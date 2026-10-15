/**
 * Vertical motion — noticing that the user rode a lift or climbed stairs.
 *
 * Browsers have no barometer, so height cannot be measured. What the
 * accelerometer can see is the *shape* of a ride.
 *
 * **Lift.** A lift starts and stops with a push: acceleration along gravity
 * for a second or two, a smooth ride (nothing, while the person stands still),
 * then a push the other way. Going up it is up-then-down; going down,
 * down-then-up. Integrating each push gives a speed, and the two must roughly
 * cancel (the lift starts and ends at rest). Steps during the ride mean it was
 * not a lift. That pattern, with the steps absent, is strong evidence, and its
 * first push says which way they went.
 *
 * **Stairs.** Much weaker evidence from a phone alone: a long run of steps
 * with turns at the landings. So a {@link createStairsTracker} is only used
 * once the caller already has a reason to expect stairs (the user is at the
 * foot of some, on a route that uses them). It cannot tell up from down.
 *
 * Neither is a position: the caller decides what to do with an event, and
 * keeps a manual floor selector for when this gets it wrong.
 *
 * Pure and synchronous: samples carry their own timestamps.
 */

const RAD = Math.PI / 180;

/** Signed smallest difference a−b in degrees. */
function angleDiff(a, b) {
  const d = ((((a - b) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/**
 * @typedef {{ x: number, y: number, z: number }} Vec3
 * @typedef {Object} LiftEvent
 * @property {'lift'} kind
 * @property {'up' | 'down'} direction
 * @property {number} durationS   From the first push to the end of the second.
 * @property {number} heightM     A rough estimate of the height travelled (order of magnitude, not a measurement).
 */

/**
 * @param {Object} [options]
 * @param {number} [options.thresholdMps2=0.3]   A push must exceed this acceleration along gravity.
 * @param {number} [options.minPushS=0.5]        …for at least this long.
 * @param {number} [options.minSpeedMps=0.35]    Each push must build at least this speed.
 * @param {number} [options.maxCruiseS=60]       A ride longer than this between pushes is something else.
 * @param {number} [options.cooldownS=6]
 */
export function createLiftDetector(options = {}) {
  const o = {
    thresholdMps2: 0.3,
    minPushS: 0.5,
    minSpeedMps: 0.35,
    maxCruiseS: 60,
    cooldownS: 6,
    ...options,
  };

  let lastT = null;
  let gravity = null; // slow low-pass of accelerationIncludingGravity: which way is up
  let s = 0; // smoothed acceleration along up, m/s²
  let state = 'idle'; // idle → push1 → cruise → push2
  let pendSign = 0;
  let pendS = 0;
  let quietS = 0;
  let push1 = null;
  let push2 = null;
  let cruiseS = 0;
  let steppingS = 0; // how long steps have been seen during the ride
  let quietUntil = -Infinity;

  function reset() {
    state = 'idle';
    pendSign = 0;
    pendS = 0;
    quietS = 0;
    push1 = null;
    push2 = null;
    cruiseS = 0;
    steppingS = 0;
  }

  return {
    /**
     * @param {Object} sample
     * @param {number} sample.t                    Seconds (any origin).
     * @param {Vec3 | null} sample.acc             DeviceMotion `acceleration` (gravity removed).
     * @param {Vec3 | null} sample.accG            DeviceMotion `accelerationIncludingGravity`.
     * @param {boolean} [sample.stepping=false]    Steps counted in the last second or two.
     * @returns {LiftEvent | null}
     */
    update({ t, acc, accG, stepping = false }) {
      if (!acc || !accG) return null;
      const vals = [acc.x, acc.y, acc.z, accG.x, accG.y, accG.z];
      if (!vals.every(Number.isFinite)) return null;
      if (lastT === null) {
        lastT = t;
        gravity = [accG.x, accG.y, accG.z];
        return null;
      }
      const dt = Math.min(0.25, Math.max(0, t - lastT));
      lastT = t;
      if (dt === 0) return null;

      // Which way is up: slow, so a lift's own push barely tilts it. Both
      // vectors flip together on platforms with the opposite sign convention,
      // so their dot product (the push along "up") stays right.
      const ga = dt / (1.0 + dt);
      gravity = gravity.map((v, i) => v + ga * ([accG.x, accG.y, accG.z][i] - v));
      const norm = Math.hypot(...gravity);
      if (norm < 5 || norm > 15) return null; // free fall or a shake, not a gravity reading
      const aUp = (acc.x * gravity[0] + acc.y * gravity[1] + acc.z * gravity[2]) / norm;
      s += (aUp - s) * (dt / (0.3 + dt));

      if (t < quietUntil) return null;
      const big = Math.abs(s) > o.thresholdMps2;
      const sign = Math.sign(s);

      if (state === 'idle') {
        if (big && !stepping && sign === pendSign) pendS += dt;
        else if (big && !stepping) {
          pendSign = sign;
          pendS = dt;
        } else {
          pendS = 0;
          pendSign = 0;
        }
        if (pendS >= o.minPushS) {
          state = 'push1';
          push1 = { sign: pendSign, v: s * pendS, durationS: pendS };
          quietS = 0;
        }
        return null;
      }

      if (stepping) steppingS += dt;
      if (steppingS > 1.0) {
        reset(); // walking about: whatever that was, not a ride
        return null;
      }

      if (state === 'push1') {
        push1.v += s * dt;
        push1.durationS += dt;
        quietS = Math.abs(s) < o.thresholdMps2 / 2 ? quietS + dt : 0;
        if (quietS >= 0.3) {
          const speed = Math.abs(push1.v);
          if (speed < o.minSpeedMps || push1.durationS > 8) {
            reset(); // a bump or a sway, not a lift starting
          } else {
            state = 'cruise';
            cruiseS = 0;
            pendS = 0;
          }
        }
        return null;
      }

      if (state === 'cruise') {
        cruiseS += dt;
        if (cruiseS > o.maxCruiseS) {
          reset();
          return null;
        }
        if (big && sign === -push1.sign) {
          pendS += dt;
          if (pendS >= o.minPushS) {
            state = 'push2';
            push2 = { v: s * pendS, durationS: pendS };
            quietS = 0;
          }
        } else {
          pendS = 0;
        }
        return null;
      }

      // push2: the lift braking (or, going down, the push back up).
      push2.v += s * dt;
      push2.durationS += dt;
      quietS = Math.abs(s) < o.thresholdMps2 / 2 ? quietS + dt : 0;
      if (quietS < 0.3) return null;

      const v1 = Math.abs(push1.v);
      const v2 = Math.abs(push2.v);
      const balanced = v2 >= 0.5 * v1 && v2 <= 1.8 * v1 && v2 >= o.minSpeedMps;
      const result = balanced
        ? {
            kind: 'lift',
            direction: push1.sign > 0 ? 'up' : 'down',
            durationS: Math.round((push1.durationS + cruiseS + push2.durationS) * 10) / 10,
            // A trapezoid speed profile: peak speed × (time at speed + half the pushes).
            heightM:
              Math.round(
                ((v1 + v2) / 2) * (cruiseS + (push1.durationS + push2.durationS) / 2) * 10
              ) / 10,
          }
        : null;
      reset();
      if (result) quietUntil = t + o.cooldownS;
      return result;
    },

    reset,
  };
}

/**
 * Stairs, from context: only counts while the caller says the user is at stairs
 * ({@code armed}), then watches for a long run of steps with turns at the
 * landings. Cannot tell up from down.
 *
 * @param {Object} [options]
 * @param {number} [options.minSteps=20]       Steps with at least one landing turn…
 * @param {number} [options.minStepsStraight=36]  …or this many with no turn (a long straight flight).
 * @param {number} [options.turnDeg=140]       A landing: the heading reverses by about this much.
 * @param {number} [options.cooldownS=30]
 */
export function createStairsTracker(options = {}) {
  const o = { minSteps: 20, minStepsStraight: 36, turnDeg: 140, cooldownS: 30, ...options };
  let armed = false;
  let baseSteps = 0;
  let turns = 0;
  /** @type {Array<{ t: number, h: number }>} */
  let history = [];
  let quietUntil = -Infinity;

  const mean = (hs) => {
    const c = hs.reduce((a, h) => a + Math.cos(h.h * RAD), 0) / hs.length;
    const sn = hs.reduce((a, h) => a + Math.sin(h.h * RAD), 0) / hs.length;
    return Math.atan2(sn, c) / RAD;
  };

  return {
    /**
     * @param {Object} sample
     * @param {number} sample.t            Seconds.
     * @param {number} sample.steps        Cumulative steps counted (any origin).
     * @param {number} sample.heading      Degrees clockwise from venue +y.
     * @param {boolean} sample.armed       The user is at the foot of some stairs, expecting to climb.
     * @returns {{ kind: 'stairs', steps: number, turns: number } | null}
     */
    update({ t, steps, heading, armed: isArmed }) {
      if (!isArmed) {
        armed = false;
        return null;
      }
      if (!armed) {
        armed = true;
        baseSteps = steps;
        turns = 0;
        history = [];
      }
      if (t < quietUntil) return null;
      history.push({ t, h: heading });
      history = history.filter((p) => t - p.t <= 6);

      // A landing: the last second's heading is about opposite to the heading 3 to 5 s ago.
      const now = history.filter((p) => t - p.t <= 1);
      const before = history.filter((p) => t - p.t >= 3 && t - p.t <= 5);
      if (now.length >= 2 && before.length >= 2) {
        if (Math.abs(angleDiff(mean(now), mean(before))) >= o.turnDeg) {
          turns += 1;
          history = now; // do not count the same turn again
        }
      }

      const taken = steps - baseSteps;
      if ((turns >= 1 && taken >= o.minSteps) || taken >= o.minStepsStraight) {
        const result = { kind: 'stairs', steps: taken, turns };
        armed = false;
        quietUntil = t + o.cooldownS;
        return result;
      }
      return null;
    },
    reset() {
      armed = false;
      turns = 0;
      history = [];
    },
  };
}
