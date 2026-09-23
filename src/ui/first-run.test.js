// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFirstRun, needsFirstRun } from './first-run.js';
import { t } from './strings/index.js';

const uploads = [
  {
    provider: 'immersal',
    data: 'Camera frames',
    destination: 'Immersal cloud',
    purpose: 'Localise the device.',
  },
];

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('FirstRun', () => {
  it('explains camera, motion, data flows and what is never collected, with a privacy link', () => {
    const screen = createFirstRun({
      venueName: 'Demo Health Centre',
      uploads,
      onContinue: () => {},
      storage: null,
    });
    const text = screen.el.textContent;
    expect(text).toContain(t('firstRun.intro', { venue: 'Demo Health Centre' }));
    expect(text).toContain(t('firstRun.camera.why'));
    expect(text).toContain(t('firstRun.motion.why'));
    expect(text).toContain('Camera frames → Immersal cloud: Localise the device.');
    expect(text).toContain(t('firstRun.never.body'));
    expect(screen.el.querySelector('a').getAttribute('href')).toBe('/PRIVACY.md');
    expect(screen.el.querySelector('[data-f="allow"]').textContent).toBe(t('firstRun.allow'));
    expect(screen.el.querySelector('[data-f="floorplan"]').textContent).toBe(
      t('firstRun.floorplanOnly')
    );
    screen.destroy();
  });

  it('says "Nothing" when no provider uploads anything', () => {
    const screen = createFirstRun({
      venueName: 'V',
      uploads: [],
      onContinue: () => {},
      storage: null,
    });
    expect(screen.el.querySelector('[data-f="data"]').textContent).toBe(t('firstRun.data.none'));
  });

  it('Allow requests motion and warms the camera, remembers a granted camera, hides itself', async () => {
    const onContinue = vi.fn();
    const storage = {
      data: {},
      getItem: (k) => storage.data[k] ?? null,
      setItem: (k, v) => (storage.data[k] = v),
    };
    const screen = createFirstRun({
      venueName: 'V',
      uploads: [],
      onContinue,
      storage,
      requestMotion: vi.fn(async () => 'granted'),
      warmCamera: vi.fn(async () => true),
    });
    screen.el.querySelector('[data-f="allow"]').click();
    await flush();
    expect(onContinue).toHaveBeenCalledWith({ camera: true, motion: true });
    expect(storage.data['brains:permissions']).toBe('granted');
    expect(storage.data['brains:motion-permission']).toBe('granted');
    expect(screen.el.hidden).toBe(true);
  });

  it('reports a declined motion permission and a failed camera without remembering', async () => {
    const onContinue = vi.fn();
    const storage = {
      data: {},
      getItem: (k) => storage.data[k] ?? null,
      setItem: (k, v) => (storage.data[k] = v),
    };
    const screen = createFirstRun({
      venueName: 'V',
      uploads: [],
      onContinue,
      storage,
      requestMotion: async () => 'denied',
      warmCamera: async () => Promise.reject(new Error('NotAllowedError')),
    });
    screen.el.querySelector('[data-f="allow"]').click();
    await flush();
    expect(onContinue).toHaveBeenCalledWith({ camera: false, motion: false });
    expect(screen.el.querySelector('[data-f="status"]').textContent).toBe(
      t('firstRun.motionDenied')
    );
    expect(storage.data['brains:permissions']).toBeUndefined();
    // Recorded as a decisive "denied", not left blank — this is what stops
    // the screen being skipped forever without motion ever having been
    // resolved (the previous bug: camera-granted alone meant "never ask
    // again", even when motion silently never got a real answer).
    expect(storage.data['brains:motion-permission']).toBe('denied');
  });

  it('"floor plan only" continues without asking the OS', () => {
    const onContinue = vi.fn();
    const requestMotion = vi.fn();
    const screen = createFirstRun({
      venueName: 'V',
      uploads: [],
      onContinue,
      storage: null,
      requestMotion,
    });
    screen.el.querySelector('[data-f="floorplan"]').click();
    expect(onContinue).toHaveBeenCalledWith({ camera: false, motion: false });
    expect(requestMotion).not.toHaveBeenCalled();
  });
});

describe('needsFirstRun', () => {
  it('is false when remembered or already granted, else true', async () => {
    expect(await needsFirstRun({ storage: { getItem: () => 'granted' } })).toBe(false);
    expect(
      await needsFirstRun({
        storage: null,
        permissions: { query: async () => ({ state: 'granted' }) },
      })
    ).toBe(false);
    expect(
      await needsFirstRun({
        storage: null,
        permissions: { query: async () => ({ state: 'prompt' }) },
      })
    ).toBe(true);
    expect(
      await needsFirstRun({
        storage: null,
        permissions: {
          query: async () => {
            throw new TypeError('unsupported');
          },
        },
      })
    ).toBe(true);
    expect(await needsFirstRun({ storage: null, permissions: undefined })).toBe(true);
  });

  it('asks again if motion was never decisively resolved, even with camera remembered', async () => {
    const store = (data) => ({ getItem: (k) => data[k] ?? null });
    // The exact bug this guards against: camera granted long ago, motion
    // never recorded (an earlier build only ever persisted the camera
    // flag) — dead reckoning then never has a chance to work, silently,
    // forever, because this screen is never shown again to ask for it.
    expect(await needsFirstRun({ storage: store({ 'brains:permissions': 'granted' }) })).toBe(true);

    // Once motion has a decisive answer — granted or declined — the
    // existing camera-based skip applies again, either way.
    expect(
      await needsFirstRun({
        storage: store({
          'brains:permissions': 'granted',
          'brains:motion-permission': 'granted',
        }),
      })
    ).toBe(false);
    expect(
      await needsFirstRun({
        storage: store({
          'brains:permissions': 'granted',
          'brains:motion-permission': 'denied',
        }),
      })
    ).toBe(false);

    // Motion resolved, but camera never was (and isn't via the OS either): still asks.
    expect(
      await needsFirstRun({
        storage: store({ 'brains:motion-permission': 'denied' }),
        permissions: { query: async () => ({ state: 'prompt' }) },
      })
    ).toBe(true);
  });
});
