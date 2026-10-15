/**
 * Training screen — recording routes with almost nothing on screen.
 *
 * The whole job is: stand at a QR code and press START HERE (the camera
 * reads it), walk, and press STOP HERE at the next code. Names, route points,
 * corners, floor changes and saving all happen behind the scenes in the
 * {@link RouteWizard}; this screen only drives it and shows what the phone is
 * doing, large enough to read at a glance while walking:
 *
 *  - a huge live **step counter**, which ticks (and buzzes) on every step, so
 *    "is it tracking me right now?" is never in doubt;
 *  - one big button that is START HERE, then STOP HERE;
 *  - one line saying whether to carry on, scan soon, or fix something
 *    (no steps detected, position uncertain, paused);
 *  - after STOP HERE, a short result and "Walk on from here" / "Finished".
 *
 * The screen is kept awake (Screen Wake Lock) while open, because a phone
 * that sleeps mid-walk stops counting steps.
 *
 * Pure UI over injected parts, so it is testable without a browser: the
 * wizard, a step source, the clock and timers, vibration and the wake lock
 * are all passed in.
 */

import { t } from './strings/index.js';
import { ensureStyle } from './tokens.js';

const CSS = `
.train, .train * { box-sizing: border-box; }
.train { position: fixed; left: 0; right: 0; bottom: var(--hud-h, 0px); z-index: 25; max-height: 70vh; overflow: auto;
  padding: 10px 16px calc(14px + env(safe-area-inset-bottom)); border-radius: var(--radius) var(--radius) 0 0;
  background: var(--color-surface-solid); color: var(--color-text); font-family: var(--font); text-align: center;
  border-top: 3px solid var(--color-accent); box-shadow: 0 -4px 16px rgba(0,0,0,0.45); }
.train[hidden] { display: none; }
.train-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.train-live { display: inline-flex; align-items: center; gap: 8px; font-weight: 800; letter-spacing: 0.08em; font-size: 0.9em; }
.train-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--color-text-muted); }
.train[data-mode='recording'] .train-dot { background: var(--color-poi); animation: train-pulse 1.1s ease-in-out infinite; }
.train[data-warn='true'] .train-dot { background: var(--color-error); }
.train-exit { min-height: 40px; padding: 4px 14px; }
.train-count { font-size: clamp(80px, 26vw, 170px); line-height: 1; font-weight: 900; font-variant-numeric: tabular-nums;
  margin: 2px 0 0; transform-origin: center; }
.train[data-mode='idle'] .train-count { opacity: 0.45; }
.train-count.tick { animation: train-tick 220ms ease-out; }
.train-unit { font-size: 1.1em; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--color-text-muted); }
.train-sub { margin: 6px 0 2px; font-size: 1.15em; font-weight: 700; font-variant-numeric: tabular-nums; }
.train-banner { margin: 6px 0 10px; min-height: 2.6em; font-weight: 600; }
.train[data-warn='true'] .train-banner { color: var(--color-error); }
.train-main { width: 100%; min-height: 76px; font-size: 1.5em; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; }
.train-link { display: block; margin: 10px auto 0; min-height: 44px; padding: 6px 12px; background: none; border: 0; color: var(--color-text);
  font: inherit; text-decoration: underline; cursor: pointer; }
.train-link[hidden], .train-result[hidden], .train-main[hidden] { display: none; }
.train-result p { font-size: 1.2em; font-weight: 700; margin: 4px 0 10px; }
.train-result .btn { width: 100%; min-height: 64px; font-size: 1.2em; margin-top: 8px; }
@keyframes train-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
@keyframes train-tick { 0% { transform: scale(1.12); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .train-dot, .train-count.tick { animation: none; } }
@media (max-height: 520px) { .train-count { font-size: clamp(56px, 18vw, 110px); } .train-banner { min-height: 0; } }
`;

/**
 * @typedef {Object} TrainingOptions
 * @property {import('./route-wizard.js').RouteWizard} wizard
 * @property {HTMLElement} mount
 * @property {Document} [document]
 * @property {{ get: () => number, subscribe: (fn: (steps: number) => void) => (() => void) } | null} [steps]
 *   Live step count since the last exact fix. It falls back to ~0 at every
 *   scan; the screen keeps its own running total across those resets.
 * @property {() => number} [getStrideM]       Metres per step, for the distance figure.
 * @property {() => object | null} [getPose]   Whether a position exists (offers "start where I am").
 * @property {() => void} [onExit]
 * @property {(ms: number) => void} [vibrate]
 * @property {{ request: (type: 'screen') => Promise<{ release: () => Promise<void>, addEventListener?: Function }> } | null} [wakeLock]
 * @property {() => number} [now]
 * @property {typeof setInterval} [setInterval]
 * @property {typeof clearInterval} [clearInterval]
 * @property {number} [noStepsAfterMs=10000]   Warn if no step at all this long into a route.
 * @property {number} [pausedAfterMs=6000]     "Paused" if no step for this long mid-route.
 */

export class TrainingScreen {
  #o;
  #doc;
  #el;
  #f;
  #mode = 'idle';
  #total = 0;
  #lastRaw = 0;
  #lastStepAt = null;
  #modeSince = 0;
  #points = 0;
  #savedSteps = 0;
  #unsubs = [];
  #timer = null;
  #sentinel = null;
  #open = false;

  /** @param {TrainingOptions} options */
  constructor(options) {
    if (!options?.wizard || !options?.mount) {
      throw new TypeError('TrainingScreen needs a wizard and a mount');
    }
    this.#doc = options.document ?? globalThis.document;
    const win = this.#doc?.defaultView;
    this.#o = {
      steps: null,
      getStrideM: () => 0.73,
      getPose: () => null,
      onExit: () => {},
      vibrate: (ms) => globalThis.navigator?.vibrate?.(ms),
      wakeLock: globalThis.navigator?.wakeLock ?? null,
      now: () => Date.now(),
      setInterval: (...a) => (win ?? globalThis).setInterval(...a),
      clearInterval: (...a) => (win ?? globalThis).clearInterval(...a),
      noStepsAfterMs: 10_000,
      pausedAfterMs: 6000,
      ...options,
    };
    ensureStyle('brains-training-style', CSS, this.#doc);
    this.#render();
    this.#el.hidden = true;
  }

  get el() {
    return this.#el;
  }
  /** 'idle' (before START), 'recording' (walking), or 'result' (route saved). */
  get mode() {
    return this.#mode;
  }
  /** Steps counted in the current route (or since the screen opened, when idle). */
  get steps() {
    return this.#total;
  }
  get isOpen() {
    return this.#open;
  }

  // ---------------------------------------------------------------- render

  #render() {
    const el = this.#doc.createElement('section');
    el.className = 'train';
    el.setAttribute('aria-label', t('train.title'));
    el.innerHTML = `
      <div class="train-top">
        <span class="train-live"><i class="train-dot"></i><span data-f="live"></span></span>
        <button type="button" class="btn train-exit" data-f="exit"></button>
      </div>
      <div class="train-count" data-f="count" aria-hidden="true">0</div>
      <div class="train-unit" data-f="unit"></div>
      <p class="train-sub" data-f="sub" role="status"></p>
      <p class="train-banner" data-f="banner" role="status" aria-live="polite"></p>
      <button type="button" class="btn btn-primary train-main" data-f="main"></button>
      <button type="button" class="train-link" data-f="alt"></button>
      <div class="train-result" data-f="result" hidden>
        <p data-f="result-text" role="status"></p>
        <button type="button" class="btn btn-primary" data-f="next"></button>
        <button type="button" class="btn" data-f="done"></button>
      </div>
    `;
    this.#el = el;
    this.#f = (n) => el.querySelector(`[data-f="${n}"]`);
    this.#f('unit').textContent = t('train.unit');
    this.#f('exit').textContent = t('train.exit');
    this.#f('next').textContent = t('train.next');
    this.#f('done').textContent = t('train.done');
    this.#f('exit').addEventListener('click', () => this.close());
    this.#f('main').addEventListener('click', () => this.#o.wizard.scanHere());
    this.#f('alt').addEventListener('click', () => {
      if (this.#mode === 'recording') this.#o.wizard.stopHere();
      else this.#o.wizard.startHere();
    });
    this.#f('next').addEventListener('click', () => this.#o.wizard.nextFromHere());
    this.#f('done').addEventListener('click', () => this.#o.wizard.reset());
    this.#o.mount.appendChild(el);
  }

  // ------------------------------------------------------------- lifecycle

  open() {
    if (this.#open) return;
    this.#open = true;
    this.#el.hidden = false;
    this.#o.wizard.setChain(false); // STOP ends a route; the result asks what next
    this.#total = 0;
    this.#lastRaw = this.#o.steps?.get() ?? 0;
    this.#unsubs.push(this.#o.wizard.onStep((step) => this.#onWizardStep(step)));
    if (this.#o.steps) this.#unsubs.push(this.#o.steps.subscribe((n) => this.#onSteps(n)));
    this.#timer = this.#o.setInterval(() => this.#refresh(), 1000);
    this.#onWizardStep(this.#o.wizard.step);
    void this.#acquireWakeLock();
    this.#doc.addEventListener?.('visibilitychange', this.#onVisibility);
  }

  close() {
    if (!this.#open) return;
    this.#open = false;
    this.#el.hidden = true;
    for (const off of this.#unsubs.splice(0)) off();
    if (this.#timer !== null) this.#o.clearInterval(this.#timer);
    this.#timer = null;
    this.#o.wizard.setChain(true);
    this.#doc.removeEventListener?.('visibilitychange', this.#onVisibility);
    void this.#releaseWakeLock();
    this.#o.onExit();
  }

  destroy() {
    this.close();
    this.#el.remove();
  }

  // ------------------------------------------------------------- wake lock

  #onVisibility = () => {
    // The browser drops the lock when the page is hidden; take it back.
    if (this.#open && this.#doc.visibilityState === 'visible') void this.#acquireWakeLock();
  };

  async #acquireWakeLock() {
    if (!this.#o.wakeLock || this.#sentinel) return;
    try {
      this.#sentinel = await this.#o.wakeLock.request('screen');
      this.#sentinel?.addEventListener?.('release', () => (this.#sentinel = null));
    } catch {
      this.#sentinel = null; // refused (battery saver, unsupported): training still works
    }
  }

  async #releaseWakeLock() {
    const s = this.#sentinel;
    this.#sentinel = null;
    try {
      await s?.release();
    } catch {
      // best-effort
    }
  }

  // ----------------------------------------------------------------- input

  /** The app's final position, for the "position uncertain" line and the start-here offer. */
  onPose() {
    if (this.#open) this.#refresh();
  }

  #onWizardStep(step) {
    const now = this.#o.now();
    if (step === 'walk') {
      if (this.#mode !== 'recording') {
        this.#total = 0; // a route's own steps, from its start scan
        this.#lastRaw = this.#o.steps?.get() ?? 0;
        this.#lastStepAt = null;
        this.#modeSince = now;
      }
      this.#mode = 'recording';
    } else if (step === 'done') {
      this.#savedSteps = this.#total;
      this.#mode = 'result';
    } else if (step === 'finish') {
      this.#mode = 'recording'; // saving: nothing for the user to do
    } else {
      this.#mode = 'idle';
      this.#total = 0;
      this.#lastRaw = this.#o.steps?.get() ?? 0;
      this.#modeSince = now;
    }
    this.#refresh();
  }

  #onSteps(raw) {
    // The source counts since the last exact fix, so it drops back at every
    // scan: add what is new, and after a drop count from zero again.
    const gained = raw >= this.#lastRaw ? raw - this.#lastRaw : raw;
    this.#lastRaw = raw;
    if (gained > 0 && this.#mode !== 'result') {
      this.#total += gained;
      this.#lastStepAt = this.#o.now();
      this.#o.vibrate(8);
      this.#tick();
    }
    this.#refresh();
  }

  #tick() {
    const c = this.#f('count');
    c.classList.remove('tick');
    void c.offsetWidth; // restart the animation
    c.classList.add('tick');
  }

  // ---------------------------------------------------------------- output

  #banner() {
    const w = this.#o.wizard;
    const now = this.#o.now();
    if (this.#mode === 'recording') {
      if (w.uncertain) return { key: 'train.banner.uncertain', warn: true };
      if (!this.#o.steps) return { key: 'train.banner.noSensor', warn: true };
      if (this.#lastStepAt === null) {
        return now - this.#modeSince >= this.#o.noStepsAfterMs
          ? { key: 'train.banner.noSteps', warn: true }
          : { key: 'train.banner.tracking', warn: false };
      }
      if (now - this.#lastStepAt >= this.#o.pausedAfterMs) {
        return { key: 'train.banner.paused', warn: false };
      }
      return { key: 'train.banner.tracking', warn: false };
    }
    if (this.#mode === 'idle') {
      return this.#o.steps
        ? { key: 'train.banner.idle', warn: false }
        : { key: 'train.banner.noSensor', warn: true };
    }
    return { key: 'train.banner.saved', warn: false };
  }

  #refresh() {
    if (!this.#open) return;
    const mode = this.#mode;
    const route = this.#o.wizard.route;
    const stride = this.#o.getStrideM();
    const shown = mode === 'result' ? this.#savedSteps : this.#total;
    const banner = this.#banner();
    this.#el.dataset.mode = mode;
    this.#el.dataset.warn = String(banner.warn);

    this.#f('live').textContent = t(
      mode === 'recording' ? 'train.live.recording' : 'train.live.idle'
    );
    this.#f('count').textContent = this.#o.steps ? String(shown) : '–';
    this.#f('sub').textContent = t('train.sub', {
      metres: Math.round(shown * stride),
      points: route?.nodes ?? this.#points,
    });
    if (route) this.#points = route.nodes;
    this.#f('banner').textContent = t(banner.key);

    const recording = mode === 'recording';
    const result = mode === 'result';
    this.#f('main').hidden = result;
    this.#f('main').textContent = t(recording ? 'train.stop' : 'train.start');
    this.#f('alt').hidden = result || (!recording && !this.#o.getPose());
    this.#f('alt').textContent = t(recording ? 'train.stopNoScan' : 'train.startNoScan');
    this.#f('result').hidden = !result;
    if (result) {
      this.#f('result-text').textContent = t('train.result', {
        metres: Math.round(route?.distance ?? shown * stride),
        steps: this.#savedSteps,
        points: route?.nodes ?? this.#points,
      });
    }
  }
}

/** @param {TrainingOptions} options */
export function createTrainingScreen(options) {
  return new TrainingScreen(options);
}
