import { describe, expect, it, vi } from 'vitest';

import { PoseFusion } from './fusion.js';

/** Minimal fake clock: `advance(ms)` moves time; `now` is injected. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

function fix(clock, overrides = {}) {
  return {
    x: 0,
    y: 0,
    z: 0,
    floor: 0,
    heading: 0,
    confidence: 1,
    timestamp: clock.now(),
    ...overrides,
  };
}

describe('PoseFusion — construction', () => {
  it('uses sane defaults', () => {
    const f = new PoseFusion();
    expect(f.getPose()).toBeNull();
    expect(f.getConfidence()).toBe(0);
    expect(f.tick()).toBe(false);
  });

  it('rejects invalid options', () => {
    expect(() => new PoseFusion({ rescanThreshold: -1 })).toThrow(RangeError);
    expect(() => new PoseFusion({ rescanThreshold: 1.5 })).toThrow(RangeError);
    expect(() => new PoseFusion({ timeHalfLifeMs: NaN })).toThrow(RangeError);
    expect(() => new PoseFusion({ distanceHalfLifeM: 'far' })).toThrow(RangeError);
    expect(() => new PoseFusion({ now: 42 })).toThrow(TypeError);
  });
});

describe('PoseFusion — holding a fix', () => {
  it('stores the last known pose and emits it', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now });
    const onPose = vi.fn();
    f.on('pose', onPose);

    const p = fix(clock, { x: 3, y: 4, z: 1, floor: 2, heading: 90, confidence: 0.9 });
    f.applyFix(p);

    expect(onPose).toHaveBeenCalledOnce();
    expect(f.getPose()).toMatchObject({ x: 3, y: 4, z: 1, floor: 2, heading: 90 });
    expect(f.getConfidence()).toBeCloseTo(0.9, 12);
  });

  it('rejects an invalid fix', () => {
    const f = new PoseFusion();
    expect(() => f.applyFix({ x: 0 })).toThrow(TypeError);
    expect(f.getPose()).toBeNull();
  });

  it('ignores motion and orientation before the first fix', () => {
    const f = new PoseFusion();
    const onPose = vi.fn();
    f.on('pose', onPose);
    f.handleOrientation({ alpha: 90 });
    f.handleMotion({ acceleration: { x: 1, y: 0, z: 0 }, interval: 100 });
    expect(onPose).not.toHaveBeenCalled();
    expect(f.getPose()).toBeNull();
  });
});

describe('PoseFusion — confidence decays with time', () => {
  it('halves at the time half-life and quarters at twice it', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 10_000 });
    f.applyFix(fix(clock));

    expect(f.getConfidence()).toBeCloseTo(1, 12);
    clock.advance(10_000);
    expect(f.getConfidence()).toBeCloseTo(0.5, 12);
    clock.advance(10_000);
    expect(f.getConfidence()).toBeCloseTo(0.25, 12);
  });

  it('scales from the fix confidence, not from 1', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 1_000 });
    f.applyFix(fix(clock, { confidence: 0.6 }));
    clock.advance(1_000);
    expect(f.getConfidence()).toBeCloseTo(0.3, 12);
  });

  it('does not decay when the time half-life is 0', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 0 });
    f.applyFix(fix(clock));
    clock.advance(1_000_000);
    expect(f.getConfidence()).toBe(1);
  });

  it('resets on a new fix', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 1_000 });
    f.applyFix(fix(clock));
    clock.advance(5_000);
    expect(f.getConfidence()).toBeLessThan(0.05);
    f.applyFix(fix(clock));
    expect(f.getConfidence()).toBeCloseTo(1, 12);
  });

  it('reports the decayed confidence and current time on getPose()', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 2_000 });
    f.applyFix(fix(clock));
    clock.advance(2_000);
    const pose = f.getPose();
    expect(pose.confidence).toBeCloseTo(0.5, 12);
    expect(pose.timestamp).toBe(clock.now());
  });
});

describe('PoseFusion — dead reckoning from device motion', () => {
  it('integrates forward acceleration into +y when heading is 0', () => {
    const clock = fakeClock();
    // Disable time decay so we can isolate distance.
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 0, distanceHalfLifeM: 0 });
    f.applyFix(fix(clock));

    // 1 m/s² forward for 1 s in 10 × 100 ms steps: v = 1 m/s, s = ½·a·t² = 0.5 m.
    for (let i = 0; i < 10; i += 1) {
      f.handleMotion({ acceleration: { x: 0, y: 1, z: 0 }, interval: 100 });
    }
    const pose = f.getPose();
    expect(pose.x).toBeCloseTo(0, 9);
    expect(pose.y).toBeCloseTo(0.5, 9);
    expect(pose.z).toBeCloseTo(0, 9);
    expect(f.distanceSinceFix).toBeCloseTo(0.5, 9);
  });

  it('rotates device-frame acceleration by the current heading', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 0, distanceHalfLifeM: 0 });
    // Facing venue +x (90° clockwise from +y): device "forward" is venue +x.
    f.applyFix(fix(clock, { heading: 90 }));
    for (let i = 0; i < 10; i += 1) {
      f.handleMotion({ acceleration: { x: 0, y: 1, z: 0 }, interval: 100 });
    }
    const pose = f.getPose();
    expect(pose.x).toBeCloseTo(0.5, 9);
    expect(pose.y).toBeCloseTo(0, 9);
  });

  it('falls back to the injected clock when interval is absent', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 0, distanceHalfLifeM: 0 });
    f.applyFix(fix(clock));

    f.handleMotion({ acceleration: { x: 0, y: 1, z: 0 } }); // first sample: dt unknown, ignored
    clock.advance(1_000);
    f.handleMotion({ acceleration: { x: 0, y: 1, z: 0 } }); // dt = 1 s
    // One Euler step: v = 1 m/s, s = ½·(0+1)·1 = 0.5 m.
    expect(f.getPose().y).toBeCloseTo(0.5, 9);
  });

  it('treats null / missing acceleration components as 0', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now });
    f.applyFix(fix(clock));
    expect(() => f.handleMotion({ acceleration: null, interval: 100 })).not.toThrow();
    expect(() => f.handleMotion({ acceleration: { x: null }, interval: 100 })).not.toThrow();
    expect(f.getPose()).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('emits "pose" on every motion sample', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now });
    const onPose = vi.fn();
    f.applyFix(fix(clock));
    f.on('pose', onPose);
    f.handleMotion({ acceleration: { x: 1, y: 0, z: 0 }, interval: 50 });
    f.handleMotion({ acceleration: { x: 1, y: 0, z: 0 }, interval: 50 });
    expect(onPose).toHaveBeenCalledTimes(2);
  });
});

describe('PoseFusion — heading from device orientation', () => {
  it('uses webkitCompassHeading directly', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now });
    f.applyFix(fix(clock));
    f.handleOrientation({ webkitCompassHeading: 45, alpha: 999 });
    expect(f.getPose().heading).toBe(45);
  });

  it('converts alpha (counter-clockwise) to clockwise heading', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now });
    f.applyFix(fix(clock));
    f.handleOrientation({ alpha: 90 });
    expect(f.getPose().heading).toBe(270);
  });

  it('applies the venue heading offset and wraps into [0, 360)', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, headingOffsetDeg: 30 });
    f.applyFix(fix(clock));
    f.handleOrientation({ webkitCompassHeading: 350 });
    expect(f.getPose().heading).toBe(20);
  });

  it('ignores events with no usable heading', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now });
    f.applyFix(fix(clock, { heading: 123 }));
    f.handleOrientation({ alpha: null });
    f.handleOrientation({});
    expect(f.getPose().heading).toBe(123);
  });
});

describe('PoseFusion — confidence decays with distance', () => {
  it('halves at the distance half-life', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 0, distanceHalfLifeM: 5 });
    f.applyFix(fix(clock));

    // Walk exactly 5 m: 1 m/s² for 1 s (0.5 m), then coast at 1 m/s for 4.5 s.
    for (let i = 0; i < 10; i += 1) {
      f.handleMotion({ acceleration: { x: 0, y: 1, z: 0 }, interval: 100 });
    }
    for (let i = 0; i < 45; i += 1) {
      f.handleMotion({ acceleration: { x: 0, y: 0, z: 0 }, interval: 100 });
    }
    expect(f.distanceSinceFix).toBeCloseTo(5, 6);
    expect(f.getConfidence()).toBeCloseTo(0.5, 6);
  });

  it('compounds time and distance decay', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 1_000, distanceHalfLifeM: 5 });
    f.applyFix(fix(clock));
    for (let i = 0; i < 10; i += 1) {
      f.handleMotion({ acceleration: { x: 0, y: 1, z: 0 }, interval: 100 });
    }
    for (let i = 0; i < 45; i += 1) {
      f.handleMotion({ acceleration: { x: 0, y: 0, z: 0 }, interval: 100 });
    }
    clock.advance(1_000);
    // 0.5 (time) × 0.5 (distance)
    expect(f.getConfidence()).toBeCloseTo(0.25, 6);
  });
});

describe('PoseFusion — "rescan-needed" event', () => {
  it('fires once when confidence drops below the threshold', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 1_000, rescanThreshold: 0.3 });
    const onRescan = vi.fn();
    f.on('rescan-needed', onRescan);
    f.applyFix(fix(clock));

    expect(f.tick()).toBe(false);
    expect(onRescan).not.toHaveBeenCalled();

    clock.advance(1_000); // 0.5 — still above 0.3
    expect(f.tick()).toBe(false);
    expect(onRescan).not.toHaveBeenCalled();

    clock.advance(1_000); // 0.25 — below
    expect(f.tick()).toBe(true);
    expect(onRescan).toHaveBeenCalledOnce();
    expect(onRescan.mock.calls[0][0]).toMatchObject({
      threshold: 0.3,
      elapsedMs: 2_000,
      distanceSinceFix: 0,
    });
    expect(onRescan.mock.calls[0][0].confidence).toBeCloseTo(0.25, 12);

    clock.advance(10_000); // still below: must not fire again
    expect(f.tick()).toBe(true);
    expect(onRescan).toHaveBeenCalledOnce();
  });

  it('can fire again after a new fix restores and then loses confidence', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 1_000, rescanThreshold: 0.3 });
    const onRescan = vi.fn();
    f.on('rescan-needed', onRescan);

    f.applyFix(fix(clock));
    clock.advance(5_000);
    f.tick();
    expect(onRescan).toHaveBeenCalledOnce();

    f.applyFix(fix(clock));
    expect(f.tick()).toBe(false);
    clock.advance(5_000);
    f.tick();
    expect(onRescan).toHaveBeenCalledTimes(2);
  });

  it('fires from distance travelled alone', () => {
    const clock = fakeClock();
    const f = new PoseFusion({
      now: clock.now,
      timeHalfLifeMs: 0,
      distanceHalfLifeM: 1,
      rescanThreshold: 0.3,
    });
    const onRescan = vi.fn();
    f.on('rescan-needed', onRescan);
    f.applyFix(fix(clock));

    // Accelerate hard: 10 m/s² for 1 s → 5 m travelled → 0.5^5 ≈ 0.03.
    for (let i = 0; i < 10; i += 1) {
      f.handleMotion({ acceleration: { x: 0, y: 10, z: 0 }, interval: 100 });
    }
    expect(f.tick()).toBe(true);
    expect(onRescan).toHaveBeenCalledOnce();
    expect(onRescan.mock.calls[0][0].distanceSinceFix).toBeCloseTo(5, 6);
  });

  it('respects a configurable threshold', () => {
    const clock = fakeClock();
    const strict = new PoseFusion({ now: clock.now, timeHalfLifeMs: 1_000, rescanThreshold: 0.9 });
    const lax = new PoseFusion({ now: clock.now, timeHalfLifeMs: 1_000, rescanThreshold: 0.1 });
    strict.applyFix(fix(clock));
    lax.applyFix(fix(clock));
    clock.advance(500); // ≈ 0.707
    expect(strict.tick()).toBe(true);
    expect(lax.tick()).toBe(false);
  });

  it('unsubscribes', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 100 });
    const onRescan = vi.fn();
    const off = f.on('rescan-needed', onRescan);
    f.applyFix(fix(clock));
    off();
    clock.advance(10_000);
    f.tick();
    expect(onRescan).not.toHaveBeenCalled();
  });
});

describe('PoseFusion — attach()', () => {
  it('adds and removes window listeners', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now });
    f.applyFix(fix(clock));

    const handlers = new Map();
    const target = {
      addEventListener: vi.fn((type, fn) => handlers.set(type, fn)),
      removeEventListener: vi.fn((type) => handlers.delete(type)),
    };

    const detach = f.attach(target);
    expect(target.addEventListener).toHaveBeenCalledTimes(2);

    handlers.get('deviceorientation')({ webkitCompassHeading: 180 });
    expect(f.getPose().heading).toBe(180);

    detach();
    expect(target.removeEventListener).toHaveBeenCalledTimes(2);
    expect(handlers.size).toBe(0);
  });
});
