import { describe, expect, it, vi } from 'vitest';

import sample from '../venues/fixtures/sample-venue.json';
import { findRoute } from './router.js';
import { Venue, VenueValidationError, createVenue, loadVenue, normaliseName } from './venue.js';

const venue = () => createVenue(structuredClone(sample));
const ids = (list) => list.map((p) => p.id);

describe('createVenue', () => {
  it('builds a Venue from valid JSON', () => {
    const v = venue();
    expect(v).toBeInstanceOf(Venue);
    expect(v.id).toBe('sample-mall');
    expect(v.name).toBe('Sample Mall');
    expect(v.headingOffsetDeg).toBe(12.5);
    expect(v.providers).toEqual({ immersal: { mapId: 12345 } });
  });

  it('fails loudly on invalid JSON, naming the field', () => {
    const bad = structuredClone(sample);
    bad.pois[1].node = 'n-nope';
    expect(() => createVenue(bad)).toThrow(VenueValidationError);
    expect(() => createVenue(bad)).toThrow(/pois\[1\]\.node: references unknown node "n-nope"/);
  });

  it('defaults headingOffsetDeg to 0 and providers to {} when absent', () => {
    const json = structuredClone(sample);
    delete json.frame;
    delete json.providers;
    const v = createVenue(json);
    expect(v.headingOffsetDeg).toBe(0);
    expect(v.providers).toEqual({});
  });

  it('is immutable', () => {
    const v = venue();
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.graph)).toBe(true);
    expect(Object.isFrozen(v.pois)).toBe(true);
    expect(Object.isFrozen(v.nodeById('n-atrium'))).toBe(true);
    expect(() => {
      v.pois.push({});
    }).toThrow();
  });
});

describe('Venue — floors', () => {
  it('sorts floors by index and looks them up by index and id', () => {
    const json = structuredClone(sample);
    json.floors.reverse();
    const v = createVenue(json);
    expect(v.floors.map((f) => f.index)).toEqual([0, 1]);
    expect(v.floorByIndex(1).name).toBe('Level 1');
    expect(v.floorById('g').index).toBe(0);
    expect(v.floorByIndex(9)).toBeUndefined();
    expect(v.floorById('roof')).toBeUndefined();
  });
});

describe('Venue — nodes', () => {
  it('looks up nodes by id and defaults z to 0', () => {
    const json = structuredClone(sample);
    delete json.nodes[0].z;
    const v = createVenue(json);
    expect(v.nodeById('n-entrance')).toEqual({ id: 'n-entrance', x: 0, y: 0, z: 0, floor: 0 });
    expect(v.nodeById('nope')).toBeUndefined();
  });

  it('groups nodes per floor', () => {
    const v = venue();
    expect(ids(v.nodesOnFloor(0))).toEqual(['n-entrance', 'n-atrium', 'n-shop-a']);
    expect(ids(v.nodesOnFloor(1))).toEqual(['n-l1-landing', 'n-l1-toilets']);
    expect(v.nodesOnFloor(5)).toEqual([]);
    expect(Object.isFrozen(v.nodesOnFloor(0))).toBe(true);
  });

  it('exposes a graph the router accepts', () => {
    const v = venue();
    const route = findRoute(v.graph, 'n-entrance', 'n-l1-toilets', { wheelchair: true });
    expect(route.found).toBe(true);
    expect(route.edges.map((e) => e.type)).not.toContain('stairs');
  });
});

describe('Venue — anchors', () => {
  it('looks up anchors by id with z and heading defaulted', () => {
    const v = venue();
    expect(v.anchors.map((a) => a.id)).toEqual(['a-entrance', 'a-l1-landing']);
    expect(v.anchorById('a-entrance')).toEqual({
      id: 'a-entrance',
      x: 0.5,
      y: 1,
      z: 0,
      floor: 0,
      heading: 90,
    });
    expect(v.anchorById('a-l1-landing')).toMatchObject({ z: 4.2, heading: 0 });
    expect(v.anchorById('nope')).toBeUndefined();
    expect(Object.isFrozen(v.anchors)).toBe(true);
  });

  it('is an empty list when the venue has no anchors', () => {
    const json = structuredClone(sample);
    delete json.anchors;
    const v = createVenue(json);
    expect(v.anchors).toEqual([]);
    expect(v.anchorById('a-entrance')).toBeUndefined();
  });
});

describe('Venue — poi lookups', () => {
  it('by id', () => {
    const v = venue();
    expect(v.poiById('poi-shop-a').name).toBe('Shop A');
    expect(v.poiById('poi-nope')).toBeUndefined();
  });

  it('by name, case- and whitespace-insensitive, returning all matches', () => {
    const v = venue();
    expect(ids(v.poisByName('Information desk'))).toEqual(['poi-info']);
    expect(ids(v.poisByName('  information   DESK '))).toEqual(['poi-info']);
    expect(ids(v.poisByName('Toilets'))).toEqual(['poi-toilets-g', 'poi-toilets-l1']);
    expect(v.poisByName('Cinema')).toEqual([]);
  });

  it('by alias', () => {
    const v = venue();
    expect(ids(v.poisByAlias('help desk'))).toEqual(['poi-info']);
    expect(ids(v.poisByAlias('WC'))).toEqual(['poi-toilets-g', 'poi-toilets-l1']);
    expect(v.poisByAlias('Information desk')).toEqual([]); // a name, not an alias
  });

  it('lookupPois resolves id, then name, then alias', () => {
    const v = venue();
    expect(ids(v.lookupPois('poi-info'))).toEqual(['poi-info']);
    expect(ids(v.lookupPois('information desk'))).toEqual(['poi-info']);
    expect(ids(v.lookupPois('Info'))).toEqual(['poi-info']);
    expect(ids(v.lookupPois('restrooms'))).toEqual(['poi-toilets-g', 'poi-toilets-l1']);
    expect(v.lookupPois('nothing here')).toEqual([]);
  });

  it('lookupPois prefers an id match over a name that happens to equal it', () => {
    const json = structuredClone(sample);
    json.pois.push({ id: 'poi-extra', name: 'poi-info', node: 'n-atrium' });
    const v = createVenue(json);
    expect(ids(v.lookupPois('poi-info'))).toEqual(['poi-info']);
  });

  it('searchPois does substring matching over names and aliases', () => {
    const v = venue();
    expect(ids(v.searchPois('desk'))).toEqual(['poi-info']);
    expect(ids(v.searchPois('rest'))).toEqual(['poi-toilets-g', 'poi-toilets-l1']);
    expect(ids(v.searchPois('SHOP'))).toEqual(['poi-shop-a']);
    expect(v.searchPois('')).toEqual([]);
    expect(v.searchPois('   ')).toEqual([]);
  });

  it('groups pois per floor and per node', () => {
    const v = venue();
    expect(ids(v.poisOnFloor(0))).toEqual(['poi-info', 'poi-shop-a', 'poi-toilets-g']);
    expect(ids(v.poisOnFloor(1))).toEqual(['poi-toilets-l1', 'poi-staff-room']);
    expect(v.poisOnFloor(3)).toEqual([]);
    expect(ids(v.poisAtNode('n-atrium'))).toEqual(['poi-info']);
    expect(v.poisAtNode('n-shop-a')[0].category).toBe('retail');
    expect(v.poisAtNode('n-nope')).toEqual([]);
  });

  it('defaults aliases to an empty array', () => {
    const v = venue();
    expect(v.poiById('poi-shop-a').aliases).toEqual([]);
  });
});

describe('normaliseName', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normaliseName('  Help   Desk\n')).toBe('help desk');
    expect(normaliseName('WC')).toBe('wc');
  });
});

describe('loadVenue', () => {
  it('accepts an object', async () => {
    const v = await loadVenue(structuredClone(sample));
    expect(v.id).toBe('sample-mall');
  });

  it('accepts a JSON string', async () => {
    const v = await loadVenue(JSON.stringify(sample));
    expect(v.id).toBe('sample-mall');
  });

  it('reports unparsable JSON', async () => {
    await expect(loadVenue('{ not json')).rejects.toThrow(/venue JSON could not be parsed/);
  });

  it('fetches a URL', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => structuredClone(sample),
    }));
    const v = await loadVenue('https://example.test/venue.json', { fetch });
    expect(fetch).toHaveBeenCalledWith('https://example.test/venue.json');
    expect(v.id).toBe('sample-mall');

    const asUrl = await loadVenue(new URL('https://example.test/venue.json'), { fetch });
    expect(asUrl.id).toBe('sample-mall');

    const relative = await loadVenue('/venues/sample.json', { fetch });
    expect(relative.id).toBe('sample-mall');
  });

  it('reports HTTP failures', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    await expect(loadVenue('https://example.test/missing.json', { fetch })).rejects.toThrow(
      /failed to load venue from https:\/\/example.test\/missing.json: HTTP 404/
    );
  });

  it('propagates validation errors from fetched JSON', async () => {
    const bad = structuredClone(sample);
    bad.floors = [];
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => bad }));
    await expect(loadVenue('https://example.test/venue.json', { fetch })).rejects.toThrow(
      VenueValidationError
    );
  });

  it('fails clearly when no fetch is available', async () => {
    await expect(loadVenue('https://example.test/venue.json', { fetch: null })).rejects.toThrow(
      /no fetch available/
    );
  });
});
