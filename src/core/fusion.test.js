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

describe('PoseFusion — pedestrian dead reckoning (step counting)', () => {
  /** One footstep: a peak in acceleration magnitude, then a fall — the bounce of a walking gait. */
  function walkStep(f) {
    f.handleMotion({ acceleration: { x: 0, y: 2.5, z: 0 } }); // rising to a peak above the default threshold
    f.handleMotion({ acceleration: { x: 0, y: 0.2, z: 0 } }); // falling: the step is counted here
  }

  it('advances one stride along the heading per detected step, not along the acceleration axis', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 0, distanceHalfLifeM: 0 });
    f.applyFix(fix(clock));

    walkStep(f);
    clock.advance(400); // clear the refractory window before the next step
    walkStep(f);

    const pose = f.getPose();
    expect(pose.x).toBeCloseTo(0, 9);
    expect(pose.y).toBeCloseTo(2 * 0.73, 9); // default strideM, heading 0 = venue +y
    expect(pose.z).toBeCloseTo(0, 9);
    expect(f.distanceSinceFix).toBeCloseTo(2 * 0.73, 9);
  });

  it('steps along the current heading, whatever axis the accelerometer spike came from', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 0, distanceHalfLifeM: 0 });
    // Facing venue +x (90° clockwise from +y): a step moves +x, not +y.
    f.applyFix(fix(clock, { heading: 90 }));
    walkStep(f);
    const pose = f.getPose();
    expect(pose.x).toBeCloseTo(0.73, 9);
    expect(pose.y).toBeCloseTo(0, 9);
  });

  it('ignores a second peak inside the refractory window (one footstep, not two)', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, timeHalfLifeMs: 0, distanceHalfLifeM: 0 });
    f.applyFix(fix(clock));
    walkStep(f);
    walkStep(f); // no time advanced: the same footstep's bounce, not a second step
    expect(f.distanceSinceFix).toBeCloseTo(0.73, 9);
  });

  it('ignores jostling below the step threshold', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, strideM: 1, stepThreshold: 1.5 });
    f.applyFix(fix(clock));
    f.handleMotion({ acceleration: { x: 0, y: 0.8, z: 0 } });
    f.handleMotion({ acceleration: { x: 0, y: 0.1, z: 0 } });
    expect(f.distanceSinceFix).toBe(0);
  });

  it('a calibrated stride changes the distance per step', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now, strideM: 0.9 });
    f.applyFix(fix(clock));
    walkStep(f);
    expect(f.getPose().y).toBeCloseTo(0.9, 9);
  });

  it('treats null / missing acceleration components as 0 (no phantom step)', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now });
    f.applyFix(fix(clock));
    expect(() => f.handleMotion({ acceleration: null })).not.toThrow();
    expect(() => f.handleMotion({ acceleration: { x: null } })).not.toThrow();
    expect(f.getPose()).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('emits "pose" for each step counted, not for every raw sample', () => {
    const clock = fakeClock();
    const f = new PoseFusion({ now: clock.now });
    const onPose = vi.fn();
    f.applyFix(fix(clock));
    f.on('pose', onPose);
    walkStep(f);
    expect(onPose).toHaveBeenCalledOnce();
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
  /** N footsteps of a 0.5 m stride, well clear of the refractory window. */
  function walk(f, clock, steps) {
    for (let i = 0; i < steps; i += 1) {
      f.handleMotion({ acceleration: { x: 0, y: 2.5, z: 0 } });
      f.handleMotion({ acceleration: { x: 0, y: 0.2, z: 0 } });
      clock.advance(400);
    }
  }

  it('halves at the distance half-life', () => {
    const clock = fakeClock();
    const f = new PoseFusion({
      now: clock.now,
      timeHalfLifeMs: 0,
      distanceHalfLifeM: 5,
      strideM: 0.5,
    });
    f.applyFix(fix(clock));

    walk(f, clock, 10); // 10 × 0.5 m = 5 m, one distance half-life
    expect(f.distanceSinceFix).toBeCloseTo(5, 9);
    expect(f.getConfidence()).toBeCloseTo(0.5, 9);
  });

  it('compounds time and distance decay', () => {
    const clock = fakeClock();
    const f = new PoseFusion({
      now: clock.now,
      timeHalfLifeMs: 1_000,
      distanceHalfLifeM: 5,
      strideM: 0.5,
    });
    f.applyFix(fix(clock));
    walk(f, clock, 10); // 5 m distance decay
    clock.advance(1_000 - 10 * 400); // land exactly one time half-life after the fix
    // 0.5 (time) × 0.5 (distance)
    expect(f.getConfidence()).toBeCloseTo(0.25, 9);
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
      strideM: 0.5,
    });
    const onRescan = vi.fn();
    f.on('rescan-needed', onRescan);
    f.applyFix(fix(clock));

    // 10 steps of 0.5 m → 5 m travelled → 0.5^5 ≈ 0.03.
    for (let i = 0; i < 10; i += 1) {
      f.handleMotion({ acceleration: { x: 0, y: 2.5, z: 0 } });
      f.handleMotion({ acceleration: { x: 0, y: 0.2, z: 0 } });
      clock.advance(400);
    }
    expect(f.tick()).toBe(true);
    expect(onRescan).toHaveBeenCalledOnce();
    expect(onRescan.mock.calls[0][0].distanceSinceFix).toBeCloseTo(5, 9);
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
