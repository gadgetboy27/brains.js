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
});
