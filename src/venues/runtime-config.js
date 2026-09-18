/**
 * Per-venue runtime config — the operator's "right now" overrides.
 *
 * A small JSON file, separate from the venue map, that can be edited at any
 * moment to **close a route edge** or **hide a point of interest** without a
 * redeploy. The app fetches it at startup (falling back to a cached copy),
 * polls it, and re-applies it on change. Closures are honoured by routing and
 * shown in the UI.
 *
 * ```jsonc
 * {
 *   "version": 1,
 *   "updatedAt": "2026-09-19T10:00:00Z",         // optional, informational
 *   "closures": [
 *     { "from": "n-lift-g", "to": "n-lift-1", "reason": "Lift out of service until 3 pm" }
 *   ],
 *   "hiddenPois": ["poi-clinic-b"],
 *   "notice": "Clinic B is closed today."       // optional venue-wide notice
 * }
 * ```
 *
 * `closures[].from/to` name an edge in either direction. Unknown ids are
 * reported but do not stop the rest of the config applying — a typo must not
 * take the app down.
 */

import { createVenue } from '../core/venue.js';

const CACHE_PREFIX = 'brains:runtime-config:';

/** @typedef {{ version: 1, updatedAt?: string, closures?: Array<{ from: string, to: string, reason?: string }>, hiddenPois?: string[], notice?: string }} RuntimeConfig */

export const EMPTY_CONFIG = Object.freeze({ version: 1, closures: [], hiddenPois: [] });

/**
 * Validate a runtime config. Returns problems (empty when valid).
 * @param {unknown} json
 * @returns {Array<{ path: string, message: string }>}
 */
export function validateRuntimeConfig(json) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return [{ path: 'config', message: 'must be an object' }];
  }
  if (json.version !== 1)
    errors.push({ path: 'version', message: `must be 1, got ${json.version}` });
  if (json.updatedAt !== undefined && typeof json.updatedAt !== 'string') {
    errors.push({ path: 'updatedAt', message: 'must be a string' });
  }
  if (json.notice !== undefined && typeof json.notice !== 'string') {
    errors.push({ path: 'notice', message: 'must be a string' });
  }
  if (json.closures !== undefined) {
    if (!Array.isArray(json.closures))
      errors.push({ path: 'closures', message: 'must be an array' });
    else
      json.closures.forEach((c, i) => {
        if (!c || typeof c !== 'object')
          errors.push({ path: `closures[${i}]`, message: 'must be an object' });
        else {
          for (const k of ['from', 'to']) {
            if (typeof c[k] !== 'string' || !c[k])
              errors.push({ path: `closures[${i}].${k}`, message: 'is required' });
          }
          if (c.reason !== undefined && typeof c.reason !== 'string') {
            errors.push({ path: `closures[${i}].reason`, message: 'must be a string' });
          }
        }
      });
  }
  if (json.hiddenPois !== undefined) {
    if (!Array.isArray(json.hiddenPois))
      errors.push({ path: 'hiddenPois', message: 'must be an array' });
    else
      json.hiddenPois.forEach((id, i) => {
        if (typeof id !== 'string' || !id)
          errors.push({ path: `hiddenPois[${i}]`, message: 'must be a poi id' });
      });
  }
  return errors;
}

/** Normalise to the full shape. Throws on invalid input. */
export function normaliseRuntimeConfig(json) {
  const errors = validateRuntimeConfig(json);
  if (errors.length) {
    throw new TypeError(
      `Invalid runtime config: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`
    );
  }
  return {
    version: 1,
    updatedAt: json.updatedAt,
    closures: (json.closures ?? []).map((c) => ({
      from: c.from,
      to: c.to,
      ...(c.reason ? { reason: c.reason } : {}),
    })),
    hiddenPois: [...(json.hiddenPois ?? [])],
    ...(json.notice ? { notice: json.notice } : {}),
  };
}

/** Stable string for change detection. */
export function fingerprint(config) {
  const c = normaliseRuntimeConfig(config);
  return JSON.stringify({
    closures: [...c.closures].sort((a, b) => `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`)),
    hiddenPois: [...c.hiddenPois].sort(),
    notice: c.notice ?? '',
  });
}

/**
 * Resolve the config URL: explicit option, else the venue's runtimeConfigUrl
 * (relative to the venue URL), else none.
 */
export function resolveRuntimeConfigUrl({ explicit, venue, venueUrl }) {
  const url = explicit ?? venue?.runtimeConfigUrl;
  if (!url) return null;
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('/') || !venueUrl) return url;
  const base = venueUrl.slice(0, venueUrl.lastIndexOf('/') + 1);
  return base + url;
}

/**
 * Fetch the config, caching it; on failure return the cached copy, else the
 * empty config. Never throws.
 *
 * @param {string} url
 * @param {{ fetch?: typeof fetch, storage?: Storage | null, now?: () => number }} [options]
 * @returns {Promise<{ config: RuntimeConfig, source: 'network' | 'cache' | 'none', error?: Error }>}
 */
export async function fetchRuntimeConfig(
  url,
  { fetch: fetchImpl = globalThis.fetch, storage = null, now = () => Date.now() } = {}
) {
  try {
    if (typeof fetchImpl !== 'function') throw new TypeError('no fetch available');
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const config = normaliseRuntimeConfig(await res.json());
    try {
      storage?.setItem(CACHE_PREFIX + url, JSON.stringify({ savedAt: now(), config }));
    } catch {
      // storage may be unavailable
    }
    return { config, source: 'network' };
  } catch (error) {
    try {
      const raw = storage?.getItem(CACHE_PREFIX + url);
      if (raw) {
        const cached = JSON.parse(raw);
        return { config: normaliseRuntimeConfig(cached.config), source: 'cache', error };
      }
    } catch {
      // fall through
    }
    return { config: { ...EMPTY_CONFIG, closures: [], hiddenPois: [] }, source: 'none', error };
  }
}

/**
 * Apply a runtime config to a venue, returning a new Venue with `closed`
 * edges and `hidden` POIs. The original is untouched.
 *
 * @param {import('../core/venue.js').Venue} venue
 * @param {RuntimeConfig} config
 * @returns {{ venue: import('../core/venue.js').Venue, applied: { closures: number, hiddenPois: number }, unknown: string[] }}
 */
export function applyRuntimeConfig(venue, config) {
  const c = normaliseRuntimeConfig(config);
  const json = venue.toJSON();
  const unknown = [];
  let closures = 0;
  for (const closure of c.closures) {
    const edge = json.edges.find(
      (e) =>
        (e.from === closure.from && e.to === closure.to) ||
        (e.from === closure.to && e.to === closure.from)
    );
    if (!edge) {
      unknown.push(`edge ${closure.from}→${closure.to}`);
      continue;
    }
    edge.closed = true;
    if (closure.reason) edge.closedReason = closure.reason;
    closures += 1;
  }
  let hiddenPois = 0;
  for (const id of c.hiddenPois) {
    const poi = json.pois.find((p) => p.id === id);
    if (!poi) {
      unknown.push(`poi ${id}`);
      continue;
    }
    poi.hidden = true;
    hiddenPois += 1;
  }
  return { venue: createVenue(json), applied: { closures, hiddenPois }, unknown };
}

/**
 * Poll the config and call back on change. Returns a stop function.
 *
 * @param {string} url
 * @param {{ intervalMs?: number, onChange: (result: Awaited<ReturnType<typeof fetchRuntimeConfig>>) => void, fetch?: typeof fetch, storage?: Storage | null, setInterval?: Function, clearInterval?: Function, initial?: RuntimeConfig }} options
 */
export function pollRuntimeConfig(url, options) {
  const {
    intervalMs = 60_000,
    onChange,
    setInterval: setIntervalFn = (...a) => globalThis.setInterval(...a),
    clearInterval: clearIntervalFn = (...a) => globalThis.clearInterval(...a),
    initial,
  } = options;
  let last = initial ? fingerprint(initial) : null;
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await fetchRuntimeConfig(url, options);
      if (result.source === 'network') {
        const fp = fingerprint(result.config);
        if (fp !== last) {
          last = fp;
          onChange(result);
        }
      }
    } finally {
      inFlight = false;
    }
  };
  const timer = setIntervalFn(tick, intervalMs);
  return () => clearIntervalFn(timer);
}
