import { describe, expect, it } from 'vitest';

import { checkScan } from './scan-check.js';

const at = (x, y, floor = 0) => ({ x, y, floor });
// Walked from (0,0) to near (20,0): 27 steps ≈ 20 m.
const base = {
  previous: at(0, 0),
  scan: at(20, 0),
  steps: 27,
  distanceM: 20,
};

describe('checkScan', () => {
  it('match: the marker is where dead reckoning put the walker, within drift', () => {
    const r = checkScan({ ...base, estimate: at(19, 0.5) });
    expect(r.verdict).toBe('match');
    expect(r.jumpM).toBe(1.1);
  });

  it('allows more drift on a longer walk', () => {
    const near = checkScan({ ...base, estimate: at(15, 0), distanceM: 20 }); // 5 m off, tolerance 5 m
    expect(near.verdict).toBe('match');
    const far = checkScan({ ...base, estimate: at(15, 0), distanceM: 4 }); // same 5 m, tolerance 2.6 m
    expect(far.verdict).toBe('check');
  });

  it('check: further off than drift explains, but they could have walked it', () => {
    const r = checkScan({ ...base, estimate: at(8, 0) }); // 12 m off after a 20 m walk
    expect(r.verdict).toBe('check');
    expect(r.jumpM).toBe(12);
    expect(r.toleranceM).toBe(5);
  });

  it('impossible: the two markers are further apart than the steps could cover', () => {
    // 6 steps, yet the markers are 60 m apart: one is in the wrong place.
    const r = checkScan({
      previous: at(0, 0),
      scan: at(60, 0),
      estimate: at(4, 0),
      steps: 6,
      distanceM: 4.4,
    });
    expect(r.verdict).toBe('impossible');
    expect(r.apartM).toBe(60);
  });

  it('does not call it impossible when steps are not being counted at all', () => {
    const r = checkScan({
      previous: at(0, 0),
      scan: at(60, 0),
      estimate: at(0, 0),
      steps: 0,
      distanceM: 0,
      stepsTrusted: false,
    });
    expect(r.verdict).toBe('check'); // still flagged as far from the estimate
  });

  it('a long stride is allowed, a sprint across the building is not', () => {
    // 20 steps at up to 1.2 m = 24 m, plus slack 5: 28 m apart is reachable, 40 m is not.
    expect(checkScan({ ...base, scan: at(28, 0), estimate: at(28, 0), steps: 20 }).verdict).toBe(
      'match'
    );
    expect(checkScan({ ...base, scan: at(40, 0), estimate: at(20, 0), steps: 20 }).verdict).toBe(
      'impossible'
    );
  });

  it('first: nothing to compare with on the first scan', () => {
    expect(checkScan({ ...base, estimate: null, previous: null }).verdict).toBe('first');
    expect(checkScan({ ...base, estimate: at(1, 1), previous: null }).verdict).toBe('first');
  });

  it('unchecked: across floors, where stairs and lifts are not step-counted', () => {
    expect(checkScan({ ...base, scan: at(20, 0, 1), estimate: at(0, 0) }).verdict).toBe(
      'unchecked'
    );
    expect(checkScan({ ...base, estimate: at(20, 0, 1) }).verdict).toBe('unchecked');
  });
});
