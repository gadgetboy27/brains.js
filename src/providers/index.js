/**
 * Provider selection and fallback chain.
 *
 * `createProviderChain(venue, options)` builds a `ProviderChain` — itself a
 * `PositionProvider` — from the providers the venue is configured for. The
 * app talks to the chain exactly as it would to a single provider; the chain
 * decides which concrete provider is active.
 *
 * ## Order
 *
 * The venue JSON may list an explicit order:
 *
 * ```jsonc
 * "providers": { "order": ["immersal", "qr", "mock"], "immersal": { … } }
 * ```
 *
 * Otherwise the default order is: `immersal` if `providers.immersal` is
 * configured, then `qr` if the venue has anchors, then `mock` if
 * `options.allowMock` is set (never by default — it would silently fake
 * positions in production).
 *
 * ## Fallback rules
 *
 *  1. A provider that throws from its constructor, rejects from `start()`, or
 *     settles into a failure status (`permission-denied`, `no-camera`,
 *     `unsupported`, `error`) has *failed to initialise*: the chain moves on.
 *  2. A running provider whose poses stay below `minConfidence` — or that
 *     emits nothing at all — for longer than `lowConfidenceMs` has *lost
 *     confidence*: it is stopped and the next provider is started.
 *  3. When every provider has failed the chain's status is `exhausted`.
 *
 * Every transition is surfaced through `state` and the `change` event so the
 * UI can say which provider is active, what was tried, and why it fell back.
 */

import { PositionProvider } from '../core/positioning.js';
import { ImmersalProvider } from './immersal.js';
import { MockProvider } from './mock.js';
import { QrProvider } from './qr.js';

/** @typedef {import('../core/venue.js').Venue} Venue */

/**
 * @typedef {Object} ProviderEntry
 * @property {(venue: Venue, options: object) => PositionProvider} create
 * @property {(venue: Venue, options: object) => boolean} [isConfigured]
 * @property {typeof PositionProvider} [Class] For uploads disclosure.
 */

/** @type {Record<string, ProviderEntry>} */
export const DEFAULT_REGISTRY = Object.freeze({
  immersal: {
    Class: ImmersalProvider,
    isConfigured: (venue) => Number.isInteger(venue.providers?.immersal?.mapId),
    create: (venue, options) => new ImmersalProvider({ venue, ...options.immersal }),
  },
  qr: {
    Class: QrProvider,
    isConfigured: (venue) => venue.anchors.length > 0,
    create: (venue, options) => new QrProvider({ venue, ...options.qr }),
  },
  mock: {
    Class: MockProvider,
    isConfigured: (venue, options) => Boolean(options.allowMock),
    create: (venue, options) => new MockProvider({ ...options.mock }),
  },
});

const FAILURE_STATUSES = new Set(['permission-denied', 'no-camera', 'unsupported', 'error']);

/**
 * Decide the provider order for a venue.
 *
 * @param {Venue} venue
 * @param {{ allowMock?: boolean, registry?: Record<string, ProviderEntry>, order?: string[] }} [options]
 * @returns {string[]}
 */
export function resolveProviderOrder(venue, options = {}) {
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const explicit = options.order ?? venue.providers?.order;
  if (explicit !== undefined) {
    if (!Array.isArray(explicit) || explicit.some((n) => typeof n !== 'string')) {
      throw new TypeError('providers.order must be an array of provider names');
    }
    for (const name of explicit) {
      if (!registry[name]) throw new Error(`unknown provider "${name}" in providers.order`);
    }
    return [...explicit];
  }
  return Object.keys(registry).filter(
    (name) => registry[name].isConfigured?.(venue, options) ?? true
  );
}

/**
 * @typedef {Object} ChainOptions
 * @property {Record<string, ProviderEntry>} [registry]
 * @property {string[]} [order]             Overrides venue providers.order.
 * @property {boolean} [allowMock=false]
 * @property {number} [minConfidence=0.3]   Poses below this count as low confidence.
 * @property {number} [lowConfidenceMs=15000] Fall back after this long without a good pose.
 * @property {number} [checkIntervalMs=1000]
 * @property {object} [immersal] Options passed to ImmersalProvider.
 * @property {object} [qr]       Options passed to QrProvider.
 * @property {object} [mock]     Options passed to MockProvider.
 * @property {() => number} [now]
 * @property {typeof setInterval} [setInterval]
 * @property {typeof clearInterval} [clearInterval]
 */

/**
 * @typedef {Object} ChainState
 * @property {'idle' | 'starting' | 'active' | 'exhausted'} status
 * @property {string | null} active       Name of the running provider.
 * @property {PositionProvider | null} provider
 * @property {string[]} order
 * @property {Array<{ name: string, reason: string, error?: Error }>} failed
 * @property {number | null} lastGoodPoseAt
 */

export class ProviderChain extends PositionProvider {
  /**
   * The chain itself sends nothing; see `declaredUploads()` for the union of
   * what its members send.
   */
  static uploads = [];

  #venue;
  /** @type {Required<ChainOptions>} */
  #opts;
  #order;
  #index = -1;
  /** @type {PositionProvider | null} */
  #active = null;
  #activeName = null;
  #unsubscribe = [];
  #failed = [];
  #status = 'idle';
  #lastGoodPoseAt = null;
  #activeSince = null;
  #watchdog = null;
  #changeListeners = new Set();
  #starting = null;

  /**
   * @param {Venue} venue
   * @param {ChainOptions} [options]
   */
  constructor(venue, options = {}) {
    super();
    if (!venue || typeof venue.id !== 'string')
      throw new TypeError('ProviderChain requires a Venue');
    this.#venue = venue;
    this.#opts = {
      registry: DEFAULT_REGISTRY,
      allowMock: false,
      minConfidence: 0.3,
      lowConfidenceMs: 15_000,
      checkIntervalMs: 1000,
      immersal: {},
      qr: {},
      mock: {},
      now: () => Date.now(),
      setInterval: (...a) => globalThis.setInterval(...a),
      clearInterval: (...a) => globalThis.clearInterval(...a),
      ...options,
    };
    if (!(this.#opts.minConfidence >= 0 && this.#opts.minConfidence <= 1)) {
      throw new RangeError('minConfidence must be in [0, 1]');
    }
    if (!(this.#opts.lowConfidenceMs >= 0)) throw new RangeError('lowConfidenceMs must be >= 0');
    this.#order = resolveProviderOrder(venue, this.#opts);
    if (this.#order.length === 0) {
      throw new Error(
        `no positioning provider is configured for venue "${venue.id}" ` +
          '(add providers.immersal, anchors for qr, or pass allowMock for development)'
      );
    }
  }

  // ----------------------------------------------------------------- state

  /** @returns {ChainState} */
  get state() {
    return {
      status: this.#status,
      active: this.#activeName,
      provider: this.#active,
      order: [...this.#order],
      failed: this.#failed.map((f) => ({ ...f })),
      lastGoodPoseAt: this.#lastGoodPoseAt,
    };
  }

  /** Names of providers in this chain, in order. */
  get order() {
    return [...this.#order];
  }

  /** The currently active provider instance, if any. */
  get active() {
    return this.#active;
  }

  /**
   * Union of the `uploads` declarations of every provider in the chain, each
   * tagged with the provider name, for disclosure before positioning starts.
   */
  declaredUploads() {
    const out = [];
    for (const name of this.#order) {
      const Class = this.#opts.registry[name]?.Class;
      for (const u of Class?.uploads ?? []) out.push({ provider: name, ...u });
    }
    return out;
  }

  /**
   * Subscribe to chain transitions.
   * @param {(event: { type: 'started' | 'fallback' | 'exhausted' | 'stopped', from?: string, to?: string, reason?: string, state: ChainState }) => void} listener
   * @returns {() => void}
   */
  onChange(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  #emitChange(event) {
    const payload = { ...event, state: this.state };
    for (const l of this.#changeListeners) l(payload);
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Start the first provider that initialises successfully. Resolves once a
   * provider is active or the chain is exhausted; never rejects.
   * @returns {Promise<void>}
   */
  async start() {
    if (this.#starting) return this.#starting;
    if (this.#status === 'active') return;
    this.#starting = this.#startFrom(0).finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  /**
   * Stop the active provider and reset the chain. A later `start()` begins
   * from the first provider again.
   * @returns {Promise<void>}
   */
  async stop() {
    this.#clearWatchdog();
    await this.#stopActive();
    this.#index = -1;
    this.#failed = [];
    this.#lastGoodPoseAt = null;
    if (this.#status !== 'idle') {
      this.#status = 'idle';
      this.#emitChange({ type: 'stopped' });
    }
  }

  async #startFrom(index) {
    this.#status = 'starting';
    for (let i = index; i < this.#order.length; i += 1) {
      const name = this.#order[i];
      const result = await this.#tryStart(name);
      if (result.ok) {
        this.#index = i;
        this.#activate(name, result);
        return;
      }
      this.#failed.push({ name, reason: result.reason, error: result.error });
    }
    const from = this.#activeName;
    this.#active = null;
    this.#activeName = null;
    this.#index = this.#order.length;
    this.#status = 'exhausted';
    this.#emitChange({
      type: 'exhausted',
      from: from ?? undefined,
      reason: 'every provider failed',
    });
  }

  async #tryStart(name) {
    const entry = this.#opts.registry[name];
    let provider;
    try {
      provider = entry.create(this.#venue, this.#opts);
    } catch (error) {
      return { ok: false, reason: `could not be created: ${error.message}`, error };
    }

    // Subscribe before start(): eager providers (e.g. MockProvider) emit their
    // first pose synchronously inside start(). Buffer until activation.
    const pending = [];
    let live = false;
    const off = provider.onPose((pose) => (live ? this.#onPose(pose) : pending.push(pose)));
    const activate = () => {
      live = true;
      for (const pose of pending.splice(0)) this.#onPose(pose);
    };

    try {
      await provider.start();
    } catch (error) {
      off();
      await safeStop(provider);
      return { ok: false, reason: `failed to start: ${error.message}`, error };
    }
    const status = provider.status;
    if (typeof status === 'string' && FAILURE_STATUSES.has(status)) {
      const error = provider.error ?? undefined; // read before stop() clears it
      off();
      await safeStop(provider);
      return { ok: false, reason: status, error };
    }
    return { ok: true, provider, off, activate };
  }

  #activate(name, { provider, off, activate }) {
    const previous = this.#activeName;
    this.#active = provider;
    this.#activeName = name;
    this.#activeSince = this.#opts.now();
    this.#lastGoodPoseAt = null;
    this.#unsubscribe.push(off);
    if (typeof provider.onStatus === 'function') {
      this.#unsubscribe.push(provider.onStatus((e) => this.#onProviderStatus(e)));
    }
    this.#status = 'active';
    this.#watchdog = this.#opts.setInterval(() => this.#check(), this.#opts.checkIntervalMs);
    this.#emitChange(
      previous ? { type: 'fallback', from: previous, to: name } : { type: 'started', to: name }
    );
    activate();
  }

  async #stopActive() {
    for (const off of this.#unsubscribe) off();
    this.#unsubscribe = [];
    const provider = this.#active;
    this.#active = null;
    this.#activeName = null;
    this.#activeSince = null;
    if (provider) await safeStop(provider);
  }

  #clearWatchdog() {
    if (this.#watchdog !== null) {
      this.#opts.clearInterval(this.#watchdog);
      this.#watchdog = null;
    }
  }

  // -------------------------------------------------------------- monitoring

  #onPose(pose) {
    if (pose.confidence >= this.#opts.minConfidence) this.#lastGoodPoseAt = this.#opts.now();
    this.emitPose(pose);
  }

  #onProviderStatus(event) {
    if (FAILURE_STATUSES.has(event.status)) {
      void this.#fallback(`provider reported ${event.status}`, event.error);
    }
  }

  /** Watchdog: fall back after too long without a confident pose. */
  #check() {
    if (this.#status !== 'active') return;
    const since = this.#lastGoodPoseAt ?? this.#activeSince;
    if (this.#opts.now() - since > this.#opts.lowConfidenceMs) {
      void this.#fallback(
        this.#lastGoodPoseAt === null
          ? `no confident pose within ${this.#opts.lowConfidenceMs} ms of starting`
          : `confidence below ${this.#opts.minConfidence} for over ${this.#opts.lowConfidenceMs} ms`
      );
    }
  }

  async #fallback(reason, error) {
    if (this.#status !== 'active') return;
    const from = this.#activeName;
    this.#clearWatchdog();
    await this.#stopActive();
    this.#failed.push({ name: from, reason, error });
    // Keep #activeName populated for the 'fallback' event's `from`.
    this.#activeName = from;
    const next = this.#index + 1;
    if (next >= this.#order.length) {
      this.#activeName = null;
      this.#index = this.#order.length;
      this.#status = 'exhausted';
      this.#emitChange({ type: 'exhausted', from, reason });
      return;
    }
    this.#starting = this.#startFrom(next).finally(() => {
      this.#starting = null;
    });
    await this.#starting;
  }
}

async function safeStop(provider) {
  try {
    await provider.stop();
  } catch {
    // best-effort
  }
}

/**
 * Build a provider chain for a venue.
 *
 * @param {Venue} venue
 * @param {ChainOptions} [options]
 * @returns {ProviderChain}
 */
export function createProviderChain(venue, options) {
  return new ProviderChain(venue, options);
}

export { ImmersalProvider, MockProvider, QrProvider };
