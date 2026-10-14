import { describe, expect, it } from 'vitest';

import { angleDiff, createTurnDetector, matchTurn } from './turn-correction.js';
import { createVenue } from './venue.js';
import demo from '../venues/demo-venue.json';

const venue = createVenue(structuredClone(demo));
// Demo ground floor: entrance (0,0) → lobby (0,6) → corridor (10,6) → …

/** Walk north then east, dead reckoning short by 2 m: the corner is "seen" at y=4. */
function walk(det, { turnAtMs = 4000, endMs = 8000, headingAfter = 90 } = {}) {
  let turn = null;
  for (let t = 0; t <= endMs; t += 250) {
    const north = t < turnAtMs;
    const pose = {
      x: north ? 0 : ((t - turnAtMs) / 1000) * 1.2,
      y: north ? (t / 1000) * 1.0 : (turnAtMs / 1000) * 1.0,
      floor: 0,
      heading: north ? 0 : headingAfter,
      confidence: 0.7,
      timestamp: t,
    };
    turn = det.update(pose) ?? turn;
  }
  return turn;
}

describe('angleDiff', () => {
  it('is the signed shortest turn', () => {
    expect(angleDiff(90, 0)).toBe(90);
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(180, 0)).toBe(180);
  });
});

describe('createTurnDetector', () => {
  it('reports a clockwise corner and where dead reckoning put it', () => {
    const turn = walk(createTurnDetector());
    expect(turn.angle).toBeCloseTo(90, 0);
    expect(turn.headingBefore).toBeCloseTo(0, 0);
    expect(turn.headingAfter).toBeCloseTo(90, 0);
    expect(turn.y).toBeCloseTo(4, 0);
    expect(turn.x).toBeLessThan(1);
  });

  it('reports an anticlockwise corner as negative', () => {
    const turn = walk(createTurnDetector(), { headingAfter: 270 });
    expect(turn.angle).toBeCloseTo(-90, 0);
  });

  it('ignores a wobble, a gentle bend, and a turn while standing still', () => {
    expect(walk(createTurnDetector(), { headingAfter: 25 })).toBeNull();
    const det = createTurnDetector();
    let hit = null;
    for (let t = 0; t <= 8000; t += 250) {
      hit = det.update({ x: 0, y: 0, floor: 0, heading: t < 4000 ? 0 : 90, timestamp: t }) ?? hit;
    }
    expect(hit).toBeNull();
  });

  it('ignores noisy, unsteady headings', () => {
    const det = createTurnDetector();
    let hit = null;
    for (let t = 0; t <= 8000; t += 250) {
      const h = (t / 250) % 2 === 0 ? 0 : 140;
      hit = det.update({ x: 0, y: t / 1000, floor: 0, heading: h, timestamp: t }) ?? hit;
    }
    expect(hit).toBeNull();
  });

  it('fires once per corner, not on every following sample', () => {
    const det = createTurnDetector();
    let count = 0;
    for (let t = 0; t <= 8000; t += 250) {
      const north = t < 4000;
      const pose = {
        x: north ? 0 : ((t - 4000) / 1000) * 1.2,
        y: north ? t / 1000 : 4,
        floor: 0,
        heading: north ? 0 : 90,
        timestamp: t,
      };
      if (det.update(pose)) count += 1;
    }
    expect(count).toBe(1);
  });
});

describe('matchTurn', () => {
  const turn = { angle: 90, headingBefore: 0, headingAfter: 90, x: 0, y: 4, floor: 0 };

  it('finds the one junction that fits and returns the offset to it', () => {
    const m = matchTurn(turn, venue);
    expect(m.node.id).toBe('n-lobby');
    expect(m.dx).toBeCloseTo(0);
    expect(m.dy).toBeCloseTo(2);
  });

  it('does nothing when the turn is not at a mapped junction', () => {
    expect(matchTurn({ ...turn, y: -9 }, venue)).toBeNull(); // nothing within range
    expect(matchTurn({ ...turn, angle: -90, headingAfter: 270 }, venue)).toBeNull(); // no left turn here
    expect(matchTurn({ ...turn, floor: 1 }, venue)).toBeNull();
  });

  it('refuses to guess between two junctions that both fit', () => {
    const json = structuredClone(demo);
    json.nodes.push(
      { id: 'n-p0', x: -4, y: 0, z: 0, floor: 0 },
      { id: 'n-p1', x: -4, y: 5, z: 0, floor: 0 },
      { id: 'n-p2', x: -1, y: 5, z: 0, floor: 0 }
    );
    json.edges.push({ from: 'n-p0', to: 'n-p1' }, { from: 'n-p1', to: 'n-p2' });
    const twin = createVenue(json);
    expect(matchTurn({ ...turn, x: -2, y: 5 }, twin)).toBeNull();
    expect(matchTurn({ ...turn, x: -2, y: 5 }, twin, { radiusM: 2.1 })?.node.id).toBe('n-p1');
  });

  it('does not use closed or staff-only corridors', () => {
    const json = structuredClone(demo);
    for (const e of json.edges)
      if (e.from === 'n-lobby' && e.to === 'n-corridor-g-1') e.closed = true;
    expect(matchTurn(turn, createVenue(json))).toBeNull();
  });
});
