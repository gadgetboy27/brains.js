/**
 * Camera backdrop — the live camera feed behind the transparent WebGL canvas.
 *
 * This is what turns the 3-D scene into "AR": a full-bleed <video> under the
 * canvas, both inside the AR view. Not an <iframe> — a frame cannot share a
 * camera stream, permissions or a coordinate frame with the page.
 *
 * Three sources, in order of preference:
 *  1. the active provider's own video (QrProvider exposes `video`) — no
 *     second camera stream is opened;
 *  2. a provider that mounts its own camera element into the AR view
 *     (ImmersalProvider's SDK does) — nothing to do, just don't cover it;
 *  3. a preview stream this module opens itself (`getUserMedia`), used with
 *     the mock provider so a development walk looks like the real thing.
 *
 * Every browser API is injectable; nothing here positions anything.
 */

import { ensureStyle } from './tokens.js';

const CSS = `
.camera-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: #000; z-index: 0; }
.camera-backdrop[hidden] { display: none; }
`;

export class CameraBackdrop {
  #doc;
  #mount;
  #video;
  #ownStream = null;
  #opts;
  #source = 'none';

  /**
   * @param {Object} options
   * @param {HTMLElement} options.mount      The AR view element; the canvas must come after the video.
   * @param {Document} [options.document]
   * @param {(constraints: MediaStreamConstraints) => Promise<MediaStream>} [options.getUserMedia]
   */
  constructor(options) {
    if (!options?.mount) throw new TypeError('CameraBackdrop requires a mount element');
    this.#doc = options.document ?? globalThis.document;
    this.#mount = options.mount;
    this.#opts = {
      getUserMedia: (c) => globalThis.navigator?.mediaDevices?.getUserMedia?.(c),
      ...options,
    };
    ensureStyle('brains-camera-backdrop-style', CSS, this.#doc);
    this.#video = this.#doc.createElement('video');
    this.#video.className = 'camera-backdrop';
    this.#video.muted = true;
    this.#video.setAttribute('playsinline', '');
    this.#video.setAttribute('aria-hidden', 'true');
    this.#video.hidden = true;
    this.#mount.insertBefore(this.#video, this.#mount.firstChild);
    // Make sure the mount stacks its children (canvas above video).
    if (this.#mount.style && !this.#mount.style.position) this.#mount.style.position = 'absolute';
  }

  get video() {
    return this.#video;
  }

  /** 'provider' | 'preview' | 'external' | 'none' */
  get source() {
    return this.#source;
  }

  /**
   * Show the camera for the given active provider.
   * @param {object | null} provider
   * @returns {Promise<'provider' | 'preview' | 'external' | 'none'>}
   */
  async attach(provider) {
    this.#stopOwn();
    const stream = provider?.video?.srcObject;
    if (stream) {
      this.#video.srcObject = stream;
      this.#source = 'provider';
    } else if (provider?.constructor?.name === 'ImmersalProvider' || provider?.mountsOwnCamera) {
      // The SDK manages its own camera element inside the AR view.
      this.#video.hidden = true;
      this.#source = 'external';
      return this.#source;
    } else {
      try {
        const own = await this.#opts.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (!own) throw new Error('no stream');
        this.#ownStream = own;
        this.#video.srcObject = own;
        this.#source = 'preview';
      } catch {
        this.#video.hidden = true;
        this.#source = 'none';
        return this.#source;
      }
    }
    this.#video.hidden = false;
    try {
      await this.#video.play?.();
    } catch {
      // autoplay may need a gesture; the stream still shows on the next play
    }
    return this.#source;
  }

  /** Hide the feed (e.g. when the floor plan is showing) and release any preview stream. */
  detach() {
    this.#stopOwn();
    this.#video.srcObject = null;
    this.#video.hidden = true;
    this.#source = 'none';
  }

  #stopOwn() {
    if (this.#ownStream) {
      for (const t of this.#ownStream.getTracks?.() ?? []) t.stop();
      this.#ownStream = null;
    }
  }

  destroy() {
    this.detach();
    this.#video.remove();
  }
}

/** @param {ConstructorParameters<typeof CameraBackdrop>[0]} options */
export function createCameraBackdrop(options) {
  return new CameraBackdrop(options);
}
