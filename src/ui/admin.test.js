// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PositionProvider } from '../core/positioning.js';
import { createVenue } from '../core/venue.js';
import demo from '../venues/demo-venue.json';
import { createAdminPanel, defaultDownload } from './admin.js';
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
  it('starts from the venue; without a position the "here" buttons explain what to do', () => {
    const { admin } = make();
    expect(admin.draft.summary.nodes).toBe(demo.nodes.length);
    const btn = admin.el.querySelector('[data-f="rec-node"]');
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(admin.el.querySelector('[data-f="rec-status"]').textContent).toBe(
      t('admin.record.noPoseHint')
    );
    btn.click();
    expect(admin.el.querySelector('[data-f="toast"]').textContent).toBe(
      t('admin.record.noPoseHint')
    );
    expect(admin.draft.summary.nodes).toBe(demo.nodes.length);
  });

  it('a tap on the plan sets the working position, then "here" buttons work and give loud feedback', () => {
    const onManualPose = vi.fn();
    const { admin } = make({ onManualPose });
    const pose = admin.setManualPose({ x: 40, y: 6, floor: 0 });
    expect(pose).toMatchObject({ x: 40, y: 6, floor: 0, confidence: 0.5 });
    expect(onManualPose).toHaveBeenCalledWith(pose);
    expect(admin.el.querySelector('[data-f="toast"]').textContent).toBe(
      t('admin.record.poseFromPlan')
    );
    expect(admin.el.querySelector('[data-f="rec-node"]').getAttribute('aria-disabled')).toBe(
      'false'
    );

    const node = admin.addNodeHere('Pharmacy');
    expect(admin.el.querySelector('[data-f="toast"]').textContent).toBe(
      t('admin.record.added.node', { name: 'Pharmacy' })
    );
    expect(admin.walk).toEqual([{ kind: 'node', name: 'Pharmacy' }]);
    expect(admin.el.querySelector('[data-f="walk"]').textContent).toContain('Pharmacy');
    expect(node.id).toBe('n-pharmacy');
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

describe('defaultDownload — saving a file on iOS and everywhere else', () => {
  it('uses the Web Share sheet when the browser can share a file (iOS Safari)', () => {
    const shared = [];
    const nav = {
      share: vi.fn(async (data) => {
        shared.push(data);
      }),
      canShare: vi.fn(() => true),
    };
    const restore = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
    try {
      defaultDownload('brains-demo-2026-01-01-0000.venue.json', '{"id":"demo"}');
      expect(nav.canShare).toHaveBeenCalledWith({
        files: [expect.objectContaining({ name: 'brains-demo-2026-01-01-0000.venue.json' })],
      });
      expect(shared).toHaveLength(1);
      expect(shared[0].files[0].name).toBe('brains-demo-2026-01-01-0000.venue.json');
      expect(shared[0].title).toBe('brains-demo-2026-01-01-0000.venue.json');
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: restore, configurable: true });
    }
  });

  it('falls back to an <a download> link when file sharing is not available (desktop)', () => {
    const nav = { share: undefined, canShare: undefined };
    const restore = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
    const clicked = vi.fn();
    const realCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === 'a') el.click = clicked;
      return el;
    });
    try {
      defaultDownload('brains-demo-2026-01-01-0000.venue.json', '{"id":"demo"}');
      expect(clicked).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      Object.defineProperty(globalThis, 'navigator', { value: restore, configurable: true });
    }
  });

  it('falls back to the anchor link if canShare rejects this file (some Android browsers)', () => {
    const nav = { share: vi.fn(), canShare: vi.fn(() => false) };
    const restore = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
    const clicked = vi.fn();
    const realCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = realCreate(tag);
      if (tag === 'a') el.click = clicked;
      return el;
    });
    try {
      defaultDownload('brains-demo-2026-01-01-0000.venue.json', '{"id":"demo"}');
      expect(nav.share).not.toHaveBeenCalled();
      expect(clicked).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
      Object.defineProperty(globalThis, 'navigator', { value: restore, configurable: true });
    }
  });
});

describe('AdminPanel — export and drafts', () => {
  it('validates, downloads and copies the venue JSON, named obviously and confirmed with a toast', async () => {
    const { admin, download, copy } = make();
    admin.showTab('export');
    expect(admin.el.querySelector('[data-f="valid"]').textContent).toBe(t('admin.export.valid'));
    const name = admin.download();
    expect(name).toMatch(/^brains-demo-health-centre-\d{4}-\d\d-\d\d-\d{4}\.venue\.json$/);
    const [, text] = download.mock.calls[0];
    expect(JSON.parse(text)).toEqual(demo);
    expect(admin.el.querySelector('[data-f="toast"]').textContent).toBe(
      t('admin.export.downloaded', { name })
    );
    await admin.copy();
    expect(copy).toHaveBeenCalledOnce();
    expect(admin.el.querySelector('[data-f="toast"]').textContent).toBe(t('admin.export.copied'));
  });

  it('never blocks getting a broken draft out — download still works; only Publish is disabled', () => {
    const { admin, download } = make();
    admin.draft.pois[0].node = 'n-ghost';
    admin.showTab('export');
    expect(admin.el.querySelector('[data-f="download"]').disabled).toBe(false);
    expect(admin.el.querySelector('[data-f="publish"]').disabled).toBe(true);
    expect(admin.el.querySelector('[data-f="problems"]').textContent).toContain('pois[0].node');
    const name = admin.download();
    expect(name).toMatch(/^brains-demo-health-centre-/);
    expect(JSON.parse(download.mock.calls[0][1]).pois[0].node).toBe('n-ghost');
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

describe('AdminPanel — wards, phone layout, scan', () => {
  it('Ward category takes a number and names the place "Ward N" with search aliases', () => {
    const { admin, provider } = make();
    provider.emit(pose(12, 6));
    admin.addPoiHere();
    const cat = admin.el.querySelector('[data-f="poi-cat"]');
    expect([...cat.options].map((o) => o.value)).toContain('ward');
    cat.value = 'ward';
    cat.dispatchEvent(new Event('change'));
    expect(admin.el.querySelector('[data-f="poi-ward-row"]').hidden).toBe(false);
    const num = admin.el.querySelector('[data-f="poi-ward"]');
    num.value = '12';
    num.dispatchEvent(new Event('input'));
    expect(admin.el.querySelector('[data-f="poi-name"]').value).toBe('Ward 12');
    const poi = admin.submitPoi({ category: 'ward', ward: 12, aliases: ['Cardiac ward'] });
    expect(poi).toMatchObject({
      name: 'Ward 12',
      category: 'ward',
      aliases: ['W12', 'Ward12', 'Cardiac ward'],
    });
    expect(admin.submitPoi({ category: 'ward', ward: 100 })).toBeUndefined(); // out of range: nothing added
    expect(admin.draft.validate()).toEqual([]);
  });

  it('editing a ward keeps the number in sync', () => {
    const { admin, provider } = make();
    provider.emit(pose(12, 6));
    admin.addPoiHere();
    const poi = admin.submitPoi({ category: 'ward', ward: 4 });
    admin.showTab('edit');
    admin.openEdit('poi', poi.id);
    expect(admin.el.querySelector('[data-f="edit-ward"]').value).toBe('4');
    expect(admin.el.querySelector('[data-f="edit-ward-row"]').hidden).toBe(false);
    admin.el.querySelector('[data-f="edit-ward"]').value = '7';
    admin.el.querySelector('[data-f="edit-ward"]').dispatchEvent(new Event('input'));
    expect(admin.el.querySelector('[data-f="edit-name"]').value).toBe('Ward 7');
    expect(admin.saveEdit()).toMatchObject({
      id: poi.id,
      name: 'Ward 7',
      aliases: ['W7', 'Ward7'],
    });
  });

  it('collapses to the tab row and back', () => {
    const { admin } = make();
    const btn = admin.el.querySelector('[data-f="collapse"]');
    expect(admin.collapsed).toBe(false);
    btn.click();
    expect(admin.collapsed).toBe(true);
    expect(btn.textContent).toBe(t('admin.expand'));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    expect(admin.collapsed).toBe(false);
  });

  it('offers "scan a marker" only when the app can show the camera', () => {
    const { admin } = make();
    expect(admin.el.querySelector('[data-f="rec-scan"]').hidden).toBe(true);
    const onScanRequest = vi.fn();
    const { admin: withScan } = make({ onScanRequest });
    const btn = withScan.el.querySelector('[data-f="rec-scan"]');
    expect(btn.hidden).toBe(false);
    btn.click();
    expect(onScanRequest).toHaveBeenCalledOnce();
    expect(withScan.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.record.scanning')
    );
  });
});

describe('AdminPanel — QR codes: preview, print sheet, register a printed sticker', () => {
  const qr = {
    qrDataUrl: async (text) => `data:image/png;base64,${btoa(text)}`,
    qrSvg: async (text) => `<svg data-text="${text}"></svg>`,
  };

  it("shows each marker's code in the Export tab and builds a print sheet", async () => {
    const openSheet = vi.fn();
    const { admin } = make({ ...qr, openSheet, publicBaseUrl: 'https://wayfinding.example.nz' });
    admin.showTab('export');
    await new Promise((r) => setTimeout(r, 0));
    const imgs = [...admin.el.querySelectorAll('[data-f="markers"] img')];
    expect(imgs).toHaveLength(demo.anchors.length);
    expect(imgs[0].src).toBe(
      `data:image/png;base64,${btoa('https://wayfinding.example.nz/?v=demo-health-centre&anchor=a-entrance')}`
    );
    expect(admin.el.querySelector('[data-f="markers-title"]').textContent).toBe(
      t('admin.export.markers', { count: 3 })
    );

    const html = await admin.openPrintSheet();
    expect(openSheet).toHaveBeenCalledOnce();
    expect(html).toContain(
      'data-text="https://wayfinding.example.nz/?v=demo-health-centre&anchor=a-lift-1"'
    );
    expect(html.match(/<section class="card">/g)).toHaveLength(3);
    expect(html).toContain('Demo Health Centre');
  });

  it('registers a pre-printed sticker at the current position and the scanner recognises it', () => {
    const onScanRequest = vi.fn();
    const { admin, provider, prompt } = make({ ...qr, onScanRequest });
    expect(admin.beginRegister()).toBe(false); // no position yet
    provider.emit(pose(20, 6, 90));
    expect(admin.beginRegister()).toBe(true);
    expect(onScanRequest).toHaveBeenCalledOnce();
    expect(admin.registering).toBe(true);
    expect(admin.el.querySelector('[data-f="status"]').textContent).toBe(
      t('admin.record.registering')
    );

    prompt.mockReturnValueOnce('Sticker 17');
    const anchor = admin.registerCode('STICKER-0017');
    expect(anchor).toMatchObject({
      x: 20,
      y: 6,
      heading: 90,
      name: 'Sticker 17',
      code: 'STICKER-0017',
    });
    expect(admin.registering).toBe(false);
    expect(admin.markerPayload(anchor)).toBe('STICKER-0017'); // its own text, not a URL
    expect(admin.draft.validate()).toEqual([]);

    admin.beginRegister();
    expect(admin.registerCode('STICKER-0017')).toBeNull(); // recognised, not duplicated
    expect(admin.el.querySelector('[data-f="toast"]').textContent).toBe(
      t('admin.record.registerKnown', { name: 'Sticker 17' })
    );
    expect(admin.registerCode('ANOTHER')).toBeNull(); // not registering any more
  });

  describe('sticker survey', () => {
    const scan = (admin, code) => {
      admin.beginSurveyScan();
      return admin.registerCode(code);
    };

    it('records name + code + position per scan, first scan at the origin, and links stops', () => {
      const onScanRequest = vi.fn();
      const onManualPose = vi.fn();
      const { admin } = make({ ...qr, onScanRequest, onManualPose });
      admin.showTab('survey');
      const name = admin.el.querySelector('[data-f="survey-name"]');

      name.value = 'Main reception';
      expect(admin.beginSurveyScan()).toBe(true); // no position needed
      expect(onScanRequest).toHaveBeenCalledOnce();
      expect(admin.surveying).toBe(true);
      const first = admin.registerCode('A03');
      expect(admin.surveying).toBe(false);
      expect(first.anchor).toMatchObject({
        x: 0,
        y: 0,
        floor: 0,
        code: 'A03',
        name: 'Main reception',
      });
      expect(first.poi).toMatchObject({ name: 'Main reception', category: 'service' });
      expect(first.poi.aliases).toContain('Front desk'); // from the places library
      expect(admin.el.querySelector('[data-f="survey-toast"]').textContent).toBe(
        t('admin.survey.firstAtOrigin')
      );
      expect(name.value).toBe(''); // cleared for the next stop

      // Walk on: the app sets a new pose; the next scan links to the last stop.
      admin.setManualPose({ x: 12, y: 3, floor: 0 });
      const wardField = admin.el.querySelector('[data-f="survey-ward"]');
      wardField.value = '7';
      const second = scan(admin, 'A18');
      expect(second.anchor).toMatchObject({ x: 12, y: 3, code: 'A18', name: 'Ward 7' });
      expect(second.poi).toMatchObject({ name: 'Ward 7', category: 'ward' });
      expect(second.poi.aliases).toContain('W7');
      expect(
        admin.draft.edges.some(
          (e) =>
            (e.from === first.node.id && e.to === second.node.id) ||
            (e.from === second.node.id && e.to === first.node.id)
        )
      ).toBe(true);
      expect(admin.el.querySelector('[data-f="survey-count"]').textContent).toBe(
        t('admin.survey.count', { count: 2 })
      );
      expect(admin.draft.validate()).toEqual([]);

      // Re-scanning a recorded code fixes the position there instead of duplicating it.
      admin.setManualPose({ x: 40, y: 40, floor: 0 });
      expect(scan(admin, 'A03')).toBeNull();
      expect(onManualPose).toHaveBeenLastCalledWith(expect.objectContaining({ x: 0, y: 0 }));
      expect(admin.draft.anchors.filter((a) => a.code === 'A03')).toHaveLength(1);

      // No name typed: still recorded, by code.
      admin.setManualPose({ x: 20, y: 3, floor: 0 });
      const third = scan(admin, 'A06');
      expect(third.poi).toBeNull();
      expect(third.anchor.code).toBe('A06');
      expect(admin.el.querySelector('[data-f="survey-toast"]').textContent).toBe(
        t('admin.survey.recordedNoName', { code: 'A06' })
      );
    });

    it('a printed code list fills in names and floors, tracks progress and survives reload', () => {
      const { admin, storage } = make({ ...qr, onScanRequest: vi.fn() });
      admin.showTab('survey');
      const status = admin.el.querySelector('[data-f="survey-plan-status"]');
      const name = admin.el.querySelector('[data-f="survey-name"]');
      expect(status.textContent).toBe('');

      admin.el.querySelector('[data-f="survey-plan-demo"]').click();
      expect(admin.surveyPlan).toHaveLength(24);
      expect(status.textContent).toContain(t('admin.survey.planStatus', { done: 0, total: 24 }));
      expect(status.textContent).toContain('A01');
      expect(name.value).toBe('Main entrance - outside doors'); // offered, not committed

      // Scanning a *different* listed code uses that code's own name, not the offered one.
      const r = scan(admin, 'A09');
      expect(r.anchor).toMatchObject({ code: 'A09', name: 'Radiology reception', floor: 0 });
      expect(r.poi.name).toBe('Radiology reception');
      expect(status.textContent).toContain(t('admin.survey.planStatus', { done: 1, total: 24 }));

      // A typed name beats the list.
      admin.setManualPose({ x: 5, y: 0, floor: 0 });
      name.value = 'Front desk';
      expect(scan(admin, 'A03').anchor.name).toBe('Front desk');

      // A code listed on another floor moves the survey to that floor (creating it).
      expect(admin.draft.floorByIndex(2)).toBeNull();
      admin.setManualPose({ x: 5, y: 5, floor: 0 });
      const up = scan(admin, 'A22');
      expect(admin.draft.floorByIndex(2)).toMatchObject({ id: 'l2', name: 'Level 2' });
      expect(up.anchor).toMatchObject({ floor: 2, name: 'Ward 2' });
      expect(up.poi).toMatchObject({ category: 'ward' });
      expect(up.poi.aliases).toContain('W2');
      expect(admin.draft.validate()).toEqual([]);

      // Codes in a printed URL still match; unlisted codes are recorded plainly.
      admin.setManualPose({ x: 8, y: 5, floor: 2 });
      expect(scan(admin, 'https://s.example/A23').anchor.name).toBe('Theatre reception');
      admin.setManualPose({ x: 9, y: 5, floor: 2 });
      expect(scan(admin, 'ZZ99').anchor.name).toBeUndefined();

      // The list is kept per venue on this device.
      const { admin: again } = make({ storage });
      expect(again.surveyPlan).toHaveLength(24);
      expect(again.el.querySelector('[data-f="survey-plan"]').value).toContain('A24');

      // Bad lines are reported, good lines kept.
      const parsed = admin.setSurveyPlan('B01, G, Door\nnope');
      expect(parsed.rows).toHaveLength(1);
      expect(admin.el.querySelector('[data-f="toast"]').textContent).toBe(
        t('admin.survey.planErrors', { count: 1, first: parsed.errors[0] })
      );
    });
  });

  describe('stride calibration', () => {
    const walkStep = () => {
      window.dispatchEvent(
        Object.assign(new Event('devicemotion'), { acceleration: { x: 0, y: 2.5, z: 0 } })
      );
      window.dispatchEvent(
        Object.assign(new Event('devicemotion'), { acceleration: { x: 0, y: 0.2, z: 0 } })
      );
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('sets frame.strideM from a measured walk, and the wizard picks it up', () => {
      const { admin } = make();
      const distance = admin.el.querySelector('[data-f="stride-distance"]');
      const toggle = admin.el.querySelector('[data-f="stride-toggle"]');
      const status = admin.el.querySelector('[data-f="stride-status"]');
      expect(status.textContent).toBe(t('admin.stride.default'));

      distance.value = '7.3';
      toggle.click();
      expect(toggle.textContent).toBe(t('admin.stride.stop'));
      // 10 steps, 400 ms apart — clear of the fusion's default refractory window.
      for (let i = 0; i < 10; i += 1) {
        walkStep();
        vi.advanceTimersByTime(400);
      }
      expect(status.textContent).toBe(t('admin.stride.counting', { steps: 10 }));

      toggle.click();
      expect(toggle.textContent).toBe(t('admin.stride.start'));
      expect(status.textContent).toBe(t('admin.stride.saved', { m: 0.73, steps: 10 }));
      expect(admin.draft.frame.strideM).toBe(0.73);
      expect(admin.el.querySelector('[data-f="toast"]').textContent).toBe(
        t('admin.stride.saved', { m: 0.73, steps: 10 })
      );

      admin.showTab('routes');
      expect(admin.wizard.el.textContent).toBeTruthy(); // still renders with a custom stride
    });

    it('refuses too short a walk and stops listening for motion afterwards', () => {
      const { admin } = make();
      const toggle = admin.el.querySelector('[data-f="stride-toggle"]');
      const status = admin.el.querySelector('[data-f="stride-status"]');
      toggle.click();
      walkStep();
      toggle.click();
      expect(status.textContent).toBe(t('admin.stride.tooFewSteps', { steps: 1 }));
      expect(admin.draft.frame?.strideM).toBeUndefined();

      walkStep(); // no longer listening: does nothing
      expect(status.textContent).toBe(t('admin.stride.tooFewSteps', { steps: 1 }));
    });
  });
});
