// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVenue } from '../core/venue.js';
import demo from '../venues/demo-venue.json';
import { applyContrastPreference, createDestinationPicker } from './destination-picker.js';
import { t } from './strings/index.js';

const venue = () => createVenue(structuredClone(demo));

function make(options = {}) {
  const onSelect = vi.fn();
  const storage = new Map();
  const picker = createDestinationPicker({
    venue: venue(),
    onSelect,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    ...options,
  });
  return { picker, onSelect, storage };
}

const names = (picker) => picker.results.map((p) => p.name);
const optionEls = (picker) => [...picker.el.querySelectorAll('[role="option"]')];
const press = (picker, key) => {
  const input = picker.el.querySelector('[data-f="input"]');
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-contrast');
});

describe('DestinationPicker — listing', () => {
  it('requires a venue and onSelect', () => {
    expect(() => createDestinationPicker({})).toThrow(/requires a Venue/);
    expect(() => createDestinationPicker({ venue: venue() })).toThrow(/requires onSelect/);
  });

  it('lists every public POI by default with floor and aliases, hiding staff POIs', () => {
    const { picker } = make();
    expect(names(picker)).toEqual([
      'Main entrance',
      'Reception',
      'Clinic A',
      'Clinic B',
      'Toilets',
      'Lift',
      'Stairs',
    ]);
    expect(names(picker)).not.toContain('Staff room');
    const clinicB = optionEls(picker)[3];
    expect(clinicB.querySelector('.name').textContent).toBe('Clinic B');
    expect(clinicB.querySelector('.floor').textContent).toBe('First floor');
    expect(clinicB.querySelector('.alias').textContent).toBe('Also known as Dermatology');
    expect(clinicB.getAttribute('aria-label')).toBe('Navigate to Clinic B');
    expect(picker.el.querySelector('[data-f="count"]').textContent).toBe('7 destinations');
  });

  it('shows staff POIs when asked', () => {
    const { picker } = make({ showStaff: true });
    expect(names(picker)).toContain('Staff room');
  });

  it('searches names and aliases', () => {
    const { picker } = make();
    picker.setQuery('wc');
    expect(names(picker)).toEqual(['Toilets']);
    picker.setQuery('DERMA');
    expect(names(picker)).toEqual(['Clinic B']);
    picker.setQuery('clinic');
    expect(names(picker)).toEqual(['Clinic A', 'Clinic B']);
    picker.setQuery('elevator');
    expect(names(picker)).toEqual(['Lift']);
    expect(picker.el.querySelector('[data-f="count"]').textContent).toBe('1 destination');
  });

  it('shows a no-results message using the query', () => {
    const { picker } = make();
    picker.setQuery('helipad');
    expect(names(picker)).toEqual([]);
    const empty = picker.el.querySelector('[data-f="empty"]');
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('Nothing matches “helipad”.');
  });

  it('typing in the box updates results; clear resets', () => {
    const { picker } = make();
    const input = picker.el.querySelector('[data-f="input"]');
    input.value = 'toil';
    input.dispatchEvent(new Event('input'));
    expect(names(picker)).toEqual(['Toilets']);
    const clear = picker.el.querySelector('[data-f="clear"]');
    expect(clear.hidden).toBe(false);
    clear.click();
    expect(picker.query).toBe('');
    expect(names(picker)).toHaveLength(7);
    expect(clear.hidden).toBe(true);
  });

  it('browses by category with pressed-state chips, combined with search', () => {
    const { picker } = make();
    const chips = [...picker.el.querySelectorAll('[data-f="cats"] button')];
    expect(chips.map((c) => c.textContent)).toEqual([
      'All',
      'Clinics',
      'Exits',
      'Facilities',
      'Services',
    ]);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');

    chips[1].click(); // Clinics
    expect(picker.category).toBe('clinic');
    expect(names(picker)).toEqual(['Clinic A', 'Clinic B']);
    expect(chips[1].getAttribute('aria-pressed')).toBe('true');
    expect(chips[0].getAttribute('aria-pressed')).toBe('false');

    picker.setQuery('b');
    expect(names(picker)).toEqual(['Clinic B']);
    chips[0].click();
    expect(names(picker)).toEqual(['Clinic B', 'Toilets']); // "b" matches Bathroom alias too
  });
});

describe('DestinationPicker — selection and keyboard', () => {
  it('selects on click', () => {
    const { picker, onSelect } = make();
    optionEls(picker)[2].click();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0].id).toBe('poi-clinic-a');
  });

  it('is a combobox controlling a listbox', () => {
    const { picker } = make();
    const input = picker.el.querySelector('[data-f="input"]');
    const list = picker.el.querySelector('[data-f="list"]');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(list.getAttribute('role')).toBe('listbox');
    expect(picker.el.getAttribute('role')).toBe('dialog');
    expect(picker.el.querySelector('label[for]').textContent).toBe(t('picker.searchLabel'));
  });

  it('arrow keys move the active option and Enter selects it', () => {
    const { picker, onSelect } = make();
    const input = picker.el.querySelector('[data-f="input"]');
    press(picker, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(optionEls(picker)[0].id);
    expect(optionEls(picker)[0].getAttribute('aria-selected')).toBe('true');
    press(picker, 'ArrowDown');
    press(picker, 'ArrowDown');
    expect(optionEls(picker)[2].getAttribute('aria-selected')).toBe('true');
    press(picker, 'ArrowUp');
    expect(optionEls(picker)[1].getAttribute('aria-selected')).toBe('true');
    press(picker, 'Enter');
    expect(onSelect.mock.calls[0][0].name).toBe('Reception');
  });

  it('wraps around and Enter with no active option picks the first result', () => {
    const { picker, onSelect } = make();
    press(picker, 'ArrowUp');
    expect(optionEls(picker)[6].getAttribute('aria-selected')).toBe('true');
    picker.setQuery('clinic');
    press(picker, 'Enter');
    expect(onSelect.mock.calls[0][0].name).toBe('Clinic A');
  });

  it('Escape clears the query, then closes', () => {
    const onClose = vi.fn();
    const { picker } = make({ onClose });
    picker.setQuery('x');
    press(picker, 'Escape');
    expect(picker.query).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    press(picker, 'Escape');
    expect(onClose).toHaveBeenCalledOnce();
    const close = picker.el.querySelector('[data-f="close"]');
    expect(close.hidden).toBe(false);
    close.click();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('open() focuses the search box; close() hides', () => {
    const { picker } = make();
    picker.close();
    expect(picker.isOpen).toBe(false);
    picker.open();
    expect(picker.isOpen).toBe(true);
    expect(document.activeElement).toBe(picker.el.querySelector('[data-f="input"]'));
  });
});

describe('DestinationPicker — high contrast', () => {
  it('toggles data-contrast on <html> and persists the choice', () => {
    const { picker, storage } = make();
    const box = picker.el.querySelector('[data-f="contrast"]');
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');
    expect(storage.get('brains:contrast')).toBe('high');
    picker.setHighContrast(false);
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
    expect(storage.get('brains:contrast')).toBe('normal');
  });

  it('applyContrastPreference honours storage, then the OS preference', () => {
    const storage = { getItem: () => 'high', setItem: () => {} };
    expect(applyContrastPreference({ storage })).toBe(true);
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');

    const none = { getItem: () => null, setItem: () => {} };
    expect(applyContrastPreference({ storage: none, matchMedia: () => ({ matches: true }) })).toBe(
      true
    );
    expect(applyContrastPreference({ storage: none, matchMedia: () => ({ matches: false }) })).toBe(
      false
    );
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
    expect(
      applyContrastPreference({
        storage: { getItem: () => 'normal' },
        matchMedia: () => ({ matches: true }),
      })
    ).toBe(false);
  });

  it('touch targets are large: options are at least 48px tall by style', () => {
    make();
    const css = document.getElementById('brains-picker-style').textContent;
    expect(css).toMatch(/\.picker-option \{[^}]*min-height: 64px/);
    expect(css).toMatch(/min-height: var\(--touch-target\)/);
  });
});
