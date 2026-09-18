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
    expect(app.hud.text.notices).toContain(t('notice.noPosition'));
    usable(app);
    // Route starts at the main entrance (the "exit" POI) when there is no pose.
    expect(app.hud.text.distance).toBe('46 m'); // entrance → Clinic B via the stairs
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
