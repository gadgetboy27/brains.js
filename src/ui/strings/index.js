/**
 * Strings and languages.
 *
 * Every user-facing string in the app comes through `t(key, params)`. Each
 * language is one file in this folder exporting `{ code, name, strings }`;
 * English is the reference set and the fallback for any missing key.
 *
 * A venue can add or override languages **without a code change**: its venue
 * JSON may carry a `languages` block (see src/venues/schema.json) which the
 * app registers at boot with `registerLanguage()`. A community language that
 * only translates some keys is fine — the rest fall back to English.
 *
 * The active language is chosen from `?lang=`, a stored preference, then the
 * browser's languages, then English. Components render with the language
 * current at construction; `onLanguageChange()` lets the app rebuild them.
 */

import en from './en.js';
import mi from './mi.js';

/** @typedef {{ code: string, name: string, strings: Record<string, string> }} Language */

const BUILT_IN = [en, mi];
const STORAGE_KEY = 'brains:lang';

/** @type {Map<string, Language>} */
const languages = new Map(BUILT_IN.map((l) => [l.code, { ...l, builtIn: true }]));

let currentCode = 'en';
const listeners = new Set();

/** Normalise a BCP 47 tag for lookup: lowercase, and also try the base language. */
function candidates(code) {
  const c = String(code ?? '')
    .trim()
    .toLowerCase();
  if (!c) return [];
  const base = c.split('-')[0];
  return base === c ? [c] : [c, base];
}

/**
 * Register (or override) a language at runtime, e.g. from venue JSON.
 * Strings are merged over any existing definition for the same code.
 * @param {Language} language
 */
export function registerLanguage(language) {
  if (!language || typeof language.code !== 'string' || !language.code.trim()) {
    throw new TypeError('registerLanguage: language.code is required');
  }
  if (!language.strings || typeof language.strings !== 'object') {
    throw new TypeError(`registerLanguage(${language.code}): strings must be an object`);
  }
  const code = language.code.trim().toLowerCase();
  const existing = languages.get(code);
  languages.set(code, {
    code,
    name: language.name?.trim() || existing?.name || code,
    strings: { ...(existing?.strings ?? {}), ...language.strings },
    builtIn: existing?.builtIn ?? false,
  });
  for (const l of listeners) l({ type: 'registered', code });
}

/** Remove every non-built-in language (e.g. when switching venue). */
export function resetLanguages() {
  for (const [code, l] of languages) if (!l.builtIn) languages.delete(code);
  if (!languages.has(currentCode)) currentCode = 'en';
}

/** @returns {Array<{ code: string, name: string, builtIn: boolean }>} */
export function availableLanguages() {
  return [...languages.values()].map(({ code, name, builtIn }) => ({ code, name, builtIn }));
}

/** @param {string} code */
export function hasLanguage(code) {
  return candidates(code).some((c) => languages.has(c));
}

/**
 * Select the active language. Accepts region tags (`mi-NZ` → `mi`).
 * @param {string} code
 * @returns {string} The code actually selected.
 */
export function setLanguage(code) {
  const match = candidates(code).find((c) => languages.has(c));
  if (!match) throw new RangeError(`no strings for language "${code}"`);
  if (match !== currentCode) {
    currentCode = match;
    for (const l of listeners) l({ type: 'changed', code: match });
  }
  return match;
}

export function getLanguage() {
  return currentCode;
}

/**
 * Pick the language for this session: `?lang=`, stored preference, browser
 * languages, else English. Persists nothing by itself.
 *
 * @param {{ search?: string, storage?: Storage | null, navigatorLanguages?: readonly string[] }} [source]
 * @returns {string}
 */
export function detectLanguage({ search = '', storage = null, navigatorLanguages = [] } = {}) {
  const fromQuery = new URLSearchParams(search).get('lang');
  if (fromQuery && hasLanguage(fromQuery)) return setLanguage(fromQuery);
  let stored;
  try {
    stored = storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (stored && hasLanguage(stored)) return setLanguage(stored);
  for (const tag of navigatorLanguages) if (hasLanguage(tag)) return setLanguage(tag);
  return setLanguage('en');
}

/** Persist a language choice. */
export function storeLanguage(code, storage) {
  try {
    storage?.setItem(STORAGE_KEY, code);
  } catch {
    // storage may be unavailable
  }
}

/**
 * Subscribe to language registration and changes.
 * @param {(event: { type: 'changed' | 'registered', code: string }) => void} listener
 * @returns {() => void}
 */
export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Look up a string and interpolate `{param}` placeholders.
 *
 * Unknown keys return the key itself (never throw in a render path) so a
 * missing string is visible in the UI rather than crashing it.
 *
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 * @returns {string}
 */
export function t(key, params = {}) {
  const table = languages.get(currentCode)?.strings ?? en.strings;
  const template = table[key] ?? en.strings[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

/** Display name for a venue category key; unknown keys are title-cased. */
export function categoryName(category) {
  if (!category) return t('category.other');
  const key = `category.${category}`;
  const table = languages.get(currentCode)?.strings ?? en.strings;
  if (key in table || key in en.strings) return t(key);
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Format metres for display: whole metres, never negative. */
export function formatMetres(metres) {
  return String(Math.max(0, Math.round(metres)));
}

/** The reference (English) key set, for tests that check completeness. */
export const REFERENCE_KEYS = Object.freeze(Object.keys(en.strings));
