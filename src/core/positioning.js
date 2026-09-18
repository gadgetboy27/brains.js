/**
 * PositionProvider — the interface every positioning method implements.
 *
 * The rest of the app (core, ui, venues) only ever talks to a provider through
 * this interface (see docs/DECISIONS.md, ADR-003). Concrete providers live in
 * src/providers/ and are selected at startup.
 *
 * ## Coordinate frame
 *
 * Poses are reported in **venue-local metres**: a right-handed cartesian frame
 * fixed to the venue, with `x` and `y` in the floor plane and `z` up. The
 * venue JSON defines where the origin sits and which floor-plan direction is
 * +y. Every provider is responsible for mapping its own native output into
 * this frame.
 *
 * ## Privacy rules (binding on every implementation)
 *
 * 1. **Never expose venue GPS coordinates.** A provider must not emit, log,
 *    attach to poses, or otherwise surface the venue's latitude/longitude —
 *    even if its vendor SDK reports them. If a vendor map is geo-referenced,
 *    that reference stays inside the provider. Callers get venue-local metres
 *    and nothing else.
 *
 * 2. **Declare exactly what leaves the device.** Each provider class must
 *    define a static `uploads` property listing every kind of data it sends
 *    off-device (camera frames, sensor readings, device identifiers, …),
 *    where it goes and why. An empty array means nothing leaves the device.
 *    The property must be declared on the class itself — inheriting a parent's
 *    declaration does not count — so that adding a provider forces a
 *    conscious statement about its data flows. The UI surfaces this list to
 *    users before positioning starts.
 *
 * `validateProvider()` enforces the structural parts of these rules and throws
 * if a provider is missing required members.
 */

/**
 * A single position + orientation fix in venue-local coordinates.
 *
 * @typedef {Object} Pose
 * @property {number} x          Metres east along the venue's +x axis.
 * @property {number} y          Metres along the venue's +y axis (floor-plan "up").
 * @property {number} z          Metres above the venue origin's floor plane.
 * @property {number} floor      Integer floor index as defined by the venue JSON
 *                               (e.g. 0 = ground, -1 = basement, 1 = first).
 * @property {number} heading    Direction the device is facing, in degrees,
 *                               clockwise from venue +y, in the range [0, 360).
 * @property {number} confidence Provider's confidence in this pose, 0 (none) to
 *                               1 (certain).
 * @property {number} timestamp  Milliseconds since the Unix epoch (`Date.now()`)
 *                               at which the pose was valid.
 */

/**
 * One kind of data a provider sends off the device.
 *
 * @typedef {Object} UploadDeclaration
 * @property {string} data        What is sent, e.g. "camera frames",
 *                                "device orientation", "session id".
 * @property {string} destination Who receives it, e.g. "Immersal cloud
 *                                localisation API (EU region)".
 * @property {string} purpose     Why it is sent, in one sentence.
 * @property {string} [retention] How long the recipient keeps it, if known.
 */

/**
 * Callback invoked for every new pose.
 * @callback PoseListener
 * @param {Pose} pose
 * @returns {void}
 */

/** Members every provider instance must have. */
const REQUIRED_METHODS = Object.freeze(['start', 'stop', 'onPose']);

/** Fields every pose must carry, all finite numbers. */
const POSE_FIELDS = Object.freeze(['x', 'y', 'z', 'floor', 'heading', 'confidence', 'timestamp']);

/** Fields every upload declaration must carry, all non-empty strings. */
const UPLOAD_FIELDS = Object.freeze(['data', 'destination', 'purpose']);

/**
 * Base class for positioning providers.
 *
 * Subclasses must:
 *  - declare `static uploads = [...]` (see privacy rule 2 above);
 *  - implement `start()` and `stop()`;
 *  - call `this.emitPose(pose)` whenever a new pose is available.
 *
 * The base class provides the `onPose` subscription mechanism and pose
 * validation. Plain objects that duck-type the same members are also accepted
 * by `validateProvider()`.
 *
 * @abstract
 */
export class PositionProvider {
  /**
   * Every kind of data this provider sends off-device. Subclasses MUST declare
   * this themselves; the base class deliberately leaves it undefined so that
   * `validateProvider()` rejects providers that forgot.
   *
   * @type {UploadDeclaration[] | undefined}
   */
  static uploads;

  /** @type {Set<PoseListener>} */
  #listeners = new Set();

  /**
   * Begin producing poses. Must be safe to call once after construction and
   * again after `stop()`. Should resolve once the provider is ready to emit,
   * and reject if it cannot start (e.g. camera permission denied).
   *
   * @abstract
   * @returns {Promise<void>}
   */
  async start() {
    throw new Error(`${this.constructor.name} must implement start()`);
  }

  /**
   * Stop producing poses and release any resources (camera, sensors, network).
   * Must be safe to call even if `start()` was never called or has failed.
   * Listeners registered with `onPose` are retained across stop/start.
   *
   * @abstract
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error(`${this.constructor.name} must implement stop()`);
  }

  /**
   * Subscribe to poses.
   *
   * @param {PoseListener} listener
   * @returns {() => void} Unsubscribe function.
   */
  onPose(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('onPose listener must be a function');
    }
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Deliver a pose to every listener. Validates the pose first so that a
   * malformed provider fails loudly instead of feeding NaNs into the scene.
   *
   * @protected
   * @param {Pose} pose
   */
  emitPose(pose) {
    validatePose(pose);
    for (const listener of this.#listeners) {
      listener(pose);
    }
  }
}

/**
 * Throw unless `pose` is a well-formed venue-local pose.
 *
 * @param {unknown} pose
 * @returns {asserts pose is Pose}
 */
export function validatePose(pose) {
  if (pose === null || typeof pose !== 'object') {
    throw new TypeError('pose must be an object');
  }
  for (const field of POSE_FIELDS) {
    const value = pose[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`pose.${field} must be a finite number, got ${String(value)}`);
    }
  }
  if (!Number.isInteger(pose.floor)) {
    throw new RangeError(`pose.floor must be an integer, got ${pose.floor}`);
  }
  if (pose.heading < 0 || pose.heading >= 360) {
    throw new RangeError(`pose.heading must be in [0, 360), got ${pose.heading}`);
  }
  if (pose.confidence < 0 || pose.confidence > 1) {
    throw new RangeError(`pose.confidence must be in [0, 1], got ${pose.confidence}`);
  }
  if (
    'lat' in pose ||
    'lon' in pose ||
    'lng' in pose ||
    'latitude' in pose ||
    'longitude' in pose
  ) {
    throw new Error('pose must not carry GPS coordinates (see PositionProvider privacy rules)');
  }
}

/**
 * Locate a provider's `uploads` declaration.
 *
 * For class instances it must be an *own* static property of the instance's
 * class (inherited declarations are ignored). For plain duck-typed objects it
 * must be an own property of the object.
 *
 * @param {object} provider
 * @returns {unknown} The declaration, or `undefined` if none was made.
 */
function findUploads(provider) {
  const ctor = provider.constructor;
  if (typeof ctor === 'function' && ctor !== Object && Object.hasOwn(ctor, 'uploads')) {
    return ctor.uploads;
  }
  if (Object.hasOwn(provider, 'uploads')) {
    return provider.uploads;
  }
  return undefined;
}

/**
 * Throw unless `provider` implements the PositionProvider interface.
 *
 * Checks that `start`, `stop` and `onPose` are functions and that an `uploads`
 * declaration is present and well-formed. Accepts subclasses of
 * `PositionProvider` and plain objects with the same shape.
 *
 * @param {unknown} provider
 * @returns {asserts provider is PositionProvider}
 */
export function validateProvider(provider) {
  if (provider === null || typeof provider !== 'object') {
    throw new TypeError('provider must be an object');
  }

  const name =
    provider.constructor?.name && provider.constructor !== Object
      ? provider.constructor.name
      : 'provider';

  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== 'function') {
      throw new TypeError(`${name} is missing required method ${method}()`);
    }
  }

  const uploads = findUploads(provider);
  if (uploads === undefined) {
    throw new TypeError(
      `${name} must declare a static "uploads" array stating what data leaves the device ` +
        '(use [] if nothing does)'
    );
  }
  if (!Array.isArray(uploads)) {
    throw new TypeError(`${name}.uploads must be an array, got ${typeof uploads}`);
  }
  uploads.forEach((entry, i) => {
    if (entry === null || typeof entry !== 'object') {
      throw new TypeError(`${name}.uploads[${i}] must be an object`);
    }
    for (const field of UPLOAD_FIELDS) {
      const value = entry[field];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError(`${name}.uploads[${i}].${field} must be a non-empty string`);
      }
    }
  });
}
