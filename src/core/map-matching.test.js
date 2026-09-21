import { describe, expect, it } from 'vitest';

import { MapMatcher, nearbyLandmarks, nearestEdge, projectOntoSegment } from './map-matching.js';
import { createVenue } from './venue.js';
import demo from '../venues/demo-venue.json';

const venue = createVenue(structuredClone(demo));
const pose = (x, y, confidence = 0.5, floor = 0) => ({
  x,
  y,
  z: floor * 4,
  floor,
  heading: 0,
  confidence,
  timestamp: 1,
});

describe('projectOntoSegment', () => {
  it('projects onto the segment and clamps to its ends', () => {
    expect(projectOntoSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({
      x: 5,
      y: 0,
      t: 0.5,
      distance: 3,
    });
    expect(projectOntoSegment({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toMatchObject({
      x: 0,
      y: 0,
      t: 0,
      distance: 4,
    });
    expect(projectOntoSegment({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 0 }).distance).toBeCloseTo(
      Math.SQRT2,
      9
    );
  });
});

describe('nearestEdge', () => {
  it('finds the corridor on the same floor, ignoring staff-only, closed and vertical edges', () => {
    const hit = nearestEdge(pose(15, 7.5), venue);
    expect(hit.edge).toMatchObject({ from: 'n-corridor-g-1', to: 'n-corridor-g-2' });
    expect(hit.distance).toBe(1.5);
    // The staff corridor lobby→clinic A passes right here; it must not be used.
    const nearStaff = nearestEdge(pose(5, 9), venue);
    expect(nearStaff.edge.staffOnly).toBeUndefined();
    expect(nearestEdge(pose(5, 9), venue, { includeStaff: true }).edge.staffOnly).toBe(true);
    // Lift edge (floor change) is not a corridor.
    expect(nearestEdge(pose(30, 10, 0.5, 1), venue).edge.type).not.toBe('lift');
    expect(nearestEdge(pose(100, 100), venue, { maxDistance: 4 })).toBeNull();
  });
});

describe('nearbyLandmarks', () => {
  it('lists places, markers and named nodes within range, nearest first, same floor only', () => {
    const near = nearbyLandmarks(pose(1, 1), venue, 6);
    expect(near[0]).toMatchObject({ kind: 'anchor', id: 'a-entrance' }); // (0,1): 1 m
    expect(near.map((l) => `${l.kind}:${l.id}`)).toContain('poi:poi-entrance');
    expect(near.map((l) => `${l.kind}:${l.id}`)).toContain('poi:poi-reception'); // lobby (0,6): ~5.1 m
    expect(near.every((l) => l.distance <= 6)).toBe(true);
    expect(nearbyLandmarks(pose(1, 1, 0.5, 1), venue, 6)).toEqual([]);
    // Staff-only places are never landmarks for visitors.
    expect(nearbyLandmarks(pose(36, 2, 0.5, 1), venue, 3).map((l) => l.id)).not.toContain(
      'poi-staff-room'
    );
    // Named corridor nodes only when asked.
    expect(nearbyLandmarks(pose(15, 6), venue, 6).map((l) => l.kind)).not.toContain('node');
    expect(
      nearbyLandmarks(pose(15, 6), venue, 6, { includeNodes: true }).map((l) => l.name)
    ).toEqual(['Ground corridor, west', 'Ground corridor, middle']);
  });
});

describe('MapMatcher', () => {
  it('snaps a drifting pose onto the corridor and boosts confidence, but never moves an exact fix', () => {
    const m = new MapMatcher(venue);
    const r = m.update(pose(15, 8.2, 0.5));
    expect(r.snapped).toBe(true);
    expect(r.pose).toMatchObject({ x: 15, y: 6, confidence: 0.6 });
    expect(r.offPathM).toBeCloseTo(2.2, 9);
    expect(r.edge).toMatchObject({ from: 'n-corridor-g-1', to: 'n-corridor-g-2' });

    const fix = m.update(pose(15, 8.2, 1));
    expect(fix.snapped).toBe(false);
    expect(fix.pose).toEqual(pose(15, 8.2, 1));
  });

  it('leaves a pose alone when it is far from every corridor', () => {
    const m = new MapMatcher(venue, { maxSnapM: 4 });
    const r = m.update(pose(15, 30, 0.5));
    expect(r.snapped).toBe(false);
    expect(r.pose).toEqual(pose(15, 30, 0.5));
    expect(r.edge).toBeNull();
  });

  it('is sticky: keeps the current corridor until another is clearly closer', () => {
    const m = new MapMatcher(venue, { maxSnapM: 4, stickyM: 2 });
    // Walking the main corridor y=6 near the junction with the door edge x=10 (corridor-g-1 → clinic A).
    m.update(pose(8, 6, 0.5));
    // At (10, 7.2): the door edge (x=10) is 0 m away, the corridor 1.2 m: difference < stickyM → stay.
    let r = m.update(pose(10, 7.2, 0.5));
    expect(r.edge).toMatchObject({ from: 'n-lobby', to: 'n-corridor-g-1' });
    // At (10, 9): corridor is 3 m away, door edge 0 m: difference ≥ stickyM → switch.
    r = m.update(pose(10, 9, 0.5));
    expect(r.edge).toMatchObject({ from: 'n-corridor-g-1', to: 'n-clinic-a' });
    expect(r.pose).toMatchObject({ x: 10, y: 9 });
  });

  it('reports landmarks as you enter and leave their vicinity, with hysteresis', () => {
    const m = new MapMatcher(venue, { landmarkRadiusM: 4, exitRadiusM: 7 });
    let r = m.update(pose(0, 0, 0.5)); // at the entrance
    expect(r.entered.map((l) => l.id).sort()).toEqual(['a-entrance', 'poi-entrance']);
    expect(r.left).toEqual([]);
    r = m.update(pose(0, 5, 0.5)); // 5 m on: still within exit radius, reception now within 4 m
    expect(r.entered.map((l) => l.id)).toEqual(['poi-reception']);
    expect(r.left).toEqual([]);
    r = m.update(pose(6, 6, 0.5)); // entrance now 8.5 m away (> 7), reception 6 m (still near)
    expect(r.left.map((l) => l.id).sort()).toEqual(['a-entrance', 'poi-entrance']);
    expect(m.near.map((l) => l.id)).toContain('poi-reception');
    // Coming back does not re-announce until we had really left.
    r = m.update(pose(0, 5, 0.5));
    expect(r.entered).toEqual([]);
  });

  it('setVenue keeps landmark state but forgets the edge', () => {
    const m = new MapMatcher(venue);
    m.update(pose(15, 8, 0.5));
    m.setVenue(venue);
    expect(m.update(pose(15, 8, 0.5)).snapped).toBe(true);
    m.reset();
    expect(m.near).toEqual([]);
  });
});
