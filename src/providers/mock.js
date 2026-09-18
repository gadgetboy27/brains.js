/**
 * MockProvider — simulates a walk through the venue so the whole app can be
 * developed with no camera, no venue map and no vendor account.
 *
 * The simulated person walks along a configurable path of venue-local
 * waypoints at a steady speed. Every `fixIntervalMs` the provider emits a
 * pose, exactly as a real VPS provider would after a successful localisation.
 * Two knobs make it behave like an imperfect real provider:
 *
 *  - **drift** — the reported position wanders away from the true position at
 *    `driftRateMps` metres per second in a fixed random direction, and
 *    confidence falls as the drift grows. Resets on `recover()`.
 *  - **fix interval** — how often a fix arrives. Between fixes the app is on
 *    its own (see src/core/fusion.js), which is exactly the situation a real
 *    camera-based provider puts it in.
 *
 * Controls let you script failure modes from the UI or a test:
 *
 *  - `forceLowConfidence(value)` — every subsequent fix carries this
 *    confidence until `clearForcedConfidence()`.
 *  - `forceLost()` — stop emitting fixes altogether, as when the camera sees
 *    nothing recognisable. `recover()` resumes, with drift reset (a fresh
 *    localisation).
 *  - `teleport(point)` — jump the true position and emit a fix immediately.
 *
 * Nothing leaves the device; `uploads` is empty. Time, timers and randomness
 * are injectable so tests are deterministic and instant.
 */

import { metresBetween } from '../core/distance.js';
import { PositionProvider } from '../core/positioning.js';

/** @typedef {import('../core/positioning.js').Pose} Pose */

/** @typedef {{ x: number, y: number, z?: number, floor?: number }} Waypoint */

/**
 * @typedef {Object} MockProviderOptions
 * @property {Waypoint[]} [path=[]]
 *   Waypoints to walk through, in order. A single waypoint means "stand here".
 * @property {number} [speedMps=1.2] Walking speed. 0 stands still.
 * @property {number} [fixIntervalMs=1000] Time between emitted fixes.
 * @property {number} [driftRateMps=0] Growth of position error, metres per second.
 * @property {number} [confidence=0.9] Confidence of a fresh, drift-free fix.
 * @property {number} [confidenceLossPerMetre=0.1]
 *   How much confidence drops per metre of accumulated drift.
 * @property {boolean} [loop=false] Walk the path again from the start when done.
 * @property {() => number} [now=Date.now] Clock in ms.
 * @property {() => number} [random=Math.random] Source for the drift direction.
 * @property {typeof setTimeout} [setTimeout]
 * @property {typeof clearTimeout} [clearTimeout]
 */

const DEG = 180 / Math.PI;

/** Heading clockwise from +y, in [0, 360). */
function headingOf(dx, dy) {
  const h = Math.atan2(dx, dy) * DEG;
  return h < 0 ? h + 360 : h;
}

export class MockProvider extends PositionProvider {
  /** Nothing leaves the device. */
  static uploads = [];

  /** @type {Required<MockProviderOptions>} */
  #opts;

  /** @type {'idle' | 'running' | 'lost'} */
  #state = 'idle';

  /** Precomputed path: waypoints with z/floor defaults, and cumulative lengths. */
  #points = [];
  #cumulative = [0];
  #total = 0;

  /** Distance walked along the path, metres. */
  #along = 0;

  /** Accumulated drift vector, metres. */
  #drift = { x: 0, y: 0 };
  #driftAngle = 0;

  /** @type {number | null} */
  #forcedConfidence = null;

  #lastTickAt = null;
  #timer = null;

  /** @param {MockProviderOptions} [options] */
  constructor(options = {}) {
    super();
    this.#opts = {
      path: [],
      speedMps: 1.2,
      fixIntervalMs: 1000,
      driftRateMps: 0,
      confidence: 0.9,
      confidenceLossPerMetre: 0.1,
      loop: false,
      now: () => Date.now(),
      random: () => Math.random(),
      setTimeout: (...a) => globalThis.setTimeout(...a),
      clearTimeout: (...a) => globalThis.clearTimeout(...a),
      ...options,
    };

    for (const key of ['speedMps', 'fixIntervalMs', 'driftRateMps', 'confidenceLossPerMetre']) {
      const v = this.#opts[key];
      if (!(Number.isFinite(v) && v >= 0)) {
        throw new RangeError(`${key} must be a non-negative number, got ${v}`);
      }
    }
    if (!(
      Number.isFinite(this.#opts.confidence) &&
      this.#opts.confidence >= 0 &&
      this.#opts.confidence <= 1
    )) {
      throw new RangeError(`confidence must be in [0, 1], got ${this.#opts.confidence}`);
    }
    this.setPath(this.#opts.path);
  }

  // ------------------------------------------------------------ inspection

  /** @returns {'idle' | 'running' | 'lost'} */
  get state() {
    return this.#state;
  }

  /** Metres walked along the path (wraps when looping). */
  get distanceAlongPath() {
    return this.#along;
  }

  /** Total path length in metres. */
  get pathLength() {
    return this.#total;
  }

  /** Magnitude of the current drift, metres. */
  get driftMetres() {
    return Math.hypot(this.#drift.x, this.#drift.y);
  }

  /** The true (undrifted) position, for debug overlays and tests. */
  get truePosition() {
    return this.#positionAt(this.#along);
  }

  /** Confidence the next fix would carry. */
  get currentConfidence() {
    if (this.#forcedConfidence !== null) return this.#forcedConfidence;
    const c = this.#opts.confidence - this.driftMetres * this.#opts.confidenceLossPerMetre;
    return Math.min(1, Math.max(0, c));
  }

  // -------------------------------------------------------------- controls

  /**
   * Replace the path. Resets progress to the start. May be called while
   * running.
   * @param {Waypoint[]} path
   */
  setPath(path) {
    if (!Array.isArray(path)) throw new TypeError('path must be an array of waypoints');
    const points = path.map((p, i) => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        throw new TypeError(`path[${i}] must have finite x and y`);
      }
      const floor = p.floor ?? 0;
      if (!Number.isInteger(floor)) throw new TypeError(`path[${i}].floor must be an integer`);
      return { x: p.x, y: p.y, z: p.z ?? 0, floor };
    });
    const cumulative = [0];
    for (let i = 1; i < points.length; i += 1) {
      cumulative.push(cumulative[i - 1] + metresBetween(points[i - 1], points[i]));
    }
    this.#points = points;
    this.#cumulative = cumulative;
    this.#total = cumulative[cumulative.length - 1] ?? 0;
    this.#along = 0;
  }

  /** @param {number} metresPerSecond */
  setSpeed(metresPerSecond) {
    if (!(Number.isFinite(metresPerSecond) && metresPerSecond >= 0)) {
      throw new RangeError('speed must be a non-negative number');
    }
    this.#opts.speedMps = metresPerSecond;
  }

  /** @param {number} metresPerSecond */
  setDriftRate(metresPerSecond) {
    if (!(Number.isFinite(metresPerSecond) && metresPerSecond >= 0)) {
      throw new RangeError('drift rate must be a non-negative number');
    }
    this.#opts.driftRateMps = metresPerSecond;
  }

  /** @param {number} ms Takes effect from the next scheduled fix. */
  setFixInterval(ms) {
    if (!(Number.isFinite(ms) && ms >= 0)) throw new RangeError('fix interval must be >= 0');
    this.#opts.fixIntervalMs = ms;
  }

  /**
   * Force every subsequent fix to carry this confidence, ignoring drift.
   * @param {number} [value=0.2]
   */
  forceLowConfidence(value = 0.2) {
    if (!(Number.isFinite(value) && value >= 0 && value <= 1)) {
      throw new RangeError('confidence must be in [0, 1]');
    }
    this.#forcedConfidence = value;
  }

  /** Return to drift-derived confidence. */
  clearForcedConfidence() {
    this.#forcedConfidence = null;
  }

  /**
   * Simulate losing localisation: no more fixes until `recover()`. The
   * simulated person keeps walking, so recovery reveals how far the app's
   * dead reckoning has diverged.
   */
  forceLost() {
    if (this.#state !== 'running') return;
    this.#state = 'lost';
  }

  /**
   * Simulate a fresh localisation after being lost: drift is reset, fixes
   * resume immediately. No-op unless lost.
   */
  recover() {
    if (this.#state !== 'lost') return;
    this.#advance(); // keep walking through the lost period
    this.#resetDrift();
    this.#state = 'running';
    this.#emitFix();
  }

  /**
   * Jump the true position to a point on no particular path segment and
   * emit a fix immediately. Subsequent walking continues along the path from
   * where it was, so this is best used with a single-waypoint path.
   * @param {Waypoint} point
   */
  teleport(point) {
    this.setPath([point]);
    this.#resetDrift();
    if (this.#state === 'lost') this.#state = 'running';
    if (this.#state === 'running') this.#emitFix();
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Start walking and emitting fixes. The first fix is emitted immediately.
   * @returns {Promise<void>}
   */
  async start() {
    if (this.#state !== 'idle') return;
    this.#state = 'running';
    this.#along = 0;
    this.#lastTickAt = this.#opts.now();
    this.#resetDrift();
    this.#emitFix();
    this.#schedule();
  }

  /**
   * Stop walking and emitting. Listeners are kept. A later `start()` begins
   * from the start of the path again.
   * @returns {Promise<void>}
   */
  async stop() {
    this.#clearTimer();
    this.#state = 'idle';
    this.#lastTickAt = null;
  }

  // ------------------------------------------------------------- internals

  #resetDrift() {
    this.#drift = { x: 0, y: 0 };
    this.#driftAngle = this.#opts.random() * 2 * Math.PI;
  }

  /** Move the walker and grow drift by the time since the last tick. */
  #advance() {
    const now = this.#opts.now();
    const dt = this.#lastTickAt === null ? 0 : Math.max(0, now - this.#lastTickAt) / 1000;
    this.#lastTickAt = now;
    if (dt === 0) return;

    if (this.#total > 0 && this.#opts.speedMps > 0) {
      this.#along += this.#opts.speedMps * dt;
      if (this.#along > this.#total) {
        this.#along = this.#opts.loop ? this.#along % this.#total : this.#total;
      }
    }

    if (this.#opts.driftRateMps > 0) {
      const step = this.#opts.driftRateMps * dt;
      this.#drift.x += Math.cos(this.#driftAngle) * step;
      this.#drift.y += Math.sin(this.#driftAngle) * step;
    }
  }

  #positionAt(along) {
    const pts = this.#points;
    if (pts.length === 0) return { x: 0, y: 0, z: 0, floor: 0, heading: 0 };
    if (pts.length === 1 || this.#total === 0) return { ...pts[0], heading: 0 };

    // Find the segment containing `along`.
    let i = 0;
    while (i < this.#cumulative.length - 2 && along >= this.#cumulative[i + 1]) i += 1;
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = this.#cumulative[i + 1] - this.#cumulative[i];
    const t = segLen === 0 ? 0 : Math.min(1, (along - this.#cumulative[i]) / segLen);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      floor: t < 1 ? a.floor : b.floor,
      heading: headingOf(b.x - a.x, b.y - a.y),
    };
  }

  #emitFix() {
    const p = this.#positionAt(this.#along);
    this.emitPose({
      x: p.x + this.#drift.x,
      y: p.y + this.#drift.y,
      z: p.z,
      floor: p.floor,
      heading: p.heading,
      confidence: this.currentConfidence,
      timestamp: this.#opts.now(),
    });
  }

  #tick() {
    this.#timer = null;
    if (this.#state === 'idle') return;
    this.#advance();
    if (this.#state === 'running') this.#emitFix();
    this.#schedule();
  }

  #schedule() {
    this.#timer = this.#opts.setTimeout(() => this.#tick(), this.#opts.fixIntervalMs);
  }

  #clearTimer() {
    if (this.#timer !== null) {
      this.#opts.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
