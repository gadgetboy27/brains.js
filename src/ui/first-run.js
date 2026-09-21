/**
 * First-run screen — asks for camera and motion permission with a plain
 * explanation of why, what leaves the phone (taken from the providers' own
 * `uploads` declarations), and what is never collected. Shown before
 * positioning starts on a device where permission has not yet been granted.
 *
 * On iOS, `DeviceMotionEvent.requestPermission()` must be called from a user
 * gesture, so the "Allow" button is where both permissions are requested; the
 * camera is opened once (and released) so the browser's prompt appears here
 * rather than later, mid-navigation.
 *
 * "Use the floor plan only" is a first-class choice, not a failure.
 */

import { t } from './strings/index.js';
import { ensureStyle } from './tokens.js';

const CSS = `
.firstrun { position: fixed; inset: 0; z-index: 40; overflow: auto; padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
  box-sizing: border-box; background: var(--color-bg); color: var(--color-text); font-family: var(--font); font-size: var(--font-size); }
.firstrun[hidden] { display: none; }
.firstrun h1 { margin: 0 0 8px; font-size: var(--font-size-large); }
.firstrun h2 { margin: 16px 0 4px; font-size: 1em; color: var(--color-accent); }
.firstrun p, .firstrun li { margin: 0 0 6px; line-height: 1.45; }
.firstrun a { color: var(--color-accent); }
.firstrun ul { margin: 0; padding-left: 20px; }
.firstrun-actions { display: grid; gap: 10px; margin-top: 20px; }
.firstrun-status { min-height: 1.5em; color: var(--color-text-muted); }
`;

const STORAGE_KEY = 'brains:permissions';

export class FirstRun {
  #doc;
  #el;
  #f;
  #opts;

  /**
   * @param {Object} options
   * @param {string} options.venueName
   * @param {Array<{ provider: string, data: string, destination: string, purpose: string }>} options.uploads
   * @param {(result: { camera: boolean, motion: boolean }) => void} options.onContinue
   * @param {HTMLElement} [options.mount]
   * @param {Document} [options.document]
   * @param {Storage | null} [options.storage]
   * @param {() => Promise<'granted' | 'denied' | 'prompt'>} [options.requestMotion]   iOS-style motion permission.
   * @param {() => Promise<boolean>} [options.warmCamera]   Opens and releases the camera to trigger the prompt.
   * @param {string} [options.privacyUrl='/PRIVACY.md']
   */
  constructor(options) {
    if (typeof options?.onContinue !== 'function')
      throw new TypeError('FirstRun requires onContinue');
    this.#doc = options.document ?? globalThis.document;
    if (!this.#doc) throw new TypeError('FirstRun requires a document');
    this.#opts = {
      storage: safeStorage(),
      requestMotion: defaultRequestMotion,
      warmCamera: defaultWarmCamera,
      privacyUrl: '/PRIVACY.md',
      uploads: [],
      ...options,
    };
    ensureStyle('brains-firstrun-style', CSS, this.#doc);

    const el = this.#doc.createElement('section');
    el.className = 'firstrun';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'firstrun-title');
    el.innerHTML = `
      <h1 id="firstrun-title" data-f="title"></h1>
      <p data-f="intro"></p>
      <h2 data-f="camera-title"></h2><p data-f="camera-why"></p>
      <h2 data-f="motion-title"></h2><p data-f="motion-why"></p>
      <h2 data-f="data-title"></h2><ul data-f="data"></ul>
      <h2 data-f="never-title"></h2><p data-f="never-body"></p>
      <p><a data-f="privacy" target="_blank" rel="noopener"></a></p>
      <div class="firstrun-actions">
        <button type="button" class="btn btn-primary" data-f="allow"></button>
        <button type="button" class="btn" data-f="floorplan"></button>
      </div>
      <p class="firstrun-status" data-f="status" role="status" aria-live="polite"></p>
    `;
    this.#el = el;
    this.#f = (n) => el.querySelector(`[data-f="${n}"]`);
    (options.mount ?? this.#doc.body).appendChild(el);

    this.#f('title').textContent = t('firstRun.title');
    this.#f('intro').textContent = t('firstRun.intro', { venue: options.venueName });
    this.#f('camera-title').textContent = t('firstRun.camera.title');
    this.#f('camera-why').textContent = t('firstRun.camera.why');
    this.#f('motion-title').textContent = t('firstRun.motion.title');
    this.#f('motion-why').textContent = t('firstRun.motion.why');
    this.#f('data-title').textContent = t('firstRun.data.title');
    this.#f('never-title').textContent = t('firstRun.never.title');
    this.#f('never-body').textContent = t('firstRun.never.body');
    this.#f('privacy').textContent = t('firstRun.privacyLink');
    this.#f('privacy').href = this.#opts.privacyUrl;
    this.#f('allow').textContent = t('firstRun.allow');
    this.#f('floorplan').textContent = t('firstRun.floorplanOnly');

    const list = this.#f('data');
    const uploads = this.#opts.uploads;
    if (uploads.length === 0) {
      const li = this.#doc.createElement('li');
      li.textContent = t('firstRun.data.none');
      list.appendChild(li);
    } else {
      for (const u of uploads) {
        const li = this.#doc.createElement('li');
        li.textContent = t('firstRun.data.item', {
          data: u.data,
          destination: u.destination,
          purpose: u.purpose,
        });
        list.appendChild(li);
      }
    }

    this.#f('allow').addEventListener('click', () => this.#allow());
    this.#f('floorplan').addEventListener('click', () =>
      this.#finish({ camera: false, motion: false })
    );
    this.#f('allow').focus?.();
  }

  get el() {
    return this.#el;
  }

  async #allow() {
    const allow = this.#f('allow');
    allow.disabled = true;
    this.#f('status').textContent = t('firstRun.requesting');
    let motion;
    let camera;
    try {
      motion = (await this.#opts.requestMotion()) !== 'denied';
    } catch {
      motion = false;
    }
    try {
      camera = await this.#opts.warmCamera();
    } catch {
      camera = false;
    }
    this.#f('status').textContent = motion ? '' : t('firstRun.motionDenied');
    if (camera) {
      try {
        this.#opts.storage?.setItem(STORAGE_KEY, 'granted');
      } catch {
        // storage may be unavailable
      }
    }
    this.#finish({ camera, motion });
  }

  #finish(result) {
    this.#el.hidden = true;
    this.#opts.onContinue(result);
  }

  destroy() {
    this.#el.remove();
  }
}

/** Whether the first-run screen should be shown. */
export async function needsFirstRun({
  storage = safeStorage(),
  permissions = globalThis.navigator?.permissions,
} = {}) {
  try {
    if (storage?.getItem(STORAGE_KEY) === 'granted') return false;
  } catch {
    // ignore
  }
  try {
    const status = await permissions?.query?.({ name: 'camera' });
    if (status?.state === 'granted') return false;
  } catch {
    // camera permission query unsupported: ask
  }
  return true;
}

async function defaultRequestMotion() {
  const M = globalThis.DeviceMotionEvent;
  const O = globalThis.DeviceOrientationEvent;
  const results = [];
  for (const E of [M, O]) {
    if (typeof E?.requestPermission === 'function') results.push(await E.requestPermission());
  }
  if (results.length === 0) return 'granted'; // not gated on this platform
  return results.every((r) => r === 'granted') ? 'granted' : 'denied';
}

async function defaultWarmCamera() {
  const md = globalThis.navigator?.mediaDevices;
  if (!md?.getUserMedia) return false;
  const stream = await md.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  for (const track of stream.getTracks()) track.stop();
  return true;
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** @param {ConstructorParameters<typeof FirstRun>[0]} options */
export function createFirstRun(options) {
  return new FirstRun(options);
}
