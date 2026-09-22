/**
 * Scan overlay — what makes the camera view feel like it's actually doing
 * something, on top of the phone's own "camera is on" light:
 *
 *  - a viewfinder frame, the familiar "line the code up here" square every
 *    QR scanner shows, that flashes green the instant a frame decodes
 *    *anything* (recognised or not — this is proof of "the camera is
 *    reading codes", separate from whether that code was useful);
 *  - a "Recording" badge with the live distance walked since the route's
 *    start scan, while the route wizard has a leg in progress, answering
 *    "is it tracking my movement" without switching to the floor plan.
 *
 * Pure UI: nothing here decides what counts as a scan or a step; it only
 * reacts to being told.
 */

import { t } from './strings/index.js';
import { ensureStyle } from './tokens.js';

const CSS = `
.scan-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 5; }
.scan-frame { width: min(62vw, 62vh); aspect-ratio: 1; box-sizing: border-box; border: 3px solid var(--color-accent); border-radius: 20px;
  opacity: 0.85; transition: border-color 150ms ease, box-shadow 150ms ease; }
.scan-frame[hidden] { display: none; }
.scan-frame.flash { border-color: var(--color-ok); box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-ok) 30%, transparent); }
.scan-badge { position: absolute; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px;
  background: rgba(0, 0, 0, 0.6); color: #fff; font-weight: 600; font-size: 0.95em; white-space: nowrap; }
.scan-badge[hidden] { display: none; }
.scan-badge-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--color-poi); animation: scan-badge-pulse 1.1s ease-in-out infinite; }
@keyframes scan-badge-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .scan-badge-dot { animation: none; } }
`;

export class ScanOverlay {
  #doc;
  #opts;
  #el;
  #frame;
  #badge;
  #badgeText;
  #flashTimer = null;

  /**
   * @param {Object} options
   * @param {HTMLElement} options.mount   The AR view element.
   * @param {Document} [options.document]
   * @param {typeof setTimeout} [options.setTimeout]
   * @param {typeof clearTimeout} [options.clearTimeout]
   */
  constructor(options) {
    if (!options?.mount) throw new TypeError('ScanOverlay requires a mount element');
    this.#doc = options.document ?? globalThis.document;
    this.#opts = {
      setTimeout: (...a) => globalThis.setTimeout(...a),
      clearTimeout: (...a) => globalThis.clearTimeout(...a),
      ...options,
    };
    ensureStyle('brains-scan-overlay-style', CSS, this.#doc);
    const el = this.#doc.createElement('div');
    el.className = 'scan-overlay';
    el.setAttribute('aria-hidden', 'true'); // decorative; the HUD's live region carries the real announcements
    el.innerHTML = `
      <div class="scan-frame" data-f="frame" hidden></div>
      <div class="scan-badge" data-f="badge" hidden><span class="scan-badge-dot"></span><span data-f="badge-text"></span></div>
    `;
    this.#el = el;
    this.#frame = el.querySelector('[data-f="frame"]');
    this.#badge = el.querySelector('[data-f="badge"]');
    this.#badgeText = el.querySelector('[data-f="badge-text"]');
    options.mount.appendChild(el);
  }

  get el() {
    return this.#el;
  }

  /** Show or hide the viewfinder frame (only meaningful while a QR-capable provider is active). */
  setViewfinderVisible(visible) {
    this.#frame.hidden = !visible;
  }

  /**
   * A frame decoded something — recognised, unrecognised, repeat, doesn't
   * matter. Briefly highlights the frame green so it's obvious the camera
   * is reading codes even when nothing useful comes of a particular one.
   */
  flash() {
    if (this.#frame.hidden) return;
    this.#frame.classList.add('flash');
    this.#opts.clearTimeout(this.#flashTimer);
    this.#flashTimer = this.#opts.setTimeout(() => this.#frame.classList.remove('flash'), 220);
  }

  /**
   * The route wizard has (or hasn't) a leg in progress.
   * @param {boolean} active
   * @param {number} [distanceM]
   */
  setRecording(active, distanceM = 0) {
    this.#badge.hidden = !active;
    if (active)
      this.#badgeText.textContent = t('scan.recording', { distance: Math.round(distanceM) });
  }

  destroy() {
    this.#opts.clearTimeout(this.#flashTimer);
    this.#el.remove();
  }
}

/** @param {ConstructorParameters<typeof ScanOverlay>[0]} options */
export function createScanOverlay(options) {
  return new ScanOverlay(options);
}
