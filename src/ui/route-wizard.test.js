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
    recording: [], // [active, distanceM][] — every onRecording call, in order
    onRecording: (active, distanceM) => h.recording.push([active, distanceM]),
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
    expect(h.recording).toEqual([[true, 0]]); // recording starts the instant the leg does
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
    expect(h.recording.at(-1)).toEqual([true, 6]); // the live distance keeps up with each point
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
    expect(h.recording.at(-1)).toEqual([false, undefined]); // the recording badge goes off with it
  });

  it('"not wheelchair-friendly" is reachable during the walk, before the auto-save on the destination scan', () => {
    // The auto-flow's destination scan calls arrive() then save() in the
    // same tick, so the checkbox has to be ticked *during* the walk step —
    // the finish step it used to live in is never actually shown to the
    // user in that flow (replaced before the next paint).
    const h = host();
    const w = createRouteWizard(h);
    const f = (n) => w.el.querySelector(`[data-f="${n}"]`);
    w.scanHere();
    h.decode('A01');
    expect(w.step).toBe('walk');

    for (let y = 1; y <= 6; y += 1) {
      const p = pose(0, y, 0, 0, 0.8);
      h.pose = p;
      w.onPose(p);
    }
    f('no-wheelchair').checked = true;
    w.scanHere();
    h.decode('A02');
    expect(w.step).toBe('walk'); // chained into the next leg

    const level = h.draft.edges.filter((e) => e.type !== 'stairs');
    expect(level.length).toBeGreaterThan(0);
    expect(level.every((e) => e.wheelchair === false)).toBe(true);
  });

  it('destroy() mid-walk turns the recording indicator off — closing admin must not leave it stuck on', () => {
    const h = host();
    const w = createRouteWizard(h);
    w.scanHere();
    h.decode('A01');
    expect(h.recording.at(-1)).toEqual([true, 0]);
    w.destroy();
    expect(h.recording.at(-1)).toEqual([false, undefined]);
  });
});

describe('RouteWizard — one button at a time (chain: false, startHere, stopHere)', () => {
  const walkTo = (h, w, x, y) => {
    h.pose = pose(x, y);
    w.onPose(h.pose);
  };

  it('with chain off, the end scan saves the route and waits at "done"', () => {
    const h = host(undefined, { plan: { A01: 'Entrance', A02: 'Ward 7' } });
    const w = createRouteWizard(h, { chain: false });
    const seen = [];
    w.onStep((s) => seen.push(s));
    w.scanHere();
    h.decode('A01');
    walkTo(h, w, 0, 10);
    w.scanHere();
    h.decode('A02');
    expect(w.step).toBe('done');
    expect(seen).toEqual(['walk', 'finish', 'done']);
    expect(h.draft.pois.map((p) => p.name)).toEqual(expect.arrayContaining(['Entrance', 'Ward 7']));
    w.nextFromHere(); // the user chose "walk on from here"
    expect(w.step).toBe('walk');
  });

  it('chain defaults on and can be switched', () => {
    const h = host(undefined, { plan: { A01: 'Entrance', A02: 'Ward 7' } });
    const w = createRouteWizard(h);
    w.setChain(false);
    w.scanHere();
    h.decode('A01');
    walkTo(h, w, 0, 10);
    w.scanHere();
    h.decode('A02');
    expect(w.step).toBe('done');
  });

  it('startHere and stopHere need no scan and name the places themselves', () => {
    const h = host();
    const w = createRouteWizard(h, { chain: false });
    h.setPose({ x: 0, y: 0 }, { confidence: 1 });
    expect(w.startHere()).toBe(true);
    expect(w.step).toBe('walk');
    walkTo(h, w, 0, 12);
    const saved = w.stopHere();
    expect(saved.distance).toBeGreaterThan(10);
    expect(w.step).toBe('done');
    expect(h.draft.pois.map((p) => p.name)).toEqual([
      t('admin.wizard.autoName', { n: 1 }),
      t('admin.wizard.autoName', { n: 2 }),
    ]);
  });

  it('startHere refuses without a position', () => {
    const h = host();
    const w = createRouteWizard(h);
    expect(w.startHere()).toBe(false);
    expect(w.step).toBe('start');
  });
});

describe('RouteWizard — quality check at the end of a route', () => {
  /** A venue with a known marker A02 at (0, 10); the walker starts at a fresh sticker A01 at the origin. */
  function setup(options) {
    const h = host(undefined, { plan: { A01: 'Entrance', A02: 'Ward 7' } });
    const a = h.draft.addAnchor({ x: 0, y: 10, floor: 0, name: 'Ward 7' });
    a.code = 'A02';
    const w = createRouteWizard(h, { chain: false, ...options });
    w.scanHere();
    h.decode('A01'); // new sticker: the origin, exact
    return { h, w };
  }
  const walk = (h, w, ys, confidence = 0.6) => {
    for (const y of ys) {
      h.pose = pose(0, y, 0, 0, confidence);
      w.onPose(h.pose);
    }
  };
  /** The provider reads the marker (an exact pose reaches the wizard), then the wizard is told the code. */
  const scanEnd = (h, w) => {
    w.scanHere();
    const p = pose(0, 10, 0, 0, 1);
    h.pose = p;
    w.onPose(p);
    h.decode('A02');
  };

  it('good: small drift is reported and the route ends exactly on the marker', () => {
    const { h, w } = setup();
    walk(h, w, [3, 6, 9, 10.4]); // 0.4 m long over 10 m
    scanEnd(h, w);
    const q = w.route.quality;
    expect(q.verdict).toBe('good');
    expect(q.driftM).toBeCloseTo(0.4, 1);
    expect(q.corrected).toBe(true);
    expect(w.step).toBe('done');
  });

  it('ok: drift is spread back along the route instead of dumped on the last leg', () => {
    const { h, w } = setup();
    walk(h, w, [3, 6, 9, 12.4]); // 2.4 m long over 12.4 m
    scanEnd(h, w);
    const q = w.route.quality;
    expect(q.verdict).toBe('ok');
    expect(q.driftM).toBeCloseTo(2.4, 1);
    const ys = h.draft.nodes
      .filter((n) => n.x === 0)
      .map((n) => n.y)
      .sort((a, b) => a - b);
    // Each recorded point moved back by its share (0.58 m at y=3 … 2.4 m at the end) and
    // the last one merged into the marker's own point at 10.
    expect(ys[0]).toBe(0);
    expect(ys.at(-1)).toBeCloseTo(10, 1);
    expect(ys).toHaveLength(new Set(ys.map((y) => y.toFixed(1))).size); // no duplicate points
    const gaps = ys.slice(1).map((y, i) => y - ys[i]);
    for (const g of gaps) expect(g).toBeGreaterThan(1.5); // evenly shortened, none collapsed
    // Distances follow: the route's total matches the corridor it now describes.
    expect(w.route.distance).toBeCloseTo(10, 0);
  });

  it('check: a big miss is reported, NOT baked into the map, and can be re-walked', () => {
    const { h, w } = setup();
    walk(h, w, [3, 6, 9, 12, 15, 18]); // 8 m long over 18 m
    const nodesBefore = h.draft.nodes.length;
    scanEnd(h, w);
    const q = w.route.quality;
    expect(q.verdict).toBe('check');
    expect(q.driftM).toBeCloseTo(8, 1);
    expect(q.corrected).toBe(false);
    expect(h.draft.nodes.find((n) => n.y === 18)).toBeDefined(); // left as walked

    expect(w.rewalk()).toBe(true);
    expect(w.step).toBe('walk');
    // Only this route's own points are gone; the start (and its place) remain.
    expect(h.draft.nodes.map((n) => n.y)).toEqual(expect.arrayContaining([0]));
    expect(h.draft.nodes.some((n) => n.y >= 3 && n.y !== 10)).toBe(false);
    expect(h.draft.nodes.length).toBeLessThan(nodesBefore);
    // Walking it again works and now ends fine.
    walk(h, w, [3, 6, 9.4]);
    scanEnd(h, w);
    expect(w.route.quality.verdict).toBe('good');
  });

  it('unchecked: no comparison is possible when the end marker is new', () => {
    const h = host(undefined, { plan: { A01: 'Entrance', A03: 'New spot' } });
    const w = createRouteWizard(h, { chain: false });
    w.scanHere();
    h.decode('A01');
    walk(h, w, [3, 6, 9]);
    w.scanHere();
    h.decode('A03'); // a sticker nobody has recorded: it lives wherever dead reckoning says
    expect(w.route.quality.verdict).toBe('unchecked');
  });

  it('unchecked: a route that began at an approximate position cannot be judged', () => {
    const h = host(undefined, { plan: { A02: 'Ward 7' } });
    const a = h.draft.addAnchor({ x: 0, y: 10, floor: 0 });
    a.code = 'A02';
    const w = createRouteWizard(h, { chain: false });
    h.setPose({ x: 0, y: 0 }, { confidence: 0.5 });
    w.startHere();
    walk(h, w, [3, 6, 9]);
    scanEnd(h, w);
    expect(w.route.quality.verdict).toBe('unchecked');
  });

  it('rewalk only applies to a saved route', () => {
    const { w } = setup();
    expect(w.rewalk()).toBe(false);
  });

  it('judges against the length walked: the same miss is fine on a long route', () => {
    const { h, w } = setup({ goodM: 0.1, goodPct: 0.02, okM: 0.5, okPct: 0.3 });
    walk(h, w, [3, 6, 9, 12, 15, 18]); // 8 m miss over 18 m = 44%
    scanEnd(h, w);
    expect(w.route.quality.verdict).toBe('check');
    const h2 = setup({ goodM: 0.1, goodPct: 0.02, okM: 0.5, okPct: 0.5 });
    walk(h2.h, h2.w, [3, 6, 9, 12, 15, 18]);
    scanEnd(h2.h, h2.w);
    expect(h2.w.route.quality.verdict).toBe('ok');
  });
});

describe('RouteWizard — undo last route', () => {
  const walkTo = (h, w, x, y) => {
    h.pose = pose(x, y);
    w.onPose(h.pose);
  };
  /** Scan A01 (a new sticker: the origin), walk north, scan the new sticker `end` at the end. */
  function recordRoute(h, w, end, toY = 12) {
    w.scanHere();
    h.decode('A01');
    walkTo(h, w, 0, 4);
    walkTo(h, w, 0, 8);
    walkTo(h, w, 0, toY);
    w.scanHere();
    h.decode(end);
  }
  const snapshot = (h) => ({
    nodes: h.draft.nodes.length,
    edges: h.draft.edges.length,
    pois: h.draft.pois.length,
    anchors: h.draft.anchors.length,
  });

  it("removes the route's points, edges, places and new markers, and returns to the start", () => {
    const h = host(undefined, { plan: { A01: 'Entrance', A02: 'Ward 7' } });
    const w = createRouteWizard(h, { chain: false });
    w.scanHere();
    h.decode('A01'); // the origin sticker exists before the route begins
    const base = snapshot(h);
    walkTo(h, w, 0, 4);
    walkTo(h, w, 0, 8);
    walkTo(h, w, 0, 12);
    w.scanHere();
    h.decode('A02');
    expect(w.step).toBe('done');
    expect(snapshot(h).nodes).toBeGreaterThan(base.nodes + 2);
    expect(w.canUndo).toBe(true);

    expect(w.undoLastRoute()).toBe(true);
    expect(w.step).toBe('start');
    // Only what this route created is gone: the origin's point, place and sticker stay.
    expect(snapshot(h).edges).toBe(0);
    expect(snapshot(h).nodes).toBe(base.nodes);
    expect(snapshot(h).anchors).toBe(base.anchors);
    expect(snapshot(h).pois).toBe(base.pois);
    expect(h.draft.pois.some((p) => p.name === 'Ward 7')).toBe(false);
    expect(w.canUndo).toBe(false);
    expect(h.toasts.at(-1)).toBe(t('admin.wizard.undone'));
  });

  it('can be repeated to step back through several routes', () => {
    const h = host(undefined, { plan: { A01: 'Entrance', A02: 'Ward 7', A03: 'Ward 8' } });
    const w = createRouteWizard(h, { chain: false });
    recordRoute(h, w, 'A02');
    w.nextFromHere(); // walk on from Ward 7
    walkTo(h, w, 0, 16);
    walkTo(h, w, 0, 20);
    w.scanHere();
    h.decode('A03');
    expect(w.step).toBe('done');
    const twoRoutes = snapshot(h);

    w.undoLastRoute(); // takes out only the second route
    const oneRoute = snapshot(h);
    expect(oneRoute.nodes).toBeLessThan(twoRoutes.nodes);
    expect(h.draft.pois.some((p) => p.name === 'Ward 7')).toBe(true);
    expect(h.draft.pois.some((p) => p.name === 'Ward 8')).toBe(false);

    expect(w.canUndo).toBe(true); // available again at the start screen
    w.undoLastRoute();
    expect(h.draft.pois.some((p) => p.name === 'Ward 7')).toBe(false);
    expect(snapshot(h).edges).toBe(0);
    expect(w.canUndo).toBe(false);
  });

  it('leaves alone what the route only passed through (a marker the venue already had)', () => {
    const h = host(undefined, { plan: { A01: 'Entrance', A02: 'Ward 7' } });
    const known = h.draft.addAnchor({ x: 0, y: 12, floor: 0, name: 'Known' });
    known.code = 'A02';
    const w = createRouteWizard(h, { chain: false });
    recordRoute(h, w, 'A02');
    expect(w.step).toBe('done');
    w.undoLastRoute();
    expect(h.draft.anchors.some((a) => a.id === known.id)).toBe(true);
  });

  it('is not available while a route is in progress, or with nothing saved', () => {
    const h = host(undefined, { plan: { A01: 'Entrance' } });
    const w = createRouteWizard(h, { chain: false });
    expect(w.canUndo).toBe(false);
    expect(w.undoLastRoute()).toBe(false);
    w.scanHere();
    h.decode('A01'); // a route begins
    expect(w.step).toBe('walk');
    expect(w.undoLastRoute()).toBe(false);
  });

  it('walk-it-again still works on top of the same record', () => {
    const h = host(undefined, { plan: { A01: 'Entrance', A02: 'Ward 7' } });
    const w = createRouteWizard(h, { chain: false });
    recordRoute(h, w, 'A02');
    expect(w.rewalk()).toBe(true);
    expect(w.step).toBe('walk');
    expect(w.canUndo).toBe(false); // the redone route is not saved until it is finished
  });
});
