/**
 * ImmersalProvider — camera-based visual positioning via the Immersal VPS for
 * Web SDK (https://github.com/immersal/vps-for-web, MIT).
 *
 * ## How it fits together
 *
 *  - The SDK opens the rear camera, downloads the venue's Immersal map and
 *    localises camera frames against it (on-device by default, in WASM).
 *  - Every successful localisation is a *fix*: an absolute pose in the map's
 *    coordinate frame. `immersalToVenue()` converts it into our venue-local
 *    contract (see ./positioning.js) using the transform recorded in the venue
 *    JSON, and it is handed to a `PoseFusion` instance.
 *  - Between fixes the provider emits `PoseFusion`'s dead-reckoned estimate
 *    (device motion + confidence decay), and forwards its `rescan-needed`
 *    event so the UI can prompt the user to point the camera at something
 *    recognisable.
 *
 * ## Configuration
 *
 *  - **API key** comes from the `IMMERSAL_API_KEY` environment variable
 *    (`import.meta.env.IMMERSAL_API_KEY`, see .env.example). It is read at
 *    build time by Vite and is never read from a committed file. Tests inject
 *    it via the `apiKey` option. Note that anything in a client bundle is
 *    visible to users; restrict the key in the Immersal developer portal.
 *  - **Map id and map→venue transform** come from the venue JSON:
 *
 *    ```jsonc
 *    "providers": {
 *      "immersal": {
 *        "mapId": 12345,
 *        "origin": { "x": 0, "y": 0, "z": 0 },   // venue coords of the map origin
 *        "rotationDeg": 0,                       // yaw to turn map axes onto venue axes
 *        "floor": 0                              // optional: fixed floor; else from floor elevations
 *      }
 *    }
 *    ```
 *
 * ## Coordinate frames
 *
 * Immersal's map frame is right-handed, **Y-up**, metres, and the localised
 * rotation is a quaternion `[x, y, z, w]` describing the camera, which looks
 * down its local −Z. Our venue frame is right-handed, **Z-up**, with heading
 * measured clockwise from +y. The conversion is
 *
 *     venue = origin + Rz(rotationDeg) · (map.x, −map.z, map.y)
 *
 * and heading is taken from the rotated camera-forward vector.
 *
 * ## SDK loading
 *
 * The SDK is not published to npm. Copy `js/` from the vps-for-web repository
 * into `public/vendor/immersal/` (see docs/immersal.md); the provider imports
 * `/vendor/immersal/immersal.js` at runtime. Pass `loadSdk` to override, which
 * is also how tests inject a fake.
 *
 * ## Camera permission
 *
 * As with QrProvider, `start()` never rejects for camera or network problems:
 * it settles into a `status` and emits a `status` event, and can be retried.
 */

import { PoseFusion } from '../core/fusion.js';
import { PositionProvider } from '../core/positioning.js';

/** @typedef {import('../core/positioning.js').Pose} Pose */
/** @typedef {import('../core/venue.js').Venue} Venue */

/**
 * @typedef {'idle' | 'starting' | 'loading-map' | 'localising' | 'permission-denied' | 'no-camera' | 'unsupported' | 'error'} ImmersalStatus
 */

/**
 * @typedef {Object} ImmersalMapConfig
 * @property {number} mapId
 * @property {{ x: number, y: number, z: number }} [origin]
 * @property {number} [rotationDeg]
 * @property {number} [floor]
 */

/**
 * @typedef {Object} ImmersalProviderOptions
 * @property {Venue} venue
 * @property {HTMLElement} container        Element the SDK mounts its camera <video> into.
 * @property {string} [apiKey]              Defaults to import.meta.env.IMMERSAL_API_KEY.
 * @property {'device' | 'server'} [mode='device']
 * @property {() => Promise<{ Immersal: any }>} [loadSdk]
 * @property {number} [fixConfidence=0.9]   Confidence assigned to a fresh Immersal fix.
 * @property {number} [pollIntervalMs=100]  How often to drive the SDK / check for new fixes.
 * @property {number} [serverIntervalMs=3000] Interval between server localisations (mode 'server').
 * @property {number} [emitIntervalMs=100]  Minimum gap between dead-reckoned pose emissions.
 * @property {number} [tickIntervalMs=500]  How often PoseFusion re-checks for rescan-needed.
 * @property {object} [fusion]              Extra PoseFusion options (thresholds, half-lives).
 * @property {EventTarget} [motionTarget]   Where device motion events come from (default window).
 * @property {number} [imageDownScale=0.25]
 * @property {number} [continuousInterval=16]
 * @property {() => number} [now]
 * @property {() => number} [perfNow]
 * @property {typeof setInterval} [setInterval]
 * @property {typeof clearInterval} [clearInterval]
 */

const DEG = Math.PI / 180;
const FLOOR_TOLERANCE_M = 0.75;

// ------------------------------------------------------------ conversions

/** Rotate vector v by unit quaternion q = [x, y, z, w]. */
function rotateByQuaternion(q, v) {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

function wrapHeading(deg) {
  const w = deg % 360;
  return w < 0 ? w + 360 : w;
}

/**
 * Pick the venue floor for a venue-local height. Uses floor `elevation`
 * (highest elevation at or below z, with tolerance); falls back to the lowest
 * floor.
 *
 * @param {Venue} venue
 * @param {number} z
 */
export function floorForHeight(venue, z) {
  let best = null;
  for (const floor of venue.floors) {
    if (typeof floor.elevation !== 'number') continue;
    if (
      floor.elevation <= z + FLOOR_TOLERANCE_M &&
      (best === null || floor.elevation > best.elevation)
    ) {
      best = floor;
    }
  }
  return (best ?? venue.floors[0]).index;
}

/**
 * Convert an Immersal localisation into a venue-local pose.
 *
 * @param {{ position: { x: number, y: number, z: number } | number[], rotation: { x: number, y: number, z: number, w: number } | number[] }} loc
 *   The SDK's `localizeInfo` (or `{ position: [x,y,z], rotation: [x,y,z,w] }`).
 * @param {ImmersalMapConfig} map
 * @param {Venue} venue
 * @param {{ confidence: number, timestamp: number }} meta
 * @returns {Pose}
 */
export function immersalToVenue(loc, map, venue, meta) {
  const p = Array.isArray(loc.position)
    ? loc.position
    : [loc.position.x, loc.position.y, loc.position.z];
  const q = Array.isArray(loc.rotation)
    ? loc.rotation
    : [loc.rotation.x, loc.rotation.y, loc.rotation.z, loc.rotation.w];

  const theta = (map.rotationDeg ?? 0) * DEG;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const origin = map.origin ?? { x: 0, y: 0, z: 0 };

  // Y-up → Z-up, then yaw about venue +z, then translate.
  const mx = p[0];
  const my = -p[2];
  const mz = p[1];
  const x = origin.x + mx * cos - my * sin;
  const y = origin.y + mx * sin + my * cos;
  const z = origin.z + mz;

  // Camera looks down its local −Z in the map frame.
  const f = rotateByQuaternion(q, [0, 0, -1]);
  const fx = f[0];
  const fy = -f[2];
  const rfx = fx * cos - fy * sin;
  const rfy = fx * sin + fy * cos;
  const heading = Math.hypot(rfx, rfy) < 1e-9 ? 0 : wrapHeading(Math.atan2(rfx, rfy) / DEG);

  const floor = Number.isInteger(map.floor) ? map.floor : floorForHeight(venue, z);

  return { x, y, z, floor, heading, confidence: meta.confidence, timestamp: meta.timestamp };
}

// ----------------------------------------------------------------- config

/**
 * Read and validate the venue's Immersal config. Throws with a readable
 * message naming the field.
 * @param {Venue} venue
 * @returns {ImmersalMapConfig}
 */
export function readMapConfig(venue) {
  const cfg = venue?.providers?.immersal;
  if (!cfg || typeof cfg !== 'object') {
    throw new TypeError(`venue "${venue?.id}" has no providers.immersal config`);
  }
  if (!Number.isInteger(cfg.mapId) || cfg.mapId <= 0) {
    throw new TypeError(`providers.immersal.mapId must be a positive integer, got ${cfg.mapId}`);
  }
  if (cfg.origin !== undefined) {
    for (const k of ['x', 'y', 'z']) {
      if (!Number.isFinite(cfg.origin?.[k])) {
        throw new TypeError(`providers.immersal.origin.${k} must be a finite number`);
      }
    }
  }
  if (cfg.rotationDeg !== undefined && !Number.isFinite(cfg.rotationDeg)) {
    throw new TypeError('providers.immersal.rotationDeg must be a finite number');
  }
  if (cfg.floor !== undefined && !Number.isInteger(cfg.floor)) {
    throw new TypeError('providers.immersal.floor must be an integer');
  }
  return cfg;
}

/** The API key from the environment, or undefined. Never reads a file. */
export function apiKeyFromEnv() {
  const key = import.meta.env?.IMMERSAL_API_KEY;
  return typeof key === 'string' && key.trim() !== '' ? key.trim() : undefined;
}

function defaultLoadSdk() {
  const url = new URL(
    '/vendor/immersal/immersal.js',
    globalThis.location?.href ?? 'http://localhost/'
  );
  return import(/* @vite-ignore */ url.href);
}

function classifyError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission-denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-camera';
    case 'NotSupportedError':
      return 'unsupported';
    default:
      return 'error';
  }
}

// --------------------------------------------------------------- provider

export class ImmersalProvider extends PositionProvider {
  /**
   * Exactly what the Immersal Web SDK sends off the device, per its source
   * (vps-for-web/js/immersal.js, imUtils.js, locWorker.js).
   */
  static uploads = [
    {
      data: 'Browser and device identification (user agent / client hints)',
      destination: '51Degrees device-detection service (cloud.51degrees.com), a third party',
      purpose:
        'The SDK loads a 51Degrees script to identify the phone model so it can look up camera intrinsics.',
      retention: 'Governed by 51Degrees; not controlled by this app.',
    },
    {
      data: 'Developer API key and the detected device vendor + model',
      destination: 'Immersal cloud (api.immersal.com/devget)',
      purpose:
        'Fetch known camera intrinsics (focal length, principal point) for this device model.',
    },
    {
      data: 'Developer API key and the venue map id',
      destination: 'Immersal cloud (api.immersal.com/map and /ecef)',
      purpose: 'Download the venue map for on-device localisation and its geo-reference (if any).',
    },
    {
      data: 'Camera frames (downscaled PNG), camera intrinsics, device orientation quaternion, developer API key, map ids',
      destination: 'Immersal cloud (api.immersal.com/localize)',
      purpose:
        'Server-side localisation. Sent ONLY when mode is "server"; in the default "device" mode frames never leave the phone.',
      retention: 'Per Immersal terms; not controlled by this app.',
    },
    {
      data: 'None of the user’s data (library code only)',
      destination: 'cdnjs.cloudflare.com and cdn.jsdelivr.net',
      purpose:
        'The SDK’s PNG-encoding worker imports pako and UPNG from public CDNs (server mode).',
    },
  ];

  /** @type {Required<ImmersalProviderOptions>} */
  #opts;
  /** @type {ImmersalMapConfig} */
  #map;
  /** @type {PoseFusion} */
  #fusion;
  /** @type {ImmersalStatus} */
  #status = 'idle';
  #error = null;
  #sdk = null;
  #mapHandle = -1;
  #lastCounter = 0;
  #lastEmitAt = -Infinity;
  #pollTimer = null;
  #tickTimer = null;
  #serverTimer = null;
  #detachMotion = null;
  #statusListeners = new Set();
  #fixCount = 0;
  #applyingFix = false;

  /** @param {ImmersalProviderOptions} options */
  constructor(options) {
    super();
    if (!options || typeof options.venue?.id !== 'string' || !Array.isArray(options.venue.floors)) {
      throw new TypeError('ImmersalProvider requires a Venue (see createVenue())');
    }
    this.#map = readMapConfig(options.venue);

    const apiKey = options.apiKey ?? apiKeyFromEnv();
    if (!apiKey) {
      throw new Error(
        'ImmersalProvider: no API key. Set IMMERSAL_API_KEY in your environment (see .env.example); ' +
          'it is never read from a committed file.'
      );
    }

    this.#opts = {
      mode: 'device',
      loadSdk: defaultLoadSdk,
      fixConfidence: 0.9,
      pollIntervalMs: 100,
      serverIntervalMs: 3000,
      emitIntervalMs: 100,
      tickIntervalMs: 500,
      fusion: {},
      motionTarget: globalThis.window ?? null,
      imageDownScale: 0.25,
      continuousInterval: 16,
      now: () => Date.now(),
      perfNow: () => globalThis.performance?.now?.() ?? Date.now(),
      setInterval: (...a) => globalThis.setInterval(...a),
      clearInterval: (...a) => globalThis.clearInterval(...a),
      ...options,
      apiKey,
    };
    if (this.#opts.mode !== 'device' && this.#opts.mode !== 'server') {
      throw new RangeError(`mode must be 'device' or 'server', got ${this.#opts.mode}`);
    }
    if (!(this.#opts.fixConfidence >= 0 && this.#opts.fixConfidence <= 1)) {
      throw new RangeError('fixConfidence must be in [0, 1]');
    }
    if (!this.#opts.container && this.#opts.loadSdk === defaultLoadSdk) {
      throw new TypeError('ImmersalProvider requires a container element for the camera view');
    }

    this.#fusion = new PoseFusion({
      headingOffsetDeg: options.venue.headingOffsetDeg ?? 0,
      now: this.#opts.now,
      ...this.#opts.fusion,
    });
    this.#fusion.on('pose', () => this.#emitFused(false));
  }

  // ---------------------------------------------------------------- state

  /** @returns {ImmersalStatus} */
  get status() {
    return this.#status;
  }

  get error() {
    return this.#error;
  }

  /** The PoseFusion instance filling in between fixes. */
  get fusion() {
    return this.#fusion;
  }

  /** Number of Immersal fixes accepted since start(). */
  get fixCount() {
    return this.#fixCount;
  }

  /** The map config in use (from the venue JSON). */
  get mapConfig() {
    return this.#map;
  }

  /**
   * @param {(event: { status: ImmersalStatus, error?: Error }) => void} listener
   * @returns {() => void}
   */
  onStatus(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  /**
   * Forwarded from PoseFusion: fires once per fix when confidence drops
   * below the threshold.
   * @param {(event: object) => void} listener
   * @returns {() => void}
   */
  onRescanNeeded(listener) {
    return this.#fusion.on('rescan-needed', listener);
  }

  #setStatus(status, error = null) {
    this.#status = status;
    this.#error = error;
    const event = error ? { status, error } : { status };
    for (const l of this.#statusListeners) l(event);
  }

  // ------------------------------------------------------------ lifecycle

  /**
   * Load the SDK, open the camera, download the map and begin localising.
   * Never rejects for camera, network or SDK problems: check `status`.
   * @returns {Promise<void>}
   */
  async start() {
    if (this.#status !== 'idle' && !isFailure(this.#status)) return;
    this.#setStatus('starting');

    let Immersal;
    try {
      ({ Immersal } = await this.#opts.loadSdk());
      if (typeof Immersal?.Initialize !== 'function')
        throw new Error('SDK did not export Immersal.Initialize');
    } catch (err) {
      this.#setStatus('unsupported', toError(err, 'Immersal SDK could not be loaded'));
      return;
    }

    try {
      this.#sdk = await Immersal.Initialize(this.#opts.container, {
        developerToken: this.#opts.apiKey,
        mapIds: [this.#map.mapId],
        continuousLocalization: this.#opts.mode === 'device',
        continuousInterval: this.#opts.continuousInterval,
        imageDownScale: this.#opts.imageDownScale,
        solverType: 1,
      });
    } catch (err) {
      this.#sdk = null;
      this.#setStatus(classifyError(err), toError(err, 'camera could not be started'));
      return;
    }

    this.#setStatus('loading-map');
    try {
      this.#mapHandle = await this.#sdk.loadMap(this.#map.mapId);
      if (!(this.#mapHandle >= 0)) throw new Error(`map ${this.#map.mapId} failed to load`);
    } catch (err) {
      await this.#teardownSdk();
      this.#setStatus('error', toError(err, `map ${this.#map.mapId} could not be loaded`));
      return;
    }

    this.#lastCounter = this.#sdk.localization?.counter ?? 0;
    this.#fixCount = 0;
    if (this.#opts.motionTarget?.addEventListener) {
      this.#detachMotion = this.#fusion.attach(this.#opts.motionTarget);
    }
    this.#pollTimer = this.#opts.setInterval(() => this.#poll(), this.#opts.pollIntervalMs);
    this.#tickTimer = this.#opts.setInterval(() => this.#fusion.tick(), this.#opts.tickIntervalMs);
    if (this.#opts.mode === 'server') {
      this.#serverTimer = this.#opts.setInterval(
        () => this.#localiseServer(),
        this.#opts.serverIntervalMs
      );
    }
    this.#setStatus('localising');
  }

  /**
   * Stop localising, release the camera and free the map. Safe in any state.
   * @returns {Promise<void>}
   */
  async stop() {
    this.#clearTimers();
    if (this.#detachMotion) {
      this.#detachMotion();
      this.#detachMotion = null;
    }
    await this.#teardownSdk();
    if (this.#status !== 'idle') this.#setStatus('idle');
  }

  async #teardownSdk() {
    const sdk = this.#sdk;
    this.#sdk = null;
    if (!sdk) return;
    try {
      if (this.#mapHandle >= 0 && typeof sdk.freeMap === 'function')
        await sdk.freeMap(this.#mapHandle);
    } catch {
      // best-effort
    }
    this.#mapHandle = -1;
    try {
      sdk.continuousLocalization = false;
    } catch {
      // best-effort
    }
    try {
      sdk.camera?.dispose?.();
    } catch {
      // best-effort
    }
  }

  #clearTimers() {
    if (this.#pollTimer !== null) this.#opts.clearInterval(this.#pollTimer);
    if (this.#tickTimer !== null) this.#opts.clearInterval(this.#tickTimer);
    if (this.#serverTimer !== null) this.#opts.clearInterval(this.#serverTimer);
    this.#pollTimer = this.#tickTimer = this.#serverTimer = null;
  }

  // ------------------------------------------------------------ localising

  /** Drive on-device continuous localisation and pick up any new fix. */
  #poll() {
    const sdk = this.#sdk;
    if (!sdk || this.#status !== 'localising') return;
    if (this.#opts.mode === 'device') {
      try {
        sdk.localizeDevice(this.#opts.perfNow());
      } catch (err) {
        this.#fail(err);
        return;
      }
    }
    const counter = sdk.localization?.counter ?? 0;
    if (counter !== this.#lastCounter) {
      this.#lastCounter = counter;
      this.#acceptFix(sdk.localizeInfo);
    }
  }

  async #localiseServer() {
    const sdk = this.#sdk;
    if (!sdk || this.#status !== 'localising' || sdk.localization?.localizing) return;
    try {
      const info = await sdk.localizeServerAsync();
      if (this.#status === 'localising' && info) {
        this.#lastCounter = sdk.localization?.counter ?? this.#lastCounter;
        this.#acceptFix(info);
      }
    } catch {
      // A failed localisation attempt is normal (nothing recognisable in view).
    }
  }

  #acceptFix(info) {
    const pose = immersalToVenue(info, this.#map, this.#opts.venue, {
      confidence: this.#opts.fixConfidence,
      timestamp: this.#opts.now(),
    });
    this.#fixCount += 1;
    // applyFix() fires fusion's 'pose' event; suppress that path and emit once, unthrottled.
    this.#applyingFix = true;
    try {
      this.#fusion.applyFix(pose);
    } finally {
      this.#applyingFix = false;
    }
    this.#emitFused(true);
  }

  /** Emit the fused estimate, rate-limited unless forced. */
  #emitFused(force) {
    if (this.#applyingFix && !force) return;
    if (this.#status !== 'localising' && !force) return;
    const pose = this.#fusion.getPose();
    if (!pose) return;
    const now = this.#opts.now();
    if (!force && now - this.#lastEmitAt < this.#opts.emitIntervalMs) return;
    this.#lastEmitAt = now;
    this.emitPose(pose);
  }

  #fail(err) {
    this.#clearTimers();
    this.#setStatus('error', toError(err, 'localisation failed'));
  }
}

function isFailure(status) {
  return (
    status === 'permission-denied' ||
    status === 'no-camera' ||
    status === 'unsupported' ||
    status === 'error'
  );
}

function toError(err, fallback) {
  if (err instanceof Error) return err;
  return new Error(typeof err === 'string' && err ? err : fallback, { cause: err });
}
