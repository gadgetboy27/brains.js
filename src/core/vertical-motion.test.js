import { describe, expect, it } from 'vitest';

import { createLiftDetector, createStairsTracker } from './vertical-motion.js';

const G = 9.81;

/**
 * Samples at 20 Hz for a vertical acceleration profile (m/s² along up).
 * `sign` flips both vectors, like a platform with the opposite convention.
 */
function* samples(profile, { sign = 1, stepping = () => false, noise = 0, startT = 100 } = {}) {
  let t = startT;
  let k = 0;
  for (const [seconds, a] of profile) {
    for (let i = 0; i < Math.round(seconds * 20); i += 1) {
      const jitter = noise ? Math.sin(k * 12.9898) * noise : 0;
      const up = a + jitter;
      yield {
        t,
        acc: { x: 0, y: 0, z: sign * up },
        accG: { x: 0, y: 0, z: sign * (G + up) },
        stepping: stepping(t),
      };
      t += 0.05;
      k += 1;
    }
  }
}

function run(detector, gen) {
  const events = [];
  for (const s of gen) {
    const e = detector.update(s);
    if (e) events.push(e);
  }
  return events;
}

// A lift going up: push up 1.5 s, glide 5 s, brake 1.5 s; stand still before and after.
const UP = [
  [2, 0],
  [1.5, 0.8],
  [5, 0],
  [1.5, -0.8],
  [2, 0],
];
const DOWN = UP.map(([s, a]) => [s, -a]);

describe('createLiftDetector', () => {
  it('sees a ride up, and says which way, how long and roughly how high', () => {
    const [e] = run(createLiftDetector(), samples(UP));
    expect(e).toMatchObject({ kind: 'lift', direction: 'up' });
    expect(e.durationS).toBeGreaterThan(6);
    expect(e.durationS).toBeLessThan(10);
    // 0.8 m/s² for 1.5 s is 1.2 m/s; at that speed for 5 s plus the pushes ≈ 7 m: a floor or two.
    expect(e.heightM).toBeGreaterThan(4);
    expect(e.heightM).toBeLessThan(10);
  });

  it('sees a ride down', () => {
    const events = run(createLiftDetector(), samples(DOWN));
    expect(events).toHaveLength(1);
    expect(events[0].direction).toBe('down');
  });

  it('gets the direction right on a platform whose sensors read with the opposite sign', () => {
    expect(run(createLiftDetector(), samples(UP, { sign: -1 }))[0].direction).toBe('up');
    expect(run(createLiftDetector(), samples(DOWN, { sign: -1 }))[0].direction).toBe('down');
  });

  it('still sees it through sensor noise', () => {
    const events = run(createLiftDetector(), samples(UP, { noise: 0.12 }));
    expect(events).toHaveLength(1);
    expect(events[0].direction).toBe('up');
  });

  it('ignores a single push with nothing to balance it (a bump, a lurch)', () => {
    expect(
      run(
        createLiftDetector(),
        samples([
          [2, 0],
          [1.5, 0.8],
          [10, 0],
        ])
      )
    ).toEqual([]);
  });

  it('ignores pushes that do not balance (not a ride that starts and ends at rest)', () => {
    expect(
      run(
        createLiftDetector(),
        samples([
          [2, 0],
          [1.5, 0.8],
          [4, 0],
          [0.6, -0.4], // far too small a push to stop 1.2 m/s
          [2, 0],
        ])
      )
    ).toEqual([]);
  });

  it('ignores a push that is too weak to matter', () => {
    expect(
      run(
        createLiftDetector(),
        samples([
          [2, 0],
          [1.5, 0.22],
          [4, 0],
          [1.5, -0.22],
          [2, 0],
        ])
      )
    ).toEqual([]);
  });

  it('is not fooled by walking: steps during the ride cancel it', () => {
    const walking = (t) => t > 103 && t < 112;
    expect(run(createLiftDetector(), samples(UP, { stepping: walking }))).toEqual([]);
  });

  it('forgets a push that was never answered', () => {
    expect(
      run(
        createLiftDetector({ maxCruiseS: 20 }),
        samples([
          [2, 0],
          [1.5, 0.8],
          [30, 0],
          [1.5, -0.8],
          [2, 0],
        ])
      )
    ).toEqual([]);
  });

  it('does not fire twice for one ride, but will for the next', () => {
    const d = createLiftDetector({ cooldownS: 6 });
    expect(run(d, samples(UP))).toHaveLength(1);
    expect(run(d, samples(DOWN, { startT: 130 }))).toHaveLength(1);
  });

  it('survives missing or junk readings', () => {
    const d = createLiftDetector();
    expect(d.update({ t: 1, acc: null, accG: null })).toBeNull();
    expect(d.update({ t: 2, acc: { x: NaN, y: 0, z: 0 }, accG: { x: 0, y: 0, z: G } })).toBeNull();
    expect(d.update({ t: 3, acc: { x: 0, y: 0, z: 0 }, accG: { x: 0, y: 0, z: 0 } })).toBeNull();
  });
});

describe('createStairsTracker', () => {
  /** Walk `n` steps at 1.8 steps/s heading `h`, from step count `from` at time `t`. */
  function walk(tracker, { t, from, n, h, armed = true }) {
    let out = null;
    let time = t;
    for (let i = 1; i <= n; i += 1) {
      time += 1 / 1.8;
      out = tracker.update({ t: time, steps: from + i, heading: h, armed }) ?? out;
    }
    return { out, t: time, steps: from + n };
  }

  it('does nothing unless the caller says the user is at stairs', () => {
    const tr = createStairsTracker();
    expect(walk(tr, { t: 0, from: 0, n: 80, h: 0, armed: false }).out).toBeNull();
  });

  it('fires after a flight with a turn at the landing', () => {
    const tr = createStairsTracker();
    const a = walk(tr, { t: 0, from: 0, n: 10, h: 0 }); // up the first flight
    expect(a.out).toBeNull();
    const b = walk(tr, { t: a.t, from: a.steps, n: 14, h: 180 }); // round the landing, up the second
    expect(b.out).toMatchObject({ kind: 'stairs' });
    expect(b.out.turns).toBeGreaterThanOrEqual(1);
    expect(b.out.steps).toBeGreaterThanOrEqual(20);
  });

  it('a long straight flight counts too, but only after many more steps', () => {
    const tr = createStairsTracker();
    expect(walk(tr, { t: 0, from: 0, n: 25, h: 90 }).out).toBeNull();
    expect(walk(tr, { t: 14, from: 25, n: 14, h: 90 }).out).toMatchObject({ kind: 'stairs' });
  });

  it('a few steps and a turn is just a corridor', () => {
    const tr = createStairsTracker();
    const a = walk(tr, { t: 0, from: 0, n: 6, h: 0 });
    expect(walk(tr, { t: a.t, from: a.steps, n: 6, h: 180 }).out).toBeNull();
  });

  it('starts counting afresh each time it is armed, and rests after firing', () => {
    const tr = createStairsTracker({ cooldownS: 30 });
    const a = walk(tr, { t: 0, from: 0, n: 40, h: 0 });
    expect(a.out).not.toBeNull();
    // Still armed straight afterwards: no second event inside the cooldown.
    expect(walk(tr, { t: a.t, from: a.steps, n: 40, h: 0 }).out).toBeNull();
    // Walked away (disarmed), and later back at stairs: steps before then do not count.
    tr.update({ t: 200, steps: 500, heading: 0, armed: false });
    expect(walk(tr, { t: 200, from: 500, n: 10, h: 0 }).out).toBeNull();
  });
});
