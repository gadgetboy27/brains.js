// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VenueDraft } from '../core/venue-draft.js';
import { blankVenue } from '../app.js';
import { AdminPanel } from './admin.js';
import { createRouteWizard } from './route-wizard.js';
import { t } from './strings/index.js';

const pose = (x, y, heading = 0, floor = 0, confidence = 1) => ({
  x,
  y,
  z: floor * 4,
  floor,
  heading,
  confidence,
  timestamp: 0,
});

/** A host that behaves like the admin panel: a pose the wizard can set, a draft, scans on demand. */
function host(draft = new VenueDraft(blankVenue('test-site')), { plan = {} } = {}) {
  const h = {
    draft,
    mount: document.body,
    pose: null,
    scanHandler: null,
    toasts: [],
    changed: vi.fn(),
    showTab: vi.fn(),
    getPose: () => h.pose,
    setPose: (point, { confidence = 0.5 } = {}) => {
      h.pose = { ...pose(point.x, point.y, point.heading ?? 0, point.floor ?? 0, confidence) };
      return h.pose;
    },
    scan: (handler) => (h.scanHandler = handler),
    fixToCode: (text) => {
      const a = draft.anchors.find((x) => x.code === text);
      if (!a) return false;
      h.setPose(a, { confidence: 1 });
      return true;
    },
    toast: (text) => h.toasts.push(text),
    wardFields: AdminPanel.wardFields,
    // A printed-code list, like AdminPanel's — most codes name themselves.
    resolveCodeName: (text) => plan[text] ?? null,
    /** The camera decoded `text`. */
    decode(text) {
      const fn = h.scanHandler;
      h.scanHandler = null;
      return fn?.(text);
    },
  };
  return h;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('RouteWizard', () => {
  it('a scan starts a route, a scan ends it and starts the next — no typing required', () => {
    const h = host(undefined, { plan: { A01: 'Main entrance', A18: 'Ward 7' } });
    const w = createRouteWizard(h, { stepM: 3, turnDeg: 35 });
    const f = (n) => w.el.querySelector(`[data-f="${n}"]`);
    // As in the panel: the live position updates, then the wizard hears about it.
    const walk = (p) => {
      h.pose = p;
      w.onPose(p);
    };
    expect(w.step).toBe('start');
    expect(f('start-status').textContent).toBe(t('admin.wizard.start.noPose'));

    // Scan the sticker at the entrance: first code of a new venue = origin,
    // named from the printed-code list, walking begins automatically.
    w.scanHere();
    const entrance = h.decode('A01');
    expect(entrance).toMatchObject({ x: 0, y: 0, code: 'A01' });
    expect(h.pose.confidence).toBe(1);
    expect(w.step).toBe('walk');
    const start = h.draft.pois.find((p) => p.name === 'Main entrance');
    expect(start).toMatchObject({ category: 'exit' }); // from the places library
    expect(start.aliases).toContain('Way out');

    // The camera catching the same sticker twice (or a fumbled re-tap) is a
    // fix, not an arrival — the route doesn't end on its own start code.
    w.scanHere();
    expect(h.decode('A01')).toBeNull(); // known: not re-recorded
    expect(w.step).toBe('walk');
    expect(w.route).toMatchObject({ nodes: 0, scans: 1 });

    // Walk north: dead-reckoned poses every metre; a point lands every 3 m.
    for (let y = 1; y <= 7; y += 1) walk(pose(0, y, 0, 0, 0.8));
    expect(w.route).toMatchObject({ nodes: 2, distance: 6 }); // at y=3 and y=6
    // Stale dead reckoning: nothing is dropped, the hint asks for a scan.
    walk(pose(0, 7, 0, 0, 0.1));
    expect(f('walk-hint').textContent).toBe(t('admin.wizard.walk.uncertain'));

    // Walk on, up to level 1 (the floor change is tagged stairs automatically).
    walk(pose(0, 7, 90, 0, 1));
    expect(f('walk-hint').textContent).toBe(t('admin.wizard.walk.hint'));
    walk(pose(6, 7, 90, 0, 1));
    walk(pose(6, 7, 90, 1, 1));
    const stairs = h.draft.edges.at(-1);
    expect(stairs).toMatchObject({ type: 'stairs', floorChange: true });

    // Scan the destination sticker: ends this route and starts the next,
    // named from the list — no fields to fill in, no button but Scan.
    w.scanHere();
    expect(h.decode('A18')).toMatchObject({ code: 'A18', floor: 1 });
    const ward = h.draft.pois.find((p) => p.name === 'Ward 7');
    expect(ward).toBeTruthy();
    expect(h.draft.nodeById(ward.node).floor).toBe(1);
    expect(f('summary').textContent).toMatch(
      /^Main entrance → Ward 7: \d+ m, \d+ points, 2 codes$/
    );
    expect(h.draft.validate()).toEqual([]);
    expect(h.toasts).toContain(t('admin.wizard.done.saved'));
    expect(w.step).toBe('walk'); // chained straight into the next leg
    expect(w.route).toMatchObject({ nodes: 0, distance: 0 });

    // Walk on and scan a code with no entry in the printed-code list: it is
    // still recorded — by its own text — so nothing is lost for want of a name.
    walk(pose(10, 7, 90, 1, 0.9));
    w.scanHere();
    expect(h.decode('C99')).toMatchObject({ code: 'C99' });
    const c99 = h.draft.pois.find((p) => p.name === 'C99');
    expect(c99).toBeTruthy();
    expect(h.draft.edgeBetween(ward.node, c99.node)).toBeTruthy();
    expect(h.draft.validate()).toEqual([]);
  });

  it('starts from and ends at existing places, joining the graph instead of duplicating it', () => {
    const draft = new VenueDraft(blankVenue('site'));
    const a = draft.addNode({ x: 0, y: 0, floor: 0 });
    const b = draft.addNode({ x: 20, y: 0, floor: 0 });
    draft.addPoi({ name: 'Reception', node: a.id });
    draft.addPoi({ name: 'Pharmacy', node: b.id });
    const h = host(draft);
    const w = createRouteWizard(h);
    const f = (n) => w.el.querySelector(`[data-f="${n}"]`);
    const nodesBefore = draft.nodes.length;

    expect([...f('start-existing').options].map((o) => o.textContent)).toEqual([
      t('admin.wizard.existingNone'),
      'Pharmacy',
      'Reception',
    ]);
    f('start-existing').value = draft.pois[0].id; // Reception
    f('start-existing').dispatchEvent(new Event('change'));
    expect(f('start-name').value).toBe('Reception');
    expect(w.beginWalk()).toBe(true);
    expect(h.pose).toMatchObject({ x: 0, y: 0, confidence: 1 });

    w.onPose(pose(10, 0, 90));
    w.arrive();
    expect([...f('finish-existing').options].map((o) => o.textContent)).toEqual([
      t('admin.wizard.existingNone'),
      'Pharmacy', // the start place is not offered as its own destination
    ]);
    f('finish-existing').value = draft.pois[1].id;
    expect(w.save()).toMatchObject({ edges: 2 });
    expect(draft.nodes.length).toBe(nodesBefore + 1); // only the midpoint was new
    expect(draft.edgeBetween(draft.nodes.at(-1).id, b.id)).toMatchObject({ distance: 10 });
    expect(draft.validate()).toEqual([]);
  });

  it('needs a destination name, marks turns by hand, and can stop a route', () => {
    const h = host();
    const w = createRouteWizard(h);
    const f = (n) => w.el.querySelector(`[data-f="${n}"]`);
    h.setPose({ x: 0, y: 0 }, { confidence: 1 });
    f('start-name').value = 'Lift lobby';
    w.beginWalk();
    h.pose = pose(2, 0, 90);
    expect(w.markTurn()).toMatchObject({ x: 2, y: 0 });
    expect(w.route.nodes).toBe(1);
    w.arrive();
    expect(w.save()).toBeNull();
    expect(f('finish-status').textContent).toBe(t('admin.wizard.finish.needName'));
    w.cancel();
    expect(w.step).toBe('start');
    expect(h.toasts.at(-1)).toBe(t('admin.wizard.walk.cancelled'));
    expect(h.draft.nodes.length).toBeGreaterThan(1); // recorded points stay (Undo removes them)
  });
});
