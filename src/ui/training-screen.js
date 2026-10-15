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
.train-tools { display: inline-flex; gap: 8px; }
.train-exit, .train-torch { min-height: 40px; padding: 4px 14px; }
.train-torch[hidden] { display: none; }
.train-scan { margin: 0 0 10px; padding: 8px 12px; border-radius: 8px; font-weight: 700; border: 2px solid var(--color-text-muted); }
.train-scan[hidden] { display: none; }
.train-scan[data-verdict='match'] { border-color: var(--color-ok); }
.train-scan[data-verdict='check'] { border-color: var(--color-poi); }
.train-scan[data-verdict='impossible'] { border-color: var(--color-error); color: var(--color-error); }
.train-torch[aria-pressed='true'], .train-sound[aria-pressed='true'] { background: var(--color-accent); color: var(--color-accent-contrast); }
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
.train-transfer { margin: 6px 0 10px; padding: 10px 12px; border: 2px solid var(--color-accent); border-radius: 8px; }
.train-transfer[hidden] { display: none; }
.train-transfer p { margin: 0 0 8px; font-weight: 700; }
.train-kinds, .train-floors { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; }
.train-kinds .btn, .train-floors .btn { flex: 1 1 40%; min-height: 56px; font-size: 1.1em; font-weight: 700; }
.train-kinds .btn[aria-pressed='true'] { background: var(--color-accent); color: var(--color-accent-contrast); }
.train-link[hidden], .train-result[hidden], .train-main[hidden] { display: none; }
.train-result p { font-size: 1.2em; font-weight: 700; margin: 4px 0 10px; }
.train-result .btn { width: 100%; min-height: 64px; font-size: 1.2em; margin-top: 8px; }
.train-result .btn[hidden] { display: none; }
.train-quality { margin: 4px 0; padding: 8px 12px; border-radius: 8px; font-weight: 700; border: 2px solid var(--color-text-muted); }
.train-quality[data-verdict='good'] { border-color: var(--color-ok); }
.train-quality[data-verdict='ok'] { border-color: var(--color-poi); }
.train-quality[data-verdict='check'] { border-color: var(--color-error); color: var(--color-error); }
.train-quality:empty, .train-quality-note:empty { display: none; }
.train-quality-note { margin: 4px 0; font-size: 0.95em; color: var(--color-text-muted); }
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
 * @property {{ readonly supported: boolean, readonly on: boolean, set: (on: boolean) => Promise<boolean> } | null} [torch]
 *   The camera light, for reading a code in a dim corridor. The button only
 *   appears when the camera has one (Android Chrome; not iOS Safari).
 * @property {{ enabled: boolean, supported: boolean, setEnabled: (on: boolean) => boolean, unlock: () => void, play: (name: string) => boolean } | null} [cues]
 *   Sounds for what just happened; the screen has the on/off switch and plays "saved".
 * @property {() => Array<{ index: number, name: string }>} [floors]  The venue's floors, for "Changed floor?".
 * @property {() => number} [getFloor]  The floor the position is on now.
 * @property {(pick: { floor: number, kind: 'lift' | 'stairs' }) => void} [onFloorPick]  Staff said which floor they are on, and how they got there.
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
  /** The latest marker check shown, and when (it fades after a few seconds). */
  #scanNote = null;
  /** The open "which floor are you on?" question: what was detected (or null for a manual one). */
  #transfer = null;
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
      torch: null,
      cues: null,
      floors: () => [],
      getFloor: () => 0,
      onFloorPick: () => {},
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
        <span class="train-tools">
          <button type="button" class="btn train-torch" data-f="sound" aria-pressed="false" hidden></button>
          <button type="button" class="btn train-torch" data-f="torch" aria-pressed="false" hidden></button>
          <button type="button" class="btn train-exit" data-f="exit"></button>
        </span>
      </div>
      <div class="train-count" data-f="count" aria-hidden="true">0</div>
      <div class="train-unit" data-f="unit"></div>
      <p class="train-sub" data-f="sub" role="status"></p>
      <p class="train-banner" data-f="banner" role="status" aria-live="polite"></p>
      <p class="train-scan" data-f="scan-note" role="status" aria-live="polite" hidden></p>
      <button type="button" class="btn btn-primary train-main" data-f="main"></button>
      <button type="button" class="train-link" data-f="alt"></button>
      <button type="button" class="train-link" data-f="undo-last" hidden></button>
      <button type="button" class="train-link" data-f="floor-link" hidden></button>
      <div class="train-transfer" data-f="transfer" role="group" hidden>
        <p data-f="transfer-text"></p>
        <div class="train-kinds" data-f="kinds">
          <button type="button" class="btn" data-f="kind-lift"></button>
          <button type="button" class="btn" data-f="kind-stairs"></button>
        </div>
        <div class="train-floors" data-f="floors"></div>
        <button type="button" class="train-link" data-f="transfer-cancel"></button>
      </div>
      <div class="train-result" data-f="result" hidden>
        <p data-f="result-text" role="status"></p>
        <p class="train-quality" data-f="quality" role="status"></p>
        <p class="train-quality-note" data-f="quality-note"></p>
        <button type="button" class="btn btn-primary" data-f="rewalk"></button>
        <button type="button" class="btn btn-primary" data-f="next"></button>
        <button type="button" class="btn" data-f="done"></button>
        <button type="button" class="train-link" data-f="undo"></button>
      </div>
    `;
    this.#el = el;
    this.#f = (n) => el.querySelector(`[data-f="${n}"]`);
    this.#f('unit').textContent = t('train.unit');
    this.#f('exit').textContent = t('train.exit');
    this.#f('sound').classList.add('train-sound');
    this.#f('next').textContent = t('train.next');
    this.#f('rewalk').textContent = t('train.rewalk');
    this.#f('rewalk').addEventListener('click', () => this.#o.wizard.rewalk());
    this.#f('floor-link').textContent = t('train.floorLink');
    this.#f('kind-lift').textContent = t('train.kind.lift');
    this.#f('kind-stairs').textContent = t('train.kind.stairs');
    this.#f('transfer-cancel').textContent = t('train.transfer.cancel');
    this.#f('floor-link').addEventListener('click', () => this.offerFloorChange(null));
    this.#f('transfer-cancel').addEventListener('click', () => this.#closeTransfer());
    this.#f('kind-lift').addEventListener('click', () => this.#setKind('lift'));
    this.#f('kind-stairs').addEventListener('click', () => this.#setKind('stairs'));
    this.#f('undo').textContent = t('train.undo');
    this.#f('undo-last').textContent = t('train.undoLast');
    this.#f('undo').addEventListener('click', () => this.#o.wizard.undoLastRoute());
    this.#f('undo-last').addEventListener('click', () => this.#o.wizard.undoLastRoute());
    this.#f('sound').addEventListener('click', () => {
      const cues = this.#o.cues;
      if (!cues) return;
      cues.unlock(); // a tap is the gesture the browser needs before it allows sound
      cues.setEnabled(!cues.enabled);
      if (cues.enabled) cues.play('scan'); // so the choice is audible straight away
      this.#refresh();
    });
    this.#f('torch').addEventListener('click', async () => {
      await this.#o.torch?.set(!this.#o.torch.on);
      this.#refresh();
    });
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
    if (this.#o.torch?.on) void this.#o.torch.set(false);
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

  /**
   * Show how the marker just scanned fitted the walk (see core/scan-check.js).
   * Quietly ignores verdicts there is nothing to say about.
   * @param {{ verdict: string, jumpM?: number | null, apartM?: number | null }} result
   */
  showScanCheck(result) {
    if (!['match', 'check', 'impossible'].includes(result?.verdict)) return;
    this.#scanNote = { ...result, at: this.#o.now() };
    this.#refresh();
  }

  /**
   * Ask which floor the walker is now on. Called when a lift ride or a climb
   * of stairs is noticed (with what was seen), or from the "Changed floor?"
   * link (nothing detected: they say how they got there).
   * @param {{ kind: 'lift' | 'stairs', direction?: 'up' | 'down' } | null} seen
   */
  offerFloorChange(seen) {
    if (!this.#open || this.#mode !== 'recording') return;
    const others = this.#o.floors().filter((f) => f.index !== this.#o.getFloor());
    if (others.length === 0) return; // a one-floor venue has nowhere to go
    this.#transfer = {
      kind: seen?.kind ?? 'lift',
      direction: seen?.direction ?? null,
      seen: Boolean(seen),
    };
    this.#renderTransfer();
  }

  #setKind(kind) {
    if (!this.#transfer) return;
    this.#transfer.kind = kind;
    this.#renderTransfer();
  }

  #closeTransfer() {
    this.#transfer = null;
    this.#f('transfer').hidden = true;
  }

  #renderTransfer() {
    const tr = this.#transfer;
    const box = this.#f('transfer');
    if (!tr) {
      box.hidden = true;
      return;
    }
    const key = tr.seen
      ? tr.kind === 'lift'
        ? tr.direction === 'down'
          ? 'train.transfer.liftDown'
          : tr.direction === 'up'
            ? 'train.transfer.liftUp'
            : 'train.transfer.lift'
        : 'train.transfer.stairs'
      : 'train.transfer.manual';
    this.#f('transfer-text').textContent = t(key);
    for (const kind of ['lift', 'stairs']) {
      this.#f(`kind-${kind}`).setAttribute('aria-pressed', String(tr.kind === kind));
    }
    const here = this.#o.getFloor();
    const floors = this.#f('floors');
    floors.textContent = '';
    for (const fl of this.#o.floors().filter((f) => f.index !== here)) {
      const b = this.#doc.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      // Going up in a lift: the floors above are the likely answer.
      const likely =
        (tr.direction === 'up' && fl.index > here) || (tr.direction === 'down' && fl.index < here);
      if (likely) b.classList.add('btn-primary');
      b.textContent = fl.name;
      b.addEventListener('click', () => {
        const kind = this.#transfer?.kind ?? 'lift';
        this.#closeTransfer();
        this.#o.onFloorPick({ floor: fl.index, kind });
      });
      floors.appendChild(b);
    }
    box.hidden = false;
  }

  #onWizardStep(step) {
    const now = this.#o.now();
    // A scan (or stopping) is over: the light would only drain the battery.
    if (this.#o.torch?.on) void this.#o.torch.set(false);
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
      // A route the quality check flagged is not a cheerful moment.
      this.#o.cues?.play(this.#o.wizard.route?.quality?.verdict === 'check' ? 'warn' : 'saved');
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

  /**
   * How well the route held together, in words: the drift against a marker the
   * venue already knew, and what it means for the stride.
   * @param {{ verdict: string, driftM?: number, legM?: number, scale?: number | null, corrected?: boolean } | null} q
   */
  #showQuality(q) {
    const el = this.#f('quality');
    const note = this.#f('quality-note');
    const verdict = q?.verdict ?? 'unchecked';
    el.dataset.verdict = verdict;
    el.textContent = t(q?.loop ? `train.quality.loop.${verdict}` : `train.quality.${verdict}`, {
      drift: q?.driftM ?? 0,
      len: Math.round(q?.legM ?? 0),
    });
    // Steps consistently off the true distance: say which way, so the stride can be set.
    const off =
      q?.scale && Math.abs(1 - q.scale) >= 0.05 ? Math.round(Math.abs(1 - q.scale) * 100) : 0;
    note.textContent = q?.retraced
      ? t('train.quality.retraced')
      : off
        ? t(q.scale > 1 ? 'train.quality.short' : 'train.quality.long', { pct: off })
        : '';
    this.#f('rewalk').hidden = verdict !== 'check';
    this.#f('next').classList.toggle('btn-primary', verdict !== 'check');
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

    const note = this.#scanNote;
    if (note && this.#o.now() - note.at > 8000) this.#scanNote = null;
    const noteEl = this.#f('scan-note');
    noteEl.hidden = !this.#scanNote;
    if (this.#scanNote) {
      noteEl.dataset.verdict = this.#scanNote.verdict;
      noteEl.textContent = t(`train.scan.${this.#scanNote.verdict}`, {
        jump: this.#scanNote.jumpM ?? 0,
        apart: Math.round(this.#scanNote.apartM ?? 0),
      });
    }

    const cues = this.#o.cues;
    const soundEl = this.#f('sound');
    soundEl.hidden = !cues?.supported;
    soundEl.textContent = t(cues?.enabled ? 'train.sound.on' : 'train.sound.off');
    soundEl.setAttribute('aria-pressed', String(Boolean(cues?.enabled)));

    if (mode !== 'recording' && this.#transfer) this.#closeTransfer();
    this.#f('floor-link').hidden = !(mode === 'recording' && this.#o.floors().length > 1);

    const torch = this.#o.torch;
    const torchEl = this.#f('torch');
    torchEl.hidden = !torch?.supported;
    torchEl.textContent = t(torch?.on ? 'train.torch.on' : 'train.torch.off');
    torchEl.setAttribute('aria-pressed', String(Boolean(torch?.on)));

    const recording = mode === 'recording';
    const result = mode === 'result';
    this.#f('undo-last').hidden = mode !== 'idle' || !this.#o.wizard.canUndo;
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
      this.#showQuality(route?.quality ?? null);
    }
  }
}

/** @param {TrainingOptions} options */
export function createTrainingScreen(options) {
  return new TrainingScreen(options);
}
