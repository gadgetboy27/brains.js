import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionProvider, validateProvider } from '../core/positioning.js';
import { createVenue } from '../core/venue.js';
import sample from '../venues/fixtures/sample-venue.json';
import {
  DEFAULT_REGISTRY,
  ImmersalProvider,
  MockProvider,
  ProviderChain,
  QrProvider,
  createProviderChain,
  resolveProviderOrder,
} from './index.js';

const venue = () => createVenue(structuredClone(sample));

const pose = (confidence = 1) => ({
  x: 0,
  y: 0,
  z: 0,
  floor: 0,
  heading: 0,
  confidence,
  timestamp: Date.now(),
});

/**
 * A scriptable fake provider. `behaviour`:
 *  - 'ok'            start() resolves, status 'running'
 *  - 'throw-create'  constructor throws
 *  - 'reject-start'  start() rejects
 *  - a failure status string: start() resolves but status is that
 */
function fakeProviderClass(name, behaviour = 'ok', uploads = []) {
  class Fake extends PositionProvider {
    static uploads = uploads;
    static instances = [];
    status = 'idle';
    error = null;
    #statusListeners = new Set();
    started = 0;
    stopped = 0;
    constructor() {
      super();
      if (behaviour === 'throw-create') throw new Error(`${name} cannot be created`);
      Fake.instances.push(this);
    }
    async start() {
      this.started += 1;
      if (behaviour === 'reject-start') throw new Error(`${name} refused to start`);
      if (behaviour === 'ok') {
        this.status = 'running';
      } else {
        this.status = behaviour;
        this.error = new Error(`${name}: ${behaviour}`);
      }
    }
    async stop() {
      this.stopped += 1;
      this.status = 'idle';
    }
    onStatus(listener) {
      this.#statusListeners.add(listener);
      return () => this.#statusListeners.delete(listener);
    }
    /** Test helpers. */
    emit(p) {
      this.emitPose(p);
    }
    report(status, error) {
      this.status = status;
      for (const l of this.#statusListeners) l({ status, error });
    }
  }
  Object.defineProperty(Fake, 'name', { value: name });
  return Fake;
}

function registryOf(spec) {
  const registry = {};
  for (const [name, behaviour] of Object.entries(spec)) {
    const Class = fakeProviderClass(name, behaviour);
    registry[name] = { Class, isConfigured: () => true, create: () => new Class() };
  }
  return registry;
}

function make(spec, options = {}) {
  const registry = registryOf(spec);
  const chain = createProviderChain(venue(), {
    registry,
    lowConfidenceMs: 5000,
    checkIntervalMs: 1000,
    ...options,
  });
  const events = [];
  chain.onChange((e) => events.push({ type: e.type, from: e.from, to: e.to, reason: e.reason }));
  const poses = [];
  chain.onPose((p) => poses.push(p));
  return { chain, registry, events, poses };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(9_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('resolveProviderOrder', () => {
  it('uses the default order based on venue config', () => {
    // Sample venue: immersal mapId + anchors → immersal, qr. No mock by default.
    expect(resolveProviderOrder(venue())).toEqual(['immersal', 'qr']);
    expect(resolveProviderOrder(venue(), { allowMock: true })).toEqual(['immersal', 'qr', 'mock']);
  });

  it('drops providers that are not configured', () => {
    const json = structuredClone(sample);
    delete json.providers;
    delete json.anchors;
    expect(resolveProviderOrder(createVenue(json))).toEqual([]);
    expect(resolveProviderOrder(createVenue(json), { allowMock: true })).toEqual(['mock']);
  });

  it('honours an explicit order from the venue or options', () => {
    const json = structuredClone(sample);
    json.providers.order = ['qr', 'immersal'];
    expect(resolveProviderOrder(createVenue(json))).toEqual(['qr', 'immersal']);
    expect(resolveProviderOrder(venue(), { order: ['mock'] })).toEqual(['mock']);
  });

  it('rejects unknown names or a malformed order', () => {
    expect(() => resolveProviderOrder(venue(), { order: ['teleport'] })).toThrow(
      /unknown provider "teleport"/
    );
    expect(() => resolveProviderOrder(venue(), { order: 'qr' })).toThrow(TypeError);
  });

  it('exposes the concrete providers in the default registry', () => {
    expect(DEFAULT_REGISTRY.immersal.Class).toBe(ImmersalProvider);
    expect(DEFAULT_REGISTRY.qr.Class).toBe(QrProvider);
    expect(DEFAULT_REGISTRY.mock.Class).toBe(MockProvider);
  });
});

describe('ProviderChain — construction', () => {
  it('is a PositionProvider that passes validateProvider()', () => {
    const { chain } = make({ a: 'ok' });
    expect(chain).toBeInstanceOf(ProviderChain);
    expect(chain).toBeInstanceOf(PositionProvider);
    expect(() => validateProvider(chain)).not.toThrow();
    expect(chain.state).toEqual({
      status: 'idle',
      active: null,
      provider: null,
      order: ['a'],
      failed: [],
      lastGoodPoseAt: null,
    });
  });

  it('refuses a venue with no configured provider', () => {
    const json = structuredClone(sample);
    delete json.providers;
    delete json.anchors;
    expect(() => createProviderChain(createVenue(json))).toThrow(
      /no positioning provider is configured/
    );
  });

  it('validates thresholds', () => {
    expect(() => make({ a: 'ok' }, { minConfidence: 2 })).toThrow(RangeError);
    expect(() => make({ a: 'ok' }, { lowConfidenceMs: -1 })).toThrow(RangeError);
  });

  it('declares the union of member uploads, tagged by provider', () => {
    const registry = {
      immersal: DEFAULT_REGISTRY.immersal,
      qr: DEFAULT_REGISTRY.qr,
    };
    const chain = createProviderChain(venue(), { registry });
    const uploads = chain.declaredUploads();
    expect(uploads.length).toBe(ImmersalProvider.uploads.length);
    expect(uploads.every((u) => u.provider === 'immersal')).toBe(true);
    expect(uploads[0]).toHaveProperty('destination');
  });
});

describe('ProviderChain — initialisation fallback', () => {
  it('starts the first provider when it works', async () => {
    const { chain, registry, events } = make({ a: 'ok', b: 'ok' });
    await chain.start();
    expect(chain.state.status).toBe('active');
    expect(chain.state.active).toBe('a');
    expect(chain.active).toBe(registry.a.Class.instances[0]);
    expect(registry.b.Class.instances).toHaveLength(0);
    expect(events).toEqual([{ type: 'started', from: undefined, to: 'a', reason: undefined }]);
  });

  it('skips a provider whose constructor throws', async () => {
    const { chain } = make({ a: 'throw-create', b: 'ok' });
    await chain.start();
    expect(chain.state.active).toBe('b');
    expect(chain.state.failed).toEqual([
      { name: 'a', reason: 'could not be created: a cannot be created', error: expect.any(Error) },
    ]);
  });

  it('skips a provider whose start() rejects, stopping it first', async () => {
    const { chain, registry } = make({ a: 'reject-start', b: 'ok' });
    await chain.start();
    expect(chain.state.active).toBe('b');
    expect(chain.state.failed[0].reason).toBe('failed to start: a refused to start');
    expect(registry.a.Class.instances[0].stopped).toBe(1);
  });

  it.each(['permission-denied', 'no-camera', 'unsupported', 'error'])(
    'skips a provider that settles into %s',
    async (status) => {
      const { chain, registry } = make({ a: status, b: 'ok' });
      await chain.start();
      expect(chain.state.active).toBe('b');
      expect(chain.state.failed[0]).toMatchObject({ name: 'a', reason: status });
      expect(chain.state.failed[0].error.message).toBe(`a: ${status}`);
      expect(registry.a.Class.instances[0].stopped).toBe(1);
    }
  );

  it('is exhausted when every provider fails, and never rejects', async () => {
    const { chain, events } = make({
      a: 'permission-denied',
      b: 'throw-create',
      c: 'reject-start',
    });
    await expect(chain.start()).resolves.toBeUndefined();
    expect(chain.state.status).toBe('exhausted');
    expect(chain.state.active).toBeNull();
    expect(chain.state.failed.map((f) => f.name)).toEqual(['a', 'b', 'c']);
    expect(events).toEqual([
      { type: 'exhausted', from: undefined, to: undefined, reason: 'every provider failed' },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('start() while active is a no-op and concurrent starts share one attempt', async () => {
    const { chain, registry } = make({ a: 'ok' });
    await Promise.all([chain.start(), chain.start()]);
    await chain.start();
    expect(registry.a.Class.instances).toHaveLength(1);
    expect(registry.a.Class.instances[0].started).toBe(1);
  });
});

describe('ProviderChain — poses and confidence fallback', () => {
  it('forwards poses from the active provider unchanged', async () => {
    const { chain, registry, poses } = make({ a: 'ok' });
    await chain.start();
    const p = pose(0.8);
    registry.a.Class.instances[0].emit(p);
    expect(poses).toEqual([p]);
    expect(chain.state.lastGoodPoseAt).toBe(9_000_000);
  });

  it('falls back when no confident pose arrives within lowConfidenceMs of starting', async () => {
    const { chain, registry, events } = make({ a: 'ok', b: 'ok' });
    await chain.start();

    await vi.advanceTimersByTimeAsync(5000);
    expect(chain.state.active).toBe('a'); // exactly at the threshold: not yet
    await vi.advanceTimersByTimeAsync(1000);

    expect(chain.state.active).toBe('b');
    expect(registry.a.Class.instances[0].stopped).toBe(1);
    expect(chain.state.failed).toEqual([
      { name: 'a', reason: 'no confident pose within 5000 ms of starting', error: undefined },
    ]);
    expect(events.map((e) => e.type)).toEqual(['started', 'fallback']);
    expect(events[1]).toMatchObject({ from: 'a', to: 'b' });
  });

  it('falls back when confidence stays below minConfidence for too long', async () => {
    const { chain, registry, events } = make({ a: 'ok', b: 'ok' }, { minConfidence: 0.5 });
    await chain.start();
    const a = registry.a.Class.instances[0];

    a.emit(pose(0.9));
    await vi.advanceTimersByTimeAsync(4000);
    a.emit(pose(0.9)); // still good: resets the clock
    await vi.advanceTimersByTimeAsync(4000);
    expect(chain.state.active).toBe('a');

    for (let i = 0; i < 6; i += 1) {
      a.emit(pose(0.2)); // low confidence for 6 s
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(chain.state.active).toBe('b');
    expect(chain.state.failed[0].reason).toBe('confidence below 0.5 for over 5000 ms');
    expect(events.at(-1)).toMatchObject({ type: 'fallback', from: 'a', to: 'b' });
  });

  it('stops forwarding poses from a provider it has abandoned', async () => {
    const { chain, registry, poses } = make({ a: 'ok', b: 'ok' });
    await chain.start();
    const a = registry.a.Class.instances[0];
    await vi.advanceTimersByTimeAsync(6000);
    expect(chain.state.active).toBe('b');
    a.emit(pose(1));
    expect(poses).toEqual([]);
    registry.b.Class.instances[0].emit(pose(1));
    expect(poses).toHaveLength(1);
  });

  it('falls back immediately when the active provider reports a failure status', async () => {
    const { chain, registry, events } = make({ a: 'ok', b: 'ok' });
    await chain.start();
    const err = new Error('camera unplugged');
    registry.a.Class.instances[0].report('error', err);
    await vi.advanceTimersByTimeAsync(0);
    expect(chain.state.active).toBe('b');
    expect(chain.state.failed[0]).toEqual({
      name: 'a',
      reason: 'provider reported error',
      error: err,
    });
    expect(events.at(-1)).toMatchObject({ type: 'fallback', from: 'a', to: 'b' });
  });

  it('chains through several fallbacks and ends exhausted', async () => {
    const { chain, events } = make({ a: 'ok', b: 'ok', c: 'ok' }, { lowConfidenceMs: 2000 });
    await chain.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(chain.state.active).toBe('b');
    await vi.advanceTimersByTimeAsync(3000);
    expect(chain.state.active).toBe('c');
    await vi.advanceTimersByTimeAsync(3000);
    expect(chain.state.status).toBe('exhausted');
    expect(chain.state.active).toBeNull();
    expect(events.map((e) => e.type)).toEqual(['started', 'fallback', 'fallback', 'exhausted']);
    expect(events.at(-1)).toMatchObject({
      from: 'c',
      reason: 'no confident pose within 2000 ms of starting',
    });
    expect(chain.state.failed.map((f) => f.name)).toEqual(['a', 'b', 'c']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips a later provider that fails to initialise during fallback', async () => {
    const { chain } = make({ a: 'ok', b: 'permission-denied', c: 'ok' }, { lowConfidenceMs: 1000 });
    await chain.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(chain.state.active).toBe('c');
    expect(chain.state.failed.map((f) => [f.name, f.reason])).toEqual([
      ['a', 'no confident pose within 1000 ms of starting'],
      ['b', 'permission-denied'],
    ]);
  });
});

describe('ProviderChain — stop()', () => {
  it('stops the active provider, clears the watchdog and resets for a fresh start', async () => {
    const { chain, registry, events } = make({ a: 'ok', b: 'ok' });
    await chain.start();
    await vi.advanceTimersByTimeAsync(6000); // now on b
    await chain.stop();

    expect(registry.b.Class.instances[0].stopped).toBe(1);
    expect(chain.state).toMatchObject({ status: 'idle', active: null, failed: [] });
    expect(vi.getTimerCount()).toBe(0);
    expect(events.at(-1).type).toBe('stopped');

    await chain.start();
    expect(chain.state.active).toBe('a'); // from the top again
    expect(registry.a.Class.instances).toHaveLength(2);
  });

  it('is safe before start() and twice', async () => {
    const { chain, events } = make({ a: 'ok' });
    await chain.stop();
    await chain.stop();
    expect(events).toEqual([]);
  });
});

describe('ProviderChain — with the real registry', () => {
  it('runs the MockProvider end to end when allowed', async () => {
    const chain = createProviderChain(venue(), {
      order: ['mock'],
      allowMock: true,
      mock: { path: [{ x: 1, y: 2 }], fixIntervalMs: 500 },
    });
    const poses = [];
    chain.onPose((p) => poses.push(p));
    await chain.start();
    expect(chain.state.active).toBe('mock');
    expect(chain.active).toBeInstanceOf(MockProvider);
    expect(poses).toHaveLength(1);
    expect(poses[0]).toMatchObject({ x: 1, y: 2 });
    await chain.stop();
  });

  it('falls from a denied camera (qr) to mock', async () => {
    const denied = new Error('no');
    denied.name = 'NotAllowedError';
    const chain = createProviderChain(venue(), {
      order: ['qr', 'mock'],
      allowMock: true,
      qr: { getUserMedia: async () => Promise.reject(denied), BarcodeDetector: class {} },
      mock: { path: [{ x: 0, y: 0 }] },
    });
    await chain.start();
    expect(chain.state.active).toBe('mock');
    expect(chain.state.failed).toHaveLength(1);
    expect(chain.state.failed[0]).toMatchObject({ name: 'qr', reason: 'permission-denied' });
    expect(chain.state.failed[0].error).toBe(denied);
    await chain.stop();
  });
});
