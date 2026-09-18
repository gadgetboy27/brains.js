import { describe, expect, it } from 'vitest';

import { createNavigator } from './navigation.js';
import { findRoute } from './router.js';
import { createVenue } from './venue.js';
import demo from '../venues/demo-venue.json';

const venue = createVenue(structuredClone(demo));
const pose = (x, y, floor = 0) => ({
  x,
  y,
  z: floor * 4,
  floor,
  heading: 0,
  confidence: 1,
  timestamp: 1,
});

describe('createNavigator', () => {
  it('requires a found route', () => {
    expect(() => createNavigator(null)).toThrow(TypeError);
    expect(() => createNavigator({ found: false })).toThrow(TypeError);
  });

  it('starts by heading for the second node with the full distance remaining', () => {
    const route = findRoute(venue.graph, 'n-entrance', 'n-clinic-a'); // entrance→lobby→corr-g-1→clinic-a, 22 m
    const nav = createNavigator(route);
    expect(nav.state).toBeNull();
    const s = nav.update(pose(0, 0));
    expect(s.nextIndex).toBe(1);
    expect(s.nextNode.id).toBe('n-lobby');
    expect(s.nextEdge.type).toBe('door');
    expect(s.distanceToNext).toBe(6);
    expect(s.distanceRemaining).toBe(22);
    expect(s.arrived).toBe(false);
    expect(s.floorChange).toBeNull();
  });

  it('advances past nodes as the user reaches them and tracks distance remaining', () => {
    const route = findRoute(venue.graph, 'n-entrance', 'n-clinic-a');
    const nav = createNavigator(route);
    nav.update(pose(0, 3));
    expect(nav.state.nextNode.id).toBe('n-lobby');
    expect(nav.state.distanceRemaining).toBe(19);

    nav.update(pose(0, 5.5)); // within 2 m of the lobby
    expect(nav.state.nextNode.id).toBe('n-corridor-g-1');
    expect(nav.state.distanceRemaining).toBeCloseTo(Math.hypot(10, 0.5) + 6, 6);

    nav.update(pose(6, 6)); // along the corridor, past the lobby
    expect(nav.state.nextNode.id).toBe('n-corridor-g-1');
    expect(nav.state.distanceRemaining).toBe(10);
  });

  it('never goes backwards on a noisy pose', () => {
    const route = findRoute(venue.graph, 'n-entrance', 'n-clinic-a');
    const nav = createNavigator(route);
    nav.update(pose(9, 6)); // near corridor-g-1 → next becomes clinic-a
    expect(nav.state.nextNode.id).toBe('n-clinic-a');
    nav.update(pose(0, 0)); // jumps back to the entrance
    expect(nav.state.nextNode.id).toBe('n-clinic-a');
  });

  it('arrives within the arrive radius and reports zero remaining', () => {
    const route = findRoute(venue.graph, 'n-entrance', 'n-clinic-a');
    const nav = createNavigator(route, { arriveRadius: 3 });
    const s = nav.update(pose(10, 9.5));
    expect(s.arrived).toBe(true);
    expect(s.distanceRemaining).toBe(0);
    expect(s.nextNode.id).toBe('n-clinic-a');
  });

  it('handles a single-node route (already there)', () => {
    const route = findRoute(venue.graph, 'n-lobby', 'n-lobby');
    const nav = createNavigator(route);
    const s = nav.update(pose(0, 6));
    expect(s.arrived).toBe(true);
    expect(s.nextIndex).toBe(0);
    expect(s.nextEdge).toBeNull();
  });

  it('reports the upcoming floor change and off-floor state', () => {
    const route = findRoute(venue.graph, 'n-entrance', 'n-clinic-b', {
      wheelchair: true,
      timeOfDay: '12:00',
    });
    const nav = createNavigator(route);
    let s = nav.update(pose(0, 0));
    expect(s.floorChange.edge.type).toBe('lift');
    expect(s.floorChange.from.id).toBe('n-lift-g');
    expect(s.floorChange.to.id).toBe('n-lift-1');
    expect(s.offFloor).toBe(false);

    // At the ground lift lobby: next is the lift on floor 1, pose still on floor 0.
    s = nav.update(pose(30, 10));
    expect(s.nextNode.id).toBe('n-lift-1');
    expect(s.offFloor).toBe(true);
    expect(s.distanceToNext).toBe(0); // horizontally under it

    // Emerging on floor 1 at the lift: advance past it.
    s = nav.update(pose(30, 10, 1));
    expect(s.nextNode.id).toBe('n-corridor-1-3');
    expect(s.offFloor).toBe(false);
    expect(s.floorChange).toBeNull();
    expect(s.distanceRemaining).toBe(4 + 10 + 6);
  });

  it('does not advance past a node on another floor', () => {
    const route = findRoute(venue.graph, 'n-entrance', 'n-clinic-b');
    const nav = createNavigator(route);
    nav.update(pose(10, 2)); // at ground stairs → next is stairs-1 (floor 1)
    expect(nav.state.nextNode.id).toBe('n-stairs-1');
    nav.update(pose(10, 2)); // still on floor 0 at the same spot: must not advance
    expect(nav.state.nextNode.id).toBe('n-stairs-1');
  });

  it('reset() starts over', () => {
    const route = findRoute(venue.graph, 'n-entrance', 'n-clinic-a');
    const nav = createNavigator(route);
    nav.update(pose(9, 6));
    nav.reset();
    expect(nav.state).toBeNull();
    expect(nav.update(pose(0, 0)).nextNode.id).toBe('n-lobby');
  });
});
