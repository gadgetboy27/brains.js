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

import { formatMetres, t } from './strings.js';
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
`;

export class Hud {
  #el;
  #doc;
  #f;
  #destination = null;
  #onChangeDestination;
  #onCancel;
  #errorRetry = null;

  /**
   * @param {Object} options
   * @param {HTMLElement} [options.mount]           Default document.body.
   * @param {Document} [options.document]
   * @param {() => void} [options.onChangeDestination]
   * @param {() => void} [options.onCancel]
   * @param {() => void} [options.onRescanAcknowledged]
   */
  constructor(options = {}) {
    this.#doc = options.document ?? globalThis.document;
    const mount = options.mount ?? this.#doc?.body;
    if (!this.#doc || !mount) throw new TypeError('Hud requires a document and mount element');
    this.#onChangeDestination = options.onChangeDestination;
    this.#onCancel = options.onCancel;

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
    `;
    this.#el = el;
    this.#f = (name) => el.querySelector(`[data-f="${name}"]`);
    mount.appendChild(el);

    this.#f('rescan-title').textContent = t('hud.rescan.title');
    this.#f('rescan-body').textContent = t('hud.rescan.body');
    this.#f('rescan-ok').textContent = t('hud.rescan.action');
    this.#f('error-dismiss').textContent = t('hud.error.dismiss');
    this.#f('error-retry').textContent = t('hud.error.retry');
    this.#f('change').textContent = t('hud.changeDestination');
    this.#f('cancel').textContent = t('hud.cancel');

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
    };
  }

  // -------------------------------------------------------------- navigation

  /**
   * @param {{ name: string } | null} poi
   */
  setDestination(poi) {
    this.#destination = poi;
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
    }
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

  // --------------------------------------------------------------- lifecycle

  show() {
    this.#el.hidden = false;
  }

  hide() {
    this.#el.hidden = true;
  }

  destroy() {
    this.#el.remove();
  }
}

/** @param {ConstructorParameters<typeof Hud>[0]} [options] */
export function createHud(options) {
  return new Hud(options);
}
