/**
 * The demo venue exists so routing filters can be exercised on a realistic
 * layout. These tests pin down the scenarios it was designed for.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { findRoute } from '../core/router.js';
import { createVenue } from '../core/venue.js';
import demo from './demo-venue.json';
import { validateVenue } from './schema.js';
import schema from './schema.json';

const venue = createVenue(structuredClone(demo));
const types = (route) => route.edges.map((e) => e.type);
const names = (route) => route.edges.map((e) => e.name ?? e.type);

describe('demo-venue.json — validity', () => {
  it('passes the hand validator and the JSON Schema', () => {
    expect(validateVenue(demo)).toEqual([]);
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(demo), JSON.stringify(validate.errors)).toBe(true);
  });

  it('has the required features', () => {
    expect(venue.floors.map((f) => f.index)).toEqual([0, 1]);
    expect(venue.poiById('poi-entrance').category).toBe('exit');
    expect(venue.graph.edges.some((e) => e.type === 'lift')).toBe(true);
    expect(venue.graph.edges.some((e) => e.type === 'stairs')).toBe(true);
    expect(venue.pois.filter((p) => p.category === 'clinic')).toHaveLength(2);
    expect(venue.graph.edges.filter((e) => e.staffOnly)).toHaveLength(2);
    expect(venue.graph.edges.find((e) => e.name?.startsWith('Staff corridor'))).toBeDefined();
  });
});

describe('demo-venue.json — routing scenarios', () => {
  it('unfiltered: entrance to Clinic B takes the stairs (the short way)', () => {
    const r = findRoute(venue.graph, 'n-entrance', 'n-clinic-b');
    expect(r.found).toBe(true);
    expect(types(r)).toContain('stairs');
    expect(types(r)).not.toContain('lift');
    expect(r.distance).toBe(46);
  });

  it('wheelchair: entrance to Clinic B takes the lift (the long way) and never the stairs', () => {
    const r = findRoute(venue.graph, 'n-entrance', 'n-clinic-b', {
      wheelchair: true,
      timeOfDay: '12:00',
    });
    expect(r.found).toBe(true);
    expect(types(r)).toContain('lift');
    expect(types(r)).not.toContain('stairs');
    expect(r.distance).toBe(68);
    expect(r.path).toEqual([
      'n-entrance',
      'n-lobby',
      'n-corridor-g-1',
      'n-corridor-g-2',
      'n-corridor-g-3',
      'n-lift-g',
      'n-lift-1',
      'n-corridor-1-3',
      'n-corridor-1-2',
      'n-clinic-b',
    ]);
  });

  it('after hours: the lift is out of service, so a wheelchair user cannot reach Clinic B', () => {
    const r = findRoute(venue.graph, 'n-entrance', 'n-clinic-b', {
      wheelchair: true,
      timeOfDay: '23:30',
    });
    expect(r).toMatchObject({ found: false, reason: 'no-route' });
    expect(r.edgesExcluded).toBe(4); // stairs, lift, and both staff-only edges
    // Someone who can use stairs still gets there.
    expect(findRoute(venue.graph, 'n-entrance', 'n-clinic-b', { timeOfDay: '23:30' }).found).toBe(
      true
    );
  });

  it('visitor: entrance to Clinic A goes round by the corridor, never the staff corridor', () => {
    const r = findRoute(venue.graph, 'n-entrance', 'n-clinic-a');
    expect(r.path).toEqual(['n-entrance', 'n-lobby', 'n-corridor-g-1', 'n-clinic-a']);
    expect(r.distance).toBe(22);
    expect(r.edges.every((e) => !e.staffOnly)).toBe(true);
  });

  it('staff: entrance to Clinic A takes the staff corridor', () => {
    const r = findRoute(venue.graph, 'n-entrance', 'n-clinic-a', { accessLevel: 'staff' });
    expect(r.path).toEqual(['n-entrance', 'n-lobby', 'n-clinic-a']);
    expect(r.distance).toBe(18);
    expect(names(r)).toContain('Staff corridor (lobby to Clinic A)');
  });

  it('the staff room is unreachable for visitors and hidden from public POIs', () => {
    expect(findRoute(venue.graph, 'n-entrance', 'n-staff-room').found).toBe(false);
    expect(
      findRoute(venue.graph, 'n-entrance', 'n-staff-room', { accessLevel: 'staff' }).found
    ).toBe(true);
    expect(venue.poiById('poi-staff-room').access).toBe('staff');
  });

  it('POI lookups resolve the clinics by name and alias', () => {
    expect(venue.lookupPois('dermatology').map((p) => p.id)).toEqual(['poi-clinic-b']);
    expect(venue.lookupPois('Clinic A').map((p) => p.id)).toEqual(['poi-clinic-a']);
    expect(venue.poisOnFloor(1).map((p) => p.id)).toEqual(['poi-clinic-b', 'poi-staff-room']);
  });

  it('every floor-change edge is marked and agrees with its nodes', () => {
    for (const e of venue.graph.edges) {
      const a = venue.nodeById(e.from).floor;
      const b = venue.nodeById(e.to).floor;
      if (a !== b) expect(e.floorChange, `${e.from}→${e.to}`).toBe(true);
    }
  });
});
