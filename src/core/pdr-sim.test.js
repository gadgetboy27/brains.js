import { describe, expect, it } from 'vitest';

import { compareVariants, formatComparison, generateWalk, mulberry32 } from './pdr-sim.js';
import { PoseFusion } from './fusion.js';
import { createVenue } from './venue.js';
import { findRoute } from './router.js';
import demo from '../venues/demo-venue.json';

const venue = createVenue(structuredClone(demo));
const routes = [
  ['n-entrance', 'n-clinic-a'],
  ['n-entrance', 'n-lift-g'],
];
const byId = (c, id) => c.results.find((r) => r.id === id);

describe('generateWalk', () => {
  const nodes = findRoute(venue.graph, 'n-entrance', 'n-clinic-a').nodes;

  it('is deterministic for a seed and ends at the destination', () => {
    const a = generateWalk(nodes, {}, mulberry32(7));
    const b = generateWalk(nodes, {}, mulberry32(7));
    expect(a.samples.length).toBe(b.samples.length);
    expect(a.samples[100]).toEqual(b.samples[100]);
    const end = a.samples.at(-1).truth;
    expect(Math.hypot(end.x - 10, end.y - 12)).toBeLessThan(0.1);
  });

  it('produces a footstep peak about every 0.55 s', () => {
    const w = generateWalk(nodes, {}, mulberry32(1));
    const peaks = w.samples.filter((s) => s.motion.acceleration.y > 1.5).length;
    expect(Math.abs(peaks - w.samples.at(-1).t / 0.55)).toBeLessThan(2);
  });
});

describe('compareVariants', () => {
  it('with perfect sensors and the right stride, every strategy stays close', () => {
    const perfect = {
      strideError: 0,
      compassBiasDeg: 0,
      compassNoiseDeg: 0,
      disturbanceDeg: 0,
      burstsPerWalk: 0,
      gyroBiasDps: 0,
      gyroNoiseDps: 0,
    };
    const c = compareVariants({ venue, routes, runs: 3, scenario: perfect });
    for (const r of c.results) expect(r.meanM, r.id).toBeLessThan(1.5);
  });

  it('is repeatable for a seed', () => {
    const a = compareVariants({ venue, routes, runs: 3, seed: 5 });
    const b = compareVariants({ venue, routes, runs: 3, seed: 5 });
    expect(a).toEqual(b);
  });

  it('gyro blending beats the compass alone when the compass is disturbed', () => {
    const c = compareVariants({ venue, routes, runs: 15 });
    expect(byId(c, 'gyro').meanM).toBeLessThan(byId(c, 'compass').meanM * 0.85);
  });

  it('corner fixes do not make the gyro-blended position worse', () => {
    const c = compareVariants({ venue, routes, runs: 15 });
    expect(byId(c, 'gyro+corners').meanM).toBeLessThanOrEqual(byId(c, 'gyro').meanM * 1.05);
  });

  it('corner fixes leave an already-accurate position alone (dead band)', () => {
    const quiet = { disturbanceDeg: 0, burstsPerWalk: 0, compassNoiseDeg: 0, compassBiasDeg: 0 };
    const c = compareVariants({ venue, routes, runs: 15, scenario: quiet });
    expect(byId(c, 'gyro+corners').meanM).toBeLessThanOrEqual(byId(c, 'gyro').meanM * 1.03);
  });

  it('formats a markdown table with every strategy', () => {
    const text = formatComparison(compareVariants({ venue, routes, runs: 2 }));
    expect(text).toContain('| Strategy |');
    for (const label of [
      'Compass only',
      'Gyro blended with compass',
      'Gyro blend + corner fixes',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('rejects a route that does not exist', () => {
    expect(() => compareVariants({ venue, routes: [['n-entrance', 'nope']], runs: 1 })).toThrow();
  });
});

describe('PoseFusion.applySoftFix', () => {
  it('moves the position and restarts decay without resetting the heading state', () => {
    let t = 1000;
    const f = new PoseFusion({ now: () => t });
    f.applyFix({ x: 0, y: 0, z: 0, floor: 0, heading: 0, confidence: 1, timestamp: t });
    f.handleOrientation({ webkitCompassHeading: 40 });
    t += 20_000;
    const before = f.getConfidence();
    f.applySoftFix({ x: 3, y: 4, z: 0, floor: 0, heading: 250, confidence: 0.75, timestamp: t });
    const pose = f.getPose();
    expect([pose.x, pose.y, pose.heading]).toEqual([3, 4, 40]); // pose heading ignored
    expect(pose.confidence).toBeCloseTo(0.75, 5);
    expect(pose.confidence).toBeGreaterThan(before);
    // A compass reading right after is blended with the gyro, not snapped as after a scan.
    f.handleMotion({
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
    });
    t += 100;
    f.handleMotion({
      rotationRate: { alpha: 0, beta: 0, gamma: 0 },
      accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
    });
    f.handleOrientation({ webkitCompassHeading: 40 });
    f.handleOrientation({ webkitCompassHeading: 100 }); // a 60° glitch
    expect(f.getPose().heading).toBeCloseTo(40, 0);
  });
});
