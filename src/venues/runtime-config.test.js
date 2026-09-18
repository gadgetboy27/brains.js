import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { findRoute } from '../core/router.js';
import { createVenue } from '../core/venue.js';
import demo from './demo-venue.json';
import {
  EMPTY_CONFIG,
  applyRuntimeConfig,
  fetchRuntimeConfig,
  fingerprint,
  normaliseRuntimeConfig,
  pollRuntimeConfig,
  resolveRuntimeConfigUrl,
  validateRuntimeConfig,
} from './runtime-config.js';

const venue = () => createVenue(structuredClone(demo));
const mem = () => {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => (data[k] = v), data };
};
const ok = (json) => ({ ok: true, status: 200, json: async () => json });

const liftClosed = {
  version: 1,
  updatedAt: '2026-09-19T10:00:00Z',
  closures: [{ from: 'n-lift-1', to: 'n-lift-g', reason: 'Lift out of service' }],
  hiddenPois: ['poi-clinic-b'],
  notice: 'Clinic B is closed today.',
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('validateRuntimeConfig / normalise', () => {
  it('accepts the full and the minimal shape', () => {
    expect(validateRuntimeConfig(liftClosed)).toEqual([]);
    expect(validateRuntimeConfig({ version: 1 })).toEqual([]);
    expect(normaliseRuntimeConfig({ version: 1 })).toEqual({
      version: 1,
      updatedAt: undefined,
      closures: [],
      hiddenPois: [],
    });
  });

  it('names each problem', () => {
    const paths = (j) => validateRuntimeConfig(j).map((e) => e.path);
    expect(paths(null)).toEqual(['config']);
    expect(paths({ version: 2 })).toEqual(['version']);
    expect(paths({ version: 1, closures: [{ from: 'a' }] })).toEqual(['closures[0].to']);
    expect(paths({ version: 1, closures: 'x' })).toEqual(['closures']);
    expect(paths({ version: 1, hiddenPois: [1] })).toEqual(['hiddenPois[0]']);
    expect(paths({ version: 1, notice: 3 })).toEqual(['notice']);
    expect(() => normaliseRuntimeConfig({ version: 9 })).toThrow(/Invalid runtime config: version/);
  });

  it('fingerprints ignore order and updatedAt', () => {
    const a = {
      version: 1,
      updatedAt: 'x',
      closures: [
        { from: 'a', to: 'b' },
        { from: 'c', to: 'd' },
      ],
      hiddenPois: ['p', 'q'],
    };
    const b = {
      version: 1,
      updatedAt: 'y',
      closures: [
        { from: 'c', to: 'd' },
        { from: 'a', to: 'b' },
      ],
      hiddenPois: ['q', 'p'],
    };
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(a)).not.toBe(fingerprint({ ...a, hiddenPois: ['p'] }));
  });

  it('resolves the config URL relative to the venue URL', () => {
    expect(resolveRuntimeConfigUrl({ explicit: '/rt.json', venue: null })).toBe('/rt.json');
    expect(
      resolveRuntimeConfigUrl({
        venue: { runtimeConfigUrl: 'runtime.json' },
        venueUrl: '/venues/demo/venue.json',
      })
    ).toBe('/venues/demo/runtime.json');
    expect(
      resolveRuntimeConfigUrl({
        venue: { runtimeConfigUrl: 'https://x/rt.json' },
        venueUrl: '/v.json',
      })
    ).toBe('https://x/rt.json');
    expect(resolveRuntimeConfigUrl({ venue: {} })).toBeNull();
  });
});

describe('applyRuntimeConfig', () => {
  it('closes the edge (either direction), hides the POI, and leaves the original venue untouched', () => {
    const base = venue();
    const { venue: v, applied, unknown } = applyRuntimeConfig(base, liftClosed);
    expect(applied).toEqual({ closures: 1, hiddenPois: 1 });
    expect(unknown).toEqual([]);
    const lift = v.graph.edges.find((e) => e.type === 'lift');
    expect(lift).toMatchObject({ closed: true, closedReason: 'Lift out of service' });
    expect(v.closedEdges).toHaveLength(1);
    expect(v.poiById('poi-clinic-b').hidden).toBe(true);
    expect(v.visiblePois.map((p) => p.id)).not.toContain('poi-clinic-b');
    expect(v.searchPois('derma')).toEqual([]);
    expect(v.lookupPois('poi-clinic-b')).toHaveLength(1); // still resolvable by id
    expect(base.closedEdges).toHaveLength(0);
    expect(base.poiById('poi-clinic-b').hidden).toBeUndefined();
  });

  it('routing never uses a closed edge and says so when nothing is left', () => {
    const { venue: v } = applyRuntimeConfig(venue(), liftClosed);
    const wheelchair = findRoute(v.graph, 'n-entrance', 'n-clinic-b', {
      wheelchair: true,
      timeOfDay: '12:00',
    });
    expect(wheelchair).toMatchObject({ found: false, reason: 'no-route', closedEdgesExcluded: 1 });
    const walker = findRoute(v.graph, 'n-entrance', 'n-clinic-b', { timeOfDay: '12:00' });
    expect(walker.found).toBe(true);
    expect(walker.edges.map((e) => e.type)).not.toContain('lift');
  });

  it('reports unknown ids without failing', () => {
    const { applied, unknown } = applyRuntimeConfig(venue(), {
      version: 1,
      closures: [
        { from: 'n-nope', to: 'n-lobby' },
        { from: 'n-entrance', to: 'n-lobby' },
      ],
      hiddenPois: ['poi-ghost', 'poi-lift'],
    });
    expect(applied).toEqual({ closures: 1, hiddenPois: 1 });
    expect(unknown).toEqual(['edge n-nope→n-lobby', 'poi poi-ghost']);
  });
});

describe('fetchRuntimeConfig', () => {
  it('fetches with no-store, normalises and caches', async () => {
    const storage = mem();
    const fetch = vi.fn(async () => ok(liftClosed));
    const result = await fetchRuntimeConfig('/rt.json', { fetch, storage, now: () => 5 });
    expect(fetch).toHaveBeenCalledWith('/rt.json', { cache: 'no-store' });
    expect(result.source).toBe('network');
    expect(result.config.closures).toHaveLength(1);
    expect(JSON.parse(storage.data['brains:runtime-config:/rt.json']).savedAt).toBe(5);
  });

  it('falls back to the cache, then to the empty config, never throwing', async () => {
    const storage = mem();
    await fetchRuntimeConfig('/rt.json', { fetch: async () => ok(liftClosed), storage });
    const cached = await fetchRuntimeConfig('/rt.json', {
      fetch: async () => ({ ok: false, status: 503 }),
      storage,
    });
    expect(cached.source).toBe('cache');
    expect(cached.config.hiddenPois).toEqual(['poi-clinic-b']);
    expect(cached.error.message).toBe('HTTP 503');

    const none = await fetchRuntimeConfig('/other.json', {
      fetch: async () => Promise.reject(new Error('offline')),
      storage,
    });
    expect(none.source).toBe('none');
    expect(none.config).toEqual({ ...EMPTY_CONFIG, closures: [], hiddenPois: [] });

    const invalid = await fetchRuntimeConfig('/bad.json', {
      fetch: async () => ok({ version: 7 }),
      storage: null,
    });
    expect(invalid.source).toBe('none');
    expect(invalid.error.message).toMatch(/Invalid runtime config/);
  });
});

describe('pollRuntimeConfig', () => {
  it('calls back only when the config changes, and stops', async () => {
    let current = liftClosed;
    const fetch = vi.fn(async () => ok(current));
    const onChange = vi.fn();
    const stop = pollRuntimeConfig('/rt.json', {
      fetch,
      storage: null,
      intervalMs: 1000,
      onChange,
      initial: liftClosed,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).not.toHaveBeenCalled(); // unchanged

    current = { ...liftClosed, hiddenPois: [] };
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].config.hiddenPois).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenCalledOnce(); // same again

    stop();
    current = liftClosed;
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('ignores fetch failures while polling', async () => {
    const fetch = vi.fn(async () => Promise.reject(new Error('down')));
    const onChange = vi.fn();
    pollRuntimeConfig('/rt.json', { fetch, storage: null, intervalMs: 500, onChange });
    await vi.advanceTimersByTimeAsync(1500);
    expect(onChange).not.toHaveBeenCalled();
  });
});
