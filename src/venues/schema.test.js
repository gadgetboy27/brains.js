import { describe, expect, it } from 'vitest';

import sample from './fixtures/sample-venue.json';
import {
  ACCESS,
  EDGE_TYPES,
  SCHEMA_VERSION,
  VenueValidationError,
  assertVenue,
  validateVenue,
} from './schema.js';

const clone = () => structuredClone(sample);
const paths = (venue) => validateVenue(venue).map((e) => e.path);

/** Assert exactly one error whose path is `path` and whose message matches. */
function expectSingleError(venue, path, message) {
  const errors = validateVenue(venue);
  expect(errors, JSON.stringify(errors)).toHaveLength(1);
  expect(errors[0].path).toBe(path);
  if (message) expect(errors[0].message).toMatch(message);
}

describe('validateVenue — valid input', () => {
  it('accepts the sample fixture', () => {
    expect(validateVenue(sample)).toEqual([]);
    expect(() => assertVenue(sample)).not.toThrow();
  });

  it('accepts the minimal venue', () => {
    const minimal = {
      schemaVersion: SCHEMA_VERSION,
      id: 'v',
      name: 'V',
      floors: [{ index: 0, id: 'g', name: 'Ground' }],
      nodes: [{ id: 'n', x: 0, y: 0, floor: 0 }],
      edges: [],
      pois: [],
    };
    expect(validateVenue(minimal)).toEqual([]);
  });
});

describe('validateVenue — top level', () => {
  it('rejects non-objects with a readable message', () => {
    expect(validateVenue(null)).toEqual([
      { path: 'venue', message: 'must be an object, got null' },
    ]);
    expect(paths([])).toEqual(['venue']);
    expect(paths('{}')).toEqual(['venue']);
  });

  it('requires the current schemaVersion', () => {
    const v = clone();
    v.schemaVersion = 2;
    expectSingleError(v, 'schemaVersion', /must be 1, got 2/);
    delete v.schemaVersion;
    expectSingleError(v, 'schemaVersion', /got undefined/);
  });

  it('requires id as a slug and a non-empty name', () => {
    const v = clone();
    v.id = 'has spaces';
    expectSingleError(v, 'id', /slug/);
    v.id = 'ok';
    v.name = '   ';
    expectSingleError(v, 'name', /non-empty string/);
    delete v.name;
    expectSingleError(v, 'name', /is required/);
  });

  it('validates frame.headingOffsetDeg when present', () => {
    const v = clone();
    v.frame = { headingOffsetDeg: 'north' };
    expectSingleError(v, 'frame.headingOffsetDeg', /finite number/);
    v.frame = 'north';
    expectSingleError(v, 'frame', /must be an object/);
  });

  it('requires providers to be an object when present', () => {
    const v = clone();
    v.providers = ['immersal'];
    expectSingleError(v, 'providers', /must be an object, got an array/);
  });

  it('validates the providers block field by field', () => {
    const v = clone();
    v.providers.order = ['qr', 'qr'];
    expectSingleError(v, 'providers.order[1]', /duplicate "qr"/);
    v.providers.order = [];
    expectSingleError(v, 'providers.order', /at least 1 item/);
    delete v.providers.order;
    v.providers.immersal.mapId = 0;
    expectSingleError(v, 'providers.immersal.mapId', /must be >= 1/);
    v.providers.immersal.mapId = 12345;
    v.providers.immersal.origin = { x: 0, y: 0 };
    expectSingleError(v, 'providers.immersal.origin.z', /is required/);
    delete v.providers.immersal.origin;
    v.providers.beacons = 'yes';
    expectSingleError(v, 'providers.beacons', /must be an object/);
  });

  it('rejects GPS coordinates at the top level', () => {
    const v = clone();
    v.lat = 51.5;
    v.longitude = -0.1;
    expect(paths(v).sort()).toEqual(['venue.lat', 'venue.longitude']);
    expect(validateVenue(v)[0].message).toMatch(/must not contain GPS coordinates/);
  });
});

describe('validateVenue — floors', () => {
  it('requires at least one floor', () => {
    const v = clone();
    v.floors = [];
    // Nodes then all reference an undefined floor too.
    expect(paths(v)[0]).toBe('floors');
    expect(validateVenue(v)[0].message).toMatch(/at least 1 item/);
  });

  it('requires index to be an integer and id a slug', () => {
    const v = clone();
    v.floors[1].index = 1.5;
    expect(paths(v)).toContain('floors[1].index');
    v.floors[1].index = 1;
    v.floors[1].id = '';
    expectSingleError(v, 'floors[1].id', /non-empty string/);
  });

  it('rejects duplicate floor indexes and ids naming both positions', () => {
    const v = clone();
    v.floors[1].index = 0;
    // nodes on floor 1 now reference an undefined floor as well
    const errors = validateVenue(v);
    const dup = errors.find((e) => e.path === 'floors[1].index');
    expect(dup.message).toMatch(/duplicate index 0 \(first used at floors\[0\]\)/);

    const w = clone();
    w.floors[1].id = 'g';
    expectSingleError(w, 'floors[1].id', /duplicate id "g"/);
  });

  it('rejects GPS coordinates on a floor', () => {
    const v = clone();
    v.floors[0].lon = 0;
    expectSingleError(v, 'floors[0].lon', /GPS/);
  });
});

describe('validateVenue — nodes', () => {
  it('requires at least one node', () => {
    const v = clone();
    v.nodes = [];
    expect(paths(v)[0]).toBe('nodes');
  });

  it('names the exact bad coordinate', () => {
    const v = clone();
    v.nodes[2].x = '20';
    expectSingleError(v, 'nodes[2].x', /must be a finite number, got "20"/);
    v.nodes[2].x = 20;
    v.nodes[2].y = NaN;
    expectSingleError(v, 'nodes[2].y', /finite number/);
    v.nodes[2].y = 0;
    v.nodes[2].z = Infinity;
    expectSingleError(v, 'nodes[2].z', /finite number/);
  });

  it('requires floor to be a defined floor index', () => {
    const v = clone();
    v.nodes[0].floor = 7;
    expectSingleError(v, 'nodes[0].floor', /references undefined floor index 7/);
    v.nodes[0].floor = 'g';
    expectSingleError(v, 'nodes[0].floor', /finite number, got "g"/);
  });

  it('rejects duplicate node ids', () => {
    const v = clone();
    v.nodes[1].id = 'n-entrance';
    // edges/pois that referenced n-atrium now fail too; check the dup is reported.
    const dup = validateVenue(v).find((e) => e.path === 'nodes[1].id');
    expect(dup.message).toMatch(/duplicate id "n-entrance"/);
  });

  it('rejects GPS coordinates on a node', () => {
    const v = clone();
    v.nodes[0].latitude = 51.5;
    expectSingleError(v, 'nodes[0].latitude', /GPS/);
  });
});

describe('validateVenue — edges', () => {
  it('rejects edges referencing unknown nodes', () => {
    const v = clone();
    v.edges[0].to = 'n-missing';
    expectSingleError(v, 'edges[0].to', /references unknown node "n-missing"/);
  });

  it('rejects self-loops', () => {
    const v = clone();
    v.edges[0].to = v.edges[0].from;
    expectSingleError(v, 'edges[0].to', /self-loop/);
  });

  it('restricts type to the known set', () => {
    const v = clone();
    v.edges[2].type = 'teleporter';
    expectSingleError(v, 'edges[2].type', new RegExp(`must be one of ${EDGE_TYPES.join(', ')}`));
  });

  it('validates distance, booleans and staffOnly', () => {
    const v = clone();
    v.edges[2].distance = -1;
    expectSingleError(v, 'edges[2].distance', /must be >= 0/);
    v.edges[2].distance = 20;
    v.edges[2].oneWay = 'yes';
    expectSingleError(v, 'edges[2].oneWay', /true or false/);
    delete v.edges[2].oneWay;
    v.edges[2].wheelchair = 1;
    expectSingleError(v, 'edges[2].wheelchair', /true or false/);
    delete v.edges[2].wheelchair;
    v.edges[2].staffOnly = 'yes';
    expectSingleError(v, 'edges[2].staffOnly', /true or false/);
  });

  it('checks floorChange against the nodes it joins', () => {
    const v = clone();
    v.edges[0].floorChange = true; // entrance → atrium, both floor 0
    expectSingleError(v, 'edges[0].floorChange', /is true but its nodes are on the same floor/);
    delete v.edges[0].floorChange;
    v.edges[2].floorChange = false; // atrium (0) → l1-landing (1)
    expectSingleError(v, 'edges[2].floorChange', /is false but its nodes are on floors 0 and 1/);
    v.edges[2].floorChange = true;
    expect(validateVenue(v)).toEqual([]);
  });

  it('validates opening hours windows field by field', () => {
    const v = clone();
    v.edges[0].hours = [{ open: '9:00', close: '17:00' }];
    expectSingleError(v, 'edges[0].hours[0].open', /'HH:MM'/);
    v.edges[0].hours = [{ open: '09:00', close: '25:00' }];
    expectSingleError(v, 'edges[0].hours[0].close', /'HH:MM'/);
    v.edges[0].hours = [{ open: '09:00', close: '17:00', days: [7] }];
    expectSingleError(v, 'edges[0].hours[0].days[0]', /0 \(Sunday\) – 6 \(Saturday\)/);
    v.edges[0].hours = [{ open: '09:00', close: '17:00', days: [] }];
    expectSingleError(v, 'edges[0].hours[0].days', /at least 1 item/);
    v.edges[0].hours = { open: '09:00', close: '17:00' };
    expectSingleError(v, 'edges[0].hours', /must be an array/);
  });
});

describe('validateVenue — anchors', () => {
  it('are optional', () => {
    const v = clone();
    delete v.anchors;
    expect(validateVenue(v)).toEqual([]);
  });

  it('validates coordinates, floor and heading, naming the field', () => {
    const v = clone();
    v.anchors[0].x = 'zero';
    expectSingleError(v, 'anchors[0].x', /finite number, got "zero"/);
    v.anchors[0].x = 0;
    v.anchors[0].floor = 9;
    expectSingleError(v, 'anchors[0].floor', /references undefined floor index 9/);
    v.anchors[0].floor = 0;
    v.anchors[0].heading = 360;
    expectSingleError(v, 'anchors[0].heading', /must be < 360/);
    v.anchors[0].heading = -1;
    expectSingleError(v, 'anchors[0].heading', /must be >= 0/);
  });

  it('rejects duplicate ids and GPS keys', () => {
    const v = clone();
    v.anchors[1].id = 'a-entrance';
    expectSingleError(v, 'anchors[1].id', /duplicate id "a-entrance"/);
    const w = clone();
    w.anchors[0].lat = 1;
    expectSingleError(w, 'anchors[0].lat', /GPS/);
  });

  it('must be an array when present', () => {
    const v = clone();
    v.anchors = {};
    expectSingleError(v, 'anchors', /must be an array/);
  });
});

describe('validateVenue — pois', () => {
  it('requires id, name and a known node', () => {
    const v = clone();
    delete v.pois[0].name;
    expectSingleError(v, 'pois[0].name', /is required/);
    v.pois[0].name = 'Information desk';
    v.pois[0].node = 'n-nowhere';
    expectSingleError(v, 'pois[0].node', /references unknown node "n-nowhere"/);
  });

  it('validates aliases as non-empty strings', () => {
    const v = clone();
    v.pois[0].aliases = ['Help desk', 42];
    expectSingleError(v, 'pois[0].aliases[1]', /non-empty string, got 42/);
    v.pois[0].aliases = 'Help desk';
    expectSingleError(v, 'pois[0].aliases', /must be an array/);
  });

  it('rejects duplicate poi ids', () => {
    const v = clone();
    v.pois[1].id = 'poi-info';
    expectSingleError(v, 'pois[1].id', /duplicate id "poi-info" \(first used at pois\[0\]\)/);
  });

  it('validates access and hours', () => {
    const v = clone();
    v.pois[4].access = 'secret';
    expectSingleError(v, 'pois[4].access', new RegExp(`must be one of ${ACCESS.join(', ')}`));
    v.pois[4].access = 'staff';
    v.pois[0].hours = [{ open: '09:00' }];
    expectSingleError(v, 'pois[0].hours[0].close', /is required/);
  });

  it('accepts a floor that matches the node and rejects one that does not', () => {
    const v = clone();
    v.pois[0].floor = 0; // poi-info at n-atrium, floor 0
    expect(validateVenue(v)).toEqual([]);
    v.pois[0].floor = 1;
    expectSingleError(v, 'pois[0].floor', /is 1 but node "n-atrium" is on floor 0/);
    v.pois[0].floor = 7;
    expectSingleError(v, 'pois[0].floor', /references undefined floor index 7/);
  });

  it('rejects GPS coordinates on a poi', () => {
    const v = clone();
    v.pois[0].lng = -0.1;
    expectSingleError(v, 'pois[0].lng', /GPS/);
  });
});

describe('assertVenue / VenueValidationError', () => {
  it('throws one error listing every problem with its path', () => {
    const v = clone();
    v.name = '';
    v.nodes[1].y = 'ten';
    v.pois[2].node = 'n-ghost';

    let caught;
    try {
      assertVenue(v);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VenueValidationError);
    expect(caught).toBeInstanceOf(Error);
    expect(caught.name).toBe('VenueValidationError');
    expect(caught.errors.map((e) => e.path)).toEqual(['name', 'nodes[1].y', 'pois[2].node']);
    expect(caught.message).toBe(
      [
        'Invalid venue JSON (3 problems):',
        '  - name: must be a non-empty string, got ""',
        '  - nodes[1].y: must be a finite number, got "ten"',
        '  - pois[2].node: references unknown node "n-ghost"',
      ].join('\n')
    );
  });

  it('uses the singular for one problem', () => {
    const v = clone();
    v.id = '';
    expect(() => assertVenue(v)).toThrow(/^Invalid venue JSON \(1 problem\):/);
  });
});
