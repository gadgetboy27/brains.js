/**
 * Application boot. `bootApp()` reads configuration, loads the venue, builds
 * the positioning chain and mounts the UI: the AR view (scene + arrow), the
 * floor-plan view, the HUD and the destination picker.
 *
 * ## Configuration
 *
 * Resolved in this order — query string, then environment (`import.meta.env`,
 * see .env.example), then defaults:
 *
 *  - venue:     `?venue=<url>`      / `VENUE_JSON_URL`    / the bundled demo venue
 *  - venue id:  `?v=<id>` → `${VENUE_BASE_URL ?? '/venues/'}<id>/venue.json` (QR entry, docs/entry.md)
 *  - anchor:    `?anchor=<id>` — the marker the user scanned; seeds their position
 *  - provider:  `?provider=<name>`  / `POSITIONING_PROVIDER` / the venue's own order
 *  - mock:      `?mock=1` or `provider=mock` allows the mock provider (always allowed in dev builds)
 *  - view:      `?view=ar|floorplan|auto` / default auto (tilt-driven)
 *  - filters:   `?wheelchair=1`, `?stepFree=1`, `?staff=1`
 *  - runtime:   `?runtime=<url>` / `RUNTIME_CONFIG_URL` / the venue's `runtimeConfigUrl`
 *  - harness:   `?harness=1` shows the accuracy test panel (docs/accuracy.md)
 *  - admin:     `?admin=1` shows the venue admin panel (docs/admin.md)
 *
 * ## Views
 *
 * "auto" switches between the camera view and the floor plan from the
 * phone's pitch: held up (screen facing forward) → AR; held flat (screen up,
 * waist height) → floor plan, with hysteresis so it doesn't flicker. Manual
 * buttons override it. Both views are always kept up to date.
 *
 * Every browser dependency is injectable so the whole boot runs under jsdom.
 */

import { PoseFusion } from './core/fusion.js';
import { MapMatcher } from './core/map-matching.js';
import { createNavigator } from './core/navigation.js';
import { findRoute } from './core/router.js';
import { createVenue, loadVenue } from './core/venue.js';
import { loadVenueCache, saveVenueCache } from './core/venue-cache.js';
import {
  applyRuntimeConfig,
  fetchRuntimeConfig,
  pollRuntimeConfig,
  resolveRuntimeConfigUrl,
} from './venues/runtime-config.js';
import { createProviderChain } from './providers/index.js';
import { NavigationArrow } from './ui/arrow.js';
import { ArScene } from './ui/ar-scene.js';
import { applyContrastPreference, createDestinationPicker } from './ui/destination-picker.js';
import { createAdminPanel } from './ui/admin.js';
import { createCameraBackdrop } from './ui/camera-backdrop.js';
import { createFirstRun, needsFirstRun } from './ui/first-run.js';
import { createFloorplan } from './ui/floorplan.js';
import { createHarness } from './ui/harness.js';
import { createHud } from './ui/hud.js';
import { createSpeechGuide } from './ui/speech.js';
import {
  detectLanguage,
  registerLanguage,
  resetLanguages,
  setLanguage,
  storeLanguage,
  t,
} from './ui/strings/index.js';
import { ensureStyle } from './ui/tokens.js';
import demoVenue from './venues/demo-venue.json';

const CSS = `
.app { position: fixed; inset: 0; background: var(--color-bg); }
.app-views { position: absolute; inset: 0; }
.app-view { position: absolute; inset: 0; }
.app-view[hidden] { display: none; }
.app-switch { position: fixed; top: calc(12px + env(safe-area-inset-top)); right: 12px; z-index: 25; display: flex; gap: 8px; }
`;

const FAILURE_MESSAGES = {
  'permission-denied': 'error.cameraDenied',
  'no-camera': 'error.noCamera',
  unsupported: 'error.unsupported',
};

/** Providers that need the camera (and therefore the AR view makes sense). */
const CAMERA_PROVIDERS = new Set(['immersal', 'qr']);
const LOW_BATTERY_LEVEL = 0.2;

/**
 * Read app config from the URL and environment.
 * @param {{ search?: string, env?: Record<string, string | boolean | undefined> }} [source]
 */
export function readConfig({
  search = globalThis.location?.search ?? '',
  env = import.meta.env ?? {},
} = {}) {
  const q = new URLSearchParams(search);
  const provider = q.get('provider') ?? env.POSITIONING_PROVIDER ?? null;
  const view = q.get('view') ?? 'auto';
  // Default venue id: the bundled demo, so the deployed site still loads a
  // *published* version of it (admin "Publish") when one exists.
  const venueId = q.get('v') ?? env.DEFAULT_VENUE_ID ?? null;
  const base = env.VENUE_BASE_URL ?? '/venues/';
  const venueUrl =
    q.get('venue') ??
    (venueId && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(venueId)
      ? `${base.endsWith('/') ? base : `${base}/`}${venueId}/venue.json`
      : null) ??
    env.VENUE_JSON_URL ??
    null;
  return {
    venueUrl,
    venueId,
    anchorId: q.get('anchor') ?? null,
    runtimeConfigUrl: q.get('runtime') ?? env.RUNTIME_CONFIG_URL ?? null,
    provider,
    allowMock: q.get('mock') === '1' || provider === 'mock' || Boolean(env.DEV),
    view: ['ar', 'floorplan', 'auto'].includes(view) ? view : 'auto',
    harness: q.get('harness') === '1',
    admin: q.get('admin') === '1' || q.get('survey') === '1',
    survey: q.get('survey') === '1',
    filter: {
      wheelchair: q.get('wheelchair') === '1',
      stepFree: q.get('stepFree') === '1',
      accessLevel: q.get('staff') === '1' ? 'staff' : 'visitor',
    },
  };
}

/**
 * Decide which view a device pitch calls for. `beta` is the front-back tilt
 * from DeviceOrientationEvent: ~0 flat on a table, ~90 upright.
 * @param {number} beta
 * @param {'ar' | 'floorplan'} current
 */
export function viewForTilt(beta, current) {
  if (!Number.isFinite(beta)) return current;
  if (current === 'ar' && beta < 35) return 'floorplan';
  if (current === 'floorplan' && beta > 55) return 'ar';
  return current;
}

/**
 * @param {Object} [options]
 * @param {HTMLElement} [options.root]
 * @param {Document} [options.document]
 * @param {Window} [options.window]
 * @param {ReturnType<typeof readConfig>} [options.config]
 * @param {object} [options.venue]        A pre-built Venue (skips loading).
 * @param {object} [options.providerOptions]  Extra options for createProviderChain.
 * @param {object | false} [options.mapMatching]  MapMatcher options, or false to disable snapping.
 * @param {object} [options.arSceneOptions]
 * @param {object} [options.arrowOptions]
 * @param {object} [options.floorplanOptions]
 * @param {Function} [options.requestAnimationFrame]
 * @param {Function} [options.cancelAnimationFrame]
 * @param {(url: string) => Promise<object>} [options.loadVenue]
 * @param {Storage | null} [options.storage]   For the contrast preference (default localStorage).
 */
export async function bootApp(options = {}) {
  const doc = options.document ?? globalThis.document;
  const win = options.window ?? globalThis.window;
  if (!doc) throw new TypeError('bootApp requires a document');
  const raf = options.requestAnimationFrame ?? ((cb) => win.requestAnimationFrame(cb));
  const caf = options.cancelAnimationFrame ?? ((id) => win.cancelAnimationFrame(id));
  const config = options.config ?? readConfig();

  const storage = options.storage !== undefined ? options.storage : safeStorage();
  applyContrastPreference({ document: doc, storage });
  ensureStyle('brains-app-style', CSS, doc);

  const root = options.root ?? doc.querySelector('#app') ?? doc.body;
  root.textContent = '';
  root.classList.add('app');
  root.setAttribute('aria-label', t('app.title'));

  const views = doc.createElement('div');
  views.className = 'app-views';
  const arView = doc.createElement('div');
  arView.className = 'app-view';
  arView.setAttribute('aria-label', t('view.ar'));
  const planView = doc.createElement('div');
  planView.className = 'app-view';
  planView.setAttribute('aria-label', t('view.floorplan'));
  views.append(arView, planView);
  root.appendChild(views);

  const hud = createHud({
    document: doc,
    mount: root,
    onChangeDestination: () => picker.open(),
    onCancel: () => clearDestination(),
    onToggleMute: () => speech.toggleMuted(),
    onRateChange: (rate) => speech.setRate(rate),
  });
  const speech = createSpeechGuide({
    liveRegion: hud.liveRegion,
    storage,
    ...options.speechOptions,
  });
  hud.setSpeechState({ muted: speech.muted, rate: speech.rate, supported: speech.supported });
  const offSpeech = speech.onChange((state) => hud.setSpeechState(state));

  // --- venue (with a cached copy as the fallback, so the floor plan survives
  // a failed fetch; see docs/handled-states.md)
  let venue = options.venue ?? null;
  let venueFromCache = false;
  let venueIsNew = false;
  if (!venue) {
    if (!config.venueUrl) {
      venue = createVenue(structuredClone(demoVenue));
    } else {
      try {
        venue = await (options.loadVenue ?? loadVenue)(config.venueUrl);
        saveVenueCache(config.venueUrl, venue.toJSON(), storage);
      } catch (err) {
        if (config.venueId === demoVenue.id && /HTTP 404/.test(err.message)) {
          // Nothing published yet for the demo: use the bundled copy.
          venue = createVenue(structuredClone(demoVenue));
        } else if (config.admin && config.venueId && /HTTP 404/.test(err.message)) {
          // A venue that does not exist yet: staff start it from a blank sheet.
          venue = createVenue(blankVenue(config.venueId));
          venueIsNew = true;
        }
        const cached = venue ? null : loadVenueCache(config.venueUrl, storage);
        if (cached) {
          try {
            venue = createVenue(cached.json);
            venueFromCache = true;
          } catch {
            venue = null;
          }
        }
        if (!venue) {
          hud.showError(t('error.venueLoadNoCache'), {
            hint: err.message,
            retry: () => (options.onRetryVenue ? options.onRetryVenue() : win.location?.reload?.()),
          });
          return { hud, error: err, state: 'venue-failed', destroy: () => hud.destroy() };
        }
      }
    }
  }

  // --- languages: built-in + the venue's community languages, then choose one.
  resetLanguages();
  for (const lang of venue.languages ?? []) registerLanguage(lang);
  const langCode = detectLanguage({
    search: options.search ?? globalThis.location?.search ?? '',
    storage,
    navigatorLanguages: options.navigatorLanguages ?? globalThis.navigator?.languages ?? [],
  });
  doc.documentElement.lang = langCode;
  speech.setLanguage(langCode);
  if (venueFromCache) hud.showNotice('venue-cached', t('notice.venueCached'));
  if (venueIsNew) hud.showNotice('venue-new', t('notice.venueNew', { id: venue.id }));

  // --- map matching: snap dead-reckoned poses to the corridors and notice
  // known places as they are passed (src/core/map-matching.js).
  const matcher =
    options.mapMatching === false ? null : new MapMatcher(venue, options.mapMatching ?? {});
  let lastLandmarkAnnouncedAt = -Infinity;

  // --- runtime config: closures and hidden POIs, fetched now and polled.
  const baseVenue = venue;
  const runtimeUrl = resolveRuntimeConfigUrl({
    explicit: config.runtimeConfigUrl,
    venue,
    venueUrl: config.venueUrl,
  });
  let runtimeConfig = null;
  let stopPolling = null;
  const runtimeFetchOptions = { storage, ...(options.fetch ? { fetch: options.fetch } : {}) };
  function applyRuntime(result) {
    runtimeConfig = result.config;
    venue = applyRuntimeConfig(baseVenue, result.config).venue;
    matcher?.setVenue(venue);
    showClosures();
  }
  function showClosures() {
    const closed = venue.closedEdges;
    if (closed.length === 0) hud.hideNotice('closures');
    else {
      const list = closed
        .map((e) => {
          const name =
            e.name ??
            t('closure.edgeName', {
              from: venue.nodeById(e.from)?.name ?? e.from,
              to: venue.nodeById(e.to)?.name ?? e.to,
            });
          return e.closedReason
            ? t('closure.item', { name, reason: e.closedReason })
            : t('closure.itemNoReason', { name });
        })
        .join('; ');
      hud.showNotice('closures', t('closure.notice', { list }));
    }
    if (runtimeConfig?.notice) {
      hud.showNotice('venue-notice', t('closure.venueNotice', { text: runtimeConfig.notice }));
    } else hud.hideNotice('venue-notice');
  }
  if (runtimeUrl) applyRuntime(await fetchRuntimeConfig(runtimeUrl, runtimeFetchOptions));

  // --- connectivity: a persistent notice; routing and the floor plan are local.
  const nav = options.navigator ?? globalThis.navigator;
  const applyOnline = () => {
    const online = nav?.onLine !== false;
    if (online) hud.hideNotice('offline');
    else hud.showNotice('offline', t('notice.offline'));
  };
  applyOnline();
  win?.addEventListener?.('online', applyOnline);
  win?.addEventListener?.('offline', applyOnline);

  // --- positioning
  const chain = createProviderChain(venue, {
    allowMock: config.allowMock,
    ...(config.provider ? { order: [config.provider] } : {}),
    ...options.providerOptions,
  });

  // --- views
  const arScene = new ArScene({ venue, mount: arView, document: doc, ...options.arSceneOptions });
  const arrow = new NavigationArrow({
    parent: arScene.scene,
    document: doc,
    ...options.arrowOptions,
  });
  // Live camera feed under the canvas; attached whenever the AR view is showing.
  const backdrop = createCameraBackdrop({
    mount: arView,
    document: doc,
    ...options.backdropOptions,
  });
  arScene.canvas.style.position = 'relative';
  arScene.canvas.style.zIndex = '1';
  const floorplan = createFloorplan({
    venue,
    mount: planView,
    document: doc,
    ...options.floorplanOptions,
  });
  const picker = createDestinationPicker({
    venue,
    document: doc,
    mount: root,
    showStaff: config.filter.accessLevel === 'staff',
    storage,
    onLanguageChange: (code) => {
      storeLanguage(code, storage);
      setLanguage(code);
      // Components render with the language current at construction: rebuild.
      if (options.onLanguageChange) options.onLanguageChange(code);
      else restart();
    },
    onSelect: (poi) => {
      picker.close();
      setDestination(poi);
    },
    onClose: () => picker.close(),
  });

  // View switcher
  const switcher = doc.createElement('div');
  switcher.className = 'app-switch';
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', t('view.switchHint'));
  const arBtn = doc.createElement('button');
  arBtn.type = 'button';
  arBtn.className = 'btn';
  arBtn.textContent = t('view.ar');
  arBtn.setAttribute('aria-controls', 'app-view-ar');
  arView.id = 'app-view-ar';
  planView.id = 'app-view-plan';
  const planBtn = doc.createElement('button');
  planBtn.type = 'button';
  planBtn.className = 'btn';
  planBtn.textContent = t('view.floorplan');
  planBtn.setAttribute('aria-controls', 'app-view-plan');
  switcher.append(arBtn, planBtn);
  root.appendChild(switcher);

  let view = config.view === 'floorplan' ? 'floorplan' : 'ar';
  let autoView = config.view === 'auto';
  let cameraUsable = true; // false once camera positioning is known to be unavailable
  let permissions = { camera: true, motion: true }; // set by the first-run screen
  let lowPower = false; // true while the battery is low and not charging
  function showView(next, { manual = false } = {}) {
    view = next;
    if (manual) autoView = false;
    arView.hidden = view !== 'ar';
    planView.hidden = view !== 'floorplan';
    syncBackdrop();
    arBtn.setAttribute('aria-pressed', String(view === 'ar'));
    planBtn.setAttribute('aria-pressed', String(view === 'floorplan'));
    fit();
  }
  function syncBackdrop() {
    if (view === 'ar' && permissions.camera !== false && !lowPower) {
      void backdrop.attach(chain.active ?? chainNoCamera?.active ?? null);
    } else backdrop.detach();
  }
  arBtn.addEventListener('click', () => showView('ar', { manual: true }));
  planBtn.addEventListener('click', () => showView('floorplan', { manual: true }));

  const onOrientation = (e) => {
    if (!autoView) return;
    const next = viewForTilt(e.beta, view);
    if (next === 'ar' && (!cameraUsable || lowPower)) return; // AR is pointless / too costly
    if (next !== view) showView(next);
  };

  /** Camera positioning is unavailable: fall back to the floor plan and say why. */
  function cameraUnavailable(noticeKey) {
    cameraUsable = false;
    if (noticeKey) hud.showNotice('camera', t(noticeKey));
    if (view === 'ar') showView('floorplan');
  }

  // --- battery: on low battery, prefer the floor plan (no WebGL, no camera).
  let battery = null;
  const applyBattery = () => {
    if (!battery) return;
    const low = battery.level <= LOW_BATTERY_LEVEL && !battery.charging;
    if (low && !lowPower) {
      lowPower = true;
      hud.showNotice('battery', t('notice.lowBattery'));
      if (view === 'ar') showView('floorplan');
    } else if (!low && lowPower) {
      lowPower = false;
      hud.hideNotice('battery');
    }
  };
  const batteryReady = (async () => {
    try {
      const get = options.getBattery ?? nav?.getBattery?.bind(nav);
      battery = get ? await get() : null;
    } catch {
      battery = null;
    }
    if (!battery) return;
    applyBattery();
    battery.addEventListener?.('levelchange', applyBattery);
    battery.addEventListener?.('chargingchange', applyBattery);
  })();
  win?.addEventListener?.('deviceorientation', onOrientation);

  let fitted = { w: 0, h: 0 };
  function fit() {
    const w = root.clientWidth || win?.innerWidth || 1;
    const h = root.clientHeight || win?.innerHeight || 1;
    if (w === fitted.w && h === fitted.h) return;
    fitted = { w, h };
    arScene.resize(w, h);
    floorplan.resize(w, h);
  }
  win?.addEventListener?.('resize', fit);
  fit();

  // --- navigation state
  let chainNoCamera = null;
  let offPose2 = null;
  const floorName = (i) => venue.floorByIndex(i)?.name ?? t('floor.unknown');
  let destination = null;
  let navigator = null;
  let lastPose = null;

  function setDestination(poi) {
    hud.clearError();
    const target = venue.nodeById(poi.node);
    const from = lastPose ? nearestNode(venue, lastPose) : entranceNode(venue);
    const route = findRoute(venue.graph, from.id, target.id, {
      ...config.filter,
      timeOfDay: new Date(),
    });
    if (!route.found) {
      const closed = route.closedEdgesExcluded > 0;
      hud.showError(t(closed ? 'error.noRouteClosed' : 'error.noRoute', { name: poi.name }), {
        hint: t(closed ? 'error.noRouteClosedHint' : 'error.noRouteHint'),
        retry: () => picker.open(),
      });
      return false;
    }
    destination = poi;
    navigator = createNavigator(route);
    hud.setDestination(poi);
    // Seed progress from the current pose, or from the entrance when unknown, so
    // the HUD shows a distance and speech has something to say even without a fix.
    const initial = navigator.update(lastPose ?? { ...from, heading: 0 });
    hud.setProgress(initial, { floorName });
    speech.announceDestination(poi, initial);
    arScene.setRoute(route);
    floorplan.setRoute(route);
    floorplan.setDestination(poi);
    if (!lastPose) floorplan.showFloor(from.floor); // no position: show where the route starts
    if (lastPose) onPose(lastPose);
    return true;
  }

  function clearDestination() {
    destination = null;
    navigator = null;
    hud.setDestination(null);
    arScene.setRoute(null);
    floorplan.setRoute(null);
    floorplan.setDestination(null);
    arrow.setTarget(null);
    speech.announceCancelled();
  }

  let returnToPlanAfterScan = false;
  let scanOff = null;
  let scanWatchOff = null;
  // Whoever wants the app's final pose (after dead reckoning and map
  // matching) rather than the provider's raw one: the admin panel, so the
  // coordinates it records are the ones the visitor's map will show.
  const poseListeners = new Set();
  function onPose(raw) {
    let pose = raw;
    hud.hideNotice('position'); // we have one now, however it was obtained
    if (matcher) {
      const match = matcher.update(raw);
      pose = match.pose;
      // Announce a landmark we have just come within range of — at most one
      // every 8 s so a cluster of places does not turn into a monologue.
      const landmark = match.entered.find((l) => l.kind !== 'node') ?? match.entered[0];
      if (landmark && Date.now() - lastLandmarkAnnouncedAt > 8000) {
        lastLandmarkAnnouncedAt = Date.now();
        hud.showNotice('landmark', t('landmark.passing', { name: landmark.name }));
        speech.announce(t('speech.landmark', { name: landmark.name }), { interrupt: false });
      } else if (match.left.length && match.nearby.length === 0) {
        hud.hideNotice('landmark');
      }
    }
    lastPose = pose;
    if (returnToPlanAfterScan && pose.confidence >= 1) {
      returnToPlanAfterScan = false;
      showView('floorplan', { manual: true });
    }
    arScene.setPose(pose);
    arrow.setPose(pose);
    floorplan.setPose(pose);
    for (const fn of poseListeners) fn(pose);
    if (navigator) {
      const state = navigator.update(pose);
      hud.setProgress(state, { floorName });
      speech.narrate(state, { floorName, destinationName: destination?.name });
      if (state.arrived) arrow.setTarget(null);
      else arrow.setTarget(state.nextNode, state.distanceToNext);
    }
  }
  // Providers that only produce occasional exact fixes (QR) get dead reckoning
  // here, so the position keeps moving between scans and a walk from one
  // sticker to the next gives the next one coordinates.
  const appFusion = new PoseFusion({ headingOffsetDeg: venue.headingOffsetDeg ?? 0 });
  let fusionDetach = null;
  let fusionTimer = null;
  const usesAppFusion = () => {
    const active = chain.active ?? chainNoCamera?.active ?? null;
    return Boolean(active) && !active.fusion && active.constructor?.name === 'QrProvider';
  };
  const startAppFusion = () => {
    if (fusionTimer !== null) return;
    if (win?.addEventListener) fusionDetach = appFusion.attach(win);
    fusionTimer = (options.setInterval ?? ((f, ms) => win.setInterval(f, ms)))(() => {
      if (!usesAppFusion()) return;
      const fused = appFusion.getPose();
      if (fused && fused.confidence < 1) onPose(fused);
      appFusion.tick();
    }, options.fusionIntervalMs ?? 250);
  };
  const stopAppFusion = () => {
    fusionDetach?.();
    fusionDetach = null;
    if (fusionTimer !== null)
      (options.clearInterval ?? ((id) => win.clearInterval(id)))(fusionTimer);
    fusionTimer = null;
  };
  const offFusionRescan = appFusion.on('rescan-needed', () => {
    if (!usesAppFusion()) return;
    hud.showRescan();
    speech.announceRescan();
  });
  // An exact fix (a scan, or staff fixing their position in admin mode)
  // re-seeds the dead reckoning.
  const onFix = (pose) => {
    if (usesAppFusion() && pose.confidence >= 1) {
      appFusion.applyFix(pose);
      startAppFusion();
    }
    onPose(pose);
  };
  const offPose = chain.onPose(onFix);

  // Positioning problems → HUD, never alert().
  const offChange = chain.onChange((event) => {
    if (event.type === 'exhausted') {
      // Provider failed to initialise (all of them): no position at all.
      hud.showError(t('error.positioningExhausted'), { retry: () => chain.start() });
      hud.showNotice('position', t('notice.noPosition'));
      cameraUnavailable(null);
      return;
    }
    if (event.type === 'started' || event.type === 'fallback') {
      hud.hideNotice('position');
      syncBackdrop();
      const cameraFailure = event.state.failed.find((f) => FAILURE_MESSAGES[f.reason]);
      if (cameraFailure && !CAMERA_PROVIDERS.has(event.state.active)) {
        // e.g. QR denied the camera, mock took over: AR has nothing to show.
        cameraUnavailable(
          cameraFailure.reason === 'permission-denied'
            ? 'notice.cameraDenied'
            : FAILURE_MESSAGES[cameraFailure.reason]
        );
      } else if (CAMERA_PROVIDERS.has(event.state.active)) {
        cameraUsable = true;
        hud.hideNotice('camera');
      }
      if (event.type === 'fallback') {
        const key = FAILURE_MESSAGES[event.state.failed.at(-1)?.reason];
        if (key) hud.showError(t(key));
      }
    }
    // Rescan prompt from the active provider, if it exposes one.
    const active = event.state.provider;
    if (active && typeof active.onRescanNeeded === 'function') {
      rescanOff?.();
      rescanOff = active.onRescanNeeded(() => {
        hud.showRescan();
        speech.announceRescan();
      });
    }
  });
  let rescanOff = null;

  // --- render loop
  let frame = null;
  const loop = (time) => {
    fit(); // cheap no-op unless the layout size changed (e.g. first frame after boot)
    arrow.update(time ?? 0);
    if (view === 'ar' && !lowPower) arScene.render();
    frame = raf(loop);
  };
  frame = raf(loop);

  showView(view);

  // --- first run: explain and request camera + motion before starting any
  // camera provider. "Floor plan only" drops the camera providers.
  const cameraInChain = chain.order.some((n) => CAMERA_PROVIDERS.has(n));
  let firstRun = null;
  const ask =
    cameraInChain &&
    options.firstRun !== false &&
    (await needsFirstRun({
      storage,
      ...(options.permissions ? { permissions: options.permissions } : {}),
    }));
  if (ask) {
    permissions = await new Promise((resolve) => {
      firstRun = createFirstRun({
        document: doc,
        mount: root,
        storage,
        venueName: venue.name,
        uploads: chain.declaredUploads(),
        onContinue: resolve,
        ...options.firstRunOptions,
      });
    });
    firstRun.destroy();
    if (!permissions.camera) cameraUnavailable('notice.cameraDenied');
  }

  if (config.admin)
    picker.close(); // staff surveying want the plan, not the destination list
  else picker.open();
  if (permissions.camera || !cameraInChain) {
    await chain.start();
  } else {
    // Floor-plan only: positioning without the camera, if any provider allows it.
    const rest = chain.order.filter((n) => !CAMERA_PROVIDERS.has(n));
    if (rest.length > 0) {
      await chain.stop();
      chainNoCamera = createProviderChain(venue, {
        allowMock: config.allowMock,
        order: rest,
        ...options.providerOptions,
      });
      offPose2 = chainNoCamera.onPose(onPose);
      await chainNoCamera.start();
    } else {
      hud.showNotice('position', t('notice.noPosition'));
    }
  }

  syncBackdrop();

  // --- accuracy harness (test walks): records poses, fix requests and checkpoints.
  let harness = null;
  if (config.harness) {
    harness = createHarness({
      venue,
      provider: chain,
      providerName: config.provider ?? chain.order.join('>'),
      document: doc,
      mount: root,
      ...options.harnessOptions,
    });
  }

  // --- admin (staff): record routes by walking, edit the plan, export venue JSON.
  let admin = null;
  if (config.admin) {
    admin = createAdminPanel({
      venue,
      provider: {
        onPose(fn) {
          poseListeners.add(fn);
          return () => poseListeners.delete(fn);
        },
      },
      floorplan,
      document: doc,
      mount: root,
      storage,
      initialPose: lastPose,
      onScanRequest: () => {
        // Show the camera; come back to the plan on the next exact fix (a scan).
        returnToPlanAfterScan = true;
        showView('ar', { manual: true });
      },
      onManualPose: (pose) => onFix(pose),
      publicBaseUrl: options.publicBaseUrl ?? globalThis.location?.origin,
      onClose: () => {
        admin?.destroy();
        admin = null;
        hud.setCompact(false);
      },
      ...options.adminOptions,
    });
    if (view !== 'floorplan') showView('floorplan', { manual: true }); // editing happens on the plan
    hud.setCompact(true); // give the map the screen; the HUD keeps only the status line
    if (config.survey) admin.showTab('survey');
    // Registering a printed sticker: unknown codes seen by the scanner become markers.
    const watchScans = (provider) => {
      scanOff?.();
      scanOff = null;
      if (provider && typeof provider.onScan === 'function') {
        scanOff = provider.onScan((scan) => {
          if (scan.result !== 'unrecognised' || !admin) return;
          if (admin.registering || admin.surveying) {
            const anchor = admin.registerCode(scan.text);
            if (anchor) {
              returnToPlanAfterScan = false;
              showView('floorplan', { manual: true });
            }
          } else {
            // A code recorded on this device but not yet published.
            admin.fixToCode(scan.text);
          }
        });
      }
    };
    watchScans(chain.active);
    scanWatchOff = chain.onChange((e) => watchScans(e.state.provider));
  }

  // --- QR entry: the scanned entrance marker fixes the starting position.
  if (config.anchorId) {
    const anchor = venue.anchorById(config.anchorId);
    if (anchor) {
      const pose = {
        x: anchor.x,
        y: anchor.y,
        z: anchor.z ?? 0,
        floor: anchor.floor,
        heading: anchor.heading ?? 0,
        confidence: 1,
        timestamp: Date.now(),
      };
      onPose(pose);
      chain.active?.handleScan?.(`brains://${venue.id}/${anchor.id}`); // tell a QR provider too
      hud.showNotice('anchor', t('entry.anchorSeeded', { name: anchor.name ?? anchor.id }));
    }
  }

  // Re-apply on change: a closure must take effect immediately, so rebuild
  // the UI over the adjusted venue (and re-route if navigating).
  if (runtimeUrl) {
    stopPolling = pollRuntimeConfig(runtimeUrl, {
      ...runtimeFetchOptions,
      intervalMs: options.runtimePollMs ?? 60_000,
      initial: runtimeConfig,
      ...(options.setInterval ? { setInterval: options.setInterval } : {}),
      ...(options.clearInterval ? { clearInterval: options.clearInterval } : {}),
      onChange: (result) => {
        applyRuntime(result);
        if (options.onRuntimeConfigChange) options.onRuntimeConfigChange(result, venue);
        else restart();
      },
    });
  }

  async function restart() {
    const dest = destination;
    await api.destroy();
    const next = await bootApp({ ...options, venue: baseVenue, config });
    if (dest) next.setDestination(next.venue.poiById(dest.id) ?? dest);
    return next;
  }

  const api = {
    venue,
    chain,
    hud,
    picker,
    speech,
    floorplan,
    arScene,
    arrow,
    get view() {
      return view;
    },
    get runtimeConfig() {
      return runtimeConfig;
    },
    get permissions() {
      return { ...permissions };
    },
    harness,
    admin,
    /** Explicit handled state, for tests and diagnostics. */
    backdrop,
    matcher,
    get state() {
      return {
        cameraUsable,
        landmarks: matcher ? matcher.near.map((l) => l.name) : [],
        cameraBackdrop: backdrop.source,
        lowPower,
        online: nav?.onLine !== false,
        venueFromCache,
        venueIsNew,
        positioning: chain.state.status,
        hasPose: lastPose !== null,
      };
    },
    batteryReady,
    get destination() {
      return destination;
    },
    showView: (v) => showView(v, { manual: true }),
    setDestination,
    clearDestination,
    async destroy() {
      if (frame !== null) caf(frame);
      frame = null;
      win?.removeEventListener?.('resize', fit);
      win?.removeEventListener?.('deviceorientation', onOrientation);
      stopPolling?.();
      win?.removeEventListener?.('online', applyOnline);
      win?.removeEventListener?.('offline', applyOnline);
      battery?.removeEventListener?.('levelchange', applyBattery);
      battery?.removeEventListener?.('chargingchange', applyBattery);
      offPose();
      offPose2?.();
      offFusionRescan();
      stopAppFusion();
      await chainNoCamera?.stop();
      firstRun?.destroy();
      harness?.destroy();
      scanOff?.();
      scanWatchOff?.();
      admin?.destroy();
      offChange();
      offSpeech();
      speech.destroy();
      rescanOff?.();
      await chain.stop();
      backdrop.destroy();
      arrow.dispose();
      arScene.dispose();
      floorplan.destroy();
      picker.destroy();
      hud.destroy();
      root.textContent = '';
    },
  };
  return api;
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** A minimal valid venue to start surveying from: one floor, one node at the origin. */
export function blankVenue(id) {
  const name = id.replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    schemaVersion: 1,
    id,
    name,
    floors: [{ index: 0, id: 'ground', name: 'Ground', elevation: 0 }],
    nodes: [{ id: 'n-start', x: 0, y: 0, z: 0, floor: 0, name: 'Start' }],
    edges: [],
    pois: [],
  };
}

/** Where routes start when the user's position is unknown: an entrance/exit POI, else the first node. */
export function entranceNode(venue) {
  const poi = venue.pois.find((p) => p.category === 'exit' || p.category === 'entrance');
  return (poi && venue.nodeById(poi.node)) ?? venue.graph.nodes[0];
}

/** The graph node closest to a pose on the same floor (else overall). */
export function nearestNode(venue, pose) {
  let best = null;
  let bestD = Infinity;
  for (const node of venue.graph.nodes) {
    const d = Math.hypot(node.x - pose.x, node.y - pose.y) + (node.floor === pose.floor ? 0 : 1000);
    if (d < bestD) {
      bestD = d;
      best = node;
    }
  }
  return best;
}
