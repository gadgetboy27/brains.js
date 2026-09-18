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
 *  - provider:  `?provider=<name>`  / `POSITIONING_PROVIDER` / the venue's own order
 *  - mock:      `?mock=1` or `provider=mock` allows the mock provider (always allowed in dev builds)
 *  - view:      `?view=ar|floorplan|auto` / default auto (tilt-driven)
 *  - filters:   `?wheelchair=1`, `?stepFree=1`, `?staff=1`
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

import { createNavigator } from './core/navigation.js';
import { findRoute } from './core/router.js';
import { createVenue, loadVenue } from './core/venue.js';
import { createProviderChain } from './providers/index.js';
import { NavigationArrow } from './ui/arrow.js';
import { ArScene } from './ui/ar-scene.js';
import { applyContrastPreference, createDestinationPicker } from './ui/destination-picker.js';
import { createFloorplan } from './ui/floorplan.js';
import { createHud } from './ui/hud.js';
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
  return {
    venueUrl: q.get('venue') ?? env.VENUE_JSON_URL ?? null,
    provider,
    allowMock: q.get('mock') === '1' || provider === 'mock' || Boolean(env.DEV),
    view: ['ar', 'floorplan', 'auto'].includes(view) ? view : 'auto',
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
  views.append(arView, planView);
  root.appendChild(views);

  const hud = createHud({
    document: doc,
    mount: root,
    onChangeDestination: () => picker.open(),
    onCancel: () => clearDestination(),
  });

  // --- venue
  let venue = options.venue ?? null;
  if (!venue) {
    try {
      venue = config.venueUrl
        ? await (options.loadVenue ?? loadVenue)(config.venueUrl)
        : createVenue(structuredClone(demoVenue));
    } catch (err) {
      hud.showError(t('error.venueLoad'), {
        hint: err.message,
        retry: () => win.location?.reload?.(),
      });
      return { hud, error: err, destroy: () => hud.destroy() };
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
  const planBtn = doc.createElement('button');
  planBtn.type = 'button';
  planBtn.className = 'btn';
  planBtn.textContent = t('view.floorplan');
  switcher.append(arBtn, planBtn);
  root.appendChild(switcher);

  let view = config.view === 'floorplan' ? 'floorplan' : 'ar';
  let autoView = config.view === 'auto';
  function showView(next, { manual = false } = {}) {
    view = next;
    if (manual) autoView = false;
    arView.hidden = view !== 'ar';
    planView.hidden = view !== 'floorplan';
    arBtn.setAttribute('aria-pressed', String(view === 'ar'));
    planBtn.setAttribute('aria-pressed', String(view === 'floorplan'));
    fit();
  }
  arBtn.addEventListener('click', () => showView('ar', { manual: true }));
  planBtn.addEventListener('click', () => showView('floorplan', { manual: true }));

  const onOrientation = (e) => {
    if (!autoView) return;
    const next = viewForTilt(e.beta, view);
    if (next !== view) showView(next);
  };
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
  let destination = null;
  let navigator = null;
  let lastPose = null;

  function setDestination(poi) {
    hud.clearError();
    const target = venue.nodeById(poi.node);
    const from = lastPose ? nearestNode(venue, lastPose) : venue.graph.nodes[0];
    const route = findRoute(venue.graph, from.id, target.id, {
      ...config.filter,
      timeOfDay: new Date(),
    });
    if (!route.found) {
      hud.showError(t('error.noRoute', { name: poi.name }), {
        hint: t('error.noRouteHint'),
        retry: () => picker.open(),
      });
      return false;
    }
    destination = poi;
    navigator = createNavigator(route);
    hud.setDestination(poi);
    arScene.setRoute(route);
    floorplan.setRoute(route);
    floorplan.setDestination(poi);
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
  }

  const floorName = (i) => venue.floorByIndex(i)?.name ?? t('floor.unknown');

  function onPose(pose) {
    lastPose = pose;
    arScene.setPose(pose);
    arrow.setPose(pose);
    floorplan.setPose(pose);
    if (navigator) {
      const state = navigator.update(pose);
      hud.setProgress(state, { floorName });
      if (state.arrived) arrow.setTarget(null);
      else arrow.setTarget(state.nextNode, state.distanceToNext);
    }
  }
  const offPose = chain.onPose(onPose);

  // Positioning problems → HUD, never alert().
  const offChange = chain.onChange((event) => {
    if (event.type === 'exhausted') {
      hud.showError(t('error.positioningExhausted'), { retry: () => chain.start() });
      return;
    }
    if (event.type === 'fallback') {
      const failed = event.state.failed.at(-1);
      const key = FAILURE_MESSAGES[failed?.reason];
      if (key) hud.showError(t(key));
    }
    // Rescan prompt from the active provider, if it exposes one.
    const active = event.state.provider;
    if (active && typeof active.onRescanNeeded === 'function') {
      rescanOff?.();
      rescanOff = active.onRescanNeeded(() => hud.showRescan());
    }
  });
  let rescanOff = null;

  // --- render loop
  let frame = null;
  const loop = (time) => {
    fit(); // cheap no-op unless the layout size changed (e.g. first frame after boot)
    arrow.update(time ?? 0);
    if (view === 'ar') arScene.render();
    frame = raf(loop);
  };
  frame = raf(loop);

  showView(view);
  picker.open();
  await chain.start();

  async function restart() {
    const dest = destination;
    await api.destroy();
    const next = await bootApp({ ...options, venue, config });
    if (dest) next.setDestination(dest);
    return next;
  }

  const api = {
    venue,
    chain,
    hud,
    picker,
    floorplan,
    arScene,
    arrow,
    get view() {
      return view;
    },
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
      offPose();
      offChange();
      rescanOff?.();
      await chain.stop();
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
