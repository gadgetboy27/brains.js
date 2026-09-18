/**
 * Destination picker — search and browse the venue's points of interest.
 *
 *  - Search matches names **and aliases** (via `Venue.searchPois`), so "WC"
 *    finds "Toilets" and "physio" finds "Clinic A".
 *  - Category chips filter the list; categories come from the venue data.
 *  - Staff-only POIs are hidden unless `showStaff` is set.
 *
 * Accessibility:
 *  - Search box is a `combobox` controlling a `listbox` of `option`s;
 *    ArrowUp/Down move the active option (`aria-activedescendant`), Enter
 *    selects, Escape clears. Every option is also a real button, so it works
 *    with a screen reader's browse mode and with touch.
 *  - Touch targets are ≥ 48 px (token). Result count is announced through an
 *    `aria-live` region.
 *  - High-contrast mode toggles `data-contrast="high"` on <html>, which
 *    switches every token in theme.css (a checkbox, persisted in
 *    localStorage when available).
 *
 * All text comes from strings.js.
 */

import { categoryName, t } from './strings.js';
import { ensureStyle } from './tokens.js';

/** @typedef {import('../core/venue.js').Venue} Venue */

const CSS = `
.picker { position: fixed; inset: 0; z-index: 30; overflow: auto; padding: 16px; box-sizing: border-box;
  background: var(--color-bg); color: var(--color-text); font-family: var(--font); font-size: var(--font-size); }
.picker[hidden] { display: none; }
.picker-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.picker h2 { margin: 0; font-size: var(--font-size-large); }
.picker-search { position: relative; margin: 12px 0; }
.picker-search input { width: 100%; box-sizing: border-box; min-height: var(--touch-target); padding: 10px 52px 10px 14px;
  border: 2px solid var(--color-accent); border-radius: var(--radius); background: var(--color-surface-solid);
  color: var(--color-text); font: inherit; }
.picker-search .picker-clear { position: absolute; right: 4px; top: 4px; bottom: 4px; min-width: 44px; padding: 0 10px; }
.picker-cats { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }
.picker-count { color: var(--color-text-muted); margin: 0 0 8px; }
.picker-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.picker-option { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 12px; width: 100%; text-align: left;
  min-height: 64px; padding: 12px 16px; border: 2px solid transparent; border-radius: var(--radius);
  background: var(--color-surface-solid); color: var(--color-text); font: inherit; cursor: pointer; touch-action: manipulation; }
.picker-option[aria-selected='true'], .picker-option:hover { border-color: var(--color-accent); }
.picker-option .name { font-weight: 700; font-size: 1.1em; }
.picker-option .floor { color: var(--color-text-muted); white-space: nowrap; }
.picker-option .alias { grid-column: 1 / -1; color: var(--color-text-muted); font-size: 0.9em; }
.picker-empty { padding: 16px; color: var(--color-text-muted); }
.picker-contrast { display: inline-flex; align-items: center; gap: 8px; min-height: var(--touch-target); cursor: pointer; }
.picker-contrast input { width: 24px; height: 24px; }
`;

const CONTRAST_KEY = 'brains:contrast';

export class DestinationPicker {
  #venue;
  #doc;
  #el;
  #f;
  #onSelect;
  #onClose;
  #showStaff;
  #query = '';
  #category = null;
  #results = [];
  #active = -1;
  #storage;
  #listId;

  /**
   * @param {Object} options
   * @param {Venue} options.venue
   * @param {(poi: object) => void} options.onSelect
   * @param {() => void} [options.onClose]
   * @param {HTMLElement} [options.mount]
   * @param {Document} [options.document]
   * @param {boolean} [options.showStaff=false]
   * @param {Storage | null} [options.storage]   For persisting the contrast choice.
   */
  constructor(options) {
    if (!options?.venue?.searchPois) throw new TypeError('DestinationPicker requires a Venue');
    if (typeof options.onSelect !== 'function')
      throw new TypeError('DestinationPicker requires onSelect');
    this.#venue = options.venue;
    this.#doc = options.document ?? globalThis.document;
    if (!this.#doc) throw new TypeError('DestinationPicker requires a document');
    this.#onSelect = options.onSelect;
    this.#onClose = options.onClose;
    this.#showStaff = Boolean(options.showStaff);
    this.#storage = options.storage === undefined ? safeStorage() : options.storage;
    this.#listId = `picker-list-${Math.random().toString(36).slice(2, 8)}`;

    ensureStyle('brains-picker-style', CSS, this.#doc);
    const el = this.#doc.createElement('section');
    el.className = 'picker';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', `${this.#listId}-title`);
    el.innerHTML = `
      <div class="picker-head">
        <h2 id="${this.#listId}-title"></h2>
        <button type="button" class="btn" data-f="close" hidden></button>
      </div>
      <label class="picker-contrast">
        <input type="checkbox" data-f="contrast" />
        <span data-f="contrast-label"></span>
      </label>
      <div class="picker-search">
        <label class="visually-hidden" for="${this.#listId}-input" data-f="search-label"></label>
        <input id="${this.#listId}-input" type="search" data-f="input" role="combobox" autocomplete="off"
               aria-autocomplete="list" aria-expanded="true" aria-controls="${this.#listId}" />
        <button type="button" class="btn picker-clear" data-f="clear" hidden aria-label=""></button>
      </div>
      <p class="visually-hidden" data-f="cats-label"></p>
      <ul class="picker-cats" data-f="cats" role="group"></ul>
      <p class="picker-count" data-f="count" aria-live="polite"></p>
      <ul class="picker-list" id="${this.#listId}" data-f="list" role="listbox"></ul>
      <p class="picker-empty" data-f="empty" hidden></p>
    `;
    this.#el = el;
    this.#f = (name) => el.querySelector(`[data-f="${name}"]`);
    (options.mount ?? this.#doc.body).appendChild(el);

    this.#f('close').textContent = t('picker.close');
    this.#f('close').hidden = !this.#onClose;
    this.#f('close').addEventListener('click', () => this.#onClose?.());
    el.querySelector('h2').textContent = t('picker.title');
    this.#f('search-label').textContent = t('picker.searchLabel');
    this.#f('input').placeholder = t('picker.searchPlaceholder');
    this.#f('clear').setAttribute('aria-label', t('picker.clearSearch'));
    this.#f('clear').textContent = '×';
    this.#f('cats-label').textContent = t('picker.categories');
    this.#f('cats').setAttribute('aria-label', t('picker.categories'));
    this.#f('contrast-label').textContent = t('picker.highContrast');

    const input = this.#f('input');
    input.addEventListener('input', () => this.setQuery(input.value));
    input.addEventListener('keydown', (e) => this.#onKey(e));
    this.#f('clear').addEventListener('click', () => {
      this.setQuery('');
      input.focus();
    });

    const contrast = this.#f('contrast');
    contrast.checked = this.#doc.documentElement.getAttribute('data-contrast') === 'high';
    contrast.addEventListener('change', () => this.setHighContrast(contrast.checked));

    this.#buildCategories();
    this.#update();
  }

  get el() {
    return this.#el;
  }

  /** The POIs currently listed, in order. */
  get results() {
    return [...this.#results];
  }

  get query() {
    return this.#query;
  }

  get category() {
    return this.#category;
  }

  // ---------------------------------------------------------------- state

  /** @param {string} query */
  setQuery(query) {
    this.#query = query;
    const input = this.#f('input');
    if (input.value !== query) input.value = query;
    this.#f('clear').hidden = query === '';
    this.#active = -1;
    this.#update();
  }

  /** @param {string | null} category */
  setCategory(category) {
    this.#category = category;
    for (const btn of this.#f('cats').querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String((btn.dataset.category || null) === category));
    }
    this.#active = -1;
    this.#update();
  }

  /** @param {boolean} on */
  setHighContrast(on) {
    const html = this.#doc.documentElement;
    if (on) html.setAttribute('data-contrast', 'high');
    else html.removeAttribute('data-contrast');
    this.#f('contrast').checked = on;
    try {
      this.#storage?.setItem(CONTRAST_KEY, on ? 'high' : 'normal');
    } catch {
      // storage may be unavailable
    }
  }

  #visiblePois() {
    return this.#venue.pois.filter((p) => this.#showStaff || (p.access ?? 'public') === 'public');
  }

  #buildCategories() {
    const cats = this.#f('cats');
    cats.textContent = '';
    const categories = [
      ...new Set(
        this.#visiblePois()
          .map((p) => p.category)
          .filter(Boolean)
      ),
    ].sort();
    const make = (key, label) => {
      const li = this.#doc.createElement('li');
      const btn = this.#doc.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.textContent = label;
      btn.dataset.category = key ?? '';
      btn.setAttribute('aria-pressed', String((key ?? null) === this.#category));
      btn.addEventListener('click', () => this.setCategory(key));
      li.appendChild(btn);
      cats.appendChild(li);
    };
    make(null, t('picker.allCategories'));
    for (const c of categories) make(c, categoryName(c));
  }

  #update() {
    const q = this.#query.trim();
    let pois = q ? this.#venue.searchPois(q) : this.#visiblePois();
    if (!this.#showStaff) pois = pois.filter((p) => (p.access ?? 'public') === 'public');
    if (this.#category) pois = pois.filter((p) => p.category === this.#category);
    this.#results = pois;
    this.#renderList();
  }

  #renderList() {
    const list = this.#f('list');
    list.textContent = '';
    const count = this.#results.length;
    this.#f('count').textContent =
      count === 1 ? t('picker.resultsOne') : t('picker.results', { count });
    const empty = this.#f('empty');
    empty.hidden = count > 0;
    empty.textContent = count > 0 ? '' : t('picker.noResults', { query: this.#query.trim() });

    this.#results.forEach((poi, i) => {
      const li = this.#doc.createElement('li');
      const btn = this.#doc.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-option';
      btn.id = `${this.#listId}-opt-${i}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', String(i === this.#active));
      btn.setAttribute('aria-label', t('picker.select', { name: poi.name }));
      const node = this.#venue.nodeById(poi.node);
      const floorIndex = poi.floor ?? node?.floor;
      const floorName = this.#venue.floorByIndex(floorIndex)?.name ?? t('floor.unknown');
      const aliases = (poi.aliases ?? []).filter((a) => a);
      btn.innerHTML = `<span class="name"></span><span class="floor"></span>${aliases.length ? '<span class="alias"></span>' : ''}`;
      btn.querySelector('.name').textContent = poi.name;
      btn.querySelector('.floor').textContent = t('picker.floor', { floor: floorName });
      if (aliases.length)
        btn.querySelector('.alias').textContent = t('picker.alias', {
          aliases: aliases.join(', '),
        });
      btn.addEventListener('click', () => this.#select(i));
      li.appendChild(btn);
      list.appendChild(li);
    });
    this.#applyActive();
  }

  #applyActive() {
    const input = this.#f('input');
    const options = this.#f('list').querySelectorAll('[role="option"]');
    options.forEach((o, i) => o.setAttribute('aria-selected', String(i === this.#active)));
    if (this.#active >= 0 && options[this.#active]) {
      input.setAttribute('aria-activedescendant', options[this.#active].id);
      options[this.#active].scrollIntoView?.({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  #onKey(e) {
    const n = this.#results.length;
    switch (e.key) {
      case 'ArrowDown':
        if (n === 0) return;
        e.preventDefault();
        this.#active = (this.#active + 1) % n;
        this.#applyActive();
        break;
      case 'ArrowUp':
        if (n === 0) return;
        e.preventDefault();
        this.#active = this.#active < 0 ? n - 1 : (this.#active - 1 + n) % n;
        this.#applyActive();
        break;
      case 'Enter':
        if (n === 0) return;
        e.preventDefault();
        this.#select(this.#active >= 0 ? this.#active : 0);
        break;
      case 'Escape':
        e.preventDefault();
        if (this.#query) this.setQuery('');
        else this.#onClose?.();
        break;
      default:
    }
  }

  #select(index) {
    const poi = this.#results[index];
    if (poi) this.#onSelect(poi);
  }

  // ------------------------------------------------------------ lifecycle

  /** Show the picker and focus the search box. */
  open() {
    this.#el.hidden = false;
    this.#f('input').focus();
  }

  close() {
    this.#el.hidden = true;
  }

  get isOpen() {
    return !this.#el.hidden;
  }

  destroy() {
    this.#el.remove();
  }
}

/** Apply a persisted or OS-level contrast preference to <html>. Call at boot. */
export function applyContrastPreference({
  document: doc = globalThis.document,
  storage = safeStorage(),
  matchMedia = globalThis.matchMedia,
} = {}) {
  if (!doc) return false;
  let stored;
  try {
    stored = storage?.getItem(CONTRAST_KEY) ?? null;
  } catch {
    stored = null;
  }
  let high;
  if (stored === 'high') high = true;
  else if (stored === 'normal') high = false;
  else
    high = Boolean(
      typeof matchMedia === 'function' && matchMedia('(prefers-contrast: more)')?.matches
    );
  if (high) doc.documentElement.setAttribute('data-contrast', 'high');
  else doc.documentElement.removeAttribute('data-contrast');
  return high;
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** @param {ConstructorParameters<typeof DestinationPicker>[0]} options */
export function createDestinationPicker(options) {
  return new DestinationPicker(options);
}
