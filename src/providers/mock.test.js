import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionProvider, validateProvider } from '../core/positioning.js';
import { MockProvider } from './mock.js';

// A 10 m corridor east, then 10 m north up to floor 1.
const corridor = [
  { x: 0, y: 0, floor: 0 },
  { x: 10, y: 0, floor: 0 },
  { x: 10, y: 10, z: 4, floor: 1 },
];

/** Provider with deterministic drift direction (+x) and fake timers. */
function make(options = {}) {
  return new MockProvider({ path: corridor, random: () => 0, ...options });
}

function collect(provider) {
  const poses = [];
  provider.onPose((p) => poses.push(p));
  return poses;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('MockProvider — interface', () => {
  it('is a PositionProvider that passes validateProvider()', () => {
    const p = make();
    expect(p).toBeInstanceOf(PositionProvider);
    expect(() => validateProvider(p)).not.toThrow();
  });

  it('declares on its own class that nothing leaves the device', () => {
    expect(Object.hasOwn(MockProvider, 'uploads')).toBe(true);
    expect(MockProvider.uploads).toEqual([]);
  });

  it('starts idle with the path measured', () => {
    const p = make();
    expect(p.state).toBe('idle');
    expect(p.pathLength).toBeCloseTo(10 + Math.hypot(10, 4), 9);
    expect(p.distanceAlongPath).toBe(0);
    expect(p.driftMetres).toBe(0);
  });
});

describe('MockProvider — options validation', () => {
  it('rejects bad numbers', () => {
    expect(() => make({ speedMps: -1 })).toThrow(RangeError);
    expect(() => make({ fixIntervalMs: NaN })).toThrow(RangeError);
    expect(() => make({ driftRateMps: -0.1 })).toThrow(RangeError);
    expect(() => make({ confidence: 1.5 })).toThrow(RangeError);
    expect(() => make({ confidenceLossPerMetre: -1 })).toThrow(RangeError);
  });

  it('rejects malformed paths and names the waypoint', () => {
    expect(() => make({ path: 'north' })).toThrow(TypeError);
    expect(() => make({ path: [{ x: 0 }] })).toThrow(/path\[0\] must have finite x and y/);
    expect(() =>
      make({
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 1, floor: 1.5 },
        ],
      })
    ).toThrow(/path\[1\]\.floor must be an integer/);
  });
});

describe('MockProvider — walking the path', () => {
  it('emits a fix at the start immediately, then every fixIntervalMs', async () => {
    const p = make({ speedMps: 1, fixIntervalMs: 1000 });
    const poses = collect(p);

    await p.start();
    expect(p.state).toBe('running');
    expect(poses).toHaveLength(1);
    expect(poses[0]).toMatchObject({ x: 0, y: 0, z: 0, floor: 0, heading: 90, confidence: 0.9 });
    expect(poses[0].timestamp).toBe(1_000_000);

    vi.advanceTimersByTime(999);
    expect(poses).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(poses).toHaveLength(2);
    expect(poses[1]).toMatchObject({ x: 1, y: 0, heading: 90 });
    expect(poses[1].timestamp).toBe(1_001_000);
  });

  it('follows the path at the configured speed, turning corners and changing floor', async () => {
    const p = make({ speedMps: 2, fixIntervalMs: 1000 });
    const poses = collect(p);
    await p.start();

    vi.advanceTimersByTime(5000); // 10 m: at the corner
    expect(poses.at(-1)).toMatchObject({ x: 10, y: 0, floor: 0 });
    expect(poses.at(-1).heading).toBeCloseTo(0, 9); // now heading north

    vi.advanceTimersByTime(1000); // 2 m along the 10.77 m second leg
    const last = poses.at(-1);
    expect(last.x).toBeCloseTo(10, 9);
    expect(last.y).toBeCloseTo(2 * (10 / Math.hypot(10, 4)), 9);
    expect(last.z).toBeCloseTo(2 * (4 / Math.hypot(10, 4)), 9);
    expect(last.floor).toBe(0);
  });

  it('stops at the end of the path when not looping and reports the final floor', async () => {
    const p = make({ speedMps: 100, fixIntervalMs: 1000 });
    const poses = collect(p);
    await p.start();
    vi.advanceTimersByTime(3000);
    expect(poses.at(-1)).toMatchObject({ x: 10, y: 10, z: 4, floor: 1 });
    expect(p.distanceAlongPath).toBeCloseTo(p.pathLength, 9);
    expect(p.state).toBe('running'); // still emitting, standing still
    const n = poses.length;
    vi.advanceTimersByTime(1000);
    expect(poses).toHaveLength(n + 1);
  });

  it('wraps around when looping', async () => {
    const p = make({
      path: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      speedMps: 3,
      fixIntervalMs: 1000,
      loop: true,
    });
    const poses = collect(p);
    await p.start();
    vi.advanceTimersByTime(4000); // 12 m → 2 m into the second lap
    expect(poses.at(-1).x).toBeCloseTo(2, 9);
  });

  it('stands still on a single-waypoint path', async () => {
    const p = make({ path: [{ x: 5, y: 6, z: 1, floor: 2 }], fixIntervalMs: 500 });
    const poses = collect(p);
    await p.start();
    vi.advanceTimersByTime(2000);
    expect(poses).toHaveLength(5);
    expect(poses.every((q) => q.x === 5 && q.y === 6 && q.z === 1 && q.floor === 2)).toBe(true);
  });

  it('respects speed and interval changes made while running', async () => {
    const p = make({ speedMps: 1, fixIntervalMs: 1000 });
    const poses = collect(p);
    await p.start();
    vi.advanceTimersByTime(1000);
    expect(poses.at(-1).x).toBeCloseTo(1, 9);

    p.setSpeed(0);
    p.setFixInterval(250);
    // The already-scheduled 1000 ms tick fires at t=2000, then 250 ms ticks at
    // 2250, 2500, 2750, 3000: 4 more fixes.
    vi.advanceTimersByTime(2000);
    expect(poses.at(-1).x).toBeCloseTo(1, 9); // speed 0: no further movement
    expect(poses).toHaveLength(7);
  });
});

describe('MockProvider — drift', () => {
  it('grows linearly at driftRateMps and lowers confidence', async () => {
    const p = make({
      speedMps: 0,
      fixIntervalMs: 1000,
      driftRateMps: 0.5,
      confidenceLossPerMetre: 0.1,
    });
    const poses = collect(p);
    await p.start();

    expect(poses[0]).toMatchObject({ x: 0, confidence: 0.9 });

    vi.advanceTimersByTime(2000); // 1 m of drift along +x (random() → 0 → angle 0)
    expect(p.driftMetres).toBeCloseTo(1, 9);
    expect(poses.at(-1).x).toBeCloseTo(1, 9);
    expect(poses.at(-1).y).toBeCloseTo(0, 9);
    expect(poses.at(-1).confidence).toBeCloseTo(0.8, 9);
    expect(p.truePosition).toMatchObject({ x: 0, y: 0 });

    vi.advanceTimersByTime(18_000); // 10 m total → confidence floor 0
    expect(poses.at(-1).confidence).toBe(0);
  });

  it('is absent when driftRateMps is 0', async () => {
    const p = make({ speedMps: 0, driftRateMps: 0 });
    const poses = collect(p);
    await p.start();
    vi.advanceTimersByTime(10_000);
    expect(p.driftMetres).toBe(0);
    expect(poses.every((q) => q.x === 0 && q.confidence === 0.9)).toBe(true);
  });

  it('takes a direction from the injected random source', async () => {
    const p = make({ speedMps: 0, driftRateMps: 1, random: () => 0.25 }); // angle π/2 → +y
    const poses = collect(p);
    await p.start();
    vi.advanceTimersByTime(1000);
    expect(poses.at(-1).x).toBeCloseTo(0, 9);
    expect(poses.at(-1).y).toBeCloseTo(1, 9);
  });

  it('can be changed while running', async () => {
    const p = make({ speedMps: 0, driftRateMps: 0 });
    await p.start();
    vi.advanceTimersByTime(1000);
    expect(p.driftMetres).toBe(0);
    p.setDriftRate(2);
    vi.advanceTimersByTime(1000);
    expect(p.driftMetres).toBeCloseTo(2, 9);
  });
});

describe('MockProvider — forced low confidence', () => {
  it('overrides drift-derived confidence until cleared', async () => {
    const p = make({ speedMps: 0, fixIntervalMs: 1000 });
    const poses = collect(p);
    await p.start();
    expect(poses.at(-1).confidence).toBe(0.9);

    p.forceLowConfidence(0.15);
    expect(p.currentConfidence).toBe(0.15);
    vi.advanceTimersByTime(1000);
    expect(poses.at(-1).confidence).toBe(0.15);

    p.clearForcedConfidence();
    vi.advanceTimersByTime(1000);
    expect(poses.at(-1).confidence).toBe(0.9);
  });

  it('defaults to 0.2 and validates the value', () => {
    const p = make();
    p.forceLowConfidence();
    expect(p.currentConfidence).toBe(0.2);
    expect(() => p.forceLowConfidence(2)).toThrow(RangeError);
  });
});

describe('MockProvider — lost and recovered', () => {
  it('forceLost() stops fixes while the walker keeps moving', async () => {
    const p = make({ speedMps: 1, fixIntervalMs: 1000 });
    const poses = collect(p);
    await p.start();
    vi.advanceTimersByTime(2000);
    expect(poses).toHaveLength(3);
    expect(poses.at(-1).x).toBeCloseTo(2, 9);

    p.forceLost();
    expect(p.state).toBe('lost');
    vi.advanceTimersByTime(5000);
    expect(poses).toHaveLength(3); // nothing emitted while lost
    expect(p.truePosition.x).toBeCloseTo(7, 9); // but the person walked on
  });

  it('recover() resets drift and emits a fresh fix at the true position', async () => {
    const p = make({ speedMps: 1, fixIntervalMs: 1000, driftRateMps: 1 });
    const poses = collect(p);
    await p.start();
    vi.advanceTimersByTime(2000);
    expect(p.driftMetres).toBeCloseTo(2, 9);

    p.forceLost();
    vi.advanceTimersByTime(3000);
    p.recover();

    expect(p.state).toBe('running');
    expect(p.driftMetres).toBe(0);
    const fix = poses.at(-1);
    expect(fix.x).toBeCloseTo(5, 9);
    expect(fix.confidence).toBe(0.9);
    expect(fix.timestamp).toBe(1_005_000);

    vi.advanceTimersByTime(1000);
    expect(poses.at(-1).x).toBeCloseTo(6 + 1, 9); // walked 1 m, drifted 1 m (+x)
  });

  it('forceLost() and recover() are no-ops in the wrong state', async () => {
    const p = make();
    p.forceLost();
    expect(p.state).toBe('idle');
    p.recover();
    expect(p.state).toBe('idle');
    await p.start();
    p.recover();
    expect(p.state).toBe('running');
  });
});

describe('MockProvider — teleport', () => {
  it('jumps the true position and emits immediately', async () => {
    const p = make({ speedMps: 0 });
    const poses = collect(p);
    await p.start();
    p.teleport({ x: 42, y: -7, z: 8, floor: 2 });
    expect(poses.at(-1)).toMatchObject({ x: 42, y: -7, z: 8, floor: 2, confidence: 0.9 });
    expect(p.truePosition).toMatchObject({ x: 42, y: -7 });
  });

  it('also recovers from a lost state', async () => {
    const p = make();
    await p.start();
    p.forceLost();
    p.teleport({ x: 1, y: 1 });
    expect(p.state).toBe('running');
  });

  it('does not emit when idle', () => {
    const p = make();
    const poses = collect(p);
    p.teleport({ x: 1, y: 1 });
    expect(poses).toHaveLength(0);
  });
});

describe('MockProvider — lifecycle', () => {
  it('stop() halts emission and clears timers; start() restarts from the beginning', async () => {
    const p = make({ speedMps: 1, fixIntervalMs: 1000 });
    const poses = collect(p);
    await p.start();
    vi.advanceTimersByTime(3000);
    expect(poses.at(-1).x).toBeCloseTo(3, 9);

    await p.stop();
    expect(p.state).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(poses).toHaveLength(4);

    await p.start();
    expect(poses.at(-1)).toMatchObject({ x: 0, y: 0 });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('start() while running or lost is a no-op', async () => {
    const p = make();
    const poses = collect(p);
    await p.start();
    await p.start();
    expect(poses).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    p.forceLost();
    await p.start();
    expect(p.state).toBe('lost');
  });

  it('stop() is safe before start() and twice in a row', async () => {
    const p = make();
    await expect(p.stop()).resolves.toBeUndefined();
    await p.start();
    await p.stop();
    await expect(p.stop()).resolves.toBeUndefined();
  });

  it('uses injected timer functions', async () => {
    const setTimeout = vi.fn(() => 't1');
    const clearTimeout = vi.fn();
    const p = make({ fixIntervalMs: 333, setTimeout, clearTimeout });
    await p.start();
    expect(setTimeout).toHaveBeenCalledOnce();
    expect(setTimeout.mock.calls[0][1]).toBe(333);
    await p.stop();
    expect(clearTimeout).toHaveBeenCalledWith('t1');
  });

  it('every emitted pose satisfies the Pose contract (no GPS, ranges respected)', async () => {
    const p = make({ speedMps: 3, fixIntervalMs: 250, driftRateMps: 0.7, loop: true });
    const poses = collect(p);
    await p.start();
    vi.advanceTimersByTime(20_000);
    expect(poses.length).toBeGreaterThan(50);
    for (const q of poses) {
      expect(q.heading).toBeGreaterThanOrEqual(0);
      expect(q.heading).toBeLessThan(360);
      expect(q.confidence).toBeGreaterThanOrEqual(0);
      expect(q.confidence).toBeLessThanOrEqual(1);
      expect(Number.isInteger(q.floor)).toBe(true);
      expect('lat' in q || 'lon' in q).toBe(false);
    }
  });
});
