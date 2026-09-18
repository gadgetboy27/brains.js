import { describe, expect, it } from 'vitest';

import {
  edgeIsStepFree,
  edgeIsWheelchair,
  edgePassesFilter,
  findRoute,
  indexGraph,
  isOpenAt,
} from './router.js';

/**
 * Two-floor venue.
 *
 *   Floor 1:   [upper] ------- [office]
 *                |  \             |
 *             stairs  lift     (staff door)
 *                |      \         |
 *   Floor 0:  [lobby] -- [hall] -- [shop]
 *                 \_______________/
 *                 (late-night corridor, open 18:00–02:00)
 *
 * Distances are chosen so the "wrong" edge is always the tempting shortcut.
 */
function venue() {
  return {
    nodes: [
      { id: 'lobby', x: 0, y: 0, z: 0, floor: 0 },
      { id: 'hall', x: 10, y: 0, z: 0, floor: 0 },
      { id: 'shop', x: 20, y: 0, z: 0, floor: 0 },
      { id: 'upper', x: 0, y: 0, z: 4, floor: 1 },
      { id: 'office', x: 20, y: 0, z: 4, floor: 1 },
    ],
    edges: [
      { from: 'lobby', to: 'hall', type: 'walk' },
      { from: 'hall', to: 'shop', type: 'walk' },
      // Stairs: short. Lift: long way round.
      { from: 'lobby', to: 'upper', type: 'stairs', distance: 6 },
      { from: 'hall', to: 'upper', type: 'lift', distance: 30 },
      { from: 'upper', to: 'office', type: 'walk' },
      // Staff-only door straight up to the office: much shorter than via upper.
      { from: 'shop', to: 'office', type: 'door', accessLevel: 'staffOnly', distance: 4 },
      // Direct corridor, only open in the evening.
      {
        from: 'lobby',
        to: 'shop',
        type: 'walk',
        distance: 15,
        hours: [{ open: '18:00', close: '02:00' }],
      },
    ],
  };
}

const edgeTypes = (route) => route.edges.map((e) => e.type);

describe('findRoute — basics', () => {
  it('finds the shortest path and reports its distance', () => {
    // No timeOfDay in the filter, so hours are ignored and the 15 m corridor
    // beats the 20 m route via the hall.
    const route = findRoute(venue(), 'lobby', 'shop');
    expect(route.found).toBe(true);
    expect(route.path).toEqual(['lobby', 'shop']);
    expect(route.distance).toBe(15);
    expect(route.nodes.map((n) => n.id)).toEqual(route.path);
    expect(route.edges).toHaveLength(1);

    const daytime = findRoute(venue(), 'lobby', 'shop', { timeOfDay: '14:00' });
    expect(daytime.path).toEqual(['lobby', 'hall', 'shop']);
    expect(daytime.distance).toBe(20);
    expect(daytime.edges).toHaveLength(2);
  });

  it('prefers a shorter explicit-distance edge over straight-line ones', () => {
    // At 19:00 the 15 m corridor beats the 20 m via hall.
    const route = findRoute(venue(), 'lobby', 'shop', { timeOfDay: '19:00' });
    expect(route.path).toEqual(['lobby', 'shop']);
    expect(route.distance).toBe(15);
  });

  it('returns a zero-length route when start equals goal', () => {
    const route = findRoute(venue(), 'hall', 'hall');
    expect(route).toMatchObject({ found: true, path: ['hall'], distance: 0, edges: [] });
  });

  it('honours oneWay edges', () => {
    const graph = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
      ],
      edges: [{ from: 'a', to: 'b', oneWay: true }],
    };
    expect(findRoute(graph, 'a', 'b').found).toBe(true);
    expect(findRoute(graph, 'b', 'a')).toMatchObject({ found: false, reason: 'no-route' });
  });

  it('returns a clear no-route result for disconnected nodes', () => {
    const graph = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
        { id: 'c', x: 2, y: 0 },
      ],
      edges: [{ from: 'a', to: 'b' }],
    };
    const result = findRoute(graph, 'a', 'c', { stepFree: true });
    expect(result).toEqual({
      found: false,
      reason: 'no-route',
      from: 'a',
      to: 'c',
      filter: { stepFree: true },
      edgesExcluded: 0,
    });
  });

  it('throws for unknown start or goal nodes', () => {
    expect(() => findRoute(venue(), 'nowhere', 'shop')).toThrow(/unknown start node 'nowhere'/);
    expect(() => findRoute(venue(), 'lobby', 'nowhere')).toThrow(/unknown goal node 'nowhere'/);
  });

  it('finds the true shortest path in a grid, not just any path', () => {
    // 3×3 grid, unit spacing, with one diagonal shortcut that is slightly
    // longer than 2 so the orthogonal route through the middle must win.
    const nodes = [];
    const edges = [];
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        nodes.push({ id: `${x},${y}`, x, y });
        if (x > 0) edges.push({ from: `${x - 1},${y}`, to: `${x},${y}` });
        if (y > 0) edges.push({ from: `${x},${y - 1}`, to: `${x},${y}` });
      }
    }
    edges.push({ from: '0,0', to: '2,2', distance: 4.5 });
    const route = findRoute({ nodes, edges }, '0,0', '2,2');
    expect(route.distance).toBe(4);
    expect(route.path).toHaveLength(5);
  });
});

describe('findRoute — wheelchair and step-free filters', () => {
  it('unfiltered route takes the stairs (the shortcut)', () => {
    const route = findRoute(venue(), 'lobby', 'office');
    expect(edgeTypes(route)).toContain('stairs');
    expect(route.distance).toBe(26); // 6 stairs + 20 walk
  });

  it('a wheelchair route never uses a stair edge', () => {
    const route = findRoute(venue(), 'lobby', 'office', { wheelchair: true });
    expect(route.found).toBe(true);
    expect(edgeTypes(route)).not.toContain('stairs');
    expect(edgeTypes(route)).not.toContain('escalator');
    expect(route.path).toEqual(['lobby', 'hall', 'upper', 'office']);
    expect(route.distance).toBe(60); // 10 + 30 lift + 20
  });

  it('a step-free route never uses stairs or escalators', () => {
    const graph = venue();
    graph.edges.push({ from: 'hall', to: 'office', type: 'escalator', distance: 5 });
    const route = findRoute(graph, 'lobby', 'office', { stepFree: true });
    expect(edgeTypes(route)).not.toContain('stairs');
    expect(edgeTypes(route)).not.toContain('escalator');
  });

  it('wheelchair excludes step-free edges explicitly flagged wheelchair: false', () => {
    const graph = venue();
    // Make the lift unusable by wheelchair (e.g. too small) — no route left.
    graph.edges.find((e) => e.type === 'lift').wheelchair = false;
    const result = findRoute(graph, 'lobby', 'office', { wheelchair: true });
    expect(result).toMatchObject({ found: false, reason: 'no-route' });
    expect(result.edgesExcluded).toBe(3); // stairs, lift, staff door
  });

  it('stepFree alone still allows a non-wheelchair edge', () => {
    const graph = venue();
    graph.edges.find((e) => e.type === 'lift').wheelchair = false;
    expect(findRoute(graph, 'lobby', 'office', { stepFree: true }).found).toBe(true);
  });

  it('routes with every stair edge removed at every scale', () => {
    // Brute-force check: across a set of random-ish graphs a wheelchair route
    // never contains a stair edge, and when the unfiltered route has no stairs
    // both routes are equal.
    for (let seed = 1; seed <= 20; seed += 1) {
      const nodes = Array.from({ length: 8 }, (_, i) => ({
        id: `n${i}`,
        x: (i * 37 * seed) % 50,
        y: (i * 91 * seed) % 50,
      }));
      const edges = [];
      for (let i = 0; i < 8; i += 1) {
        for (let j = i + 1; j < 8; j += 1) {
          if ((i * 7 + j * 13 + seed) % 3 === 0) {
            edges.push({
              from: `n${i}`,
              to: `n${j}`,
              type: (i + j + seed) % 4 === 0 ? 'stairs' : 'walk',
            });
          }
        }
      }
      const route = findRoute({ nodes, edges }, 'n0', 'n7', { wheelchair: true });
      if (route.found) expect(edgeTypes(route)).not.toContain('stairs');
    }
  });
});

describe('findRoute — access level', () => {
  it('a visitor route never uses a staffOnly edge', () => {
    const route = findRoute(venue(), 'shop', 'office', { timeOfDay: '14:00' });
    expect(route.found).toBe(true);
    expect(route.edges.every((e) => (e.accessLevel ?? 'public') !== 'staffOnly')).toBe(true);
    expect(route.path).toEqual(['shop', 'hall', 'lobby', 'upper', 'office']);
    expect(route.distance).toBe(46); // 10 + 10 + 6 stairs + 20
  });

  it('is the same when accessLevel is given explicitly as visitor', () => {
    const route = findRoute(venue(), 'shop', 'office', { accessLevel: 'visitor' });
    expect(route.path).not.toContain('office-door');
    expect(route.edges.some((e) => e.accessLevel === 'staffOnly')).toBe(false);
  });

  it('a staff route may use the staffOnly door', () => {
    const route = findRoute(venue(), 'shop', 'office', { accessLevel: 'staff' });
    expect(route.path).toEqual(['shop', 'office']);
    expect(route.distance).toBe(4);
    expect(route.edges[0].accessLevel).toBe('staffOnly');
  });

  it('reports no-route when the only way is staffOnly', () => {
    const graph = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
      ],
      edges: [{ from: 'a', to: 'b', accessLevel: 'staffOnly' }],
    };
    expect(findRoute(graph, 'a', 'b')).toMatchObject({ found: false, edgesExcluded: 1 });
    expect(findRoute(graph, 'a', 'b', { accessLevel: 'staff' }).found).toBe(true);
  });

  it('rejects an unknown access level', () => {
    expect(() => findRoute(venue(), 'lobby', 'shop', { accessLevel: 'ceo' })).toThrow(RangeError);
  });
});

describe('findRoute — time of day', () => {
  it('an after-hours route respects edge hours', () => {
    // Corridor is open 18:00–02:00. At 14:00 it must not be used…
    const day = findRoute(venue(), 'lobby', 'shop', { timeOfDay: '14:00' });
    expect(day.path).toEqual(['lobby', 'hall', 'shop']);
    expect(day.edges.every((e) => !e.hours)).toBe(true);

    // …at 23:00 it is the shortest route…
    const night = findRoute(venue(), 'lobby', 'shop', { timeOfDay: '23:00' });
    expect(night.path).toEqual(['lobby', 'shop']);

    // …and at 01:30 (overnight window) it is still open.
    const smallHours = findRoute(venue(), 'lobby', 'shop', { timeOfDay: '01:30' });
    expect(smallHours.path).toEqual(['lobby', 'shop']);

    // At 02:00 exactly it has closed.
    const closing = findRoute(venue(), 'lobby', 'shop', { timeOfDay: '02:00' });
    expect(closing.path).toEqual(['lobby', 'hall', 'shop']);
  });

  it('returns no-route when the only edge is closed', () => {
    const graph = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
      ],
      edges: [{ from: 'a', to: 'b', hours: [{ open: '09:00', close: '17:00' }] }],
    };
    expect(findRoute(graph, 'a', 'b', { timeOfDay: '20:00' })).toMatchObject({
      found: false,
      reason: 'no-route',
      edgesExcluded: 1,
    });
    expect(findRoute(graph, 'a', 'b', { timeOfDay: '12:00' }).found).toBe(true);
    // No time given: hours are ignored.
    expect(findRoute(graph, 'a', 'b').found).toBe(true);
  });

  it('accepts a Date and applies day-of-week restrictions', () => {
    const graph = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
      ],
      // Weekdays only, 09:00–17:00.
      edges: [
        { from: 'a', to: 'b', hours: [{ open: '09:00', close: '17:00', days: [1, 2, 3, 4, 5] }] },
      ],
    };
    const tuesdayNoon = new Date(2026, 8, 22, 12, 0); // 2026-09-22 is a Tuesday
    const saturdayNoon = new Date(2026, 8, 26, 12, 0);
    expect(findRoute(graph, 'a', 'b', { timeOfDay: tuesdayNoon }).found).toBe(true);
    expect(findRoute(graph, 'a', 'b', { timeOfDay: saturdayNoon }).found).toBe(false);
  });
});

describe('isOpenAt', () => {
  it('is always open without hours or without a time', () => {
    expect(isOpenAt(undefined, '12:00')).toBe(true);
    expect(isOpenAt([{ open: '09:00', close: '17:00' }], undefined)).toBe(true);
  });

  it('treats close as exclusive and open as inclusive', () => {
    const hours = [{ open: '09:00', close: '17:00' }];
    expect(isOpenAt(hours, '09:00')).toBe(true);
    expect(isOpenAt(hours, '16:59')).toBe(true);
    expect(isOpenAt(hours, '17:00')).toBe(false);
    expect(isOpenAt(hours, '08:59')).toBe(false);
  });

  it('handles multiple windows', () => {
    const hours = [
      { open: '08:00', close: '12:00' },
      { open: '13:00', close: '18:00' },
    ];
    expect(isOpenAt(hours, '12:30')).toBe(false);
    expect(isOpenAt(hours, '13:30')).toBe(true);
  });

  it('carries an overnight window into the following morning by day', () => {
    // Friday 22:00 – 03:00 → still open Saturday 02:00, closed Saturday 22:00.
    const hours = [{ open: '22:00', close: '03:00', days: [5] }];
    expect(isOpenAt(hours, new Date(2026, 8, 25, 23, 0))).toBe(true); // Fri 23:00
    expect(isOpenAt(hours, new Date(2026, 8, 26, 2, 0))).toBe(true); // Sat 02:00
    expect(isOpenAt(hours, new Date(2026, 8, 26, 22, 0))).toBe(false); // Sat 22:00
  });

  it('rejects malformed times', () => {
    expect(() => isOpenAt([{ open: '9am', close: '17:00' }], '12:00')).toThrow(TypeError);
    expect(() => isOpenAt([{ open: '09:00', close: '25:00' }], '12:00')).toThrow(RangeError);
    expect(() => isOpenAt([{ open: '09:00', close: '17:00' }], 'noon')).toThrow(TypeError);
    expect(() => isOpenAt([{ open: '09:00', close: '17:00' }], new Date('nope'))).toThrow(
      RangeError
    );
  });
});

describe('edge accessibility defaults', () => {
  it('derives stepFree and wheelchair from type', () => {
    expect(edgeIsStepFree({ type: 'stairs' })).toBe(false);
    expect(edgeIsStepFree({ type: 'escalator' })).toBe(false);
    expect(edgeIsStepFree({ type: 'lift' })).toBe(true);
    expect(edgeIsStepFree({})).toBe(true);
    expect(edgeIsWheelchair({ type: 'stairs' })).toBe(false);
    expect(edgeIsWheelchair({ type: 'ramp' })).toBe(true);
  });

  it('lets explicit flags override the type', () => {
    expect(edgeIsStepFree({ type: 'stairs', stepFree: true })).toBe(true); // e.g. a stair lift
    expect(edgeIsWheelchair({ type: 'door', wheelchair: false })).toBe(false);
    // wheelchair: true cannot override a non-step-free edge.
    expect(edgeIsWheelchair({ type: 'stairs', wheelchair: true })).toBe(false);
  });

  it('edgePassesFilter combines all criteria', () => {
    const edge = {
      type: 'walk',
      accessLevel: 'staffOnly',
      hours: [{ open: '09:00', close: '17:00' }],
    };
    expect(edgePassesFilter(edge, {})).toBe(false);
    expect(edgePassesFilter(edge, { accessLevel: 'staff' })).toBe(true);
    expect(edgePassesFilter(edge, { accessLevel: 'staff', timeOfDay: '20:00' })).toBe(false);
    expect(edgePassesFilter(edge, { accessLevel: 'staff', timeOfDay: '10:00' })).toBe(true);
  });
});

describe('indexGraph validation', () => {
  it('rejects malformed graphs', () => {
    expect(() => indexGraph(null)).toThrow(TypeError);
    expect(() => indexGraph({ nodes: [], edges: null })).toThrow(TypeError);
    expect(() => indexGraph({ nodes: [{ x: 0, y: 0 }], edges: [] })).toThrow(/non-empty string id/);
    expect(() =>
      indexGraph({
        nodes: [
          { id: 'a', x: 0, y: 0 },
          { id: 'a', x: 1, y: 0 },
        ],
        edges: [],
      })
    ).toThrow(/duplicate node id 'a'/);
    expect(() =>
      indexGraph({ nodes: [{ id: 'a', x: 0, y: 0 }], edges: [{ from: 'a', to: 'zzz' }] })
    ).toThrow(/edges\[0\]\.to references unknown node 'zzz'/);
    expect(() =>
      indexGraph({
        nodes: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 1, y: 0 },
        ],
        edges: [{ from: 'a', to: 'b', distance: -1 }],
      })
    ).toThrow(RangeError);
  });
});
