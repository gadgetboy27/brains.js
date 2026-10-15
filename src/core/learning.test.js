import { describe, expect, it } from 'vitest';

import { loadObservations, recordObservation, suggestions } from './learning.js';

const store = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};
const gap = (steps, routeM) => ({ k: 'gap', a: 'a1', b: 'a2', steps, routeM });
const off = (from = 'n1', to = 'n2') => ({ k: 'off', from, to });

describe('recordObservation', () => {
  it('stores a day, no finer time, and nothing positional', () => {
    const s = store();
    const e = recordObservation(s, 'v', gap(30, 21), new Date('2026-10-15T13:45:12Z'));
    expect(e).toEqual({ k: 'gap', a: 'a1', b: 'a2', steps: 30, routeM: 21, d: '2026-10-15' });
    expect(loadObservations(s, 'v')).toEqual([e]);
  });

  it('rejects malformed observations and missing storage', () => {
    const s = store();
    expect(recordObservation(s, 'v', { k: 'gap', a: 'x', b: 'x', steps: 5, routeM: 3 })).toBeNull();
    expect(recordObservation(s, 'v', { k: 'gap', a: 'x', b: 'y', steps: 0, routeM: 3 })).toBeNull();
    expect(recordObservation(s, 'v', { k: 'wat' })).toBeNull();
    expect(recordObservation(null, 'v', off())).toBeNull();
    expect(loadObservations(s, 'v')).toEqual([]);
  });

  it('keeps only the newest 500', () => {
    const s = store();
    for (let i = 0; i < 505; i += 1) recordObservation(s, 'v', off(`n${i}`, 'z'));
    const list = loadObservations(s, 'v');
    expect(list).toHaveLength(500);
    expect(list[0].from).toBe('n5');
  });

  it('survives corrupt or throwing storage', () => {
    expect(loadObservations({ getItem: () => '{nope' }, 'v')).toEqual([]);
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(recordObservation(full, 'v', off())).toBeNull();
  });
});

describe('suggestions', () => {
  it('proposes the median stride once enough walks disagree with the current one', () => {
    const obs = [gap(30, 24), gap(40, 31), gap(25, 20), gap(50, 39)]; // 0.80, 0.775, 0.80, 0.78
    const { stride } = suggestions(obs, { strideM: 0.7 });
    expect(stride).toEqual({ current: 0.7, suggested: 0.79, samples: 4 });
  });

  it('says nothing with too few samples, short walks, or a negligible change', () => {
    expect(suggestions([gap(30, 24), gap(30, 24)]).stride).toBeNull();
    expect(suggestions([gap(5, 4), gap(5, 4), gap(5, 4)]).stride).toBeNull(); // too short
    const close = [gap(30, 22), gap(30, 22), gap(30, 22)]; // 0.733 vs 0.73
    expect(suggestions(close).stride).toBeNull();
  });

  it('drops walks whose implied stride no person has', () => {
    const wandered = [gap(100, 20), gap(100, 20), gap(100, 20)]; // 0.2 m per step
    expect(suggestions(wandered).stride).toBeNull();
  });

  it('flags route legs people keep leaving, most often first', () => {
    const obs = [
      off('a', 'b'),
      off('c', 'd'),
      off('a', 'b'),
      off('c', 'd'),
      off('c', 'd'),
      off('a', 'b'),
      off('e', 'f'),
    ];
    expect(suggestions(obs, { minOff: 3 }).troubleSpots).toEqual([
      { from: 'a', to: 'b', count: 3 },
      { from: 'c', to: 'd', count: 3 },
    ]);
  });
});

describe('heading suggestions', () => {
  const walk = (dh) => ({ ...gap(30, 22), dh });

  it('proposes the correction when straight walks agree the compass is off', () => {
    const { heading } = suggestions([walk(10), walk(12), walk(8), walk(11)], {
      headingOffsetDeg: 5,
    });
    expect(heading).toMatchObject({ currentDeg: 5, samples: 4 });
    expect(heading.suggestedDeg).toBeCloseTo(15.25, 0);
    expect(heading.errorDeg).toBeCloseTo(10.2, 0);
  });

  it('wraps through north and averages across the ±180 seam', () => {
    expect(
      suggestions([walk(-8), walk(-10), walk(-9)], { headingOffsetDeg: 4 }).heading.suggestedDeg
    ).toBe(355);
    const seam = suggestions([walk(178), walk(-179), walk(180)]).heading;
    expect(Math.abs(seam.errorDeg)).toBeGreaterThan(177);
  });

  it('says nothing when walks disagree, are too few, or the error is tiny', () => {
    expect(suggestions([walk(30), walk(-40), walk(5)]).heading).toBeNull();
    expect(suggestions([walk(10), walk(12)]).heading).toBeNull();
    expect(suggestions([walk(1), walk(2), walk(1)]).heading).toBeNull();
    expect(suggestions([gap(30, 22), gap(30, 22), gap(30, 22)]).heading).toBeNull();
  });

  it('rejects an impossible dh when recording', () => {
    const s = store();
    expect(recordObservation(s, 'v', { ...gap(30, 22), dh: 270 })).toBeNull();
    expect(recordObservation(s, 'v', { ...gap(30, 22), dh: -12 })).not.toBeNull();
  });
});

describe('scan observations', () => {
  const scan = (a, b, v = 'check') => ({ k: 'scan', a, b, v });

  it('records flagged scans and rejects malformed ones', () => {
    const s = store();
    expect(recordObservation(s, 'v', scan('a1', 'a2'))).not.toBeNull();
    expect(recordObservation(s, 'v', { k: 'scan', a: 'a1', b: 'a2', v: 'match' })).toBeNull();
    expect(recordObservation(s, 'v', { k: 'scan', a: 'a1', v: 'check' })).toBeNull();
  });

  it('lists a marker pair that keeps not fitting, impossible ones first', () => {
    const obs = [
      scan('a1', 'a2'),
      scan('a1', 'a2'),
      scan('a1', 'a2'),
      scan('a3', 'a4', 'impossible'),
      scan('a3', 'a4', 'impossible'),
      scan('a5', 'a6'),
    ];
    expect(suggestions(obs).suspectMarkers).toEqual([
      { a: 'a3', b: 'a4', count: 2, impossible: 2 },
      { a: 'a1', b: 'a2', count: 3, impossible: 0 },
    ]);
  });

  it('says nothing about a one-off', () => {
    expect(suggestions([scan('a1', 'a2')]).suspectMarkers).toEqual([]);
    expect(suggestions([scan('a1', 'a2', 'impossible')]).suspectMarkers).toEqual([]);
  });
});
