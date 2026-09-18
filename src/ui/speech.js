/**
 * Spoken turn-by-turn guidance via the Web Speech API.
 *
 * `SpeechGuide` wraps `speechSynthesis` with a mute control and a rate
 * setting (both persisted), picks a voice language matching the UI language,
 * and — importantly for screen-reader users, who may have speech muted to
 * avoid two voices — mirrors every announcement into an `aria-live` region so
 * the same guidance reaches assistive technology.
 *
 * `narrate(state)` turns navigator states into announcements and de-duplicates
 * them: it speaks when the next node changes, when a floor change is close,
 * on arrival, and otherwise at most every `progressEveryM` metres.
 *
 * Everything browser-specific is injectable. Unsupported browsers degrade to
 * the live region only.
 */

import { formatMetres, getLanguage, t } from './strings/index.js';

const STORAGE_KEY = 'brains:speech';
export const RATES = Object.freeze({ slow: 0.8, normal: 1, fast: 1.3 });

/** Map a UI language to a speech-synthesis locale. */
export function speechLang(code) {
  const c = String(code ?? 'en').toLowerCase();
  if (c.startsWith('mi')) return 'mi-NZ';
  if (c === 'en') return 'en-NZ';
  return c;
}

export class SpeechGuide {
  #synth;
  #Utterance;
  #live;
  #storage;
  #muted = false;
  #rate = RATES.normal;
  #lang;
  #listeners = new Set();
  #lastKey = null;
  #lastProgressAt = null;
  #progressEveryM;
  #floorChangeAnnounced = null;
  #spoken = [];

  /**
   * @param {Object} [options]
   * @param {SpeechSynthesis | null} [options.synth]
   * @param {typeof SpeechSynthesisUtterance | null} [options.Utterance]
   * @param {HTMLElement | null} [options.liveRegion]   An aria-live element to mirror text into.
   * @param {Storage | null} [options.storage]
   * @param {string} [options.lang]                    UI language code (default current).
   * @param {boolean} [options.muted]
   * @param {number} [options.rate]
   * @param {number} [options.progressEveryM=15]
   */
  constructor(options = {}) {
    this.#synth =
      options.synth === undefined ? (globalThis.speechSynthesis ?? null) : options.synth;
    this.#Utterance =
      options.Utterance === undefined
        ? (globalThis.SpeechSynthesisUtterance ?? null)
        : options.Utterance;
    this.#live = options.liveRegion ?? null;
    this.#storage = options.storage === undefined ? safeStorage() : options.storage;
    this.#lang = speechLang(options.lang ?? getLanguage());
    this.#progressEveryM = options.progressEveryM ?? 15;

    const stored = this.#load();
    this.#muted = options.muted ?? stored.muted ?? false;
    this.#rate = clampRate(options.rate ?? stored.rate ?? RATES.normal);
  }

  /** Whether synthesis is available at all. */
  get supported() {
    return Boolean(this.#synth && typeof this.#synth.speak === 'function' && this.#Utterance);
  }

  get muted() {
    return this.#muted;
  }

  get rate() {
    return this.#rate;
  }

  get lang() {
    return this.#lang;
  }

  /** Texts spoken so far (for tests and debugging). */
  get spoken() {
    return [...this.#spoken];
  }

  /** @param {(state: { muted: boolean, rate: number, supported: boolean }) => void} listener */
  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    const state = { muted: this.#muted, rate: this.#rate, supported: this.supported };
    for (const l of this.#listeners) l(state);
  }

  #load() {
    try {
      const raw = this.#storage?.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  #save() {
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify({ muted: this.#muted, rate: this.#rate }));
    } catch {
      // storage may be unavailable
    }
  }

  // -------------------------------------------------------------- controls

  /** @param {boolean} muted */
  setMuted(muted) {
    this.#muted = Boolean(muted);
    if (this.#muted) this.#synth?.cancel?.();
    this.#save();
    this.#emit();
    // Confirm the change audibly / via the live region.
    this.announce(t(this.#muted ? 'speech.off' : 'speech.on'), { force: !this.#muted });
  }

  toggleMuted() {
    this.setMuted(!this.#muted);
  }

  /** @param {number} rate  0.5–2; see RATES for presets. */
  setRate(rate) {
    this.#rate = clampRate(rate);
    this.#save();
    this.#emit();
  }

  /** @param {string} code UI language code. */
  setLanguage(code) {
    this.#lang = speechLang(code);
  }

  // ------------------------------------------------------------- speaking

  /**
   * Say something. Always mirrored to the live region; spoken aloud unless
   * muted (or `force`).
   *
   * @param {string} text
   * @param {{ interrupt?: boolean, force?: boolean }} [options]
   * @returns {boolean} Whether it was sent to the synthesiser.
   */
  announce(text, { interrupt = true, force = false } = {}) {
    if (!text) return false;
    if (this.#live) {
      // Re-set the text so identical consecutive announcements are re-read.
      this.#live.textContent = '';
      this.#live.textContent = text;
    }
    if ((this.#muted && !force) || !this.supported) return false;
    try {
      if (interrupt) this.#synth.cancel();
      const u = new this.#Utterance(text);
      u.lang = this.#lang;
      u.rate = this.#rate;
      this.#synth.speak(u);
      this.#spoken.push(text);
      return true;
    } catch {
      return false;
    }
  }

  /** Stop anything currently being spoken. */
  cancel() {
    this.#synth?.cancel?.();
  }

  /** Forget narration state (call when the destination changes). */
  resetNarration() {
    this.#lastKey = null;
    this.#lastProgressAt = null;
    this.#floorChangeAnnounced = null;
  }

  /**
   * Announce a new destination.
   * @param {{ name: string }} poi
   * @param {import('../core/navigation.js').NavigationState} [state]
   */
  announceDestination(poi, state) {
    this.resetNarration();
    this.announce(
      t('speech.destinationSet', {
        name: poi.name,
        metres: formatMetres(state?.distanceRemaining ?? 0),
      })
    );
    if (state) {
      this.#lastKey = `step:${state.nextIndex}`;
      this.#lastProgressAt = state.distanceRemaining;
    }
  }

  announceCancelled() {
    this.resetNarration();
    this.announce(t('speech.cancelled'));
  }

  announceRescan() {
    this.announce(t('speech.rescan'), { interrupt: false });
  }

  /**
   * Narrate progress. Speaks on a new next-node, an imminent floor change,
   * arrival, or every `progressEveryM` metres; silent otherwise.
   *
   * @param {import('../core/navigation.js').NavigationState} state
   * @param {{ floorName?: (index: number) => string, destinationName?: string }} [options]
   * @returns {string | null} What was announced, if anything.
   */
  narrate(state, options = {}) {
    if (!state) return null;
    if (state.arrived) {
      if (this.#lastKey === 'arrived') return null;
      this.#lastKey = 'arrived';
      const text = t('speech.arrived', {
        name: options.destinationName ?? state.nextNode?.name ?? '',
      });
      this.announce(text);
      return text;
    }

    // Imminent floor change: say it once per change point when within 8 m.
    const fc = state.floorChange;
    if (fc && state.nextNode === fc.to && this.#floorChangeAnnounced !== fc.from.id) {
      this.#floorChangeAnnounced = fc.from.id;
      const up = fc.to.floor > fc.from.floor;
      const floor = options.floorName ? options.floorName(fc.to.floor) : String(fc.to.floor);
      const text = t(up ? 'speech.floorChange.up' : 'speech.floorChange.down', {
        floor,
        via: fc.edge?.type ?? 'walk',
      });
      this.announce(text);
      this.#lastKey = `step:${state.nextIndex}`;
      this.#lastProgressAt = state.distanceRemaining;
      return text;
    }

    const key = `step:${state.nextIndex}`;
    const movedEnough =
      this.#lastProgressAt !== null &&
      this.#lastProgressAt - state.distanceRemaining >= this.#progressEveryM;
    if (key !== this.#lastKey || movedEnough) {
      this.#lastKey = key;
      this.#lastProgressAt = state.distanceRemaining;
      const name = state.nextNode?.name ?? options.destinationName ?? '';
      const text = t('speech.nextStep', { metres: formatMetres(state.distanceToNext), name });
      this.announce(text);
      return text;
    }
    if (this.#lastProgressAt === null) this.#lastProgressAt = state.distanceRemaining;
    return null;
  }

  destroy() {
    this.cancel();
    this.#listeners.clear();
  }
}

function clampRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r)) return RATES.normal;
  return Math.min(2, Math.max(0.5, r));
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** @param {ConstructorParameters<typeof SpeechGuide>[0]} [options] */
export function createSpeechGuide(options) {
  return new SpeechGuide(options);
}
