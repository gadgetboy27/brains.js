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
