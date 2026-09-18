/**
 * MockProvider — a PositionProvider for development and tests.
 *
 * Plays back a scripted list of poses on a timer, or emits whatever the test
 * pushes into it. Nothing leaves the device, so `uploads` is empty. Timing
 * and the clock are injectable so tests run instantly with fake timers.
 *
 * Usage:
 *
 * ```js
 * const provider = new MockProvider({ poses: [poseA, poseB], intervalMs: 500, loop: true });
 * provider.onPose((pose) => …);
 * await provider.start();     // emits poseA now, poseB after 500 ms, poseA after 1000 ms, …
 * provider.push(poseC);       // emit an ad-hoc pose immediately
 * await provider.stop();
 * ```
 */

import { PositionProvider, validatePose } from '../core/positioning.js';

/**
 * @typedef {import('../core/positioning.js').Pose} Pose
 */

/**
 * @typedef {Object} MockProviderOptions
 * @property {Array<Partial<Pose>>} [poses=[]]
 *   Poses to play back in order once started. `timestamp` may be omitted; it
 *   is filled from the clock at emit time.
 * @property {number} [intervalMs=1000] Delay between scripted poses.
 * @property {boolean} [loop=false] Restart from the first pose after the last.
 * @property {() => number} [now=Date.now] Clock for timestamps.
 * @property {typeof setTimeout} [setTimeout=globalThis.setTimeout]
 * @property {typeof clearTimeout} [clearTimeout=globalThis.clearTimeout]
 */

export class MockProvider extends PositionProvider {
  /** Nothing leaves the device. */
  static uploads = [];

  /** @type {Required<MockProviderOptions>} */
  #opts;

  /** @type {'idle' | 'running'} */
  #state = 'idle';

  #index = 0;

  #timer = null;

  /** @param {MockProviderOptions} [options] */
  constructor(options = {}) {
    super();
    this.#opts = {
      poses: [],
      intervalMs: 1000,
      loop: false,
      now: () => Date.now(),
      setTimeout: (...args) => globalThis.setTimeout(...args),
      clearTimeout: (...args) => globalThis.clearTimeout(...args),
      ...options,
    };
    if (!Array.isArray(this.#opts.poses)) {
      throw new TypeError('poses must be an array');
    }
    if (!(Number.isFinite(this.#opts.intervalMs) && this.#opts.intervalMs >= 0)) {
      throw new RangeError('intervalMs must be a non-negative number');
    }
    // Validate the script up front (timestamp excepted) so a bad fixture fails
    // at construction, not minutes into a session.
    this.#opts.poses.forEach((pose, i) => {
      try {
        validatePose({ ...pose, timestamp: 0 });
      } catch (err) {
        throw new TypeError(`poses[${i}] is invalid: ${err.message}`, { cause: err });
      }
    });
  }

  /** @returns {'idle' | 'running'} */
  get state() {
    return this.#state;
  }

  /** Index of the next scripted pose to emit. */
  get cursor() {
    return this.#index;
  }

  /**
   * Start playback. Emits the first scripted pose immediately (if any), then
   * one per `intervalMs`. Calling start() while running is a no-op.
   * @returns {Promise<void>}
   */
  async start() {
    if (this.#state === 'running') return;
    this.#state = 'running';
    this.#index = 0;
    this.#emitNext();
  }

  /**
   * Stop playback. Listeners are retained; a later start() replays from the
   * beginning. Safe to call when not running.
   * @returns {Promise<void>}
   */
  async stop() {
    this.#clearTimer();
    this.#state = 'idle';
  }

  /**
   * Emit an ad-hoc pose immediately, regardless of playback state. Useful for
   * driving tests and for a "teleport" debug control. `timestamp` defaults to
   * the clock.
   *
   * @param {Partial<Pose>} pose
   */
  push(pose) {
    this.emitPose(this.#stamp(pose));
  }

  #stamp(pose) {
    return { timestamp: this.#opts.now(), ...pose };
  }

  #emitNext() {
    const { poses, loop, intervalMs } = this.#opts;
    if (poses.length === 0) return;

    if (this.#index >= poses.length) {
      if (!loop) return;
      this.#index = 0;
    }

    this.emitPose(this.#stamp(poses[this.#index]));
    this.#index += 1;

    const more = this.#index < poses.length || loop;
    if (more) {
      this.#timer = this.#opts.setTimeout(() => {
        this.#timer = null;
        if (this.#state === 'running') this.#emitNext();
      }, intervalMs);
    }
  }

  #clearTimer() {
    if (this.#timer !== null) {
      this.#opts.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
