/**
 * Read design tokens (CSS custom properties from theme.css) from JavaScript,
 * so three.js materials and canvas drawing use the same palette as the DOM —
 * including the high-contrast variant — without any hex literal in code.
 */

/**
 * @param {string} name       e.g. '--color-route'
 * @param {Object} [options]
 * @param {Element} [options.element]   Element to resolve against (default <html>).
 * @param {string} [options.fallback]   Used when the token is undefined (e.g. no stylesheet in tests).
 * @param {(el: Element) => CSSStyleDeclaration} [options.getComputedStyle]
 * @returns {string} The token's value, trimmed.
 */
export function cssToken(name, { element, fallback = '', getComputedStyle: gcs } = {}) {
  const el = element ?? globalThis.document?.documentElement;
  const fn = gcs ?? globalThis.getComputedStyle;
  if (!el || typeof fn !== 'function') return fallback;
  let value;
  try {
    value = fn(el).getPropertyValue(name).trim();
  } catch {
    value = '';
  }
  return value || fallback;
}

/** Register a CSS text block once per document (idempotent by id). */
export function ensureStyle(id, css, doc = globalThis.document) {
  if (!doc || doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = css;
  doc.head.appendChild(style);
}
