import { afterEach, describe, expect, it, vi } from 'vitest';

import en from './en.js';
import {
  REFERENCE_KEYS,
  availableLanguages,
  categoryName,
  detectLanguage,
  getLanguage,
  hasLanguage,
  onLanguageChange,
  registerLanguage,
  resetLanguages,
  setLanguage,
  storeLanguage,
  t,
} from './index.js';
import mi from './mi.js';

afterEach(() => {
  resetLanguages();
  setLanguage('en');
});

describe('language files', () => {
  it('English is the reference and every key has a non-empty string', () => {
    for (const [key, value] of Object.entries(en.strings)) {
      expect(typeof value, key).toBe('string');
      expect(value.trim(), key).not.toBe('');
    }
    expect(REFERENCE_KEYS.length).toBeGreaterThan(50);
  });

  it('te reo Māori covers every reference key and uses the same placeholders', () => {
    for (const key of REFERENCE_KEYS) {
      expect(mi.strings, key).toHaveProperty(key);
      const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(mi.strings[key]), key).toEqual(ph(en.strings[key]));
    }
    expect(Object.keys(mi.strings).filter((k) => !(k in en.strings))).toEqual([]); // no stray keys
  });

  it('lists built-in languages', () => {
    expect(availableLanguages()).toEqual([
      { code: 'en', name: 'English', builtIn: true },
      { code: 'mi', name: 'Te reo Māori', builtIn: true },
    ]);
  });
});

describe('t()', () => {
  it('interpolates and falls back to the key', () => {
    expect(t('hud.destination', { name: 'Clinic A' })).toBe('To Clinic A');
    expect(t('hud.destination')).toBe('To {name}');
    expect(t('nope.missing')).toBe('nope.missing');
  });

  it('switches language and falls back to English per key', () => {
    setLanguage('mi');
    expect(t('picker.title')).toBe('Kei hea koe e haere ana?');
    expect(t('hud.arrived', { name: 'Clinic A' })).toBe('Kua tae koe ki Clinic A');
    registerLanguage({ code: 'xx', name: 'Test', strings: { 'picker.title': 'Where to?' } });
    setLanguage('xx');
    expect(t('picker.title')).toBe('Where to?');
    expect(t('picker.close')).toBe('Close'); // fallback
  });

  it('accepts region tags and rejects unknown languages', () => {
    expect(setLanguage('mi-NZ')).toBe('mi');
    expect(getLanguage()).toBe('mi');
    expect(() => setLanguage('tlh')).toThrow(RangeError);
    expect(hasLanguage('EN-GB')).toBe(true);
    expect(hasLanguage('fr')).toBe(false);
  });

  it('categoryName translates known keys and title-cases others', () => {
    expect(categoryName('clinic')).toBe('Clinics');
    expect(categoryName('pharmacy')).toBe('Pharmacy');
    expect(categoryName(undefined)).toBe('Other');
    setLanguage('mi');
    expect(categoryName('clinic')).toBe('Ngā whare haumanu');
  });
});

describe('venue-provided languages', () => {
  it('registers a community language with partial coverage, and can override built-ins', () => {
    const events = [];
    const off = onLanguageChange((e) => events.push(e));
    registerLanguage({
      code: 'sm',
      name: 'Gagana Sāmoa',
      strings: { 'picker.title': 'O fea e te alu i ai?' },
    });
    expect(availableLanguages().at(-1)).toEqual({
      code: 'sm',
      name: 'Gagana Sāmoa',
      builtIn: false,
    });
    setLanguage('sm');
    expect(t('picker.title')).toBe('O fea e te alu i ai?');
    expect(t('hud.cancel')).toBe(en.strings['hud.cancel']);

    // A venue may also override a built-in language's wording.
    registerLanguage({ code: 'en', strings: { 'hud.noDestination': 'Where to today?' } });
    setLanguage('en');
    expect(t('hud.noDestination')).toBe('Where to today?');
    expect(availableLanguages().find((l) => l.code === 'en').builtIn).toBe(true);

    expect(events.map((e) => e.type)).toEqual(['registered', 'changed', 'registered', 'changed']);
    off();
    resetLanguages();
    expect(hasLanguage('sm')).toBe(false);
    expect(t('hud.noDestination')).toBe('Where to today?'); // overrides of built-ins persist
    // restore
    registerLanguage({
      code: 'en',
      strings: { 'hud.noDestination': en.strings['hud.noDestination'] },
    });
  });

  it('validates registrations', () => {
    expect(() => registerLanguage({ name: 'x', strings: {} })).toThrow(TypeError);
    expect(() => registerLanguage({ code: 'x', strings: 'no' })).toThrow(TypeError);
  });
});

describe('detectLanguage', () => {
  it('prefers query, then storage, then browser languages, then English', () => {
    const storage = { getItem: vi.fn(() => 'mi'), setItem: vi.fn() };
    expect(detectLanguage({ search: '?lang=en', storage, navigatorLanguages: ['mi'] })).toBe('en');
    expect(detectLanguage({ search: '', storage, navigatorLanguages: ['en'] })).toBe('mi');
    expect(
      detectLanguage({ search: '', storage: null, navigatorLanguages: ['fr-FR', 'mi-NZ'] })
    ).toBe('mi');
    expect(detectLanguage({ search: '', storage: null, navigatorLanguages: ['fr'] })).toBe('en');
    expect(detectLanguage({ search: '?lang=tlh', storage: null, navigatorLanguages: [] })).toBe(
      'en'
    );
  });

  it('storeLanguage persists and tolerates broken storage', () => {
    const storage = { setItem: vi.fn() };
    storeLanguage('mi', storage);
    expect(storage.setItem).toHaveBeenCalledWith('brains:lang', 'mi');
    expect(() =>
      storeLanguage('mi', {
        setItem: () => {
          throw new Error('quota');
        },
      })
    ).not.toThrow();
  });
});
