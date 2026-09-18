import { describe, expect, it, vi } from 'vitest';

import { clearVenueCache, loadVenueCache, saveVenueCache } from './venue-cache.js';

const mem = () => {
  const data = {};
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => (data[k] = v),
    removeItem: (k) => delete data[k],
    data,
  };
};

describe('venue cache', () => {
  it('round-trips JSON per URL with a timestamp', () => {
    const storage = mem();
    expect(saveVenueCache('/v.json', { id: 'x' }, storage, () => 42)).toBe(true);
    expect(loadVenueCache('/v.json', storage)).toEqual({ savedAt: 42, json: { id: 'x' } });
    expect(loadVenueCache('/other.json', storage)).toBeNull();
    clearVenueCache('/v.json', storage);
    expect(loadVenueCache('/v.json', storage)).toBeNull();
  });

  it('tolerates missing, full or corrupt storage', () => {
    expect(saveVenueCache('/v.json', {}, null)).toBe(false);
    expect(loadVenueCache('/v.json', null)).toBeNull();
    const full = {
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
      getItem: () => null,
    };
    expect(saveVenueCache('/v.json', {}, full)).toBe(false);
    const corrupt = { getItem: () => '{not json', setItem: vi.fn() };
    expect(loadVenueCache('/v.json', corrupt)).toBeNull();
    const wrongShape = { getItem: () => '{"nope":1}' };
    expect(loadVenueCache('/v.json', wrongShape)).toBeNull();
  });
});
