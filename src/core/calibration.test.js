import { describe, expect, it } from 'vitest';

import { createCalibration } from './calibration.js';

describe('createCalibration (adaptive stride)', () => {
  it('starts at the assumed stride', () => {
    const c = createCalibration({ strideM: 0.73 });
    expect(c.strideM).toBe(0.73);
    expect(c.walks).toBe(0);
  });

  it('moves toward a longer stride after a long walk, but not all the way at once', () => {
    const c = createCalibration({ strideM: 0.73 });
    // 40 m in 47 steps is 0.85 m per step.
    expect(c.observe({ steps: 47, routeM: 40 })).toBe(true);
    expect(c.strideM).toBeGreaterThan(0.73);
    expect(c.strideM).toBeLessThan(0.85);
  });

  it('converges on the true stride over several walks', () => {
    const c = createCalibration({ strideM: 0.73 });
    for (let i = 0; i < 6; i += 1) c.observe({ steps: 50, routeM: 40 }); // 0.80
    expect(c.strideM).toBeGreaterThan(0.78);
    expect(c.strideM).toBeLessThan(0.82);
    expect(c.uncertaintyM).toBeLessThan(0.03); // and it is more sure of itself
  });

  it('a long walk moves it more than a short one', () => {
    const long = createCalibration();
    const short = createCalibration();
    long.observe({ steps: 70, routeM: 60 });
    short.observe({ steps: 12, routeM: 10.3 }); // the same 0.857 m per step
    expect(long.strideM - 0.73).toBeGreaterThan(short.strideM - 0.73);
  });

  it('ignores walks too short to learn from', () => {
    const c = createCalibration();
    expect(c.observe({ steps: 6, routeM: 12 })).toBe(false); // few steps
    expect(c.observe({ steps: 20, routeM: 5 })).toBe(false); // markers too close together
    expect(c.strideM).toBe(0.73);
    expect(c.walks).toBe(0);
  });

  it('throws out a walk that cannot be this person walking the route', () => {
    const c = createCalibration();
    for (let i = 0; i < 4; i += 1) c.observe({ steps: 50, routeM: 37 }); // 0.74: settled
    const before = c.strideM;
    // 100 steps for 37 m (0.37 m each: they wandered, or took another way round).
    expect(c.observe({ steps: 100, routeM: 37 })).toBe(false);
    expect(c.strideM).toBe(before);
  });

  it('never leaves the range of a human stride', () => {
    const c = createCalibration({ strideM: 0.95 });
    for (let i = 0; i < 30; i += 1) c.observe({ steps: 20, routeM: 30 }); // 1.5 m per step
    expect(c.strideM).toBeLessThanOrEqual(1);
    const d = createCalibration({ strideM: 0.55 });
    for (let i = 0; i < 30; i += 1) d.observe({ steps: 60, routeM: 20 }); // 0.33 m per step
    expect(d.strideM).toBeGreaterThanOrEqual(0.5);
  });

  it('is not thrown by a sloppy venue map: a 2 m error on a 40 m walk is still a decent measurement', () => {
    const c = createCalibration({ strideM: 0.73 });
    c.observe({ steps: 50, routeM: 42 }); // true 40 m, map says 42: 0.84 not 0.80
    expect(c.strideM).toBeLessThan(0.84);
  });
});
