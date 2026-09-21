import { describe, expect, it } from 'vitest';

import { HOSPITAL_PLACES, findPlace, suggestPlaces, toPoiCsv } from './places-library.js';
import { validateVenue } from './schema.js';

describe('places library', () => {
  it('has the core hospital destinations with everyday aliases', () => {
    const names = HOSPITAL_PLACES.map((p) => p.name);
    for (const n of [
      'Main entrance',
      'Main reception',
      'Emergency Department reception',
      'Train station',
      'Toilets',
      'Lift',
      'Pharmacy',
      'Radiology',
    ]) {
      expect(names).toContain(n);
    }
    expect(findPlace('ED reception').name).toBe('Emergency Department reception');
    expect(findPlace('public reception').name).toBe('Main reception');
    expect(findPlace('x-ray').name).toBe('Radiology');
    expect(findPlace('wharepaku').name).toBe('Toilets');
    expect(findPlace('nothing like this')).toBeNull();
  });

  it('is well-formed: unique names, non-empty aliases, valid categories and access values', () => {
    const names = HOSPITAL_PLACES.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const p of HOSPITAL_PLACES) {
      expect(p.aliases.length, p.name).toBeGreaterThan(0);
      expect(
        ['clinic', 'facility', 'service', 'retail', 'food', 'exit', 'staff'],
        p.name
      ).toContain(p.category);
      if (p.access) expect(['public', 'staff']).toContain(p.access);
      if (p.category === 'staff') expect(p.access, p.name).toBe('staff');
    }
  });

  it('suggests by prefix or alias, case-insensitively', () => {
    expect(suggestPlaces('train').map((p) => p.name)).toEqual(['Train station']);
    expect(suggestPlaces('RECEP').map((p) => p.name)).toEqual([
      'Main reception',
      'Emergency Department reception',
      'Outpatients reception',
      'Theatre reception',
    ]);
    expect(suggestPlaces('').length).toBe(HOSPITAL_PLACES.length);
  });

  it('produces a pois.csv the build script can consume, and the places validate as POIs', () => {
    const csv = toPoiCsv();
    expect(csv.split('\n')[0]).toBe('id,name,node,aliases,category,access');
    expect(csv).toContain(
      'poi-main-reception,Main reception,n-main-reception,Public reception|Reception|Front desk|Information desk|Enquiries|Check-in,service,'
    );
    // Every template placed on one node makes a valid venue.
    const venue = {
      schemaVersion: 1,
      id: 'lib-check',
      name: 'Library check',
      floors: [{ index: 0, id: 'g', name: 'Ground' }],
      nodes: [{ id: 'n', x: 0, y: 0, floor: 0 }],
      edges: [],
      pois: HOSPITAL_PLACES.map((p, i) => ({
        id: `poi-${i}`,
        name: p.name,
        aliases: p.aliases,
        node: 'n',
        category: p.category,
        ...(p.access ? { access: p.access } : {}),
      })),
    };
    expect(validateVenue(venue)).toEqual([]);
  });
});
