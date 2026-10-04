import { describe, expect, it } from 'vitest';

import {
  decodeAnswers,
  encodeAnswers,
  feedbackRows,
  loadFeedback,
  recordFeedback,
} from './feedback.js';

const memory = () => {
  const data = {};
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => (data[k] = v),
  };
};

describe('feedback bit code', () => {
  it('round-trips every combination', () => {
    for (const accuracy of ['none', 'yes', 'mostly', 'no'])
      for (const blocked of [false, true])
        for (const wrongFloor of [false, true])
          for (const arrived of [false, true]) {
            const a = { accuracy, blocked, wrongFloor, arrived };
            expect(decodeAnswers(encodeAnswers(a))).toEqual(a);
          }
  });

  it('packs into five bits and rejects bad input', () => {
    expect(encodeAnswers({ accuracy: 'no', blocked: true, wrongFloor: true, arrived: true })).toBe(
      31
    );
    expect(() => encodeAnswers({ accuracy: 'maybe' })).toThrow(RangeError);
    expect(() => decodeAnswers(32)).toThrow(RangeError);
  });
});

describe('recordFeedback', () => {
  it('stores an anonymous entry per venue and reads it back decoded', () => {
    const s = memory();
    const e = recordFeedback(s, {
      venueId: 'v1',
      from: 'n-a',
      to: 'p-b',
      answers: { accuracy: 'mostly', arrived: true },
      now: new Date('2026-10-05T10:00:00Z'),
    });
    expect(e).toEqual({ v: 'v1', f: 'n-a', t: 'p-b', c: 18, d: '2026-10-05' });
    expect(loadFeedback(s, 'v1')).toHaveLength(1);
    expect(loadFeedback(s, 'other')).toEqual([]);
    expect(feedbackRows(s, 'v1')[0]).toMatchObject({ accuracy: 'mostly', arrived: true });
  });

  it('survives missing or broken storage', () => {
    expect(recordFeedback(null, { venueId: 'v', answers: {} })).toBeNull();
    expect(loadFeedback({ getItem: () => '{bad' }, 'v')).toEqual([]);
  });
});
