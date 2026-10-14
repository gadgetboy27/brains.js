import { describe, expect, it } from 'vitest';

import { createNavigator } from './navigation.js';
import { createOffRouteDetector, crossTrackDistance } from './off-route.js';
import { findRoute } from './router.js';
import { createVenue } from './venue.js';
import demo from '../venues/demo-venue.json';

const venue = createVenue(structuredClone(demo));
// Route: entrance (0,0) → lobby (0,6) → corridor (10,6) → clinic A (10,12).
const pose = (x, y, confidence = 0.6, floor = 0) => ({
  x,
  y,
  z: floor * 4,
  floor,
  heading: 0,
  confidence,
  timestamp: 1,
});

function setup(options) {
  const route = findRoute(venue.graph, 'n-entrance', 'n-clinic-a');
  const nav = createNavigator(route);
  const clock = { t: 0 };
  const det = createOffRouteDetector(route, { now: () => clock.t, ...options });
  const step = (p) => det.update(p, nav.update(p));
  return { route, nav, det, step, clock };
}

describe('crossTrackDistance', () => {
  it('is zero on the route and grows with the detour', () => {
    const { route } = setup();
    expect(crossTrackDistance(pose(0, 3), route)).toBeCloseTo(0);
    expect(crossTrackDistance(pose(3, 3), route)).toBeCloseTo(3);
  });

  it('is null when the route has nothing on the pose floor', () => {
    const { route } = setup();
    expect(crossTrackDistance(pose(0, 3, 1, 2), route)).toBeNull();
  });
});

describe('createOffRouteDetector', () => {
  it('stays quiet on the route', () => {
    const { step } = setup();
    for (const y of [0.5, 2, 4, 5.5]) expect(step(pose(0, y)).offRoute).toBe(false);
  });

  it('needs several consecutive bad estimates before a dead-reckoned pose counts', () => {
    const { step } = setup();
    step(pose(0, 3));
    const results = [1, 2, 3, 4].map(() => step(pose(25, 3)));
    expect(results.map((r) => r.offRoute)).toEqual([false, false, false, true]);
    expect(results[3].reason).toBe('cross-track');
  });

  it('a good estimate in between resets the count', () => {
    const { step } = setup();
    step(pose(25, 3));
    step(pose(25, 3));
    step(pose(0, 3));
    expect(step(pose(25, 3)).offRoute).toBe(false);
  });

  it('trusts an exact fix off the route immediately', () => {
    const { step } = setup();
    expect(step(pose(25, 3, 1)).offRoute).toBe(true);
  });

  it('notices walking back the way they came', () => {
    const { step } = setup({ confirmCount: 2, awayM: 2 });
    step(pose(0, 3));
    step(pose(0, 3));
    step(pose(0, 0.5));
    const r = step(pose(0, 0.4));
    expect(r.offRoute).toBe(true);
    expect(r.reason).toBe('away');
  });

  it('is quiet during the cooldown after acknowledge()', () => {
    const { step, det, clock } = setup();
    det.acknowledge();
    expect(step(pose(25, 3, 1)).offRoute).toBe(false);
    clock.t = 9000;
    expect(step(pose(25, 3, 1)).offRoute).toBe(true);
  });

  it('ignores a pose on another floor', () => {
    const { step } = setup();
    expect(step(pose(25, 3, 1, 1)).offRoute).toBe(false);
  });
});
