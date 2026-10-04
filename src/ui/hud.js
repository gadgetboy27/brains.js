/**
 * HUD — the always-visible strip of navigation state: destination name,
 * distance remaining, next step / floor change, arrival, a rescan prompt when
 * positioning confidence drops, and an inline error surface.
 *
 * This is the app's only way to tell the user something. There is no
 * `alert()` anywhere; errors are rendered here with an optional retry action.
 * All text comes from src/ui/strings.js.
 *
 * Accessibility: the status region is `aria-live="polite"` so changes are
 * announced; the error region is `role="alert"`; buttons meet the 48 px
 * touch-target token.
 */

import { RATES } from './speech.js';
import { formatMetres, t } from './strings/index.js';
import { ensureStyle } from './tokens.js';

const CSS = `
.hud { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: var(--color-surface); color: var(--color-text); font-family: var(--font); font-size: var(--font-size);
  display: grid; gap: 8px; }
.hud[hidden] { display: none; }
.hud-status { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 4px 12px; }
.hud-destination { font-size: var(--font-size-large); font-weight: 700; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud-distance { font-size: var(--font-size-large); font-weight: 700; font-variant-numeric: tabular-nums; }
.hud-step { grid-column: 1 / -1; color: var(--color-text-muted); margin: 0; }
.hud-arrived .hud-destination { color: var(--color-ok); }
.hud-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.hud-rescan { border: 2px solid var(--color-warn); border-radius: var(--radius); padding: 10px 12px; display: grid; gap: 6px; }
.hud-rescan[hidden], .hud-error[hidden], .hud-step[hidden] { display: none; }
.hud-rescan h3, .hud-error h3 { margin: 0; font-size: 1em; }
.hud-rescan p, .hud-error p { margin: 0; }
.hud-error { border: 2px solid var(--color-error); background: var(--color-error-bg); border-radius: var(--radius); padding: 10px 12px; display: grid; gap: 6px; }
.hud-error .hud-actions { margin-top: 4px; }
.hud-notices { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.hud-notices:empty { display: none; }
.hud-notices li { border: 2px solid var(--color-warn); border-radius: var(--radius); padding: 8px 12px; }
.hud.hud-compact .hud-speech, .hud.hud-compact [data-f="nav-actions"] { display: none; }
.hud.hud-compact.hud-nodest .hud-status { display: none; }
.hud.hud-compact [data-notice="landmark"] { display: none; }
.hud.hud-compact .hud-notices { max-height: 7.5em; overflow: auto; }
.hud.hud-compact { padding-top: 8px; padding-bottom: calc(8px + env(safe-area-inset-bottom)); }
.hud-feedback { border: 2px solid var(--color-ok); border-radius: var(--radius); padding: 10px 12px; display: grid; gap: 8px; }
.hud-feedback[hidden], .hud-feedback p[hidden] { display: none; }
.hud-feedback h3, .hud-feedback p { margin: 0; font-size: 1em; }
.hud-check { display: flex; align-items: center; gap: 8px; min-height: var(--touch-target); }
.hud-floors { display: grid; gap: 6px; }
.hud-floors[hidden], .hud-floor-list[hidden] { display: none; }
.hud-floor-list p { margin: 0; }
.hud.hud-compact [data-f="floors"] { display: none; }
.hud-speech { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.hud-speech[hidden] { display: none; }
.hud-speech label { display: inline-flex; align-items: center; gap: 8px; min-height: var(--touch-target); }
.hud-speech select { min-height: var(--touch-target); padding: 6px 10px; border: 2px solid var(--color-accent); border-radius: var(--radius);
  background: var(--color-surface-solid); color: var(--color-text); font: inherit; }
`;

export class Hud {
  #el;
  #doc;
  #f;
  #destination = null;
  #onChangeDestination;
  #onCancel;
  #onToggleMute;
  #onRateChange;
  #onFloorChange;
  #onFeedback;
  #resize = null;
  #feedbackDone = false;
  #errorRetry = null;

  /**
   * @param {Object} options
   * @param {HTMLElement} [options.mount]           Default document.body.
   * @param {Document} [options.document]
   * @param {() => void} [options.onChangeDestination]
   * @param {() => void} [options.onCancel]
   * @param {() => void} [options.onRescanAcknowledged]
   * @param {() => void} [options.onToggleMute]
   * @param {(rate: number) => void} [options.onRateChange]
   * @param {(answers: { accuracy: 'yes' | 'mostly' | 'no', blocked: boolean, wrongFloor: boolean }) => void} [options.onFeedback]  Arrival answers; asked once per destination.
   * @param {(floor: number) => void} [options.onFloorChange]  The user says they took stairs / a lift.
   */
  constructor(options = {}) {
    this.#doc = options.document ?? globalThis.document;
    const mount = options.mount ?? this.#doc?.body;
    if (!this.#doc || !mount) throw new TypeError('Hud requires a document and mount element');
    this.#onChangeDestination = options.onChangeDestination;
    this.#onCancel = options.onCancel;
    this.#onToggleMute = options.onToggleMute;
    this.#onRateChange = options.onRateChange;
    this.#onFloorChange = options.onFloorChange;
    this.#onFeedback = options.onFeedback;

    ensureStyle('brains-hud-style', CSS, this.#doc);
    const el = this.#doc.createElement('section');
    el.className = 'hud';
    el.setAttribute('aria-label', t('app.title'));
    el.innerHTML = `
      <div class="hud-status" aria-live="polite" aria-atomic="true">
        <h2 class="hud-destination" data-f="destination"></h2>
        <span class="hud-distance" data-f="distance"></span>
        <p class="hud-step" data-f="step" hidden></p>
      </div>
      <ul class="hud-notices" data-f="notices" role="status" aria-live="polite"></ul>
      <div class="hud-rescan" data-f="rescan" role="status" hidden>
        <h3 data-f="rescan-title"></h3>
        <p data-f="rescan-body"></p>
        <div class="hud-actions"><button type="button" class="btn" data-f="rescan-ok"></button></div>
      </div>
      <div class="hud-error" data-f="error" role="alert" hidden>
        <p data-f="error-message"></p>
        <p data-f="error-hint" hidden></p>
        <div class="hud-actions">
          <button type="button" class="btn btn-primary" data-f="error-retry" hidden></button>
          <button type="button" class="btn" data-f="error-dismiss"></button>
        </div>
      </div>
      <div class="hud-actions" data-f="nav-actions">
        <button type="button" class="btn btn-primary" data-f="change"></button>
        <button type="button" class="btn" data-f="cancel" hidden></button>
      </div>
      <div class="hud-feedback" data-f="feedback" hidden>
        <h3 data-f="feedback-question"></h3>
        <label class="hud-check"><input type="checkbox" data-f="feedback-blocked" /> <span data-f="feedback-blocked-label"></span></label>
        <label class="hud-check"><input type="checkbox" data-f="feedback-floor" /> <span data-f="feedback-floor-label"></span></label>
        <div class="hud-actions" data-f="feedback-buttons">
          <button type="button" class="btn btn-primary" data-answer="yes"></button>
          <button type="button" class="btn" data-answer="mostly"></button>
          <button type="button" class="btn" data-answer="no"></button>
          <button type="button" class="btn" data-f="feedback-skip"></button>
        </div>
        <p data-f="feedback-thanks" hidden></p>
      </div>
      <div class="hud-floors" data-f="floors" hidden>
        <button type="button" class="btn" data-f="floor-toggle" aria-expanded="false"></button>
        <div class="hud-floor-list" data-f="floor-list" hidden>
          <p data-f="floor-which"></p>
          <div class="hud-actions" data-f="floor-buttons"></div>
        </div>
      </div>
      <div class="hud-speech" data-f="speech">
        <button type="button" class="btn" data-f="mute" aria-pressed="false"></button>
        <label>
          <span data-f="rate-label"></span>
          <select data-f="rate"></select>
        </label>
        <span class="visually-hidden" data-f="speech-unsupported" hidden></span>
      </div>
      <div class="visually-hidden" data-f="live" aria-live="assertive" aria-atomic="true"></div>
    `;
    this.#el = el;
    this.#f = (name) => el.querySelector(`[data-f="${name}"]`);
    mount.appendChild(el);
    // Let other fixed panels (the admin drawer) stop above this strip.
    const root = this.#doc.documentElement;
    const publishHeight = () => root?.style.setProperty('--hud-h', `${el.offsetHeight}px`);
    const RO = this.#doc.defaultView?.ResizeObserver;
    if (RO) {
      this.#resize = new RO(publishHeight);
      this.#resize.observe(el);
    }

    this.#f('rescan-title').textContent = t('hud.rescan.title');
    this.#f('rescan-body').textContent = t('hud.rescan.body');
    this.#f('rescan-ok').textContent = t('hud.rescan.action');
    this.#f('error-dismiss').textContent = t('hud.error.dismiss');
    this.#f('error-retry').textContent = t('hud.error.retry');
    this.#f('change').textContent = t('hud.changeDestination');
    this.#f('cancel').textContent = t('hud.cancel');
    this.#f('feedback-question').textContent = t('hud.feedback.question');
    this.#f('feedback-blocked-label').textContent = t('hud.feedback.blocked');
    this.#f('feedback-floor-label').textContent = t('hud.feedback.wrongFloor');
    this.#f('feedback-skip').textContent = t('hud.feedback.skip');
    this.#f('feedback-thanks').textContent = t('hud.feedback.thanks');
    for (const b of this.#el.querySelectorAll('[data-answer]')) {
      b.textContent = t(`hud.feedback.${b.dataset.answer}`);
      b.addEventListener('click', () => this.#answerFeedback(b.dataset.answer));
    }
    this.#f('feedback-skip').addEventListener('click', () => {
      this.#feedbackDone = true;
      this.#f('feedback').hidden = true;
    });
    this.#f('floor-toggle').textContent = t('hud.floor.change');
    this.#f('floor-which').textContent = t('hud.floor.which');
    this.#f('mute').textContent = t('speech.toggle');
    this.#f('rate-label').textContent = t('speech.rate');
    this.#f('speech-unsupported').textContent = t('speech.unsupported');
    const rate = this.#f('rate');
    for (const [key, value] of Object.entries(RATES)) {
      const opt = this.#doc.createElement('option');
      opt.value = String(value);
      opt.textContent = t(`speech.rate.${key}`);
      rate.appendChild(opt);
    }
    rate.addEventListener('change', () => this.#onRateChange?.(Number(rate.value)));
    this.#f('mute').addEventListener('click', () => this.#onToggleMute?.());

    this.#f('rescan-ok').addEventListener('click', () => {
      this.hideRescan();
      options.onRescanAcknowledged?.();
    });
    this.#f('error-dismiss').addEventListener('click', () => this.clearError());
    this.#f('error-retry').addEventListener('click', () => {
      const retry = this.#errorRetry;
      this.clearError();
      retry?.();
    });
    this.#f('change').addEventListener('click', () => this.#onChangeDestination?.());
    this.#f('cancel').addEventListener('click', () => this.#onCancel?.());
    this.#f('floor-toggle').addEventListener('click', () => {
      const list = this.#f('floor-list');
      list.hidden = !list.hidden;
      this.#f('floor-toggle').setAttribute('aria-expanded', String(!list.hidden));
    });

    this.setDestination(null);
  }

  get el() {
    return this.#el;
  }

  /** Text helpers for tests and screen readers. */
  get text() {
    return {
      destination: this.#f('destination').textContent,
      distance: this.#f('distance').textContent,
      step: this.#f('step').hidden ? '' : this.#f('step').textContent,
      error: this.#f('error').hidden ? '' : this.#f('error-message').textContent,
      rescan: this.#f('rescan').hidden ? '' : this.#f('rescan-title').textContent,
      notices: [...this.#f('notices').children].map((li) => li.textContent),
    };
  }

  // ----------------------------------------------------------------- notices

  /**
   * Show (or update) a persistent notice, e.g. "You are offline". Notices
   * stack and are announced politely; use errors for things needing action.
   * @param {string} id
   * @param {string} text
   */
  showNotice(id, text) {
    const list = this.#f('notices');
    let li = list.querySelector(`[data-notice="${id}"]`);
    if (!li) {
      li = this.#doc.createElement('li');
      li.dataset.notice = id;
      list.appendChild(li);
    }
    li.textContent = text;
  }

  /**
   * Offer the "I changed floor" control (hidden for a one-floor venue). The
   * user's current floor is listed but disabled; picking another reports it.
   * @param {{ index: number, name: string }[]} floors
   * @param {number | null} current
   */
  setFloors(floors, current) {
    const wrap = this.#f('floors');
    wrap.hidden = floors.length < 2;
    const box = this.#f('floor-buttons');
    box.textContent = '';
    for (const fl of floors) {
      const b = this.#doc.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = fl.name;
      b.disabled = fl.index === current;
      b.dataset.floor = String(fl.index);
      b.addEventListener('click', () => {
        this.#f('floor-list').hidden = true;
        this.#f('floor-toggle').setAttribute('aria-expanded', 'false');
        this.#onFloorChange?.(fl.index);
      });
      box.appendChild(b);
    }
  }

  /** @param {string} id */
  hideNotice(id) {
    this.#f('notices').querySelector(`[data-notice="${id}"]`)?.remove();
  }

  /** @param {string} id */
  hasNotice(id) {
    return Boolean(this.#f('notices').querySelector(`[data-notice="${id}"]`));
  }

  /** The assertive live region spoken guidance is mirrored into. */
  get liveRegion() {
    return this.#f('live');
  }

  /**
   * Reflect the speech guide's state on its controls.
   * @param {{ muted: boolean, rate: number, supported: boolean }} state
   */
  setSpeechState(state) {
    const mute = this.#f('mute');
    mute.setAttribute('aria-pressed', String(!state.muted));
    mute.textContent = state.muted ? t('speech.off') : t('speech.on');
    mute.setAttribute('aria-label', t('speech.toggle'));
    const rate = this.#f('rate');
    const match = [...rate.options].find((o) => Number(o.value) === state.rate);
    if (match) rate.value = match.value;
    this.#f('speech-unsupported').hidden = state.supported;
    mute.disabled = !state.supported;
    rate.disabled = !state.supported;
  }

  // -------------------------------------------------------------- navigation

  /**
   * @param {{ name: string } | null} poi
   */
  setDestination(poi) {
    this.#destination = poi;
    this.#el.classList.toggle('hud-nodest', !poi);
    this.#feedbackDone = false;
    this.#f('feedback').hidden = true;
    this.#f('feedback-buttons').hidden = false;
    this.#f('feedback-thanks').hidden = true;
    this.#el.classList.remove('hud-arrived');
    if (!poi) {
      this.#f('destination').textContent = t('hud.noDestination');
      this.#f('distance').textContent = '';
      this.#f('step').hidden = true;
      this.#f('cancel').hidden = true;
      this.#f('change').textContent = t('hud.changeDestination');
      return;
    }
    this.#f('destination').textContent = t('hud.destination', { name: poi.name });
    this.#f('cancel').hidden = false;
  }

  /**
   * Update from a navigator state (see src/core/navigation.js).
   * @param {import('../core/navigation.js').NavigationState} state
   * @param {{ floorName?: (index: number) => string }} [options]
   */
  setProgress(state, options = {}) {
    if (!this.#destination) return;
    if (state.arrived) {
      this.setArrived(true);
      return;
    }
    this.#el.classList.remove('hud-arrived');
    this.#f('destination').textContent = t('hud.destination', { name: this.#destination.name });
    this.#f('distance').textContent = t('hud.distance', {
      metres: formatMetres(state.distanceRemaining),
    });
    this.#f('distance').setAttribute(
      'aria-label',
      t('hud.distanceLong', { metres: formatMetres(state.distanceRemaining) })
    );

    const step = this.#f('step');
    if (state.floorChange) {
      const { from, to, edge } = state.floorChange;
      const up = to.floor > from.floor;
      const floor = options.floorName ? options.floorName(to.floor) : String(to.floor);
      step.textContent = t(up ? 'hud.floorChange.up' : 'hud.floorChange.down', {
        floor,
        via: edge?.type ?? 'walk',
      });
      step.hidden = false;
    } else if (state.nextNode?.name) {
      step.textContent = t('hud.nextTurn', { name: state.nextNode.name });
      step.hidden = false;
    } else {
      step.hidden = true;
    }
  }

  /** @param {boolean} arrived */
  setArrived(arrived) {
    if (!this.#destination) return;
    this.#el.classList.toggle('hud-arrived', arrived);
    if (arrived) {
      this.#f('destination').textContent = t('hud.arrived', { name: this.#destination.name });
      this.#f('distance').textContent = t('hud.arrivedShort');
      this.#f('step').hidden = true;
      if (this.#onFeedback && !this.#feedbackDone) {
        this.#feedbackDone = true; // ask once per destination
        this.#f('feedback').hidden = false;
      }
    }
  }

  #answerFeedback(accuracy) {
    this.#onFeedback?.({
      accuracy,
      blocked: this.#f('feedback-blocked').checked,
      wrongFloor: this.#f('feedback-floor').checked,
    });
    this.#f('feedback-buttons').hidden = true;
    this.#f('feedback-thanks').hidden = false;
  }

  // ------------------------------------------------------------------ rescan

  showRescan() {
    this.#f('rescan').hidden = false;
  }

  hideRescan() {
    this.#f('rescan').hidden = true;
  }

  // ------------------------------------------------------------------- error

  /**
   * Show an inline error. Replaces every former alert().
   * @param {string} message   Already-localised text (use `t()`).
   * @param {{ hint?: string, retry?: () => void }} [options]
   */
  showError(message, options = {}) {
    this.#f('error-message').textContent = message;
    const hint = this.#f('error-hint');
    hint.hidden = !options.hint;
    hint.textContent = options.hint ?? '';
    this.#errorRetry = options.retry ?? null;
    this.#f('error-retry').hidden = !options.retry;
    this.#f('error').hidden = false;
  }

  clearError() {
    this.#f('error').hidden = true;
    this.#f('error-message').textContent = '';
    this.#errorRetry = null;
  }

  /**
   * Compact mode hides the navigation and voice controls (e.g. while the
   * admin panel is open) so the map gets the space on a phone.
   * @param {boolean} on
   */
  setCompact(on) {
    this.#el.classList.toggle('hud-compact', Boolean(on));
  }

  get compact() {
    return this.#el.classList.contains('hud-compact');
  }

  // --------------------------------------------------------------- lifecycle

  show() {
    this.#el.hidden = false;
  }

  hide() {
    this.#el.hidden = true;
  }

  destroy() {
    this.#resize?.disconnect();
    this.#doc.documentElement?.style.removeProperty('--hud-h');
    this.#el.remove();
  }
}

/** @param {ConstructorParameters<typeof Hud>[0]} [options] */
export function createHud(options) {
  return new Hud(options);
}
