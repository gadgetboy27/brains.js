/**
 * QrProvider — positions the user by scanning a QR code fixed to the venue.
 *
 * Each physical code encodes a venue id and an anchor id. The anchor is looked
 * up in the venue JSON (`anchors[]`), which records where a person stands and
 * which way they face when scanning it, and that pose is emitted with
 * confidence 1.0. A scan is the cheapest possible localisation: no venue map,
 * no vendor, and it gives PoseFusion a hard reset whenever the user passes a
 * marker.
 *
 * ## Payload formats
 *
 * `parseQrPayload()` accepts either:
 *
 *  - `brains://<venueId>/<anchorId>` — compact, for printed markers; or
 *  - any `http(s)` URL carrying `venue` (or `v`) and `anchor` in its query
 *    string or hash (`https://example.com/?v=mall&anchor=a-1`,
 *    `https://example.com/#venue=mall&anchor=a-1`), so a marker scanned with
 *    the phone's own camera app opens the web app at that venue and anchor —
 *    the no-install entry path (see docs/entry.md and
 *    scripts/make-entrance-qr.mjs).
 *
 * ## Decoding
 *
 * Uses the W3C `BarcodeDetector` API via the `barcode-detector` ponyfill,
 * which delegates to the browser's native detector where one exists and
 * otherwise decodes with bundled ZXing WebAssembly. Frames are decoded
 * **on-device**; nothing is uploaded, so `uploads` is empty.
 *
 * ## Camera permission
 *
 * `start()` never rejects because of the camera. If permission is denied, the
 * device has no camera, or `getUserMedia` is unavailable (e.g. insecure
 * origin), the provider settles into the corresponding `status` and emits a
 * `status` event so the UI can explain and offer a retry via `start()` again.
 * The rest of the app keeps working on whatever other provider or fusion
 * estimate it has.
 *
 * Every browser dependency (`getUserMedia`, `BarcodeDetector`, the video
 * element, timers) is injectable so the provider is unit-testable in Node.
 */

import {
  BarcodeDetector as PonyfillBarcodeDetector,
  prepareZXingModule,
} from 'barcode-detector/ponyfill';
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

import { PositionProvider } from '../core/positioning.js';

// The ponyfill decodes with ZXing compiled to WebAssembly. By default it
// fetches that .wasm from a public CDN the first time a frame is decoded —
// slow on a hospital network and impossible offline, and a failed fetch
// looked like "the camera never recognises anything". Ship it with the app
// instead (Vite emits it as a hashed asset next to the bundle).
prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith('.wasm') ? zxingReaderWasmUrl : prefix + path),
  },
});

/** @typedef {import('../core/positioning.js').Pose} Pose */
/** @typedef {import('../core/venue.js').Venue} Venue */

/**
 * @typedef {'idle' | 'starting' | 'scanning' | 'permission-denied' | 'no-camera' | 'unsupported' | 'error'} QrStatus
 */

/**
 * @typedef {Object} QrProviderOptions
 * @property {Venue} venue                     The venue whose anchors are valid.
 * @property {HTMLVideoElement} [video]        Element to attach the camera stream to.
 *   Created (off-screen) if omitted; supply one to show a viewfinder.
 * @property {number} [scanIntervalMs=150]     How often to try decoding a frame.
 * @property {number} [repeatSuppressMs=3000]  Ignore the same code again within this window.
 * @property {(constraints: MediaStreamConstraints) => Promise<MediaStream>} [getUserMedia]
 * @property {typeof BarcodeDetector} [BarcodeDetector]
 * @property {() => HTMLVideoElement} [createVideo]
 * @property {() => number} [now]
 * @property {typeof setTimeout} [setTimeout]
 * @property {typeof clearTimeout} [clearTimeout]
 */

const BRAINS_SCHEME = /^brains:\/\/([^/\s]+)\/([^/\s?#]+)\/?$/i;

/**
 * Parse the text of a scanned code into venue and anchor ids.
 *
 * @param {string} text
 * @returns {{ venueId: string, anchorId: string } | null} `null` if the text
 *   is not one of the recognised formats.
 */
export function parseQrPayload(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();

  const compact = BRAINS_SCHEME.exec(trimmed);
  if (compact) {
    return { venueId: decodeURIComponent(compact[1]), anchorId: decodeURIComponent(compact[2]) };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const fromQuery = url.searchParams;
  const fromHash = new URLSearchParams(url.hash.replace(/^#\/?/, ''));
  const venueId =
    fromQuery.get('venue') ?? fromQuery.get('v') ?? fromHash.get('venue') ?? fromHash.get('v');
  const anchorId = fromQuery.get('anchor') ?? fromHash.get('anchor');
  if (!venueId || !anchorId) return null;
  return { venueId, anchorId };
}

/**
 * Build the compact payload for a printed marker.
 * @param {string} venueId
 * @param {string} anchorId
 */
export function formatQrPayload(venueId, anchorId) {
  return `brains://${encodeURIComponent(venueId)}/${encodeURIComponent(anchorId)}`;
}

export class QrProvider extends PositionProvider {
  /**
   * Camera frames are decoded on the device by BarcodeDetector / ZXing-wasm.
   * Nothing is transmitted.
   */
  static uploads = [];

  /** @type {Required<Omit<QrProviderOptions, 'video'>> & { video?: HTMLVideoElement }} */
  #opts;

  /** @type {QrStatus} */
  #status = 'idle';

  /** @type {Error | null} last error for 'error' status */
  #error = null;

  #stream = null;
  #video = null;
  #detector = null;
  #timer = null;

  /** @type {Set<(status: { status: QrStatus, error?: Error }) => void>} */
  #statusListeners = new Set();

  /** @type {Set<(scan: object) => void>} */
  #scanListeners = new Set();

  /** Last accepted payload text and when, for repeat suppression. */
  #lastText = null;
  #lastAt = -Infinity;

  /** @param {QrProviderOptions} options */
  constructor(options) {
    super();
    if (
      !options ||
      typeof options.venue?.anchorById !== 'function' ||
      typeof options.venue.id !== 'string'
    ) {
      throw new TypeError('QrProvider requires a Venue (see createVenue())');
    }
    this.#opts = {
      scanIntervalMs: 150,
      repeatSuppressMs: 3000,
      getUserMedia: (c) => globalThis.navigator?.mediaDevices?.getUserMedia?.(c),
      BarcodeDetector: null, // chosen at start(): see chooseDetector()
      createVideo: () => globalThis.document?.createElement('video'),
      now: () => Date.now(),
      setTimeout: (...a) => globalThis.setTimeout(...a),
      clearTimeout: (...a) => globalThis.clearTimeout(...a),
      ...options,
    };
    for (const key of ['scanIntervalMs', 'repeatSuppressMs']) {
      if (!(Number.isFinite(this.#opts[key]) && this.#opts[key] >= 0)) {
        throw new RangeError(`${key} must be a non-negative number`);
      }
    }
  }

  // ----------------------------------------------------------------- state

  /** @returns {QrStatus} */
  get status() {
    return this.#status;
  }

  /** The error behind an `'error'` status, if any. */
  get error() {
    return this.#error;
  }

  /** The video element showing the camera, once started. */
  get video() {
    return this.#video;
  }

  /**
   * Subscribe to status changes (`permission-denied`, `scanning`, …).
   * @param {(event: { status: QrStatus, error?: Error }) => void} listener
   * @returns {() => void}
   */
  onStatus(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  /**
   * Subscribe to every decoded code, accepted or not. Useful for UI feedback
   * ("that code belongs to a different venue").
   *
   * @param {(scan: { text: string, result: 'accepted' | 'unrecognised' | 'wrong-venue' | 'unknown-anchor' | 'repeat', venueId?: string, anchorId?: string }) => void} listener
   * @returns {() => void}
   */
  onScan(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#scanListeners.add(listener);
    return () => this.#scanListeners.delete(listener);
  }

  #setStatus(status, error = null) {
    this.#status = status;
    this.#error = error;
    const event = error ? { status, error } : { status };
    for (const l of this.#statusListeners) l(event);
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Open the camera and begin scanning. Resolves once the outcome is known;
   * check `status` (or listen with `onStatus`) for `'scanning'` versus
   * `'permission-denied'` / `'no-camera'` / `'unsupported'` / `'error'`.
   * Never rejects for camera problems. Calling again after a failure retries.
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this.#status === 'starting' || this.#status === 'scanning') return;
    this.#setStatus('starting');

    const { getUserMedia, createVideo } = this.#opts;

    const BarcodeDetector = await chooseDetector(this.#opts.BarcodeDetector);
    if (typeof BarcodeDetector !== 'function') {
      this.#setStatus('unsupported', new Error('BarcodeDetector is not available'));
      return;
    }
    if (typeof getUserMedia !== 'function') {
      this.#setStatus('unsupported', new Error('getUserMedia is not available (insecure origin?)'));
      return;
    }

    let stream;
    try {
      stream = await getUserMedia(CAMERA_CONSTRAINTS);
      if (!stream) throw new TypeError('getUserMedia returned nothing');
    } catch (err) {
      if (err?.name === 'OverconstrainedError') {
        // The sharper-frame request (720p, continuous focus) was rejected
        // outright by this device/camera — rare, but a plain request for
        // *any* rear camera is far less likely to be. A usable low-res
        // scanner beats none at all.
        try {
          stream = await getUserMedia(FALLBACK_CAMERA_CONSTRAINTS);
        } catch (err2) {
          this.#setStatus(classifyCameraError(err2), err2);
          return;
        }
      } else {
        this.#setStatus(classifyCameraError(err), err);
        return;
      }
    }
    await requestContinuousFocus(stream);

    try {
      this.#detector = new BarcodeDetector({ formats: ['qr_code'] });
      this.#video = this.#opts.video ?? createVideo?.();
      if (!this.#video) throw new Error('no video element available');
      this.#stream = stream;
      this.#video.srcObject = stream;
      this.#video.muted = true;
      this.#video.setAttribute?.('playsinline', '');
      await this.#video.play?.();
    } catch (err) {
      stopTracks(stream);
      this.#stream = null;
      this.#setStatus('error', err instanceof Error ? err : new Error(String(err)));
      return;
    }

    this.#setStatus('scanning');
    this.#scheduleScan();
  }

  /**
   * Stop scanning and release the camera. Safe in any state.
   * @returns {Promise<void>}
   */
  async stop() {
    this.#clearTimer();
    stopTracks(this.#stream);
    this.#stream = null;
    if (this.#video) {
      try {
        this.#video.pause?.();
        this.#video.srcObject = null;
      } catch {
        // ignore: releasing the element is best-effort
      }
    }
    this.#detector = null;
    if (this.#status !== 'idle') this.#setStatus('idle');
  }

  // -------------------------------------------------------------- scanning

  #scheduleScan() {
    this.#timer = this.#opts.setTimeout(() => this.#scanOnce(), this.#opts.scanIntervalMs);
  }

  #clearTimer() {
    if (this.#timer !== null) {
      this.#opts.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  async #scanOnce() {
    this.#timer = null;
    if (this.#status !== 'scanning') return;
    try {
      // Nothing to decode until the camera has delivered a frame; asking
      // earlier throws on some browsers and wastes a decode on others.
      if (!frameReady(this.#video)) {
        this.#scheduleScan();
        return;
      }
      const codes = await this.#detector.detect(this.#video);
      for (const code of codes ?? []) {
        if (this.#status !== 'scanning') return;
        this.handleScan(code.rawValue);
      }
    } catch (err) {
      // A single failed frame (e.g. video not ready yet) is not fatal.
      if (err?.name === 'InvalidStateError') {
        // expected before the first frame is available
      } else {
        this.#setStatus('error', err instanceof Error ? err : new Error(String(err)));
        stopTracks(this.#stream);
        this.#stream = null;
        return;
      }
    }
    if (this.#status === 'scanning') this.#scheduleScan();
  }

  /**
   * Process the text of a decoded code. Public so a UI can also accept a
   * pasted/typed payload or a scan from another source. Emits a pose when the
   * code names an anchor of this venue.
   *
   * @param {string} text
   * @returns {'accepted' | 'unrecognised' | 'wrong-venue' | 'unknown-anchor' | 'repeat'}
   */
  handleScan(text) {
    const emitScan = (result, extra = {}) => {
      const event = { text, result, ...extra };
      for (const l of this.#scanListeners) l(event);
      return result;
    };

    // A pre-printed sticker registered in admin mode: its own text names the marker.
    const registered = this.#opts.venue.anchorByCode?.(text);
    const parsed = registered
      ? { venueId: this.#opts.venue.id, anchorId: registered.id }
      : parseQrPayload(text);

    if (!parsed) return emitScan('unrecognised');
    const { venueId, anchorId } = parsed;
    if (venueId !== this.#opts.venue.id) return emitScan('wrong-venue', { venueId, anchorId });

    const anchor = this.#opts.venue.anchorById(anchorId);
    if (!anchor) return emitScan('unknown-anchor', { venueId, anchorId });

    const now = this.#opts.now();
    if (text === this.#lastText && now - this.#lastAt < this.#opts.repeatSuppressMs) {
      return emitScan('repeat', { venueId, anchorId });
    }
    this.#lastText = text;
    this.#lastAt = now;

    this.emitPose({
      x: anchor.x,
      y: anchor.y,
      z: anchor.z ?? 0,
      floor: anchor.floor,
      heading: anchor.heading ?? 0,
      confidence: 1,
      timestamp: now,
    });
    return emitScan('accepted', { venueId, anchorId });
  }
}

/**
 * A sharp, well-lit frame is what decodes: ask for 720p-class frames from
 * the rear camera (the default 640×480 makes a 4 cm sticker a smear at arm's
 * length) and continuous autofocus where the platform exposes it.
 */
export const CAMERA_CONSTRAINTS = Object.freeze({
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    // Chrome/Android honour focusMode here; other browsers ignore unknown keys.
    advanced: [{ focusMode: 'continuous' }],
  },
  audio: false,
});

/**
 * What to ask for if {@link CAMERA_CONSTRAINTS} is rejected outright
 * (`OverconstrainedError`) — the plainest possible request for the rear
 * camera, nothing the device could reasonably refuse. No resolution or
 * focus preference, just a usable stream to decode from.
 */
export const FALLBACK_CAMERA_CONSTRAINTS = Object.freeze({
  video: { facingMode: 'environment' },
  audio: false,
});

/**
 * Turn continuous autofocus on for the video track when the camera supports
 * it (Android Chrome exposes `focusMode`; iOS autofocuses regardless and
 * exposes nothing). Best-effort: a refusal changes nothing.
 * @param {MediaStream} stream
 */
export async function requestContinuousFocus(stream) {
  const [track] = stream?.getVideoTracks?.() ?? [];
  if (!track?.applyConstraints) return false;
  try {
    const caps = track.getCapabilities?.() ?? {};
    if (!caps.focusMode?.includes?.('continuous')) return false;
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Which BarcodeDetector to decode with. An explicit class (tests, or a
 * caller that knows better) is used as given. Otherwise the browser's own
 * is preferred when it says it can read QR codes — some Android builds
 * expose the API but support no formats, and then detect() finds nothing
 * forever — and the bundled ZXing ponyfill is the fallback everywhere else
 * (iOS Safari has no BarcodeDetector at all).
 * @param {Function | null | undefined} explicit
 * @param {Function | undefined} [native]
 */
export async function chooseDetector(explicit, native = globalThis.BarcodeDetector) {
  if (typeof explicit === 'function') return explicit;
  if (typeof native === 'function') {
    try {
      const formats = await native.getSupportedFormats?.();
      if (Array.isArray(formats) && formats.includes('qr_code')) return native;
    } catch {
      // fall through to the ponyfill
    }
  }
  return PonyfillBarcodeDetector;
}

/** Whether a video element has decoded at least one frame. */
function frameReady(video) {
  if (!video) return false;
  if (typeof video.readyState === 'number' && video.readyState < 2) return false; // < HAVE_CURRENT_DATA
  if (typeof video.videoWidth === 'number' && video.videoWidth === 0) return false;
  return true;
}

/** Map a getUserMedia rejection to a status. */
function classifyCameraError(err) {
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

function stopTracks(stream) {
  if (!stream?.getTracks) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // best-effort
    }
  }
}
