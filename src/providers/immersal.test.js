import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionProvider, validatePose, validateProvider } from '../core/positioning.js';
import { createVenue } from '../core/venue.js';
import sample from '../venues/fixtures/sample-venue.json';
import {
  ImmersalProvider,
  apiKeyFromEnv,
  floorForHeight,
  immersalToVenue,
  readMapConfig,
} from './immersal.js';

const venueWith = (immersal) => {
  const json = structuredClone(sample);
  json.providers = { immersal: { mapId: 12345, ...immersal } };
  return createVenue(json);
};

/** Quaternion [x, y, z, w] for a rotation of `deg` about the +Y axis. */
const yaw = (deg) => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};

/** Fake Immersal SDK instance driven by tests. */
function fakeSdk() {
  const sdk = {
    localization: { counter: 0, localizing: false },
    localizeInfo: {
      handle: -1,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    camera: { dispose: vi.fn() },
    continuousLocalization: true,
    loadMap: vi.fn(async () => 1),
    freeMap: vi.fn(async () => 0),
    localizeDevice: vi.fn(),
    localizeServerAsync: vi.fn(async () => sdk.localizeInfo),
    /** Test helper: simulate a successful on-device fix. */
    fix(position, rotation = [0, 0, 0, 1]) {
      sdk.localizeInfo = {
        handle: 1,
        position: { x: position[0], y: position[1], z: position[2] },
        rotation: { x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] },
      };
      sdk.localization.counter += 1;
    },
  };
  return sdk;
}

function fakeSdkModule(sdk, { initError } = {}) {
  const Initialize = vi.fn(async () => {
    if (initError) throw initError;
    return sdk;
  });
  return { Immersal: { Initialize }, Initialize };
}

function make(options = {}, { immersal = {}, sdkOptions = {} } = {}) {
  const sdk = fakeSdk();
  const mod = fakeSdkModule(sdk, sdkOptions);
  const container = { tagName: 'DIV' };
  const motionTarget = {
    listeners: new Map(),
    addEventListener: vi.fn((type, fn) => motionTarget.listeners.set(type, fn)),
    removeEventListener: vi.fn((type) => motionTarget.listeners.delete(type)),
  };
  const provider = new ImmersalProvider({
    venue: venueWith(immersal),
    container,
    apiKey: 'test-key',
    loadSdk: async () => mod,
    motionTarget,
    pollIntervalMs: 100,
    tickIntervalMs: 500,
    ...options,
  });
  return { provider, sdk, mod, container, motionTarget };
}

function collect(provider) {
  const poses = [];
  const statuses = [];
  provider.onPose((p) => poses.push(p));
  provider.onStatus((s) => statuses.push(s.status));
  return { poses, statuses };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(5_000_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ------------------------------------------------------------- conversion

describe('immersalToVenue', () => {
  const venue = venueWith({});
  const meta = { confidence: 0.9, timestamp: 1 };

  it('maps Y-up map coordinates onto the Z-up venue frame', () => {
    const pose = immersalToVenue(
      { position: [1, 2, 3], rotation: [0, 0, 0, 1] },
      { mapId: 1 },
      venue,
      meta
    );
    expect(pose).toMatchObject({ x: 1, y: -3, z: 2, confidence: 0.9, timestamp: 1 });
  });

  it('applies the map origin offset and yaw', () => {
    const map = { mapId: 1, origin: { x: 10, y: 20, z: 0 }, rotationDeg: 90 };
    // map (1, 0, 0) → venue-relative (1, 0) → rotated 90° CCW → (0, 1) → + origin
    const pose = immersalToVenue({ position: [1, 0, 0], rotation: [0, 0, 0, 1] }, map, venue, meta);
    expect(pose.x).toBeCloseTo(10, 9);
    expect(pose.y).toBeCloseTo(21, 9);
  });

  it('derives heading from the camera forward vector', () => {
    // Identity rotation: camera looks down map −Z, which is venue +y → heading 0.
    expect(
      immersalToVenue({ position: [0, 0, 0], rotation: [0, 0, 0, 1] }, { mapId: 1 }, venue, meta)
        .heading
    ).toBe(0);
    // Right-handed yaw −90° about +Y turns −Z into +X: venue +x → heading 90.
    expect(
      immersalToVenue({ position: [0, 0, 0], rotation: yaw(-90) }, { mapId: 1 }, venue, meta)
        .heading
    ).toBeCloseTo(90, 6);
    // Yaw +90° about +Y turns −Z into −X: venue −x → heading 270.
    expect(
      immersalToVenue({ position: [0, 0, 0], rotation: yaw(90) }, { mapId: 1 }, venue, meta).heading
    ).toBeCloseTo(270, 6);
    // Map rotation adds to heading.
    expect(
      immersalToVenue(
        { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        { mapId: 1, rotationDeg: -45 },
        venue,
        meta
      ).heading
    ).toBeCloseTo(45, 6);
  });

  it('accepts the SDK object form for position and rotation', () => {
    const pose = immersalToVenue(
      { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      { mapId: 1 },
      venue,
      meta
    );
    expect(pose).toMatchObject({ x: 1, y: -3, z: 2 });
  });

  it('chooses the floor from venue floor elevations, or a fixed floor', () => {
    // Sample venue: floor 0 at 0 m, floor 1 at 4.2 m.
    expect(
      immersalToVenue({ position: [0, 0.1, 0], rotation: [0, 0, 0, 1] }, { mapId: 1 }, venue, meta)
        .floor
    ).toBe(0);
    expect(
      immersalToVenue({ position: [0, 4.0, 0], rotation: [0, 0, 0, 1] }, { mapId: 1 }, venue, meta)
        .floor
    ).toBe(1);
    expect(
      immersalToVenue(
        { position: [0, 9, 0], rotation: [0, 0, 0, 1] },
        { mapId: 1, floor: 0 },
        venue,
        meta
      ).floor
    ).toBe(0);
  });

  it('produces poses that satisfy the Pose contract', () => {
    for (const deg of [-170, -90, 0, 45, 90, 179]) {
      const pose = immersalToVenue(
        { position: [3, 1, -2], rotation: yaw(deg) },
        { mapId: 1, rotationDeg: 33 },
        venue,
        meta
      );
      expect(() => validatePose(pose)).not.toThrow();
    }
  });
});

describe('floorForHeight', () => {
  it('uses the highest floor at or below the height, with tolerance', () => {
    const venue = venueWith({});
    expect(floorForHeight(venue, -1)).toBe(0);
    expect(floorForHeight(venue, 3.5)).toBe(1); // within 0.75 m of 4.2
    expect(floorForHeight(venue, 3.0)).toBe(0);
    expect(floorForHeight(venue, 10)).toBe(1);
  });

  it('falls back to the first floor when no elevations are given', () => {
    const json = structuredClone(sample);
    for (const f of json.floors) delete f.elevation;
    json.providers = { immersal: { mapId: 1 } };
    expect(floorForHeight(createVenue(json), 100)).toBe(0);
  });
});

// ----------------------------------------------------------------- config

describe('readMapConfig / apiKeyFromEnv', () => {
  it('reads mapId and transform from the venue', () => {
    const v = venueWith({ origin: { x: 1, y: 2, z: 3 }, rotationDeg: 10, floor: 1 });
    expect(readMapConfig(v)).toEqual({
      mapId: 12345,
      origin: { x: 1, y: 2, z: 3 },
      rotationDeg: 10,
      floor: 1,
    });
  });

  it('names the bad field', () => {
    expect(() => readMapConfig(createVenue(structuredClone(sample)))).not.toThrow(); // fixture has mapId
    const noCfg = structuredClone(sample);
    delete noCfg.providers;
    expect(() => readMapConfig(createVenue(noCfg))).toThrow(/has no providers\.immersal config/);
    expect(() => readMapConfig(venueWith({ mapId: 'abc' }))).toThrow(
      /mapId must be a positive integer/
    );
    expect(() => readMapConfig(venueWith({ origin: { x: 0, y: 'n', z: 0 } }))).toThrow(/origin\.y/);
    expect(() => readMapConfig(venueWith({ rotationDeg: NaN }))).toThrow(/rotationDeg/);
    expect(() => readMapConfig(venueWith({ floor: 1.5 }))).toThrow(/floor must be an integer/);
  });

  it('reads the API key from IMMERSAL_API_KEY only', () => {
    vi.stubEnv('IMMERSAL_API_KEY', '  env-key ');
    expect(apiKeyFromEnv()).toBe('env-key');
    vi.stubEnv('IMMERSAL_API_KEY', '');
    expect(apiKeyFromEnv()).toBeUndefined();
  });
});

// --------------------------------------------------------------- provider

describe('ImmersalProvider — interface and construction', () => {
  it('is a PositionProvider that passes validateProvider()', () => {
    const { provider } = make();
    expect(provider).toBeInstanceOf(PositionProvider);
    expect(() => validateProvider(provider)).not.toThrow();
  });

  it('declares every upload with data, destination and purpose, including the third party', () => {
    expect(Object.hasOwn(ImmersalProvider, 'uploads')).toBe(true);
    const destinations = ImmersalProvider.uploads.map((u) => u.destination).join('\n');
    expect(destinations).toMatch(/51degrees/i);
    expect(destinations).toMatch(/api\.immersal\.com\/devget/);
    expect(destinations).toMatch(/api\.immersal\.com\/map/);
    expect(destinations).toMatch(/api\.immersal\.com\/localize/);
    const frames = ImmersalProvider.uploads.find((u) => /camera frames/i.test(u.data));
    expect(frames.purpose).toMatch(/ONLY when mode is "server"/);
  });

  it('takes the API key from the environment when not passed', () => {
    vi.stubEnv('IMMERSAL_API_KEY', 'from-env');
    const provider = new ImmersalProvider({
      venue: venueWith({}),
      container: {},
      loadSdk: async () => ({}),
    });
    expect(provider.status).toBe('idle');
  });

  it('refuses to construct without an API key, pointing at .env.example', () => {
    vi.stubEnv('IMMERSAL_API_KEY', '');
    expect(
      () => new ImmersalProvider({ venue: venueWith({}), container: {}, loadSdk: async () => ({}) })
    ).toThrow(/IMMERSAL_API_KEY.*\.env\.example.*never read from a committed file/s);
  });

  it('refuses to construct without a venue, map config or container', () => {
    expect(() => new ImmersalProvider({ apiKey: 'k' })).toThrow(/requires a Venue/);
    const noCfg = structuredClone(sample);
    delete noCfg.providers;
    expect(
      () => new ImmersalProvider({ venue: createVenue(noCfg), apiKey: 'k', container: {} })
    ).toThrow(/providers\.immersal/);
    expect(() => new ImmersalProvider({ venue: venueWith({}), apiKey: 'k' })).toThrow(/container/);
  });

  it('validates mode and fixConfidence', () => {
    expect(() => make({ mode: 'edge' })).toThrow(RangeError);
    expect(() => make({ fixConfidence: 2 })).toThrow(RangeError);
  });

  it('exposes the map config and a PoseFusion seeded with the venue heading offset', () => {
    const { provider } = make({}, { immersal: { rotationDeg: 5 } });
    expect(provider.mapConfig).toMatchObject({ mapId: 12345, rotationDeg: 5 });
    expect(provider.fusion.getPose()).toBeNull();
  });
});

describe('ImmersalProvider — start()', () => {
  it('loads the SDK, initialises with the key and map id, loads the map and localises', async () => {
    const { provider, sdk, mod, container, motionTarget } = make();
    const { statuses } = collect(provider);

    await provider.start();

    expect(mod.Initialize).toHaveBeenCalledOnce();
    const [passedContainer, params] = mod.Initialize.mock.calls[0];
    expect(passedContainer).toBe(container);
    expect(params).toMatchObject({
      developerToken: 'test-key',
      mapIds: [12345],
      continuousLocalization: true,
      solverType: 1,
    });
    expect(sdk.loadMap).toHaveBeenCalledWith(12345);
    expect(provider.status).toBe('localising');
    expect(statuses).toEqual(['starting', 'loading-map', 'localising']);
    expect(motionTarget.addEventListener).toHaveBeenCalledWith(
      'devicemotion',
      expect.any(Function)
    );
    expect(motionTarget.addEventListener).toHaveBeenCalledWith(
      'deviceorientation',
      expect.any(Function)
    );
  });

  it('never rejects: camera permission denial becomes a status', async () => {
    const denied = new Error('nope');
    denied.name = 'NotAllowedError';
    const { provider, sdk } = make({}, { sdkOptions: { initError: denied } });
    const { statuses, poses } = collect(provider);

    await expect(provider.start()).resolves.toBeUndefined();
    expect(provider.status).toBe('permission-denied');
    expect(provider.error).toBe(denied);
    expect(statuses).toEqual(['starting', 'permission-denied']);
    expect(sdk.loadMap).not.toHaveBeenCalled();
    expect(poses).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports unsupported when the SDK cannot be loaded', async () => {
    const { provider } = make({ loadSdk: async () => Promise.reject(new Error('404')) });
    await provider.start();
    expect(provider.status).toBe('unsupported');
    expect(provider.error.message).toBe('404');

    const { provider: p2 } = make({ loadSdk: async () => ({}) });
    await p2.start();
    expect(p2.status).toBe('unsupported');
    expect(p2.error.message).toMatch(/Immersal\.Initialize/);
  });

  it('reports error and releases the camera when the map fails to load', async () => {
    const { provider, sdk } = make();
    sdk.loadMap.mockResolvedValueOnce(-1);
    await provider.start();
    expect(provider.status).toBe('error');
    expect(provider.error.message).toMatch(/map 12345 failed to load/);
    expect(sdk.camera.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can be retried after a failure, and is a no-op while running', async () => {
    const denied = new Error('nope');
    denied.name = 'NotAllowedError';
    const sdk = fakeSdk();
    const Initialize = vi.fn().mockRejectedValueOnce(denied).mockResolvedValue(sdk);
    const { provider } = make({ loadSdk: async () => ({ Immersal: { Initialize } }) });

    await provider.start();
    expect(provider.status).toBe('permission-denied');
    await provider.start();
    expect(provider.status).toBe('localising');
    await provider.start();
    expect(Initialize).toHaveBeenCalledTimes(2);
  });

  it('runs in server mode without continuous on-device localisation', async () => {
    const { provider, sdk, mod } = make({ mode: 'server', serverIntervalMs: 1000 });
    await provider.start();
    expect(mod.Initialize.mock.calls[0][1].continuousLocalization).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(sdk.localizeServerAsync).toHaveBeenCalledOnce();
    expect(sdk.localizeDevice).not.toHaveBeenCalled();
  });
});

describe('ImmersalProvider — fixes and fusion', () => {
  it('drives the SDK on each poll and emits a converted pose when a fix arrives', async () => {
    const { provider, sdk } = make({}, { immersal: { origin: { x: 100, y: 200, z: 0 } } });
    const { poses } = collect(provider);
    await provider.start();

    await vi.advanceTimersByTimeAsync(300);
    expect(sdk.localizeDevice).toHaveBeenCalledTimes(3);
    expect(poses).toEqual([]); // no fix yet

    sdk.fix([1, 0.2, -2], yaw(-90));
    await vi.advanceTimersByTimeAsync(100);

    expect(provider.fixCount).toBe(1);
    expect(poses).toHaveLength(1);
    expect(poses[0]).toMatchObject({ x: 101, y: 202, z: 0.2, floor: 0, confidence: 0.9 });
    expect(poses[0].heading).toBeCloseTo(90, 6);
    expect(poses[0].timestamp).toBe(5_000_400);
    expect(() => validatePose(poses[0])).not.toThrow();
  });

  it('between fixes, emits PoseFusion estimates from device motion with decaying confidence', async () => {
    const { provider, sdk, motionTarget } = make({
      emitIntervalMs: 0,
      fusion: { timeHalfLifeMs: 1000, distanceHalfLifeM: 0 },
    });
    const { poses } = collect(provider);
    await provider.start();

    sdk.fix([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(100);
    expect(poses).toHaveLength(1);
    expect(poses[0].confidence).toBeCloseTo(0.9, 9);

    // Simulate walking forward for 1 s at 1 m/s² via device motion events.
    const onMotion = motionTarget.listeners.get('devicemotion');
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(100);
      onMotion({ acceleration: { x: 0, y: 1, z: 0 }, interval: 100 });
    }
    const last = poses.at(-1);
    expect(poses.length).toBeGreaterThan(5);
    expect(last.y).toBeCloseTo(0.5, 6); // dead-reckoned 0.5 m
    expect(last.confidence).toBeCloseTo(0.9 * 0.5, 3); // 1 s at a 1 s half-life
    expect(provider.fixCount).toBe(1); // no new Immersal fix
  });

  it('rate-limits dead-reckoned emissions but never a fix', async () => {
    const { provider, sdk, motionTarget } = make({ emitIntervalMs: 1000 });
    const { poses } = collect(provider);
    await provider.start();
    sdk.fix([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(100);

    const onMotion = motionTarget.listeners.get('devicemotion');
    for (let i = 0; i < 5; i += 1) onMotion({ acceleration: { x: 1, y: 0, z: 0 }, interval: 50 });
    expect(poses).toHaveLength(1); // all within the 1 s window

    sdk.fix([5, 0, 0]);
    await vi.advanceTimersByTimeAsync(100);
    expect(poses).toHaveLength(2);
    expect(poses[1].x).toBe(5);
  });

  it('forwards rescan-needed from PoseFusion when confidence decays', async () => {
    const { provider, sdk } = make({
      tickIntervalMs: 500,
      fusion: { timeHalfLifeMs: 1000, rescanThreshold: 0.3 },
    });
    const onRescan = vi.fn();
    provider.onRescanNeeded(onRescan);
    await provider.start();
    sdk.fix([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(100);

    await vi.advanceTimersByTimeAsync(1000); // 0.45 — above
    expect(onRescan).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); // 0.225 — below
    expect(onRescan).toHaveBeenCalledOnce();
    expect(onRescan.mock.calls[0][0]).toMatchObject({ threshold: 0.3 });

    // A fresh fix re-arms it.
    sdk.fix([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onRescan).toHaveBeenCalledTimes(2);
  });

  it('accepts fixes from server localisation', async () => {
    const { provider, sdk } = make({ mode: 'server', serverIntervalMs: 1000 });
    const { poses } = collect(provider);
    await provider.start();

    sdk.localizeServerAsync.mockImplementationOnce(async () => {
      sdk.fix([2, 0, 0]);
      return sdk.localizeInfo;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(poses).toHaveLength(1);
    expect(poses[0].x).toBe(2);
  });

  it('treats a failed server localisation as routine', async () => {
    const { provider, sdk } = make({ mode: 'server', serverIntervalMs: 1000 });
    sdk.localizeServerAsync.mockRejectedValueOnce('[IMMERSAL] Localization failed');
    await provider.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.status).toBe('localising');
  });

  it('moves to error if the SDK throws while localising', async () => {
    const { provider, sdk } = make();
    const { statuses } = collect(provider);
    await provider.start();
    sdk.localizeDevice.mockImplementationOnce(() => {
      throw new Error('wasm trap');
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(provider.status).toBe('error');
    expect(provider.error.message).toBe('wasm trap');
    expect(statuses.at(-1)).toBe('error');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ImmersalProvider — stop()', () => {
  it('frees the map, disposes the camera, detaches motion and clears timers', async () => {
    const { provider, sdk, motionTarget } = make();
    const { statuses } = collect(provider);
    await provider.start();
    await provider.stop();

    expect(sdk.freeMap).toHaveBeenCalledWith(1);
    expect(sdk.continuousLocalization).toBe(false);
    expect(sdk.camera.dispose).toHaveBeenCalledOnce();
    expect(motionTarget.removeEventListener).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(provider.status).toBe('idle');
    expect(statuses.at(-1)).toBe('idle');
  });

  it('is safe before start() and twice', async () => {
    const { provider } = make();
    const { statuses } = collect(provider);
    await provider.stop();
    await provider.stop();
    expect(statuses).toEqual([]);
  });

  it('does not emit after stop() even if a fix was pending', async () => {
    const { provider, sdk } = make();
    const { poses } = collect(provider);
    await provider.start();
    await provider.stop();
    sdk.fix([1, 1, 1]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(poses).toEqual([]);
  });
});
