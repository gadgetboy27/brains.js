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

  it('shows a venue load error with retry when the venue cannot be loaded', async () => {
    const app = await bootApp({
      config: {
        venueUrl: '/nope.json',
        provider: 'mock',
        allowMock: true,
        view: 'auto',
        filter: {},
      },
      loadVenue: async () => Promise.reject(new Error('HTTP 404')),
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    });
    expect(app.error.message).toBe('HTTP 404');
    expect(app.hud.text.error).toBe(t('error.venueLoad'));
    app.destroy();
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
