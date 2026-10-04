/**
 * Arrival feedback, kept on the phone.
 *
 * After a visitor arrives the app asks whether the route was accurate. The
 * answer is packed into one small integer (a bit code) so that, if sending
 * it to the venue is ever switched on, nothing about the format changes.
 * Today it is only stored in the browser's local storage and exported by
 * staff from a test phone (admin → Publish → Download answers).
 *
 * Bit layout (low bit first):
 *   bits 0–1  accuracy: 0 not answered, 1 yes, 2 mostly, 3 no
 *   bit  2    something was blocked or closed
 *   bit  3    it sent me to the wrong floor
 *   bit  4    arrived
 *
 * An entry holds no identifier, no position and no time finer than the day:
 * `{ v: venue id, f: start node, t: destination place id, c: code, d: date }`.
 */

const KEY_PREFIX = 'brains:feedback:';
const MAX_ENTRIES = 500;

export const ACCURACY = Object.freeze({ none: 0, yes: 1, mostly: 2, no: 3 });
const ACCURACY_NAMES = ['none', 'yes', 'mostly', 'no'];

/**
 * @param {{ accuracy?: 'none' | 'yes' | 'mostly' | 'no', blocked?: boolean, wrongFloor?: boolean, arrived?: boolean }} a
 * @returns {number}
 */
export function encodeAnswers(a = {}) {
  const accuracy = ACCURACY[a.accuracy ?? 'none'];
  if (accuracy === undefined) throw new RangeError(`unknown accuracy ${a.accuracy}`);
  return accuracy | (a.blocked ? 4 : 0) | (a.wrongFloor ? 8 : 0) | (a.arrived ? 16 : 0);
}

/** @param {number} code */
export function decodeAnswers(code) {
  if (!Number.isInteger(code) || code < 0 || code > 31)
    throw new RangeError(`bad answer code ${code}`);
  return {
    accuracy: ACCURACY_NAMES[code & 3],
    blocked: Boolean(code & 4),
    wrongFloor: Boolean(code & 8),
    arrived: Boolean(code & 16),
  };
}

const keyFor = (venueId) => `${KEY_PREFIX}${venueId}`;

/** @param {Storage | null | undefined} storage @param {string} venueId */
export function loadFeedback(storage, venueId) {
  try {
    const list = JSON.parse(storage?.getItem(keyFor(venueId)) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Store one answer. Returns the entry, or null when storage is unavailable.
 * @param {Storage | null | undefined} storage
 * @param {{ venueId: string, from?: string, to?: string, answers: Parameters<typeof encodeAnswers>[0], now?: Date }} input
 */
export function recordFeedback(storage, { venueId, from, to, answers, now = new Date() }) {
  const entry = {
    v: venueId,
    ...(from ? { f: from } : {}),
    ...(to ? { t: to } : {}),
    c: encodeAnswers(answers),
    d: now.toISOString().slice(0, 10),
  };
  try {
    const list = [...loadFeedback(storage, venueId), entry].slice(-MAX_ENTRIES);
    storage.setItem(keyFor(venueId), JSON.stringify(list));
    return entry;
  } catch {
    return null;
  }
}

/** The stored answers as readable rows (for the staff export). */
export function feedbackRows(storage, venueId) {
  return loadFeedback(storage, venueId).map((e) => ({ ...e, ...decodeAnswers(e.c) }));
}
