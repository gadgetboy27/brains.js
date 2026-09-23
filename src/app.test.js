// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D } from 'three';

import { bootApp, nearestNode, readConfig, viewForTilt } from './app.js';
import { createVenue } from './core/venue.js';
import demo from './venues/demo-venue.json';
import { availableLanguages, getLanguage, setLanguage, t } from './ui/strings/index.js';

const venue = () => createVenue(structuredClone(demo));

const stubRenderer = () => ({
  setSize: vi.fn(),
  setPixelRatio: vi.fn(),
  render: vi.fn(),
  dispose: vi.fn(),
});
const fakeLabel = (text) => {
  const o = new Object3D();
  o.name = `label:${text}`;
  return o;
};
const fakeContext = () => new Proxy({}, { get: () => () => {}, set: () => true });

async function boot(overrides = {}) {
  const frames = [];
  const app = await bootApp({
    venue: venue(),
    config: {
      venueUrl: null,
      provider: 'mock',
      allowMock: true,
      view: 'auto',
      filter: { wheelchair: false, stepFree: false, accessLevel: 'visitor' },
      ...overrides.config,
    },
    providerOptions: {
      mock: { path: [{ x: 0, y: 0, floor: 0 }], fixIntervalMs: 1000, speedMps: 0 },
      ...overrides.providerOptions,
    },
    arSceneOptions: { renderer: stubRenderer(), createLabel: fakeLabel },
    arrowOptions: {
      loadModel: async () => new Object3D(),
      createLabel: fakeLabel,
      updateLabel: () => true,
    },
    floorplanOptions: { context: fakeContext() },
    firstRun: false, // the first-run screen has its own tests below
    requestAnimationFrame: (cb) => {
      frames.push(cb);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
    ...overrides.options,
  });
  return { app, frames };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<main id="app"></main>';
  document.documentElement.removeAttribute('data-contrast');
});
afterEach(() => {
  vi.useRealTimers();
  setLanguage('en');
});

describe('readConfig', () => {
  it('reads query, then env, then defaults', () => {
    expect(readConfig({ search: '', env: {} })).toEqual({
      venueUrl: null,
      venueId: null,
      anchorId: null,
      runtimeConfigUrl: null,
      provider: null,
      allowMock: false,
      view: 'auto',
      harness: false,
      admin: false,
      survey: false,
      filter: { wheelchair: false, stepFree: false, accessLevel: 'visitor' },
    });
    expect(
      readConfig({
        search: '?venue=/v.json&provider=qr&view=floorplan&wheelchair=1&staff=1',
        env: {},
      })
    ).toMatchObject({
      venueUrl: '/v.json',
      provider: 'qr',
      view: 'floorplan',
      filter: { wheelchair: true, accessLevel: 'staff' },
    });
    expect(
      readConfig({
        search: '',
        env: { VENUE_JSON_URL: '/env.json', POSITIONING_PROVIDER: 'immersal' },
      })
    ).toMatchObject({
      venueUrl: '/env.json',
      provider: 'immersal',
      allowMock: false,
    });
    expect(readConfig({ search: '?mock=1', env: {} }).allowMock).toBe(true);
    // QR entry: venue id → URL under the venue base; anchor carried through.
    expect(
      readConfig({ search: '?v=demo-health-centre&anchor=a-entrance', env: {} })
    ).toMatchObject({
      venueUrl: '/venues/demo-health-centre/venue.json',
      venueId: 'demo-health-centre',
      anchorId: 'a-entrance',
    });
    expect(
      readConfig({ search: '?v=demo', env: { VENUE_BASE_URL: 'https://cdn.example/venues' } })
        .venueUrl
    ).toBe('https://cdn.example/venues/demo/venue.json');
    expect(readConfig({ search: '?v=../etc', env: {} }).venueUrl).toBeNull(); // ids are slugs only
    expect(readConfig({ search: '?provider=mock', env: {} }).allowMock).toBe(true);
    expect(readConfig({ search: '', env: { DEV: true } }).allowMock).toBe(true);
    expect(readConfig({ search: '?view=sideways', env: {} }).view).toBe('auto');
  });
});

describe('viewForTilt', () => {
  it('switches with hysteresis', () => {
    expect(viewForTilt(80, 'ar')).toBe('ar');
    expect(viewForTilt(30, 'ar')).toBe('floorplan');
    expect(viewForTilt(45, 'floorplan')).toBe('floorplan'); // between thresholds: hold
    expect(viewForTilt(45, 'ar')).toBe('ar');
    expect(viewForTilt(60, 'floorplan')).toBe('ar');
    expect(viewForTilt(NaN, 'ar')).toBe('ar');
  });
});

describe('nearestNode', () => {
  it('prefers nodes on the same floor', () => {
    const v = venue();
    expect(nearestNode(v, { x: 1, y: 1, floor: 0 }).id).toBe('n-entrance');
    expect(nearestNode(v, { x: 30, y: 10, floor: 1 }).id).toBe('n-lift-1');
  });
});

describe('bootApp', () => {
  it('mounts all views, opens the picker and starts positioning', async () => {
    const { app } = await boot();
    const root = document.querySelector('#app');
    expect(root.getAttribute('aria-label')).toBe(t('app.title'));
    expect(app.picker.isOpen).toBe(true);
    expect(app.chain.state.active).toBe('mock');
    expect(app.view).toBe('ar');
    expect(root.querySelectorAll('.app-view')).toHaveLength(2);
    expect(app.hud.text.destination).toBe(t('hud.noDestination'));
    expect(document.body.querySelector('.hud')).not.toBeNull();
    await app.destroy();
    expect(root.textContent).toBe('');
  });

  it('routes to a picked destination and drives HUD, arrow, scene and floor plan from poses', async () => {
    const { app, frames } = await boot();
    const clinicA = app.venue.poiById('poi-clinic-a');
    expect(app.setDestination(clinicA)).toBe(true);
    expect(app.picker.isOpen).toBe(true); // programmatic set does not close the picker
    expect(app.destination).toBe(clinicA);
    expect(app.hud.text.destination).toBe('To Clinic A');
    expect(app.hud.text.distance).toBe('22 m'); // from the mock's first pose at the entrance
    expect(app.arScene.routeObjectCount).toBeGreaterThan(0);
    expect(app.floorplan.floor).toBe(0);

    await app.arrow.ready;
    frames[0](0); // one animation frame
    expect(app.arrow.visible).toBe(true);

    // Selecting from the picker closes it.
    app.picker.setQuery('clinic b');
    app.picker.el.querySelector('[role="option"]').click();
    expect(app.picker.isOpen).toBe(false);
    expect(app.hud.text.destination).toBe('To Clinic B');

    app.clearDestination();
    expect(app.destination).toBeNull();
    expect(app.hud.text.destination).toBe(t('hud.noDestination'));
    expect(app.arrow.visible).toBe(false);
    await app.destroy();
  });

  it('shows an inline error (no alert) when no route satisfies the filters', async () => {
    const { app } = await boot({
      config: { filter: { wheelchair: true, stepFree: false, accessLevel: 'visitor' } },
    });
    // Force "after hours" so the lift is closed: monkey-patch Date via fake timers.
    vi.setSystemTime(new Date(2026, 8, 19, 23, 30));
    const ok = app.setDestination(app.venue.poiById('poi-clinic-b'));
    expect(ok).toBe(false);
    expect(app.hud.text.error).toBe('No route to Clinic B with your current settings.');
    expect(app.hud.el.querySelector('[data-f="error-hint"]').textContent).toBe(
      t('error.noRouteHint')
    );
    expect(app.destination).toBeNull();
    await app.destroy();
  });

  it('switches views manually and from device tilt (auto mode)', async () => {
    const { app } = await boot();
    const [arView, planView] = document.querySelectorAll('.app-view');
    expect(arView.hidden).toBe(false);
    expect(planView.hidden).toBe(true);

    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta: 10 }));
    expect(app.view).toBe('floorplan');
    expect(planView.hidden).toBe(false);

    app.showView('ar'); // manual choice disables auto
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta: 10 }));
    expect(app.view).toBe('ar');

    const buttons = [...document.querySelectorAll('.app-switch button')];
    expect(buttons.map((b) => b.textContent)).toEqual([t('view.ar'), t('view.floorplan')]);
    buttons[1].click();
    expect(app.view).toBe('floorplan');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    await app.destroy();
  });

  it('starts in the floor plan when configured', async () => {
    const { app } = await boot({ config: { view: 'floorplan' } });
    expect(app.view).toBe('floorplan');
    await app.destroy();
  });

  it('surfaces positioning failures through the HUD', async () => {
    const denied = new Error('no');
    denied.name = 'NotAllowedError';
    const { app } = await boot({
      config: { provider: null },
      providerOptions: {
        order: ['qr', 'mock'],
        qr: { getUserMedia: async () => Promise.reject(denied), BarcodeDetector: class {} },
      },
    });
    expect(app.chain.state.active).toBe('mock');
    // Fallback happened during start(): the HUD reports the camera denial inline.
    expect(app.hud.text.error).toBe('');
    // (fallbacks during initial start are silent; a later fallback is reported)
    await app.destroy();
  });

  it('reports an exhausted chain with a retry', async () => {
    const denied = new Error('no');
    denied.name = 'NotAllowedError';
    const { app } = await boot({
      config: { provider: null, allowMock: false },
      providerOptions: {
        order: ['qr'],
        qr: { getUserMedia: async () => Promise.reject(denied), BarcodeDetector: class {} },
      },
    });
    expect(app.chain.state.status).toBe('exhausted');
    expect(app.hud.text.error).toBe(t('error.positioningExhausted'));
    expect(app.hud.el.querySelector('[data-f="error-retry"]').hidden).toBe(false);
    await app.destroy();
  });

  it('applies the stored contrast preference at boot', async () => {
    const storage = { getItem: () => 'high', setItem: vi.fn() };
    const { app } = await boot({ options: { storage } });
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');
    expect(app.picker.el.querySelector('[data-f="contrast"]').checked).toBe(true);
    await app.destroy();
  });
});

describe('bootApp — languages', () => {
  it("registers the venue's community languages, offers them in the picker and applies ?lang=", async () => {
    const json = structuredClone(demo);
    json.languages = {
      sm: { name: 'Gagana Sāmoa', strings: { 'picker.title': 'O fea e te alu i ai?' } },
    };
    const { app } = await boot({ options: { venue: createVenue(json), search: '?lang=sm' } });
    expect(getLanguage()).toBe('sm');
    expect(document.documentElement.lang).toBe('sm');
    expect(availableLanguages().map((l) => l.code)).toEqual(['en', 'mi', 'sm']);
    expect(app.picker.el.querySelector('h2').textContent).toBe('O fea e te alu i ai?');
    expect(app.picker.el.querySelector('[data-f="close"]').textContent).toBe(t('picker.close')); // fallback: English
    const select = app.picker.el.querySelector('[data-f="lang"]');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'English',
      'Te reo Māori',
      'Gagana Sāmoa',
    ]);
    expect(select.value).toBe('sm');
    await app.destroy();
  });

  it('switching language persists the choice and rebuilds the UI in that language', async () => {
    const storage = {
      data: {},
      getItem: (k) => storage.data[k] ?? null,
      setItem: (k, v) => (storage.data[k] = v),
    };
    const onLanguageChange = vi.fn();
    const { app } = await boot({ options: { storage, onLanguageChange } });
    const select = app.picker.el.querySelector('[data-f="lang"]');
    select.value = 'mi';
    select.dispatchEvent(new Event('change'));
    expect(storage.data['brains:lang']).toBe('mi');
    expect(getLanguage()).toBe('mi');
    expect(onLanguageChange).toHaveBeenCalledWith('mi');
    await app.destroy();

    // Without an override, the app rebuilds itself and reads the stored language.
    const { app: app2 } = await boot({ options: { storage } });
    expect(app2.hud.text.destination).toBe('Kōwhiria he wāhi haere');
    expect(document.documentElement.lang).toBe('mi');
    await app2.destroy();
  });

  it('uses the browser language when nothing else is set', async () => {
    const { app } = await boot({ options: { storage: null, navigatorLanguages: ['fr', 'mi-NZ'] } });
    expect(getLanguage()).toBe('mi');
    await app.destroy();
  });
});

describe('bootApp — spoken guidance', () => {
  function fakeSynth() {
    const utterances = [];
    return {
      synth: { speak: vi.fn((u) => utterances.push(u)), cancel: vi.fn() },
      Utterance: class {
        constructor(text) {
          this.text = text;
        }
      },
      utterances,
    };
  }

  it('narrates destination, progress and arrival; mirrors into the HUD live region; mute stops speech', async () => {
    const { synth, Utterance, utterances } = fakeSynth();
    const { app } = await boot({
      options: { speechOptions: { synth, Utterance, storage: null } },
      providerOptions: {
        mock: { path: [{ x: 0, y: 0, floor: 0 }], fixIntervalMs: 1000, speedMps: 0 },
      },
    });
    app.setDestination(app.venue.poiById('poi-clinic-a'));
    expect(utterances.at(-1).text).toBe('Navigating to Clinic A. 22 metres to go.');
    expect(app.hud.liveRegion.textContent).toBe('Navigating to Clinic A. 22 metres to go.');
    expect(utterances.at(-1).lang).toBe('en-NZ');

    // Move the walker to the lobby via the mock's teleport: next step spoken.
    app.chain.active.teleport({ x: 0, y: 6, floor: 0 });
    expect(utterances.at(-1).text).toBe('Continue 10 metres to Ground corridor, west.');

    // Mute from the HUD: nothing more is spoken, but the live region still updates.
    app.hud.el.querySelector('[data-f="mute"]').click();
    expect(app.speech.muted).toBe(true);
    const spokenBefore = utterances.length;
    app.chain.active.teleport({ x: 10, y: 11, floor: 0 });
    expect(app.hud.text.destination).toBe('You have arrived at Clinic A');
    expect(utterances.length).toBe(spokenBefore);
    expect(app.hud.liveRegion.textContent).toBe('You have arrived at Clinic A.');

    // Rate control.
    const rate = app.hud.el.querySelector('[data-f="rate"]');
    rate.value = '1.3';
    rate.dispatchEvent(new Event('change'));
    expect(app.speech.rate).toBe(1.3);
    await app.destroy();
  });

  it('works without speech synthesis: controls disabled, live region still narrates', async () => {
    const { app } = await boot({
      options: { speechOptions: { synth: null, Utterance: null, storage: null } },
    });
    expect(app.speech.supported).toBe(false);
    expect(app.hud.el.querySelector('[data-f="mute"]').disabled).toBe(true);
    app.setDestination(app.venue.poiById('poi-clinic-a'));
    expect(app.hud.liveRegion.textContent).toBe('Navigating to Clinic A. 22 metres to go.');
    await app.destroy();
  });

  it('has landmarks and labels for assistive technology', async () => {
    const { app } = await boot();
    const root = document.querySelector('#app');
    expect(root.querySelector('#app-view-ar canvas').getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('.app-switch').getAttribute('role')).toBe('group');
    expect(root.querySelector('.app-switch button').getAttribute('aria-controls')).toBe(
      'app-view-ar'
    );
    expect(root.querySelector('.floorplan canvas').getAttribute('role')).toBe('img');
    expect(root.querySelector('.floorplan button').getAttribute('aria-label')).toBe(
      t('floorplan.rotation')
    );
    expect(root.querySelector('.hud [aria-live="polite"]')).not.toBeNull();
    expect(root.querySelector('.hud [role="alert"]')).not.toBeNull();
    expect(root.querySelector('.picker').getAttribute('role')).toBe('dialog');
    await app.destroy();
  });
});

describe('bootApp — handled states (floor plan stays usable in every one)', () => {
  const denied = () => {
    const e = new Error('no');
    e.name = 'NotAllowedError';
    return e;
  };
  const qrDenied = () => ({
    getUserMedia: async () => Promise.reject(denied()),
    BarcodeDetector: class {},
  });
  const usable = (app) => {
    // The floor plan is mounted, a destination can be chosen, and a route is drawn on it.
    expect(app.view).toBe('floorplan');
    expect(document.querySelector('#app-view-plan').hidden).toBe(false);
    expect(app.setDestination(app.venue.poiById('poi-clinic-b'))).toBe(true);
    expect(app.hud.text.destination).toBe('To Clinic B');
    expect(app.hud.text.distance).toMatch(/\d+ m/);
    expect(app.floorplan.el.querySelector('.floorplan-banner').hidden).toBe(false); // destination floor banner
  };

  it('camera permission denied: falls back, notices, switches to the floor plan, keeps auto-AR off', async () => {
    const { app } = await boot({
      config: { provider: null },
      providerOptions: { order: ['qr', 'mock'], qr: qrDenied() },
    });
    expect(app.chain.state.active).toBe('mock');
    expect(app.state.cameraUsable).toBe(false);
    expect(app.hud.text.notices).toContain(t('notice.cameraDenied'));
    usable(app);
    // Tilting the phone up must not bring back a camera view that cannot work…
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { beta: 80 }));
    expect(app.view).toBe('floorplan');
    // …but the user may still choose it explicitly.
    app.showView('ar');
    expect(app.view).toBe('ar');
    await app.destroy();
  });

  it('provider failed to initialise (all of them): error with retry, no-position notice, routes from the entrance', async () => {
    const { app } = await boot({
      config: { provider: null, allowMock: false },
      providerOptions: { order: ['qr'], qr: qrDenied() },
    });
    expect(app.chain.state.status).toBe('exhausted');
    expect(app.state.hasPose).toBe(false);
    expect(app.hud.text.error).toBe(t('error.positioningExhausted'));
    expect(app.hud.el.querySelector('[data-f="error-retry"]').hidden).toBe(false);
    // The real reason is right there, not just "didn't work" — this is
    // what makes a repeat of this actually diagnosable.
    expect(app.hud.el.querySelector('[data-f="error-hint"]').textContent).toBe(
      'qr: permission-denied — no'
    );
    expect(app.hud.text.notices).toContain(t('notice.noPosition'));
    usable(app);
    // Route starts at the main entrance (the "exit" POI) when there is no pose.
    expect(app.hud.text.distance).toBe('46 m'); // entrance → Clinic B via the stairs

    // Manually switching back to the camera view must never show a preview
    // that looks like it's scanning when nothing is — that's what made a
    // dead camera indistinguishable from a working one.
    app.showView('ar');
    expect(app.view).toBe('ar');
    expect(app.backdrop.source).toBe('none');
    const unavailable = app.scanOverlay.el.parentElement.querySelector('.scan-unavailable');
    expect(unavailable.hidden).toBe(false);
    expect(unavailable.textContent).toContain(t('error.positioningExhausted'));
    expect(unavailable.textContent).toContain('qr: permission-denied — no'); // the real reason, right here
    expect(document.querySelector('.camera-backdrop').hidden).toBe(true);
    await app.destroy();
  });

  it('venue map failed to load: uses the cached copy with a notice…', async () => {
    const storage = {
      data: {},
      getItem: (k) => storage.data[k] ?? null,
      setItem: (k, v) => (storage.data[k] = v),
    };
    // First boot succeeds and populates the cache.
    const first = await bootApp({
      config: {
        venueUrl: '/venue.json',
        provider: 'mock',
        allowMock: true,
        view: 'floorplan',
        filter: {},
      },
      loadVenue: async () => createVenue(structuredClone(demo)),
      storage,
      arSceneOptions: { renderer: stubRenderer(), createLabel: fakeLabel },
      arrowOptions: {
        loadModel: async () => new Object3D(),
        createLabel: fakeLabel,
        updateLabel: () => true,
      },
      floorplanOptions: { context: fakeContext() },
      speechOptions: { synth: null, Utterance: null, storage: null },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    });
    expect(Object.keys(storage.data).some((k) => k.startsWith('brains:venue-cache:'))).toBe(true);
    await first.destroy();

    // Second boot: the fetch fails, the cached copy is used.
    const second = await bootApp({
      config: {
        venueUrl: '/venue.json',
        provider: 'mock',
        allowMock: true,
        view: 'floorplan',
        filter: {},
      },
      loadVenue: async () => Promise.reject(new Error('HTTP 503')),
      storage,
      arSceneOptions: { renderer: stubRenderer(), createLabel: fakeLabel },
      arrowOptions: {
        loadModel: async () => new Object3D(),
        createLabel: fakeLabel,
        updateLabel: () => true,
      },
      floorplanOptions: { context: fakeContext() },
      speechOptions: { synth: null, Utterance: null, storage: null },
      providerOptions: { mock: { path: [{ x: 0, y: 0, floor: 0 }], speedMps: 0 } },
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    });
    expect(second.state.venueFromCache).toBe(true);
    expect(second.venue.id).toBe('demo-health-centre');
    expect(second.hud.text.notices).toContain(t('notice.venueCached'));
    usable(second);
    await second.destroy();
  });

  it('…and without a cached copy shows an error with retry', async () => {
    const onRetryVenue = vi.fn();
    const app = await bootApp({
      config: {
        venueUrl: '/venue.json',
        provider: 'mock',
        allowMock: true,
        view: 'auto',
        filter: {},
      },
      loadVenue: async () => Promise.reject(new Error('HTTP 404')),
      storage: { getItem: () => null, setItem: () => {} },
      onRetryVenue,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    });
    expect(app.state).toBe('venue-failed');
    expect(app.error.message).toBe('HTTP 404');
    expect(app.hud.text.error).toBe(t('error.venueLoadNoCache'));
    app.hud.el.querySelector('[data-f="error-retry"]').click();
    expect(onRetryVenue).toHaveBeenCalledOnce();
    app.destroy();
  });

  it('offline: a persistent notice that clears when back online; routing still works', async () => {
    const navigator = { onLine: false, languages: ['en'] };
    const { app } = await boot({ options: { navigator }, config: { view: 'floorplan' } });
    expect(app.state.online).toBe(false);
    expect(app.hud.text.notices).toContain(t('notice.offline'));
    usable(app);

    navigator.onLine = true;
    window.dispatchEvent(new Event('online'));
    expect(app.hud.text.notices).not.toContain(t('notice.offline'));
    navigator.onLine = false;
    window.dispatchEvent(new Event('offline'));
    expect(app.hud.text.notices).toContain(t('notice.offline'));
    await app.destroy();
  });

  it('low battery: notice, floor plan, AR rendering paused; recovers when charging', async () => {
    const listeners = {};
    const battery = {
      level: 0.15,
      charging: false,
      addEventListener: (type, fn) => (listeners[type] = fn),
      removeEventListener: vi.fn(),
    };
    const renderer = stubRenderer();
    const { app, frames } = await boot({
      options: {
        getBattery: async () => battery,
        arSceneOptions: { renderer, createLabel: fakeLabel },
      },
    });
    await app.batteryReady;
    expect(app.state.lowPower).toBe(true);
    expect(app.hud.text.notices).toContain(t('notice.lowBattery'));
    usable(app);

    // A frame in low power does not render the 3-D scene, even if AR is chosen manually.
    app.showView('ar');
    frames.at(-1)(16);
    expect(renderer.render).not.toHaveBeenCalled();

    // Plugging in lifts the restriction.
    battery.charging = true;
    listeners.chargingchange();
    expect(app.state.lowPower).toBe(false);
    expect(app.hud.text.notices).not.toContain(t('notice.lowBattery'));
    frames.at(-1)(32);
    expect(renderer.render).toHaveBeenCalled();
    await app.destroy();
    expect(battery.removeEventListener).toHaveBeenCalledTimes(2);
  });
});

describe('bootApp — runtime config (closures and hidden POIs without a redeploy)', () => {
  const liftClosed = {
    version: 1,
    closures: [{ from: 'n-lift-g', to: 'n-lift-1', reason: 'Lift out of service' }],
    hiddenPois: ['poi-toilets-g'],
    notice: 'Ground floor toilets closed for cleaning.',
  };
  const ok = (json) => ({ ok: true, status: 200, json: async () => json });

  it('fetches the config at startup and surfaces it in routing, the picker and the HUD', async () => {
    let current = liftClosed;
    const fetch = vi.fn(async () => ok(current));
    const { app } = await boot({
      config: {
        runtimeConfigUrl: '/runtime.json',
        filter: { wheelchair: true, stepFree: false, accessLevel: 'visitor' },
      },
      options: { fetch, storage: null, onRuntimeConfigChange: vi.fn(), runtimePollMs: 1000 },
    });
    expect(fetch).toHaveBeenCalledWith('/runtime.json', { cache: 'no-store' });
    expect(app.runtimeConfig.closures).toHaveLength(1);

    // HUD lists the closure and the venue notice.
    expect(app.hud.text.notices).toContain(
      'Closed: Passenger lift (out of service overnight) (Lift out of service)'
    );
    expect(app.hud.text.notices).toContain('Ground floor toilets closed for cleaning.');

    // Picker hides the POI.
    expect(app.picker.results.map((p) => p.id)).not.toContain('poi-toilets-g');
    expect(app.venue.visiblePois.map((p) => p.id)).not.toContain('poi-toilets-g');

    // Routing refuses the closed lift for a wheelchair user, with a closure-specific message.
    vi.setSystemTime(new Date(2026, 8, 19, 12, 0));
    expect(app.setDestination(app.venue.poiById('poi-clinic-b'))).toBe(false);
    expect(app.hud.text.error).toBe('No route to Clinic B: part of the way is closed.');
    expect(app.hud.el.querySelector('[data-f="error-hint"]').textContent).toBe(
      t('error.noRouteClosedHint')
    );
    await app.destroy();
  });

  it('re-applies immediately when the polled config changes', async () => {
    let current = liftClosed;
    const fetch = vi.fn(async () => ok(current));
    const onRuntimeConfigChange = vi.fn();
    const { app } = await boot({
      config: { runtimeConfigUrl: '/runtime.json' },
      options: { fetch, storage: null, onRuntimeConfigChange, runtimePollMs: 1000 },
    });
    expect(app.hud.text.notices.some((n) => n.startsWith('Closed:'))).toBe(true);

    current = { version: 1, closures: [], hiddenPois: [] }; // operator reopens the lift
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRuntimeConfigChange).toHaveBeenCalledOnce();
    const [, adjusted] = onRuntimeConfigChange.mock.calls[0];
    expect(adjusted.closedEdges).toHaveLength(0);
    expect(adjusted.visiblePois.map((p) => p.id)).toContain('poi-toilets-g');
    expect(app.hud.text.notices.some((n) => n.startsWith('Closed:'))).toBe(false);
    await app.destroy();
  });

  it('uses the cached config when the fetch fails, and runs without one when nothing is configured', async () => {
    const storage = {
      data: {},
      getItem: (k) => storage.data[k] ?? null,
      setItem: (k, v) => (storage.data[k] = v),
    };
    const { app: first } = await boot({
      config: { runtimeConfigUrl: '/runtime.json' },
      options: { fetch: async () => ok(liftClosed), storage, onRuntimeConfigChange: vi.fn() },
    });
    await first.destroy();
    const { app: second } = await boot({
      config: { runtimeConfigUrl: '/runtime.json' },
      options: {
        fetch: async () => Promise.reject(new Error('offline')),
        storage,
        onRuntimeConfigChange: vi.fn(),
      },
    });
    expect(second.runtimeConfig.closures).toHaveLength(1);
    expect(second.hud.text.notices.some((n) => n.startsWith('Closed:'))).toBe(true);
    await second.destroy();

    const { app: none } = await boot();
    expect(none.runtimeConfig).toBeNull();
    expect(none.venue.closedEdges).toHaveLength(0);
    await none.destroy();
  });

  it('the venue JSON can point at its own runtime config, resolved relative to the venue URL', async () => {
    const json = structuredClone(demo);
    json.runtimeConfigUrl = 'runtime.json';
    const fetch = vi.fn(async () => ok({ version: 1 }));
    const app = await bootApp({
      config: {
        venueUrl: '/venues/demo/venue.json',
        runtimeConfigUrl: null,
        provider: 'mock',
        allowMock: true,
        view: 'floorplan',
        filter: {},
      },
      loadVenue: async () => createVenue(json),
      fetch,
      storage: null,
      arSceneOptions: { renderer: stubRenderer(), createLabel: fakeLabel },
      arrowOptions: {
        loadModel: async () => new Object3D(),
        createLabel: fakeLabel,
        updateLabel: () => true,
      },
      floorplanOptions: { context: fakeContext() },
      speechOptions: { synth: null, Utterance: null, storage: null },
      providerOptions: { mock: { path: [{ x: 0, y: 0, floor: 0 }], speedMps: 0 } },
      onRuntimeConfigChange: vi.fn(),
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    });
    expect(fetch).toHaveBeenCalledWith('/venues/demo/runtime.json', { cache: 'no-store' });
    await app.destroy();
  });
});

describe('bootApp — QR entry and first run', () => {
  it('seeds the position from the scanned entrance anchor', async () => {
    const { app } = await boot({
      config: { anchorId: 'a-lift-1', provider: 'mock', allowMock: true },
      providerOptions: { mock: { path: [], fixIntervalMs: 100000 } }, // mock emits nothing useful
    });
    expect(app.state.hasPose).toBe(true);
    expect(app.floorplan.floor).toBe(1); // a-lift-1 is on the first floor
    expect(app.hud.text.notices).toContain('Starting from the a-lift-1 marker.');
    app.setDestination(app.venue.poiById('poi-clinic-b'));
    expect(app.hud.text.distance).toBe('19 m'); // (30,9) → corridor east (3) → middle (10) → Clinic B (6)
    await app.destroy();
  });

  it('ignores an unknown anchor', async () => {
    const { app } = await boot({ config: { anchorId: 'a-nope' } });
    expect(app.hud.text.notices.some((n) => n.startsWith('Starting from'))).toBe(false);
    await app.destroy();
  });

  it('shows the first-run screen before starting a camera provider; Allow requests motion, warms the camera, then starts', async () => {
    const requestMotion = vi.fn(async () => 'granted');
    const warmCamera = vi.fn(async () => true);
    const storage = {
      data: {},
      getItem: (k) => storage.data[k] ?? null,
      setItem: (k, v) => (storage.data[k] = v),
    };
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const bootPromise = boot({
      config: { provider: null },
      providerOptions: {
        order: ['qr', 'mock'],
        qr: {
          getUserMedia: async () => stream,
          BarcodeDetector: class {
            detect = async () => [];
          },
        },
      },
      options: {
        firstRun: undefined,
        storage,
        permissions: { query: async () => ({ state: 'prompt' }) },
        firstRunOptions: { requestMotion, warmCamera },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    const screen = document.querySelector('.firstrun');
    expect(screen).not.toBeNull();
    expect(screen.getAttribute('role')).toBe('dialog');
    expect(screen.querySelector('[data-f="camera-why"]').textContent).toBe(
      t('firstRun.camera.why')
    );
    // Data disclosure comes from the providers: QR and mock send nothing.
    expect(screen.querySelector('[data-f="data"]').textContent).toBe(t('firstRun.data.none'));

    screen.querySelector('[data-f="allow"]').click();
    const { app } = await bootPromise;
    expect(requestMotion).toHaveBeenCalledOnce();
    expect(warmCamera).toHaveBeenCalledOnce();
    expect(storage.data['brains:permissions']).toBe('granted');
    expect(document.querySelector('.firstrun')).toBeNull();
    expect(app.permissions).toEqual({ camera: true, motion: true });
    expect(app.chain.state.active).toBe('qr');
    await app.destroy();
  });

  it('camera granted but motion declined: QR still starts, but a notice says position may not track', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const storage = {
      data: {},
      getItem: (k) => storage.data[k] ?? null,
      setItem: (k, v) => (storage.data[k] = v),
    };
    const bootPromise = boot({
      config: { provider: null },
      providerOptions: {
        order: ['qr'],
        qr: {
          getUserMedia: async () => stream,
          BarcodeDetector: class {
            detect = async () => [];
          },
        },
      },
      options: {
        firstRun: undefined,
        storage,
        permissions: { query: async () => ({ state: 'prompt' }) },
        firstRunOptions: {
          requestMotion: async () => 'denied',
          warmCamera: async () => true,
        },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    document.querySelector('.firstrun [data-f="allow"]').click();
    const { app } = await bootPromise;
    expect(app.permissions).toEqual({ camera: true, motion: false });
    expect(app.chain.state.active).toBe('qr'); // camera positioning still works…
    expect(app.hud.text.notices).toContain(t('notice.motionDenied')); // …but this is why steps won't count
    await app.destroy();
  });

  it('"floor plan only" skips camera providers and keeps the floor plan usable', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const bootPromise = boot({
      config: { provider: null },
      providerOptions: {
        order: ['qr', 'mock'],
        qr: { getUserMedia: async () => stream, BarcodeDetector: class {} },
      },
      options: {
        firstRun: undefined,
        storage: null,
        permissions: { query: async () => ({ state: 'prompt' }) },
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    document.querySelector('.firstrun [data-f="floorplan"]').click();
    const { app } = await bootPromise;
    expect(app.permissions.camera).toBe(false);
    expect(app.view).toBe('floorplan');
    expect(app.state.cameraUsable).toBe(false);
    expect(app.chain.state.active).toBeNull(); // the camera chain was not started
    expect(app.setDestination(app.venue.poiById('poi-clinic-a'))).toBe(true);
    await app.destroy();
  });

  it('is skipped when camera permission is already granted or remembered', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const providerOptions = {
      order: ['qr'],
      qr: {
        getUserMedia: async () => stream,
        BarcodeDetector: class {
          detect = async () => [];
        },
      },
    };
    const a = await boot({
      config: { provider: null },
      providerOptions,
      options: {
        firstRun: undefined,
        storage: null,
        permissions: { query: async () => ({ state: 'granted' }) },
      },
    });
    expect(document.querySelector('.firstrun')).toBeNull();
    await a.app.destroy();
    const storage = { getItem: () => 'granted', setItem: () => {} };
    const b = await boot({
      config: { provider: null },
      providerOptions,
      options: {
        firstRun: undefined,
        storage,
        permissions: { query: async () => ({ state: 'prompt' }) },
      },
    });
    expect(document.querySelector('.firstrun')).toBeNull();
    await b.app.destroy();
  });

  it('is not shown for venues with no camera provider', async () => {
    const { app } = await boot({ options: { firstRun: undefined, storage: null } }); // mock only
    expect(document.querySelector('.firstrun')).toBeNull();
    await app.destroy();
  });
});

describe('bootApp — admin mode', () => {
  it('mounts the admin panel on the floor plan and records from live poses', async () => {
    const { app } = await boot({
      config: { admin: true },
      options: {
        adminOptions: { storage: null, download: vi.fn(), copy: vi.fn(), prompt: vi.fn(() => 'x') },
      },
      providerOptions: {
        mock: { path: [{ x: 40, y: 6, floor: 0 }], fixIntervalMs: 1000, speedMps: 0 },
      },
    });
    expect(app.admin).not.toBeNull();
    expect(app.view).toBe('floorplan');
    expect(app.picker.isOpen).toBe(false); // staff see the plan first
    expect(document.querySelector('.admin')).not.toBeNull();
    app.admin.startRecording();
    const node = app.admin.addNodeHere('Pharmacy');
    expect(node).toMatchObject({ x: 40, y: 6, floor: 0, name: 'Pharmacy' });
    expect(app.admin.draft.validate()).toEqual([]);
    await app.destroy();
    expect(document.querySelector('.admin')).toBeNull();
  });
});

describe('bootApp — admin on a phone', () => {
  it('compacts the HUD while admin is open, and "scan a marker" shows the camera until an exact fix', async () => {
    const { app } = await boot({
      config: { admin: true },
      options: {
        adminOptions: { storage: null, download: vi.fn(), copy: vi.fn(), prompt: vi.fn(() => 'x') },
      },
      providerOptions: {
        mock: { path: [{ x: 0, y: 0, floor: 0 }], fixIntervalMs: 100000, speedMps: 0 },
      },
    });
    expect(app.hud.compact).toBe(true);
    expect(app.view).toBe('floorplan');

    app.admin.el.querySelector('[data-f="rec-scan"]').click();
    expect(app.view).toBe('ar');
    // A dead-reckoned pose does not bring the plan back; an exact fix (a scan) does.
    app.chain.active.forceLowConfidence(0.4);
    app.chain.active.teleport({ x: 1, y: 1, floor: 0 });
    expect(app.view).toBe('ar');
    app.chain.active.clearForcedConfidence();
    app.chain.active.forceLowConfidence(1);
    app.chain.active.teleport({ x: 2, y: 2, floor: 0 });
    expect(app.view).toBe('floorplan');

    app.admin.el.querySelector('[data-f="close"]').click();
    expect(app.hud.compact).toBe(false);
    expect(document.querySelector('.admin')).toBeNull();
    await app.destroy();
  });
});

describe('bootApp — map matching', () => {
  it('snaps drifting poses onto the corridor and announces places as they are passed', async () => {
    const { synth, Utterance, utterances } = (() => {
      const u = [];
      return {
        synth: { speak: vi.fn((x) => u.push(x)), cancel: vi.fn() },
        Utterance: class {
          constructor(t) {
            this.text = t;
          }
        },
        utterances: u,
      };
    })();
    const { app } = await boot({
      options: { speechOptions: { synth, Utterance, storage: null } },
      providerOptions: {
        mock: { path: [{ x: 0, y: 0, floor: 0 }], fixIntervalMs: 100000, speedMps: 0 },
      },
    });
    // Start at the entrance: the entrance landmark is announced once.
    expect(app.hud.text.notices).toContain('Passing Main entrance');
    expect(utterances.at(-1).text).toBe('Passing Main entrance.');

    // A dead-reckoned pose 2 m into the wall beside the corridor is pulled back onto it.
    app.chain.active.forceLowConfidence(0.5);
    app.chain.active.teleport({ x: 15, y: 8, floor: 0 });
    expect(app.floorplan.summary).toContain('You are at 15.0, 6.0 metres');
    expect(app.state.landmarks).toEqual([]); // nothing marked mid-corridor

    // An exact fix is never moved.
    app.chain.active.clearForcedConfidence();
    app.chain.active.forceLowConfidence(1);
    app.chain.active.teleport({ x: 15, y: 8, floor: 0 });
    expect(app.floorplan.summary).toContain('You are at 15.0, 8.0 metres');
    await app.destroy();
  });

  it('can be disabled', async () => {
    const { app } = await boot({
      options: { mapMatching: false },
      providerOptions: {
        mock: { path: [{ x: 15, y: 8, floor: 0 }], fixIntervalMs: 100000, speedMps: 0 },
      },
    });
    expect(app.matcher).toBeNull();
    expect(app.floorplan.summary).toContain('You are at 15.0, 8.0 metres');
    await app.destroy();
  });
});

describe('bootApp — registering a printed sticker from the scanner', () => {
  it('an unrecognised scan while registering becomes a marker at the current position', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const vibrate = vi.fn();
    const { app } = await boot({
      config: { admin: true, provider: null },
      options: {
        navigator: { vibrate, onLine: true },
        adminOptions: {
          storage: null,
          download: vi.fn(),
          copy: vi.fn(),
          prompt: vi.fn(() => 'Ward door sticker'),
          qrDataUrl: async () => 'data:,',
        },
      },
      providerOptions: {
        order: ['qr'],
        qr: {
          getUserMedia: async () => stream,
          BarcodeDetector: class {
            detect = async () => [];
          },
        },
      },
    });
    expect(app.chain.state.active).toBe('qr');
    app.admin.setManualPose({ x: 12, y: 6, floor: 0 });
    app.admin.beginRegister();
    expect(app.view).toBe('ar'); // camera shown to scan
    app.chain.active.handleScan('ROLL-0042');
    expect(app.admin.draft.anchors.at(-1)).toMatchObject({
      x: 12,
      y: 6,
      code: 'ROLL-0042',
      name: 'Ward door sticker',
    });
    expect(app.view).toBe('floorplan'); // back to the plan once registered
    // Registering a brand-new sticker is success, not a problem — the venue
    // not already knowing the code is the whole point of scanning it here.
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(vibrate).not.toHaveBeenCalledWith(40);
    await app.destroy();
  });
});

describe('bootApp — sticker survey of a new venue', () => {
  it('?survey=1 on an unpublished venue: blank sheet, scan-name-record, dead reckoning between codes', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const { app } = await boot({
      config: {
        admin: true,
        survey: true,
        provider: null,
        venueUrl: '/venues/north-shore/venue.json',
        venueId: 'north-shore',
      },
      options: {
        venue: null,
        loadVenue: async () => Promise.reject(new Error('HTTP 404')),
        adminOptions: {
          storage: null,
          download: vi.fn(),
          copy: vi.fn(),
          prompt: vi.fn(() => 'x'),
          qrDataUrl: async () => 'data:,',
        },
      },
      providerOptions: {
        order: ['qr'],
        qr: {
          getUserMedia: async () => stream,
          BarcodeDetector: class {
            detect = async () => [];
          },
        },
      },
    });
    // Nothing published yet: staff start from a blank sheet, on the survey tab.
    expect(app.state.venueIsNew).toBe(true);
    expect(app.venue.name).toBe('North Shore');
    expect(app.hud.text.notices.join(' ')).toContain('north-shore');
    expect(app.admin.tab).toBe('survey');
    expect(app.view).toBe('floorplan');
    expect(app.chain.state.active).toBe('qr');

    // Name the area, scan the printed code: recorded at the origin.
    app.admin.el.querySelector('[data-f="survey-name"]').value = 'Main reception';
    app.admin.beginSurveyScan();
    expect(app.view).toBe('ar');
    app.chain.active.handleScan('A03');
    expect(app.view).toBe('floorplan');
    expect(app.admin.draft.anchors.at(-1)).toMatchObject({
      x: 0,
      y: 0,
      code: 'A03',
      name: 'Main reception',
    });
    expect(app.state.hasPose).toBe(true);

    // Walk forward (device motion, heading 0 = +y): step counting follows
    // between scans even though the QR provider only reports exact fixes.
    // Each footstep is a peak-then-fall in acceleration magnitude; steps
    // 400 ms apart clear the default refractory window.
    const step = () => {
      window.dispatchEvent(
        Object.assign(new Event('devicemotion'), { acceleration: { x: 0, y: 2.5, z: 0 } })
      );
      window.dispatchEvent(
        Object.assign(new Event('devicemotion'), { acceleration: { x: 0, y: 0.2, z: 0 } })
      );
    };
    const stepsFor2m = Math.ceil(2 / 0.73); // default strideM
    for (let i = 0; i < stepsFor2m; i += 1) {
      step();
      vi.advanceTimersByTime(400);
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(app.floorplan.summary).toContain(
      `You are at 0.0, ${(stepsFor2m * 0.73).toFixed(1)} metres`
    );

    // The next code gets those coordinates and is linked to the first.
    app.admin.el.querySelector('[data-f="survey-name"]').value = 'Lift lobby';
    app.admin.beginSurveyScan();
    app.chain.active.handleScan('A04');
    const lift = app.admin.draft.anchors.at(-1);
    expect(lift).toMatchObject({ code: 'A04', name: 'Lift lobby' });
    expect(lift.y).toBeCloseTo(stepsFor2m * 0.73, 5);
    expect(app.admin.draft.edges).toHaveLength(1);
    expect(app.admin.draft.validate()).toEqual([]);

    // The scanner now knows both stickers: re-scanning fixes the position back.
    app.chain.active.handleScan('A03');
    expect(app.floorplan.summary).toContain('You are at 0.0, 0.0 metres');
    await app.destroy();
  });
});

describe('bootApp — every scan gets a visible reaction', () => {
  it('names an unknown or foreign code in the HUD; a recognised marker clears it', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    const vibrate = vi.fn();
    const { app } = await boot({
      config: { provider: null },
      options: { navigator: { vibrate, onLine: true } },
      providerOptions: {
        order: ['qr'],
        qr: {
          getUserMedia: async () => stream,
          BarcodeDetector: class {
            detect = async () => [];
          },
        },
      },
    });
    // The viewfinder is up (a QR-capable provider, camera view showing) and
    // flashes on every decode — proof frames are being read, whatever the
    // code turns out to be — separate from the HUD notice about it.
    const frame = app.scanOverlay.el.querySelector('[data-f="frame"]');
    expect(frame.hidden).toBe(false);

    app.chain.active.handleScan('https://stickers.example/print/A07');
    expect(app.hud.text.notices).toContain('Code “A07” is not a marker for this venue.');
    expect(vibrate).toHaveBeenCalledWith(40);
    expect(frame.classList.contains('flash')).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(frame.classList.contains('flash')).toBe(false);

    app.chain.active.handleScan('brains://other-venue/a-1');
    expect(app.hud.text.notices).toContain('Code “a-1” belongs to a different venue.');

    vibrate.mockClear();
    app.chain.active.handleScan(`brains://${app.venue.id}/${app.venue.anchors[0].id}`);
    expect(app.hud.text.notices.some((n) => n.startsWith('Code “'))).toBe(false);
    expect(app.state.hasPose).toBe(true);
    expect(frame.classList.contains('flash')).toBe(true); // a recognised marker still flashes
    expect(vibrate).toHaveBeenCalledWith(15); // a short, distinct buzz from the "problem" one above
    await app.destroy();
  });
});

describe('bootApp — route wizard', () => {
  it('admin opens on Routes; scan start, walk, scan destination — saved and chained, nothing typed', async () => {
    const { app } = await boot({
      config: { admin: true, venueUrl: '/venues/wing-b/venue.json', venueId: 'wing-b' },
      options: {
        venue: null,
        loadVenue: async () => Promise.reject(new Error('HTTP 404')),
        adminOptions: { storage: null, download: vi.fn(), copy: vi.fn(), prompt: vi.fn(() => 'x') },
        mapMatching: false,
      },
      providerOptions: {
        mock: { path: [{ x: 0, y: 0, floor: 0 }], fixIntervalMs: 1000, speedMps: 0, confidence: 1 },
      },
    });
    const admin = app.admin;
    const wizard = admin.wizard;
    expect(admin.tab).toBe('routes');
    expect(wizard.step).toBe('start');
    const f = (n) => wizard.el.querySelector(`[data-f="${n}"]`);

    // Scan the code where the route starts: the camera shows, the scan
    // starts the route on its own, and the app returns to the plan.
    const badge = app.scanOverlay.el.querySelector('[data-f="badge"]');
    expect(badge.hidden).toBe(true); // nothing recorded until a route actually starts

    f('start-scan').click();
    expect(app.view).toBe('ar');
    expect(admin.expectingCode).toBe(true);
    expect(admin.registerCode('A03')).toMatchObject({ code: 'A03', x: 0, y: 0 });
    expect(wizard.step).toBe('walk');
    expect(app.view).toBe('floorplan');
    expect(badge.hidden).toBe(false); // the "Recording" badge is on the instant the leg starts

    // Walk 8 m east in 1 m fixes: the app feeds each pose to the panel and on to the wizard.
    for (let x = 1; x <= 8; x += 1) app.chain.active.teleport({ x, y: 0, floor: 0 });
    expect(wizard.route).toMatchObject({ nodes: 4 }); // exact fixes, but points within 1.5 m snap together
    expect(f('walk-status').textContent).toMatch(/^\d+ m · \d+ points · 0 codes$/);
    expect(badge.textContent).toContain(t('scan.recording', { distance: 8 })); // live, on the camera view itself

    // Scan the code at the next place: ends this route and starts the next
    // one immediately — no separate "arrived" step, no name to type.
    f('walk-scan').click();
    expect(app.view).toBe('ar');
    expect(admin.registerCode('A06')).toMatchObject({ code: 'A06', x: 8, y: 0 });
    expect(app.view).toBe('floorplan');
    expect(wizard.step).toBe('walk'); // chained straight into the next leg, from A06
    expect(admin.draft.pois.map((p) => p.name)).toEqual(['A03', 'A06']); // no list, no typing: named by code
    expect(admin.draft.validate()).toEqual([]);
    expect(admin.el.querySelector('[data-f="toast"]').textContent).toBe(
      t('admin.wizard.done.saved')
    );
    await app.destroy();
  });
});
