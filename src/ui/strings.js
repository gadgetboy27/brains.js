/**
 * Every user-facing string in the app. Components never inline text; they
 * call `t(key, params)`. Keeping them here makes translation, tone review and
 * accessibility copy edits a single-file change.
 *
 * `{name}`-style placeholders are interpolated from `params`.
 */

export const STRINGS = Object.freeze({
  en: Object.freeze({
    'app.title': 'Indoor wayfinding',

    // HUD
    'hud.noDestination': 'Choose a destination',
    'hud.destination': 'To {name}',
    'hud.distance': '{metres} m',
    'hud.distanceLong': '{metres} metres to go',
    'hud.nextTurn': 'Next: {name}',
    'hud.arrived': 'You have arrived at {name}',
    'hud.arrivedShort': 'Arrived',
    'hud.rescan.title': 'Position uncertain',
    'hud.rescan.body':
      'Point the camera at a sign, a doorway or a QR marker so we can find you again.',
    'hud.rescan.action': 'OK',
    'hud.error.retry': 'Try again',
    'hud.error.dismiss': 'Dismiss',
    'hud.floorChange.up': 'Go up to {floor} via the {via}',
    'hud.floorChange.down': 'Go down to {floor} via the {via}',
    'hud.changeDestination': 'Change destination',
    'hud.cancel': 'Stop navigation',

    // Errors (inline, never alert())
    'error.venueLoad': 'The venue map could not be loaded.',
    'error.cameraDenied': 'Camera access was declined. You can still use the floor plan view.',
    'error.noCamera': 'No camera was found on this device. Use the floor plan view instead.',
    'error.unsupported':
      'This browser cannot run camera positioning. Use the floor plan view instead.',
    'error.positioningExhausted':
      'We cannot work out where you are. Scan a QR marker or use the floor plan view.',
    'error.noRoute': 'No route to {name} with your current settings.',
    'error.noRouteHint': 'Try relaxing the accessibility filters or check opening hours.',
    'error.generic': 'Something went wrong: {message}',

    // Destination picker
    'picker.title': 'Where do you want to go?',
    'picker.searchLabel': 'Search destinations',
    'picker.searchPlaceholder': 'Search by name, e.g. “Clinic B” or “toilets”',
    'picker.clearSearch': 'Clear search',
    'picker.categories': 'Browse by category',
    'picker.allCategories': 'All',
    'picker.results': '{count} destinations',
    'picker.resultsOne': '1 destination',
    'picker.noResults': 'Nothing matches “{query}”.',
    'picker.floor': '{floor}',
    'picker.alias': 'Also known as {aliases}',
    'picker.select': 'Navigate to {name}',
    'picker.highContrast': 'High contrast',
    'picker.close': 'Close',

    // Floor plan view
    'floorplan.title': 'Floor plan',
    'floorplan.floor': '{name}',
    'floorplan.you': 'You are here',
    'floorplan.destination': 'Destination',
    'floorplan.route': 'Route',
    'floorplan.noPose': 'Finding your position…',
    'floorplan.otherFloor': 'Your destination is on {name}.',
    'floorplan.summary':
      'Floor plan of {floor}. You are at {x}, {y} metres, facing {heading} degrees.',

    // View switcher
    'view.ar': 'Camera view',
    'view.floorplan': 'Floor plan',
    'view.switchHint': 'Hold the phone up for the camera view, or down for the floor plan.',

    // Arrow
    'arrow.distance': '{metres} m',

    // Categories (display names for venue category keys)
    'category.clinic': 'Clinics',
    'category.facility': 'Facilities',
    'category.service': 'Services',
    'category.retail': 'Shops',
    'category.food': 'Food & drink',
    'category.exit': 'Exits',
    'category.staff': 'Staff',
    'category.other': 'Other',

    // Floors
    'floor.unknown': 'Unknown floor',
  }),
});

let currentLang = 'en';

/**
 * Select the active language. Falls back to English for missing keys.
 * @param {string} lang
 */
export function setLanguage(lang) {
  if (!STRINGS[lang]) throw new RangeError(`no strings for language "${lang}"`);
  currentLang = lang;
}

export function getLanguage() {
  return currentLang;
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
  const table = STRINGS[currentLang] ?? STRINGS.en;
  const template = table[key] ?? STRINGS.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

/**
 * Display name for a venue category key; unknown keys are title-cased.
 * @param {string | undefined} category
 */
export function categoryName(category) {
  if (!category) return t('category.other');
  const key = `category.${category}`;
  const table = STRINGS[currentLang] ?? STRINGS.en;
  if (key in table || key in STRINGS.en) return t(key);
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Format metres for display: whole metres, never negative. */
export function formatMetres(metres) {
  return String(Math.max(0, Math.round(metres)));
}
