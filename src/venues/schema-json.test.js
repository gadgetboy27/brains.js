/**
 * Proves that src/venues/schema.json is a valid JSON Schema, that it accepts
 * the fixture, and that it agrees with the hand-written validator in
 * schema.js on a battery of good and bad documents.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import sample from './fixtures/sample-venue.json';
import { validateVenue } from './schema.js';
import schema from './schema.json';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateJson = ajv.compile(schema);

const clone = () => structuredClone(sample);

/** Mutations that must be rejected by BOTH validators. */
const invalidCases = {
  'missing schemaVersion': (v) => delete v.schemaVersion,
  'wrong schemaVersion': (v) => (v.schemaVersion = 2),
  'id with spaces': (v) => (v.id = 'has spaces'),
  'empty name': (v) => (v.name = ''),
  'frame.headingOffsetDeg not a number': (v) => (v.frame = { headingOffsetDeg: 'n' }),
  'no floors': (v) => (v.floors = []),
  'floor index not integer': (v) => (v.floors[0].index = 0.5),
  'floor missing name': (v) => delete v.floors[0].name,
  'node missing x': (v) => delete v.nodes[0].x,
  'node x is a string': (v) => (v.nodes[0].x = '1'),
  'node floor not integer': (v) => (v.nodes[0].floor = 'g'),
  'edge missing to': (v) => delete v.edges[0].to,
  'edge unknown type': (v) => (v.edges[0].type = 'teleporter'),
  'edge negative distance': (v) => (v.edges[0].distance = -1),
  'edge staffOnly not boolean': (v) => (v.edges[0].staffOnly = 'yes'),
  'edge floorChange not boolean': (v) => (v.edges[0].floorChange = 1),
  'edge hours not array': (v) => (v.edges[0].hours = { open: '09:00', close: '17:00' }),
  'edge hours bad HH:MM': (v) => (v.edges[0].hours = [{ open: '9:00', close: '17:00' }]),
  'edge hours bad day': (v) => (v.edges[0].hours = [{ open: '09:00', close: '17:00', days: [7] }]),
  'edge hours empty days': (v) =>
    (v.edges[0].hours = [{ open: '09:00', close: '17:00', days: [] }]),
  'poi missing node': (v) => delete v.pois[0].node,
  'poi alias not string': (v) => (v.pois[0].aliases = [42]),
  'poi bad access': (v) => (v.pois[0].access = 'vip'),
  'poi floor not integer': (v) => (v.pois[0].floor = 'g'),
  'anchor heading 360': (v) => (v.anchors[0].heading = 360),
  'anchor missing floor': (v) => delete v.anchors[0].floor,
  'providers.immersal missing mapId': (v) => (v.providers.immersal = {}),
  'providers.immersal mapId 0': (v) => (v.providers.immersal.mapId = 0),
  'providers.immersal origin missing z': (v) => (v.providers.immersal.origin = { x: 0, y: 0 }),
  'providers.order not strings': (v) => (v.providers.order = [1]),
  'floor plan missing image': (v) => (v.floors[0].plan = { widthPx: 1, heightPx: 1 }),
  'floor plan widthPx 0': (v) => (v.floors[0].plan = { image: 'a.png', widthPx: 0, heightPx: 1 }),
  'language missing name': (v) => (v.languages = { sm: { strings: {} } }),
  'language string not a string': (v) =>
    (v.languages = { sm: { name: 'x', strings: { 'picker.title': 1 } } }),
  'language bad code': (v) => (v.languages = { 'not a code': { name: 'x', strings: {} } }),
  'GPS on venue': (v) => (v.lat = 51.5),
  'GPS on node': (v) => (v.nodes[0].longitude = 0),
  'GPS on poi': (v) => (v.pois[0].lng = 0),
};

/** Mutations that must be accepted by BOTH validators. */
const validCases = {
  'fixture as is': () => {},
  'no anchors': (v) => delete v.anchors,
  'no providers': (v) => delete v.providers,
  'no frame': (v) => delete v.frame,
  'empty edges and pois': (v) => {
    v.edges = [];
    v.pois = [];
  },
  'edge with every attribute': (v) =>
    v.edges.push({
      from: 'n-atrium',
      to: 'n-l1-landing',
      type: 'ramp',
      distance: 25,
      oneWay: true,
      stepFree: true,
      wheelchair: false,
      staffOnly: true,
      floorChange: true,
      hours: [{ open: '18:00', close: '02:00', days: [5, 6] }],
      name: 'service ramp',
    }),
  'poi with floor, access and hours': (v) =>
    v.pois.push({
      id: 'poi-x',
      name: 'X',
      aliases: ['Ex'],
      floor: 1,
      node: 'n-l1-toilets',
      category: 'retail',
      access: 'staff',
      description: 'd',
      hours: [{ open: '09:00', close: '17:00' }],
    }),
  'explicit provider order': (v) => (v.providers.order = ['qr', 'immersal']),
  'unknown provider block': (v) => (v.providers.beacons = { uuid: 'x' }),
  'immersal with full transform': (v) =>
    (v.providers.immersal = { mapId: 7, origin: { x: 1, y: 2, z: 3 }, rotationDeg: 90, floor: 0 }),
  'floor with plan': (v) => {
    v.floors[0].plan = {
      image: 'ground.png',
      widthPx: 800,
      heightPx: 600,
      metresPerPixel: 0.05,
      originPx: { x: 0, y: 600 },
    };
  },
  'community language': (v) => {
    v.languages = {
      sm: { name: 'Gagana Sāmoa', strings: { 'picker.title': 'O fea e te alu i ai?' } },
    };
  },
  'negative floor index': (v) => {
    v.floors.push({ index: -1, id: 'b1', name: 'Basement', elevation: -3.5 });
  },
};

describe('schema.json', () => {
  it('is a valid draft 2020-12 schema', () => {
    expect(ajv.validateSchema(schema)).toBe(true);
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('documents every property', () => {
    const undocumented = [];
    const walk = (node, path) => {
      if (!node || typeof node !== 'object') return;
      if (node.properties) {
        for (const [key, sub] of Object.entries(node.properties)) {
          const hasDoc = typeof sub.description === 'string' || typeof sub.$ref === 'string';
          if (!hasDoc) undocumented.push(`${path}.${key}`);
          walk(sub, `${path}.${key}`);
        }
      }
      if (node.items) walk(node.items, `${path}[]`);
      if (node.$defs) for (const [k, sub] of Object.entries(node.$defs)) walk(sub, `$defs.${k}`);
    };
    walk(schema, 'venue');
    expect(undocumented).toEqual([]);
  });

  it('accepts the fixture', () => {
    expect(validateJson(sample)).toBe(true);
    expect(validateVenue(sample)).toEqual([]);
  });

  it.each(Object.entries(validCases))('accepts: %s', (_name, mutate) => {
    const v = clone();
    mutate(v);
    expect(validateJson(v), JSON.stringify(validateJson.errors)).toBe(true);
    expect(validateVenue(v)).toEqual([]);
  });

  it.each(Object.entries(invalidCases))('rejects: %s', (_name, mutate) => {
    const v = clone();
    mutate(v);
    expect(validateJson(v)).toBe(false);
    expect(validateVenue(v).length).toBeGreaterThan(0);
  });

  it('covers every edge attribute the brief requires', () => {
    const edge = schema.$defs.edge.properties;
    for (const key of ['stepFree', 'wheelchair', 'staffOnly', 'hours', 'floorChange', 'distance']) {
      expect(edge, key).toHaveProperty(key);
    }
    const poi = schema.$defs.poi.properties;
    for (const key of ['id', 'name', 'aliases', 'floor', 'node', 'category', 'access']) {
      expect(poi, key).toHaveProperty(key);
    }
    expect(schema.properties).toHaveProperty('providers');
  });
});
