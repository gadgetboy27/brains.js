import { describe, expect, it } from 'vitest';

import demo from '../venues/demo-venue.json';
import { VenueDraft, slugify } from './venue-draft.js';

describe('slugify', () => {
  it('makes safe ids', () => {
    expect(slugify('Clinic B — Dermatology')).toBe('clinic-b-dermatology');
    expect(slugify('Wāhi Tapu')).toBe('wahi-tapu');
    expect(slugify('', 'x')).toBe('x');
  });
});

describe('VenueDraft — from scratch', () => {
  it('starts with one ground floor and validates once it has a node', () => {
    const d = new VenueDraft();
    expect(d.floors).toEqual([{ index: 0, id: 'ground', name: 'Ground', elevation: 0 }]);
    expect(d.validate().map((e) => e.path)).toContain('nodes');
    d.addNode({ x: 0, y: 0, name: 'Entrance' });
    expect(d.validate()).toEqual([]);
    expect(d.summary).toEqual({ floors: 1, nodes: 1, edges: 0, pois: 0, anchors: 0, problems: 0 });
  });

  it('builds a route graph from a walk: consecutive nodes are linked with computed distances', () => {
    const d = new VenueDraft();
    const a = d.addNode({ x: 0, y: 0, name: 'Entrance' });
    const b = d.addNode({ x: 0, y: 6.004, name: 'Lobby' }, { linkFrom: a.id });
    const c = d.addNode({ x: 10, y: 6 }, { linkFrom: b.id });
    expect(a.id).toBe('n-entrance');
    expect(b.id).toBe('n-lobby');
    expect(c.id).toBe('n-3');
    expect(d.edges).toEqual([
      { from: 'n-entrance', to: 'n-lobby', distance: 6 },
      { from: 'n-lobby', to: 'n-3', distance: 10 },
    ]);
    expect(d.validate()).toEqual([]);
  });

  it('snaps to a nearby existing node instead of duplicating a junction', () => {
    const d = new VenueDraft();
    const a = d.addNode({ x: 0, y: 0 });
    const b = d.addNode({ x: 10, y: 0 }, { linkFrom: a.id });
    const c = d.addNode({ x: 10, y: 10 }, { linkFrom: b.id });
    // Walking back to within 1.5 m of the first node links to it, no new node.
    const again = d.addNode({ x: 0.8, y: 0.4 }, { linkFrom: c.id, snap: 1.5 });
    expect(again).toBe(a);
    expect(d.nodes).toHaveLength(3);
    expect(d.edges).toHaveLength(3); // a–b, b–c, c–a
    // The same edge is never added twice (a–b already exists, in either direction).
    d.addNode({ x: 0.2, y: 0 }, { linkFrom: b.id, snap: 1.5 });
    expect(d.nodes).toHaveLength(3);
    expect(d.edges).toHaveLength(3);
  });

  it('marks floor changes and defaults their type to stairs', () => {
    const d = new VenueDraft();
    d.addFloor({ index: 1, name: 'First', elevation: 4 });
    const a = d.addNode({ x: 0, y: 0 });
    const b = d.addNode({ x: 0, y: 0, floor: 1 }, { linkFrom: a.id });
    expect(b.z).toBe(4);
    expect(d.edges[0]).toMatchObject({ floorChange: true, type: 'stairs', distance: 4 });
    const c = d.addNode({ x: 5, y: 0, floor: 1 }, { linkFrom: b.id, edge: { type: 'lift' } });
    expect(d.edgeBetween(b.id, c.id).type).toBe('lift');
    expect(() => d.addNode({ x: 0, y: 0, floor: 7 })).toThrow(/floor 7 is not defined/);
  });

  it('adds POIs and anchors with unique ids and defaults', () => {
    const d = new VenueDraft();
    const n = d.addNode({ x: 3, y: 4 });
    const p1 = d.addPoi({
      name: 'Toilets',
      node: n.id,
      aliases: [' WC ', ''],
      category: 'facility',
    });
    const p2 = d.addPoi({ name: 'Toilets', node: n.id });
    expect(p1).toEqual({
      id: 'poi-toilets',
      name: 'Toilets',
      node: n.id,
      aliases: ['WC'],
      category: 'facility',
    });
    expect(p2.id).toBe('poi-toilets-2');
    expect(() => d.addPoi({ name: 'X', node: 'nope' })).toThrow(/unknown node/);
    expect(() => d.addPoi({ name: '  ', node: n.id })).toThrow(/needs a name/);
    const a = d.addAnchor({ x: 1, y: 2, heading: -90, name: 'Front door' });
    expect(a).toEqual({
      id: 'a-front-door',
      x: 1,
      y: 2,
      z: 0,
      floor: 0,
      heading: 270,
      name: 'Front door',
    });
    expect(d.validate()).toEqual([]);
  });

  it('moves, renames and removes nodes, keeping edges consistent', () => {
    const d = new VenueDraft();
    const a = d.addNode({ x: 0, y: 0 });
    const b = d.addNode({ x: 10, y: 0 }, { linkFrom: a.id });
    d.addPoi({ name: 'Shop', node: b.id });
    d.moveNode(b.id, { x: 20, y: 0 });
    expect(d.edges[0].distance).toBe(20);
    d.renameNode(b.id, 'Shop door');
    expect(d.nodeById(b.id).name).toBe('Shop door');
    expect(d.removeNode(b.id)).toBe(true);
    expect(d.nodes).toHaveLength(1);
    expect(d.edges).toHaveLength(0);
    expect(d.pois).toHaveLength(0);
    expect(d.removeNode('nope')).toBe(false);
  });

  it('undoes edits in reverse order', () => {
    const d = new VenueDraft();
    const a = d.addNode({ x: 0, y: 0 });
    const b = d.addNode({ x: 10, y: 0 }, { linkFrom: a.id });
    d.addPoi({ name: 'Shop', node: b.id });
    d.moveNode(b.id, { x: 12, y: 0 });
    expect(d.undo().type).toBe('moveNode');
    expect(d.nodeById(b.id).x).toBe(10);
    expect(d.undo().type).toBe('addPoi');
    expect(d.pois).toHaveLength(0);
    expect(d.undo().type).toBe('addNode'); // b and its edge
    expect(d.nodes).toHaveLength(1);
    expect(d.edges).toHaveLength(0);
    expect(d.undo().type).toBe('addNode');
    expect(d.undo()).toBeNull();
  });
});

describe('VenueDraft — from an existing venue', () => {
  it('round-trips the demo venue and stays valid after edits', () => {
    const d = new VenueDraft(demo);
    expect(d.validate()).toEqual([]);
    expect(d.toJSON()).toEqual(demo);
    const n = d.addNode({ x: 40, y: 6, name: 'Pharmacy' }, { linkFrom: 'n-corridor-g-3' });
    d.addPoi({ name: 'Pharmacy', node: n.id, category: 'retail' });
    expect(d.validate()).toEqual([]);
    expect(d.summary.nodes).toBe(demo.nodes.length + 1);
    expect(d.edgeBetween('n-corridor-g-3', n.id).distance).toBe(10);
    // Original untouched.
    expect(demo.nodes).toHaveLength(16);
  });
});

describe('VenueDraft — editing existing places and markers', () => {
  it('updates a place in place, keeping its id, and undoes', () => {
    const d = new VenueDraft(demo);
    const before = structuredClone(d.pois.find((p) => p.id === 'poi-clinic-b'));
    const updated = d.updatePoi('poi-clinic-b', {
      name: 'Ward 4 North',
      aliases: ['Dermatology', ' Skin clinic ', ''],
      category: 'clinic',
      access: 'staff',
    });
    expect(updated.id).toBe('poi-clinic-b');
    expect(updated).toMatchObject({
      name: 'Ward 4 North',
      aliases: ['Dermatology', 'Skin clinic'],
      access: 'staff',
    });
    expect(d.validate()).toEqual([]);
    d.updatePoi('poi-clinic-b', { access: null, aliases: [] });
    expect(updated.access).toBeUndefined();
    expect(updated.aliases).toBeUndefined();
    expect(() => d.updatePoi('poi-clinic-b', { name: ' ' })).toThrow(/needs a name/);
    expect(() => d.updatePoi('nope', { name: 'x' })).toThrow(/unknown poi/);
    d.undo();
    d.undo();
    expect(d.pois.find((p) => p.id === 'poi-clinic-b')).toEqual(before);
  });

  it('moves a place to another node (and its floor follows)', () => {
    const d = new VenueDraft(demo);
    const moved = d.movePoi('poi-clinic-b', 'n-clinic-a');
    expect(moved.node).toBe('n-clinic-a');
    expect(moved.floor).toBe(0);
    expect(() => d.movePoi('poi-clinic-b', 'n-nope')).toThrow(/unknown node/);
    d.undo();
    expect(d.pois.find((p) => p.id === 'poi-clinic-b').node).toBe('n-clinic-b');
  });

  it('updates a marker without changing its id', () => {
    const d = new VenueDraft(demo);
    const a = d.updateAnchor('a-entrance', { name: 'Front doors', heading: 450, x: 1.234, y: 2 });
    expect(a).toMatchObject({ id: 'a-entrance', name: 'Front doors', heading: 90, x: 1.23, y: 2 });
    d.updateAnchor('a-entrance', { name: null });
    expect(a.name).toBeUndefined();
    expect(() => d.updateAnchor('a-entrance', { floor: 9 })).toThrow(/floor 9/);
    expect(d.validate()).toEqual([]);
    d.undo();
    d.undo();
    expect(d.anchors.find((x) => x.id === 'a-entrance').name).toBeUndefined(); // demo anchor had no name
    expect(d.anchors.find((x) => x.id === 'a-entrance').heading).toBe(0);
  });
});
