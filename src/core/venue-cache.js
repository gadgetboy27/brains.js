/**
 * A tiny cache of venue JSON in web storage, so the floor plan keeps working
 * when the venue file cannot be fetched (offline, server down). The most
 * recent successful load per URL is kept; a stale copy is better than none,
 * and the UI says when it is showing one.
 */

const PREFIX = 'brains:venue-cache:';

/**
 * @param {string} url
 * @param {object} json
 * @param {Storage | null} storage
 * @param {() => number} [now]
 */
export function saveVenueCache(url, json, storage, now = () => Date.now()) {
  if (!storage || !url) return false;
  try {
    storage.setItem(PREFIX + url, JSON.stringify({ savedAt: now(), json }));
    return true;
  } catch {
    return false; // quota or unavailable
  }
}

/**
 * @param {string} url
 * @param {Storage | null} storage
 * @returns {{ savedAt: number, json: object } | null}
 */
export function loadVenueCache(url, storage) {
  if (!storage || !url) return null;
  try {
    const raw = storage.getItem(PREFIX + url);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.json ? parsed : null;
  } catch {
    return null;
  }
}

export function clearVenueCache(url, storage) {
  try {
    storage?.removeItem(PREFIX + url);
  } catch {
    // ignore
  }
}
