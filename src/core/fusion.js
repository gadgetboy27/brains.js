/**
 * PoseFusion — keeps a best-estimate pose between provider fixes.
 *
 * A positioning provider (see ./positioning.js) delivers an absolute pose
 * whenever it manages to localise, which for a camera-based VPS may be only
 * every few seconds and not at all while the camera is pointed at a blank
 * wall. Between those fixes this module:
 *
 *  1. holds the last known pose;
 *  2. dead-reckons from device motion — `DeviceOrientationEvent` updates
 *     heading; `DeviceMotionEvent` acceleration is used to *count footsteps*
 *     (peaks in acceleration magnitude), and each detected step advances the
 *     position by a fixed stride along the current heading. This is
 *     pedestrian dead reckoning (PDR): double-integrating raw acceleration
 *     into velocity and position (the naive approach) drifts by metres
 *     within seconds because sensor noise is integrated twice; step counting
 *     only errs by the stride estimate, a few percent of distance walked;
 *     **Heading** is the weak point: a phone compass indoors is noisy and is
 *     thrown by steel, lifts and equipment, while a gyroscope is smooth but
 *     drifts. Where the device reports a rotation rate the two are blended
 *     (a complementary filter): the gyroscope carries the heading between
 *     compass samples, and the compass slowly pulls it back so the gyro's
 *     drift never accumulates. A compass reading far from the gyro's heading
 *     is treated as interference and mostly ignored, unless it persists
 *     (then the compass is right and we were wrong). With no gyroscope the
 *     compass is used directly, as before;
 *  3. decays confidence with elapsed time and with distance travelled since
 *     the last fix, because integrated IMU error grows with both;
 *  4. emits `"rescan-needed"` once confidence drops below a threshold, so the
 *     UI can ask the user to point the camera at something recognisable.
 *
 * It emits `"pose"` with the fused estimate whenever it changes.
 *
 * Time is injected (`now()`) so tests can drive it with a fake clock. The
 * class never touches `window` itself; the caller wires DOM events to
 * `handleOrientation()` / `handleMotion()` (see `attach()`), which also keeps
 * this module testable in Node.
 */

import { validatePose } from './positioning.js';

/**
 * @typedef {import('./positioning.js').Pose} Pose
 */

/**
 * @typedef {Object} FusionOptions
 * @property {number} [rescanThreshold=0.3]
 *   Emit "rescan-needed" when confidence falls below this value.
 * @property {number} [timeHalfLifeMs=10000]
 *   Elapsed time since the last fix at which confidence has halved.
 * @property {number} [distanceHalfLifeM=5]
 *   Distance travelled since the last fix at which confidence has halved.
 * @property {number} [headingOffsetDeg=0]
 *   Rotation from the device's compass frame to venue +y, in degrees
 *   clockwise. Set by the venue JSON so compass headings become venue headings.
 * @property {number} [strideM=0.73]
 *   Metres advanced per detected step. The average adult stride; calibrate
 *   per surveyor by walking a known distance and dividing by the step count
 *   (`docs/admin.md`) for better accuracy than the population average.
 * @property {number} [stepThreshold=1.5]
 *   Acceleration-magnitude (m/s²) a peak must reach to count as a footstep.
 *   Below the bump of an ordinary walking gait; raise it if a phone in a
 *   pocket triggers false steps from incidental jostling.
 * @property {number} [stepRefractoryMs=300]
 *   Minimum time between counted steps, so one footstep's up-down bounce
 *   isn't counted twice. 300 ms allows a cadence of up to ~3.3 steps/s.
 * @property {number} [compassTimeConstantS=4]
 *   How slowly the compass corrects the gyro heading, in seconds. Longer
 *   trusts the gyro more (smoother, but its drift lingers longer); steady-state
 *   error with a gyro bias of b °/s is about b × this.
 * @property {number} [compassRejectDeg=45]
 *   A compass reading further than this from the blended heading is treated
 *   as magnetic interference…
 * @property {number} [compassTrustAfterMs=3000]
 *   …unless it keeps disagreeing for this long, when the compass is believed.
 * @property {() => number} [now=Date.now]
 *   Clock, in milliseconds. Injected for tests.
 */

const DEFAULTS = Object.freeze({
  rescanThreshold: 0.3,
  timeHalfLifeMs: 10_000,
  distanceHalfLifeM: 5,
  headingOffsetDeg: 0,
  strideM: 0.73,
  stepThreshold: 1.5,
  stepRefractoryMs: 300,
  compassTimeConstantS: 4,
  compassRejectDeg: 45,
  compassTrustAfterMs: 3000,
  now: () => Date.now(),
});

const DEG_TO_RAD = Math.PI / 180;

/** Signed smallest difference a−b in degrees, in (-180, 180]. */
function angleDiff(a, b) {
  const d = ((((a - b) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

/** Normalise degrees into [0, 360). */
function wrapHeading(deg) {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export class PoseFusion {
  /** @type {Required<FusionOptions>} */
  #opts;

  /** @type {Pose | null} Last absolute fix from the provider. */
  #fix = null;

  /** @type {Pose | null} Current fused estimate. */
  #estimate = null;

  /** Metres travelled since the last fix (path length, not displacement). */
  #distanceSinceFix = 0;

  /** Most recent acceleration-magnitude sample, for peak detection. */
  #lastMag = 0;

  /** Whether magnitude is currently rising towards a peak. */
  #magRising = false;

  /** Clock time of the last counted step, for the refractory window. */
  #lastStepAt = null;

  /** Steps counted since the last fix, independent of `strideM` — used to calibrate it. */
  #stepCount = 0;

  /** Whether the compass has set the heading since the last fix (the first sample snaps). */
  #compassSeeded = false;

  /** Low-passed gravity direction in device axes, from accelerationIncludingGravity. */
  #gravity = null;

  /** Clock time of the last motion event carrying a usable rotation rate. */
  #lastGyroAt = null;

  /** Clock time the compass first disagreed with the heading, or null. */
  #disagreeSince = null;

  /**
   * ±1: whether this device's rotationRate/gravity combination yields yaw in
   * the direction we expect. Platforms differ (iOS has reported gravity with
   * the opposite sign); it is learned from agreement with the compass.
   */
  #gyroSign = 1;

  /** Evidence for/against {@link #gyroSign}: degrees of agreeing minus disagreeing turn. */
  #signScore = 0;

  /** Gyro-integrated heading change since the last compass sample, degrees clockwise. */
  #gyroSinceCompass = 0;

  /** Compass heading at the previous compass sample, for the sign check. */
  #lastCompass = null;

  /** Clock time of the previous compass sample. */
  #lastCompassAt = null;

  /** Whether "rescan-needed" has fired since the last fix. */
  #rescanEmitted = false;

  /** @type {Map<string, Set<Function>>} */
  #listeners = new Map();

  /** @param {FusionOptions} [options] */
  constructor(options = {}) {
    this.#opts = { ...DEFAULTS, ...options };
    for (const key of [
      'rescanThreshold',
      'timeHalfLifeMs',
      'distanceHalfLifeM',
      'strideM',
      'stepThreshold',
      'stepRefractoryMs',
      'compassTimeConstantS',
      'compassRejectDeg',
      'compassTrustAfterMs',
    ]) {
      const v = this.#opts[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new RangeError(`${key} must be a non-negative finite number, got ${v}`);
      }
    }
    if (this.#opts.rescanThreshold > 1) {
      throw new RangeError('rescanThreshold must be at most 1');
    }
    if (typeof this.#opts.now !== 'function') {
      throw new TypeError('now must be a function');
    }
  }

  // ---------------------------------------------------------------- events

  /**
   * @param {'pose' | 'rescan-needed'} type
   * @param {(payload: any) => void} listener
   * @returns {() => void} Unsubscribe.
   */
  on(type, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }
    if (!this.#listeners.has(type)) {
      this.#listeners.set(type, new Set());
    }
    this.#listeners.get(type).add(listener);
    return () => this.#listeners.get(type)?.delete(listener);
  }

  #emit(type, payload) {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(payload);
    }
  }

  // ---------------------------------------------------------------- inputs

  /**
   * Accept an absolute fix from the provider. Resets dead-reckoning state and
   * confidence decay.
   *
   * @param {Pose} pose
   */
  applyFix(pose) {
    validatePose(pose);
    this.#fix = { ...pose };
    this.#estimate = { ...pose };
    this.#distanceSinceFix = 0;
    this.#lastMag = 0;
    this.#magRising = false;
    this.#lastStepAt = null;
    this.#stepCount = 0;
    this.#rescanEmitted = false;
    this.#compassSeeded = false;
    this.#disagreeSince = null;
    this.#gyroSinceCompass = 0;
    this.#lastCompass = null;
    this.#lastCompassAt = null;
    this.#emit('pose', this.getPose());
  }

  /**
   * Accept a position correction that is *not* a fresh start: move the
   * estimate and restart the confidence decay from the pose's confidence, but
   * keep everything the heading filter has learnt (an exact fix re-seeds the
   * heading from the compass; a soft correction has no reason to throw away
   * the smoothed heading), and keep counting steps.
   *
   * @param {Pose} pose  Position and confidence to adopt; its heading is ignored.
   */
  applySoftFix(pose) {
    validatePose(pose);
    if (!this.#estimate) return this.applyFix(pose);
    this.#estimate.x = pose.x;
    this.#estimate.y = pose.y;
    this.#fix = { ...this.#estimate, confidence: pose.confidence, timestamp: this.#opts.now() };
    this.#distanceSinceFix = 0;
    this.#rescanEmitted = false;
    this.#emit('pose', this.getPose());
  }

  /**
   * Update heading from a DeviceOrientationEvent-shaped object.
   *
   * Uses `webkitCompassHeading` where present (iOS, already clockwise from
   * north), else `alpha` (counter-clockwise from north per the spec, so it is
   * negated). The venue's `headingOffsetDeg` is then applied.
   *
   * @param {{ alpha?: number | null, webkitCompassHeading?: number }} event
   */
  handleOrientation(event) {
    if (!this.#estimate) return;

    let compass;
    if (typeof event.webkitCompassHeading === 'number') {
      compass = event.webkitCompassHeading;
    } else if (typeof event.alpha === 'number') {
      compass = 360 - event.alpha;
    } else {
      return;
    }
    if (!Number.isFinite(compass)) return;

    this.#blendCompass(wrapHeading(compass + this.#opts.headingOffsetDeg));
    this.#emit('pose', this.getPose());
  }

  /**
   * Fold one compass reading (already in venue frame) into the heading.
   * @param {number} measured
   */
  #blendCompass(measured) {
    const est = this.#estimate;
    const now = this.#opts.now();
    const gyroLive = this.#lastGyroAt !== null && now - this.#lastGyroAt < 500;

    // No gyroscope (or the first reading after a fix): the compass is the heading.
    if (!gyroLive || !this.#compassSeeded) {
      est.heading = measured;
      this.#compassSeeded = true;
      this.#disagreeSince = null;
      this.#gyroSinceCompass = 0;
      this.#lastCompass = measured;
      this.#lastCompassAt = now;
      return;
    }

    const dt = Math.max(0, (now - (this.#lastCompassAt ?? now)) / 1000);
    if (this.#learnGyroSign(measured)) {
      // The gyro had been turning us the wrong way for a while: the compass is the better guide.
      est.heading = measured;
      this.#disagreeSince = null;
      return;
    }

    const innovation = angleDiff(measured, est.heading);
    if (Math.abs(innovation) > this.#opts.compassRejectDeg) {
      // Interference — unless it will not go away, in which case the gyro was wrong.
      this.#disagreeSince ??= now;
      if (now - this.#disagreeSince >= this.#opts.compassTrustAfterMs) {
        est.heading = measured;
        this.#disagreeSince = null;
      }
      return;
    }
    this.#disagreeSince = null;

    const k = dt / (this.#opts.compassTimeConstantS + dt);
    est.heading = wrapHeading(est.heading + k * innovation);
  }

  /**
   * Decide whether the gyro turns the same way the compass does. Over a real
   * turn the two must agree; if they consistently do not, flip the sign.
   * @param {number} measured
   * @returns {boolean} Whether the sign was just flipped.
   */
  #learnGyroSign(measured) {
    let flipped = false;
    if (this.#lastCompass !== null) {
      const compassDelta = angleDiff(measured, this.#lastCompass);
      const gyroDelta = this.#gyroSinceCompass;
      if (Math.abs(compassDelta) > 1 && Math.abs(gyroDelta) > 1) {
        const same = Math.sign(compassDelta) === Math.sign(gyroDelta);
        const weight = Math.min(Math.abs(compassDelta), Math.abs(gyroDelta));
        this.#signScore = Math.max(-60, Math.min(60, this.#signScore + (same ? weight : -weight)));
        if (this.#signScore < -30) {
          this.#gyroSign = -this.#gyroSign;
          this.#signScore = 0;
          flipped = true;
        }
      }
    }
    this.#lastCompass = measured;
    this.#lastCompassAt = this.#opts.now();
    this.#gyroSinceCompass = 0;
    return flipped;
  }

  /**
   * Carry the heading forward with the gyroscope: the device's rotation rate
   * projected onto the vertical (gravity) axis is its turn rate, whichever
   * way up the phone is held. Returns silently if either reading is missing.
   *
   * @param {{ rotationRate?: { alpha?: number | null, beta?: number | null, gamma?: number | null } | null,
   *           accelerationIncludingGravity?: { x?: number | null, y?: number | null, z?: number | null } | null }} event
   */
  #integrateGyro(event) {
    const r = event.rotationRate;
    const g = event.accelerationIncludingGravity;
    const now = this.#opts.now();
    if (!r || !g) return;
    const raw = [g.x, g.y, g.z];
    const rate = [r.beta, r.gamma, r.alpha]; // rotation about device x, y, z
    if (![...raw, ...rate].every(Number.isFinite)) return;

    // Reject readings that cannot be gravity before they pollute the average
    // (free fall, a violent shake); walking jolts stay well inside this.
    if (Math.hypot(...raw) < 4 || Math.hypot(...raw) > 16) return;

    const last = this.#lastGyroAt;
    this.#lastGyroAt = now;
    const dt = last === null ? 0 : Math.min(0.2, Math.max(0, (now - last) / 1000));

    // Gravity direction, low-passed (about 0.25 s) so a footstep's jolt does
    // not tilt "up", but a change in how the phone is held is followed quickly.
    const a = dt / (0.25 + dt);
    this.#gravity = this.#gravity ? this.#gravity.map((v, i) => v + a * (raw[i] - v)) : raw;
    if (last === null) return;
    const norm = Math.hypot(...this.#gravity);

    const yawRate = rate.reduce((t, w, i) => t + (w * this.#gravity[i]) / norm, 0); // °/s, anticlockwise from above
    const delta = -this.#gyroSign * yawRate * dt; // heading is clockwise
    this.#estimate.heading = wrapHeading(this.#estimate.heading + delta);
    this.#gyroSinceCompass += delta;
  }

  /**
   * Feed a DeviceMotionEvent-shaped sample: its `rotationRate` (with
   * `accelerationIncludingGravity`, to find which way is up) carries the
   * heading between compass readings, and its `acceleration` feeds the step
   * counter.
   *
   * A footstep produces a clear peak in acceleration magnitude (the vertical
   * bounce of a gait); this looks for that peak crossing `stepThreshold` and,
   * once one is found (and the refractory window has passed), advances the
   * position by `strideM` along the *current heading* — not along whatever
   * direction the accelerometer happened to be pointing, which for a phone
   * held loosely is not a reliable indicator of travel direction. This is
   * pedestrian dead reckoning; see the module doc for why it replaces
   * integrating acceleration directly.
   *
   * @param {{ acceleration?: { x?: number | null, y?: number | null, z?: number | null } | null }} event
   */
  handleMotion(event) {
    if (!this.#estimate) return;
    this.#integrateGyro(event);

    const acc = event.acceleration ?? {};
    const ax = Number.isFinite(acc.x) ? acc.x : 0;
    const ay = Number.isFinite(acc.y) ? acc.y : 0;
    const az = Number.isFinite(acc.z) ? acc.z : 0;
    const mag = Math.hypot(ax, ay, az);

    if (mag > this.#lastMag) {
      this.#magRising = true;
    } else if (this.#magRising) {
      // Just passed a peak: #lastMag holds its value.
      this.#magRising = false;
      if (this.#lastMag >= this.#opts.stepThreshold) this.#step();
    }
    this.#lastMag = mag;
  }

  /** Advance the estimate by one stride along the current heading. */
  #step() {
    const now = this.#opts.now();
    if (this.#lastStepAt !== null && now - this.#lastStepAt < this.#opts.stepRefractoryMs) return;
    this.#lastStepAt = now;

    const θ = this.#estimate.heading * DEG_TO_RAD;
    const dx = this.#opts.strideM * Math.sin(θ);
    const dy = this.#opts.strideM * Math.cos(θ);
    this.#estimate.x += dx;
    this.#estimate.y += dy;
    this.#distanceSinceFix += this.#opts.strideM;
    this.#stepCount += 1;

    this.#emit('pose', this.getPose());
  }

  /**
   * Wire `window` events to this instance. Returns a detach function.
   * Kept separate from the constructor so the class is usable in Node.
   *
   * @param {EventTarget} target Usually `window`.
   * @returns {() => void}
   */
  attach(target) {
    const onOrientation = (e) => this.handleOrientation(e);
    const onMotion = (e) => this.handleMotion(e);
    target.addEventListener('deviceorientation', onOrientation);
    target.addEventListener('devicemotion', onMotion);
    return () => {
      target.removeEventListener('deviceorientation', onOrientation);
      target.removeEventListener('devicemotion', onMotion);
    };
  }

  // --------------------------------------------------------------- outputs

  /**
   * Current confidence, decayed from the last fix's confidence by elapsed
   * time and distance travelled. Each factor halves confidence at its
   * configured half-life; a half-life of 0 disables that factor.
   *
   * @returns {number} 0 when no fix has been received.
   */
  getConfidence() {
    if (!this.#fix) return 0;

    const { timeHalfLifeMs, distanceHalfLifeM } = this.#opts;
    const elapsed = Math.max(0, this.#opts.now() - this.#fix.timestamp);

    const timeFactor = timeHalfLifeMs > 0 ? Math.pow(0.5, elapsed / timeHalfLifeMs) : 1;
    const distanceFactor =
      distanceHalfLifeM > 0 ? Math.pow(0.5, this.#distanceSinceFix / distanceHalfLifeM) : 1;

    return this.#fix.confidence * timeFactor * distanceFactor;
  }

  /**
   * Fused pose with current confidence, or `null` before the first fix.
   * @returns {Pose | null}
   */
  getPose() {
    if (!this.#estimate) return null;
    return {
      ...this.#estimate,
      confidence: this.getConfidence(),
      timestamp: this.#opts.now(),
    };
  }

  /** Metres travelled (path length) since the last fix. */
  get distanceSinceFix() {
    return this.#distanceSinceFix;
  }

  /**
   * Steps counted since the last fix, independent of `strideM`. Divide a
   * known walked distance by this to calibrate a surveyor's actual stride —
   * see `docs/admin.md`.
   */
  get stepCount() {
    return this.#stepCount;
  }

  /**
   * Re-evaluate confidence and emit "rescan-needed" if it has dropped below
   * the threshold since the last fix. Call this on a timer (or on every
   * frame); it is idempotent until the next fix arrives.
   *
   * @returns {boolean} Whether a rescan is currently needed.
   */
  tick() {
    if (!this.#fix) return false;
    const confidence = this.getConfidence();
    const needed = confidence < this.#opts.rescanThreshold;
    if (needed && !this.#rescanEmitted) {
      this.#rescanEmitted = true;
      this.#emit('rescan-needed', {
        confidence,
        threshold: this.#opts.rescanThreshold,
        elapsedMs: this.#opts.now() - this.#fix.timestamp,
        distanceSinceFix: this.#distanceSinceFix,
      });
    }
    return needed;
  }
}
