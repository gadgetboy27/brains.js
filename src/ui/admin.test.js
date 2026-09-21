// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionProvider } from '../core/positioning.js';
import { createVenue } from '../core/venue.js';
import demo from '../venues/demo-venue.json';
import { createAdminPanel } from './admin.js';
import { createFloorplan } from './floorplan.js';
import { t } from './strings/index.js';

class Fake extends PositionProvider {
  static uploads = [];
  async start() {}
  async stop() {}
  emit(p) {
    this.emitPose(p);
  }
}
const pose = (x, y, heading = 0, floor = 0) => ({
  x,
  y,
  z: floor * 4,
  floor,
  heading,
  confidence: 1,
  timestamp: 1,
});
const fakeContext = () => new Proxy({}, { get: () => () => {}, set: () => true });
const mem = () => {
  const data = {};
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => (data[k] = v),
    removeItem: (k) => delete data[k],
    data,
  };
};

function make(options = {}) {
  const venue = createVenue(structuredClone(demo));
  const provider = new Fake();
  const floorplan = createFloorplan({
    venue,
    context: fakeContext(),
    pixelsPerMetre: 10,
    rotationMode: 'north-up',
  });
  floorplan.resize(400, 300, 1);
  const storage = mem();
  const download = vi.fn();
  const copy = vi.fn(async () => {});
  const prompt = vi.fn(() => 'Named');
  const admin = createAdminPanel({
    venue,
    provider,
    floorplan,
    storage,
    download,
    copy,
    prompt,
    ...options,
  });
  return { admin, provider, floorplan, storage, download, copy, prompt, venue };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('AdminPanel — recording a route', () => {
  it('starts from the venue, disables "here" buttons until a pose arrives', () => {
    const { admin } = make();
    expect(admin.draft.summary.nodes).toBe(demo.nodes.length);
    expect(admin.el.querySelector('[data-f="rec-node"]').disabled).toBe(true);
    expect(admin.el.querySelector('[data-f="rec-status"]').textContent).toBe(
      t('admin.record.noPose')
    );
  });

  it('drops linked nodes as you walk, joining existing junctions', () => {
    const { admin, provider, storage } = make();
    provider.emit(pose(0, 0)); // on the entrance node
    admin.startRecording();
    expect(admin.recording).toBe(true);

    provider.emit(pose(40, 6));
    const a = admin.addNodeHere('Pharmacy');
    expect(a.id).toBe('n-pharmacy');
    // Started on n-entrance? No: the walk starts wherever the first node is dropped
    // unless we began on an existing node; we did (0,0 = n-entrance).
    expect(admin.draft.edgeBetween('n-entrance', 'n-pharmacy')).not.toBeNull();

    provider.emit(pose(40, 16));
    const b = admin.addNodeHere();
    expect(admin.draft.edgeBetween(a.id, b.id).distance).toBe(10);

    // Walk back to the east corridor node: snaps and links, no new node.
    provider.emit(pose(30.4, 6.2));
    const c = admin.addNodeHere();
    expect(c.id).toBe('n-corridor-g-3');
    expect(admin.draft.edgeBetween(b.id, 'n-corridor-g-3')).not.toBeNull();
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.record.snapped', { name: 'Ground corridor, east' })
    );
    expect(admin.el.querySelector('[data-f="rec-status"]').textContent).toBe(
      t('admin.record.status', { nodes: 2, edges: 3 })
    );
    expect(JSON.parse(storage.data['brains:admin-draft']).nodes).toHaveLength(
      demo.nodes.length + 2
    );
    admin.stopRecording();
    expect(admin.recording).toBe(false);
  });

  it('adds a place and a QR marker where you stand', () => {
    const { admin, provider, prompt } = make();
    provider.emit(pose(40, 6, 135));
    admin.addPoiHere();
    expect(admin.el.querySelector('[data-f="poi-form"]').hidden).toBe(false);
    const poi = admin.submitPoi({
      name: 'Pharmacy',
      aliases: ['Chemist', ' Drugs '],
      category: 'retail',
    });
    expect(poi).toMatchObject({
      id: 'poi-pharmacy',
      name: 'Pharmacy',
      aliases: ['Chemist', 'Drugs'],
      category: 'retail',
    });
    expect(admin.draft.nodeById(poi.node)).toMatchObject({ x: 40, y: 6 });

    prompt.mockReturnValueOnce('Pharmacy door');
    const anchor = admin.addAnchorHere();
    expect(anchor).toMatchObject({ x: 40, y: 6, floor: 0, heading: 135, name: 'Pharmacy door' });
    prompt.mockReturnValueOnce(null); // cancelled
    expect(admin.addAnchorHere()).toBeNull();
    expect(admin.draft.validate()).toEqual([]);
  });
});

describe('AdminPanel — plan editor', () => {
  it('tap to add, tap to select, link two nodes, rename, remove, undo', () => {
    const { admin, prompt } = make();
    admin.showTab('plan');
    const n1 = admin.tapPlan({ x: 50, y: 20, floor: 0 });
    expect(n1.id).toBe('n-17');
    expect(admin.selected).toBe(n1.id);
    const n2 = admin.tapPlan({ x: 60, y: 20, floor: 0 });
    expect(admin.selected).toBe(n2.id);

    // Select n1 by tapping near it, then link to n2.
    expect(admin.tapPlan({ x: 50.5, y: 20.3, floor: 0 })).toBe(n1);
    admin.el.querySelector('[data-f="plan-link"]').click();
    admin.tapPlan({ x: 60, y: 20, floor: 0 });
    expect(admin.draft.edgeBetween(n1.id, n2.id).distance).toBe(10);

    prompt.mockReturnValueOnce('Café');
    admin.tapPlan({ x: 50, y: 20, floor: 0 });
    admin.renameSelected();
    expect(admin.draft.nodeById(n1.id).name).toBe('Café');

    admin.removeSelected();
    expect(admin.draft.nodeById(n1.id)).toBeNull();
    expect(admin.draft.edges.some((e) => e.from === n1.id || e.to === n1.id)).toBe(false);
    expect(admin.selected).toBeNull();

    expect(admin.undo().type).toBe('removeNode');
    expect(admin.draft.nodeById(n1.id)).not.toBeNull();
  });

  it('converts canvas taps through the floor plan projection', () => {
    const { admin, floorplan } = make();
    admin.showTab('plan');
    // North-up, no pose: the plan is centred on floor 0's centroid; a tap at the
    // screen centre lands on that centroid.
    const centre = floorplan.fromScreen(200, 150);
    floorplan.canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    floorplan.canvas.dispatchEvent(new MouseEvent('click', { clientX: 200, clientY: 150 }));
    const added = admin.draft.nodes.at(-1);
    expect(added.x).toBeCloseTo(centre.x, 1);
    expect(added.y).toBeCloseTo(centre.y, 1);
  });

  it('ignores plan taps on other tabs', () => {
    const { admin, floorplan } = make();
    floorplan.canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    floorplan.canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }));
    expect(admin.draft.summary.nodes).toBe(demo.nodes.length);
  });
});

describe('AdminPanel — export and drafts', () => {
  it('validates, downloads and copies the venue JSON', async () => {
    const { admin, download, copy } = make();
    admin.showTab('export');
    expect(admin.el.querySelector('[data-f="valid"]').textContent).toBe(t('admin.export.valid'));
    expect(admin.download()).toBe('demo-health-centre.venue.json');
    const [, text] = download.mock.calls[0];
    expect(JSON.parse(text)).toEqual(demo);
    await admin.copy();
    expect(copy).toHaveBeenCalledOnce();
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(t('admin.export.copied'));
  });

  it('blocks download while the draft is invalid and lists the problems', () => {
    const { admin } = make();
    admin.draft.pois[0].node = 'n-ghost';
    admin.showTab('export');
    expect(admin.el.querySelector('[data-f="download"]').disabled).toBe(true);
    expect(admin.el.querySelector('[data-f="problems"]').textContent).toContain('pois[0].node');
    expect(admin.download()).toBeNull();
  });

  it('restores a draft for the same venue and can discard it', () => {
    const first = make();
    first.provider.emit(pose(40, 6));
    first.admin.addNodeHere('Pharmacy');
    const second = make({ storage: first.storage });
    expect(second.admin.draft.nodeById('n-pharmacy')).not.toBeNull();
    expect(second.admin.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.draft.restored')
    );
    second.admin.discard();
    expect(second.admin.draft.nodeById('n-pharmacy')).toBeNull();
    expect(first.storage.data['brains:admin-draft']).toBeUndefined();
  });

  it('draws the draft on the floor plan overlay', () => {
    const calls = [];
    const ctx = new Proxy(
      {},
      { get: (_, p) => (p === 'calls' ? calls : (...a) => calls.push([p, ...a])), set: () => true }
    );
    const venue = createVenue(structuredClone(demo));
    const floorplan = createFloorplan({
      venue,
      context: ctx,
      pixelsPerMetre: 10,
      rotationMode: 'north-up',
    });
    floorplan.resize(400, 300, 1);
    const admin = createAdminPanel({
      venue,
      provider: new Fake(),
      floorplan,
      storage: null,
      download: vi.fn(),
      copy: vi.fn(),
      prompt: vi.fn(),
    });
    admin.showTab('plan');
    calls.length = 0;
    admin.tapPlan({ x: 15, y: 6, floor: 0 });
    expect(calls.filter((c) => c[0] === 'arc').length).toBeGreaterThanOrEqual(
      demo.nodes.filter((n) => n.floor === 0).length + 1
    );
    expect(calls.some((c) => c[0] === 'strokeRect')).toBe(true); // anchors
    admin.destroy();
    expect(document.querySelector('.admin')).toBeNull();
  });
});

describe('AdminPanel — publishing', () => {
  const session = () => {
    const data = {};
    return {
      getItem: (k) => data[k] ?? null,
      setItem: (k, v) => (data[k] = v),
      removeItem: (k) => delete data[k],
      data,
    };
  };
  const response = (status, body, type = 'application/json') => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => type },
    json: async () => body,
  });

  it('asks for the key once, PUTs the validated JSON, remembers the key and clears the draft', async () => {
    const fetch = vi.fn(async () => response(200, { ok: true, id: 'demo-health-centre' }));
    const sessionStorage = session();
    const { admin, prompt, storage, provider } = make({ fetch, sessionStorage });
    prompt.mockReturnValueOnce('s3cret');
    provider.emit(pose(40, 6));
    admin.addNodeHere('Pharmacy');
    expect(storage.data['brains:admin-draft']).toBeDefined();

    const result = await admin.publish();
    expect(result).toEqual({ ok: true, id: 'demo-health-centre' });
    expect(fetch).toHaveBeenCalledWith('/api/venues/demo-health-centre', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: 'Bearer s3cret' },
      body: admin.json(),
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body).nodes.some((n) => n.id === 'n-pharmacy')).toBe(
      true
    );
    expect(sessionStorage.data['brains:admin-token']).toBe('s3cret');
    expect(storage.data['brains:admin-draft']).toBeUndefined();
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.export.published')
    );

    await admin.publish(); // key remembered: no prompt
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected key (and forgets it), an unconfigured server, and validation problems', async () => {
    const sessionStorage = session();
    sessionStorage.setItem('brains:admin-token', 'old');
    const fetch = vi.fn(async () => response(401, { error: 'unauthorised' }));
    const { admin } = make({ fetch, sessionStorage });
    expect(await admin.publish()).toBeNull();
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.export.unauthorised')
    );
    expect(sessionStorage.data['brains:admin-token']).toBeUndefined();

    fetch.mockResolvedValueOnce(response(503, { error: 'not configured' }));
    sessionStorage.setItem('brains:admin-token', 'k');
    await admin.publish();
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.export.unconfigured')
    );

    fetch.mockResolvedValueOnce(
      response(422, {
        error: 'invalid venue JSON',
        problems: [{ path: 'pois[0].node', message: 'unknown' }],
      })
    );
    await admin.publish();
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.export.publishFailed', { message: 'pois[0].node: unknown' })
    );
  });

  it('recognises the dev server (no API) and a network failure', async () => {
    const sessionStorage = session();
    sessionStorage.setItem('brains:admin-token', 'k');
    const fetch = vi.fn(async () => response(200, null, 'text/html'));
    const { admin } = make({ fetch, sessionStorage });
    await admin.publish();
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.export.devServer')
    );
    fetch.mockRejectedValueOnce(new Error('Failed to fetch'));
    await admin.publish();
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.export.publishFailed', { message: 'Failed to fetch' })
    );
  });

  it('does not publish an invalid draft or without a key', async () => {
    const fetch = vi.fn();
    const { admin, prompt } = make({ fetch, sessionStorage: session() });
    prompt.mockReturnValueOnce(null); // cancelled
    expect(await admin.publish()).toBeNull();
    admin.draft.pois[0].node = 'n-ghost';
    prompt.mockReturnValueOnce('k');
    expect(await admin.publish()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('AdminPanel — places library', () => {
  it('offers library places and fills aliases, category and access from the chosen one', () => {
    const { admin, provider } = make();
    expect(admin.el.querySelectorAll('#admin-places option').length).toBeGreaterThan(40);
    provider.emit(pose(5, 5));
    admin.addPoiHere();
    const name = admin.el.querySelector('[data-f="poi-name"]');
    name.value = 'ED reception'; // an alias
    name.dispatchEvent(new Event('change'));
    expect(name.value).toBe('Emergency Department reception');
    expect(admin.el.querySelector('[data-f="poi-alias"]').value).toContain('Triage');
    expect(admin.el.querySelector('[data-f="poi-cat"]').value).toBe('service');
    const poi = admin.submitPoi({
      name: name.value,
      aliases: ['ED reception', 'Triage'],
      category: 'service',
    });
    expect(poi.access).toBeUndefined();

    admin.addPoiHere();
    name.value = 'Staff room';
    name.dispatchEvent(new Event('change'));
    const staff = admin.submitPoi({ name: 'Staff room', aliases: ['Tea room'], category: 'staff' });
    expect(staff.access).toBe('staff');
    expect(admin.draft.validate()).toEqual([]);
  });
});

describe('AdminPanel — edit existing and saved state', () => {
  it('shows saved state: published on load, local after a change, published after Publish', async () => {
    const fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true }),
    }));
    const sessionStorage = { getItem: () => 'k', setItem: () => {}, removeItem: () => {} };
    const { admin, provider } = make({ fetch, sessionStorage });
    const saved = () => admin.el.querySelector('[data-f="saved"]').textContent;
    expect(admin.savedState).toBe('published');
    expect(saved()).toBe(t('admin.saved.published'));
    provider.emit(pose(40, 6));
    admin.addNodeHere('Pharmacy');
    expect(admin.savedState).toBe('local');
    expect(saved()).toBe(t('admin.saved.local'));
    admin.el.querySelector('[data-f="save"]').click();
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(t('admin.saved.now'));
    await admin.publish();
    expect(admin.savedState).toBe('published');
    expect(saved()).toBe(t('admin.saved.published'));
  });

  it('finds places and markers by name, alias or id', () => {
    const { admin } = make();
    admin.showTab('edit');
    expect(admin.editCandidates('derma').map((c) => c.id)).toEqual(['poi-clinic-b']);
    expect(admin.editCandidates('lift').map((c) => `${c.kind}:${c.id}`)).toEqual([
      'poi:poi-lift',
      'anchor:a-lift-g',
      'anchor:a-lift-1',
    ]);
    expect(admin.editCandidates('').length).toBe(demo.pois.length + demo.anchors.length);
    expect(admin.editCandidates('zzz')).toEqual([]);
    admin.el.querySelector('[data-f="edit-search"]').value = 'clinic';
    admin.el.querySelector('[data-f="edit-search"]').dispatchEvent(new Event('input'));
    expect(admin.el.querySelectorAll('[data-f="edit-list"] [role="option"]')).toHaveLength(2);
  });

  it('edits a ward: rename, aliases, category, access — id unchanged', () => {
    const { admin } = make();
    admin.showTab('edit');
    admin.el.querySelector('[data-f="edit-list"] [data-id="poi-clinic-b"]').click();
    const form = admin.el.querySelector('[data-f="edit-form"]');
    expect(form.hidden).toBe(false);
    expect(admin.el.querySelector('[data-f="edit-name"]').value).toBe('Clinic B');
    admin.el.querySelector('[data-f="edit-name"]').value = 'Ward 4 North';
    admin.el.querySelector('[data-f="edit-alias"]').value = 'Dermatology, Skin';
    admin.el.querySelector('[data-f="edit-cat"]').value = 'clinic';
    admin.el.querySelector('[data-f="edit-access"]').value = 'staff';
    const item = admin.saveEdit();
    expect(item).toMatchObject({
      id: 'poi-clinic-b',
      name: 'Ward 4 North',
      aliases: ['Dermatology', 'Skin'],
      access: 'staff',
    });
    expect(form.hidden).toBe(true);
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.edit.saved', { name: 'Ward 4 North' })
    );
    expect(admin.savedState).toBe('local');
    expect(admin.draft.validate()).toEqual([]);
  });

  it('renames a marker and moves it to where you stand; the printed id stays valid', () => {
    const { admin, provider } = make();
    admin.showTab('edit');
    admin.openEdit('anchor', 'a-entrance');
    expect(admin.el.querySelector('[data-f="edit-note"]').textContent).toBe(
      t('admin.edit.markerId', { id: 'a-entrance' })
    );
    expect(admin.el.querySelector('[data-f="edit-move"]').disabled).toBe(true); // no pose yet
    admin.el.querySelector('[data-f="edit-name"]').value = 'Front doors';
    admin.el.querySelector('[data-f="edit-heading"]').value = '180';
    expect(admin.saveEdit()).toMatchObject({ id: 'a-entrance', name: 'Front doors', heading: 180 });

    provider.emit(pose(2, 3, 45));
    admin.openEdit('anchor', 'a-entrance');
    expect(admin.el.querySelector('[data-f="edit-move"]').disabled).toBe(false);
    const moved = admin.moveEditedHere();
    expect(moved).toMatchObject({ id: 'a-entrance', x: 2, y: 3, heading: 45 });
    expect(admin.draft.anchors.find((a) => a.id === 'a-entrance').name).toBe('Front doors');
  });

  it('moves a place to where you stand, reusing a nearby node, and removes items', () => {
    const { admin, provider } = make();
    admin.showTab('edit');
    provider.emit(pose(30.3, 6.1)); // next to n-corridor-g-3
    admin.openEdit('poi', 'poi-toilets-g');
    const moved = admin.moveEditedHere();
    expect(moved.node).toBe('n-corridor-g-3');
    expect(admin.draft.nodes).toHaveLength(demo.nodes.length); // snapped, no new node

    admin.openEdit('poi', 'poi-toilets-g');
    expect(admin.removeEdited()).toBe(true);
    expect(admin.draft.pois.find((p) => p.id === 'poi-toilets-g')).toBeUndefined();
    admin.openEdit('anchor', 'a-lift-1');
    expect(admin.removeEdited()).toBe(true);
    expect(admin.draft.anchors.find((a) => a.id === 'a-lift-1')).toBeUndefined();
    expect(admin.undo().type).toBe('removeAnchor');
    expect(admin.draft.validate()).toEqual([]);
  });
});
