/**
 * Route wizard — building a venue's routes by scanning, nothing else:
 *
 *   1. Scan the code where a route starts.
 *   2. Walk to the next place. Points are dropped automatically from the
 *      live position (step-counted dead reckoning between codes).
 *   3. Scan the code there — that ends this route and starts the next one,
 *      so a whole wing is surveyed by walking it once, scanning at each stop.
 *
 * A name for each stop is filled in automatically (from a printed-code list
 * the venue knows about — see AdminPanel's `resolveCodeName` — or the code
 * itself if not), so nothing needs to be typed to capture a route. Naming
 * it properly, picking an existing place, tagging stairs/lift/staff-only,
 * or marking a route not wheelchair-friendly are all still there, tucked
 * under "Advanced", for whoever wants them.
 *
 * It writes only through the {@link VenueDraft} the admin panel owns, so
 * Undo, autosave and Publish all apply. Everything it needs from the panel
 * comes through a small host object, so it is testable without the panel.
 *
 * "Position" here is indoor positioning (codes + dead reckoning + map
 * matching), never GPS — see docs/DECISIONS.md.
 */

import { metresBetween } from '../core/distance.js';
import { HOSPITAL_PLACES, findPlace } from '../venues/places-library.js';
import { t } from './strings/index.js';

/**
 * @typedef {Object} WizardHost
 * @property {import('../core/venue-draft.js').VenueDraft} draft
 * @property {HTMLElement} mount                        Where the wizard renders.
 * @property {Document} [document]
 * @property {() => object | null} getPose
 * @property {(point: object, opts?: object) => object} setPose   Fix the position by hand (exact when `confidence: 1`).
 * @property {(handler: (text: string) => unknown) => void} scan  Show the camera; the next decoded code goes to `handler`.
 * @property {(text: string) => boolean} fixToCode      Position at a code this draft knows; false if unknown.
 * @property {(text: string) => void} toast
 * @property {() => void} changed                       The draft changed (autosave, redraw).
 * @property {(name: string) => void} [showTab]
 * @property {(n: unknown) => { name: string, aliases: string[] } | null} wardFields
 * @property {ReadonlyArray<object>} [places]
 * @property {(code: string) => string | null} [resolveCodeName]  A printed-code list's name for this code, if any.
 * @property {(active: boolean, distanceM?: number) => void} [onRecording]  A leg started/stopped, or its distance moved.
 */

const SECTION_TYPES = ['walk', 'door', 'stairs', 'lift', 'ramp', 'escalator'];

export class RouteWizard {
  #host;
  #doc;
  #el;
  #f;
  #opts;
  #step = 'start';
  #startNode = null;
  #startName = '';
  #lastNode = null;
  #lastHeading = null;
  #route = null;
  #uncertain = false;
  /** @type {Set<(step: string) => void>} */
  #stepListeners = new Set();
  /** Nodes this route passed through, in order; `created` ones are this route's own (safe to move or remove). */
  #legNodes = [];
  /** POIs and markers this route created (as opposed to ones it found already there). */
  #legPois = [];
  #legAnchors = [];
  /**
   * Routes saved this session, newest last, with everything each created, so
   * the latest can be taken back out.
   * @type {Array<{ nodes: string[], edges: Array<{ from: string, to: string }>, pois: string[], anchors: string[] }>}
   */
  #saved = [];
  /** How the next floor change was made ('lift' | 'stairs'), set by {@link noteTransfer}. */
  #transferType = null;
  /** The last dead-reckoned (not exact) position seen since the last exact fix. */
  #lastDr = null;
  /**
   * The stretch since the last exact fix: where it began (null if that was not
   * an exact position, so the stretch cannot be judged) and the points dropped on it.
   * @type {{ start: { x: number, y: number, floor: number } | null, nodes: Array<{ id: string, created: boolean }> }}
   */
  #seg = { start: null, nodes: [] };
  /** True while the wizard is setting the position itself (a new sticker defines it): not ground truth. */
  #selfFix = false;
  /** The code that started the current leg — re-scanning it mid-walk is a position fix, not an arrival. */
  #startCode = null;

  /**
   * @param {WizardHost} host
   * @param {{ stepM?: number, turnDeg?: number, minConfidence?: number, snapM?: number, chain?: boolean,
   *   goodM?: number, goodPct?: number, okM?: number, okPct?: number }} [options]
   *   `goodM`/`goodPct` and `okM`/`okPct` set the quality check's limits: the
   *   end-of-route drift is "good" within the larger of `goodM` metres and
   *   `goodPct` of the route's length, "ok" within the larger of `okM` and `okPct`.
   *   `chain: false` stops after a route is saved (at the `done` step) instead
   *   of starting the next route from where this one ended; the caller then
   *   chooses with {@link nextFromHere} or {@link reset}.
   */
  constructor(host, options = {}) {
    if (!host?.draft || !host?.mount) throw new TypeError('RouteWizard needs a draft and a mount');
    this.#host = host;
    this.#doc = host.document ?? globalThis.document;
    this.#opts = {
      stepM: 3,
      turnDeg: 35,
      minConfidence: 0.3,
      snapM: 1.5,
      chain: true,
      goodM: 1,
      goodPct: 0.05,
      okM: 3,
      okPct: 0.15,
      ...options,
    };
    this.#render();
    this.#show('start');
  }

  get el() {
    return this.#el;
  }

  get step() {
    return this.#step;
  }

  /**
   * Be told whenever the wizard moves to another step.
   * @param {(step: 'start' | 'walk' | 'finish' | 'done') => void} listener
   * @returns {() => void} Unsubscribe.
   */
  onStep(listener) {
    this.#stepListeners.add(listener);
    return () => this.#stepListeners.delete(listener);
  }

  /** Whether to carry straight on into the next route after one is saved (see the `chain` option). */
  setChain(on) {
    this.#opts.chain = Boolean(on);
  }

  /** Whether the position is uncertain right now (dead reckoning has gone stale). */
  get uncertain() {
    return this.#uncertain;
  }

  /** Live figures for the route being walked (null outside a route). */
  get route() {
    return this.#route ? { ...this.#route, edges: [...this.#route.edges] } : null;
  }

  // ---------------------------------------------------------------- render

  #render() {
    const el = this.#doc.createElement('div');
    el.className = 'wizard';
    el.innerHTML = `
      <section data-step="start">
        <p class="wizard-live" data-f="start-status" role="status" aria-live="polite"></p>
        <div class="admin-actions">
          <button type="button" class="btn btn-primary btn-big" data-f="start-scan"></button>
          <button type="button" class="btn btn-big" data-f="start-next"></button>
        </div>
        <label><span data-f="start-name-label"></span><input data-f="start-name" list="admin-places" autocomplete="off" /></label>
        <details class="admin-plan">
          <summary data-f="advanced-label"></summary>
          <p data-f="start-hint"></p>
          <label><span data-f="start-existing-label"></span><select data-f="start-existing"><option value=""></option></select></label>
          <label><span data-f="start-ward-label"></span><input type="number" min="1" max="99" inputmode="numeric" data-f="start-ward" /></label>
        </details>
      </section>
      <section data-step="walk" hidden>
        <p class="wizard-live" data-f="walk-status" role="status" aria-live="polite"></p>
        <p class="admin-status" data-f="walk-hint"></p>
        <div class="admin-actions">
          <button type="button" class="btn btn-primary btn-big" data-f="walk-scan"></button>
        </div>
        <div class="admin-actions">
          <button type="button" class="btn" data-f="walk-turn"></button>
          <button type="button" class="btn" data-f="walk-arrive"></button>
          <button type="button" class="btn" data-f="walk-cancel"></button>
        </div>
        <details class="admin-plan">
          <summary data-f="advanced-label"></summary>
          <label><span data-f="section-label"></span><select data-f="section"></select></label>
          <label class="wizard-check"><input type="checkbox" data-f="staff" /> <span data-f="staff-label"></span></label>
          <label class="wizard-check">
            <input type="checkbox" data-f="no-wheelchair" />
            <span data-f="no-wheelchair-label"></span>
          </label>
        </details>
      </section>
      <section data-step="finish" hidden>
        <p data-f="finish-hint"></p>
        <label><span data-f="finish-existing-label"></span><select data-f="finish-existing"><option value=""></option></select></label>
        <label><span data-f="finish-name-label"></span><input data-f="finish-name" list="admin-places" autocomplete="off" /></label>
        <label><span data-f="finish-ward-label"></span><input type="number" min="1" max="99" inputmode="numeric" data-f="finish-ward" /></label>
        <div class="admin-actions">
          <button type="button" class="btn" data-f="finish-scan"></button>
          <button type="button" class="btn btn-primary" data-f="finish-save"></button>
        </div>
        <p class="admin-status" data-f="finish-status"></p>
      </section>
      <section data-step="done" hidden>
        <p class="wizard-summary" data-f="summary" role="status"></p>
        <div class="admin-actions">
          <button type="button" class="btn btn-primary" data-f="next-here"></button>
          <button type="button" class="btn" data-f="next-new"></button>
          <button type="button" class="btn" data-f="publish"></button>
        </div>
      </section>
    `;
    this.#el = el;
    this.#f = (n) => el.querySelector(`[data-f="${n}"]`);
    for (const label of el.querySelectorAll('[data-f="advanced-label"]')) {
      label.textContent = t('admin.wizard.advanced');
    }
    const text = {
      'start-hint': 'admin.wizard.start.hint',
      'start-existing-label': 'admin.wizard.existing',
      'start-name-label': 'admin.wizard.start.name',
      'start-ward-label': 'admin.ward.number',
      'start-scan': 'admin.wizard.start.scan',
      'start-next': 'admin.wizard.start.next',
      'section-label': 'admin.wizard.walk.section',
      'staff-label': 'admin.wizard.walk.staffOnly',
      'walk-turn': 'admin.wizard.walk.turn',
      'walk-scan': 'admin.wizard.walk.scan',
      'walk-arrive': 'admin.wizard.walk.arrive',
      'walk-cancel': 'admin.wizard.walk.cancel',
      'finish-hint': 'admin.wizard.finish.hint',
      'finish-existing-label': 'admin.wizard.existing',
      'finish-name-label': 'admin.wizard.finish.name',
      'finish-ward-label': 'admin.ward.number',
      'no-wheelchair-label': 'admin.wizard.finish.noWheelchair',
      'finish-scan': 'admin.wizard.scanHere',
      'finish-save': 'admin.wizard.finish.save',
      'next-here': 'admin.wizard.done.nextHere',
      'next-new': 'admin.wizard.done.nextNew',
      publish: 'admin.wizard.done.publish',
    };
    for (const [f, key] of Object.entries(text)) this.#f(f).textContent = t(key);
    const section = this.#f('section');
    for (const type of SECTION_TYPES) {
      const o = this.#doc.createElement('option');
      o.value = type;
      o.textContent = t(`admin.wizard.section.${type}`);
      section.appendChild(o);
    }
    for (const side of ['start', 'finish']) {
      this.#f(`${side}-ward`).addEventListener('input', () => {
        const w = this.#host.wardFields(this.#f(`${side}-ward`).value);
        if (w) this.#f(`${side}-name`).value = w.name;
      });
      this.#f(`${side}-existing`).addEventListener('change', () => {
        const poi = this.#poiById(this.#f(`${side}-existing`).value);
        if (poi) {
          this.#f(`${side}-name`).value = poi.name;
          this.#f(`${side}-ward`).value = '';
        }
      });
    }
    this.#f('start-scan').addEventListener('click', () => this.scanHere());
    this.#f('start-next').addEventListener('click', () => this.beginWalk());
    this.#f('walk-turn').addEventListener('click', () => this.markTurn());
    this.#f('walk-scan').addEventListener('click', () => this.scanHere());
    this.#f('walk-arrive').addEventListener('click', () => this.arrive());
    this.#f('walk-cancel').addEventListener('click', () => this.cancel());
    this.#f('finish-scan').addEventListener('click', () => this.scanHere());
    this.#f('finish-save').addEventListener('click', () => this.save());
    this.#f('next-here').addEventListener('click', () => this.nextFromHere());
    this.#f('next-new').addEventListener('click', () => this.reset());
    this.#f('publish').addEventListener('click', () => this.#host.showTab?.('export'));
    this.#host.mount.appendChild(el);
  }

  #show(step) {
    this.#step = step;
    for (const s of this.#el.querySelectorAll('[data-step]')) s.hidden = s.dataset.step !== step;
    if (step === 'start' || step === 'finish') this.#fillExisting(step);
    if (step === 'start') this.#updateStart();
    if (step === 'walk') this.#updateWalk();
    for (const l of this.#stepListeners) l(step);
  }

  #fillExisting(side) {
    const sel = this.#f(`${side}-existing`);
    sel.textContent = '';
    const blank = this.#doc.createElement('option');
    blank.value = '';
    blank.textContent = t('admin.wizard.existingNone');
    sel.appendChild(blank);
    const pois = [...this.#host.draft.pois].sort((a, b) => a.name.localeCompare(b.name));
    for (const poi of pois) {
      if (side === 'finish' && poi.node === this.#startNode) continue;
      const o = this.#doc.createElement('option');
      o.value = poi.id;
      o.textContent = poi.name;
      sel.appendChild(o);
    }
  }

  #poiById(id) {
    return this.#host.draft.pois.find((p) => p.id === id) ?? null;
  }

  #updateStart() {
    const pose = this.#host.getPose();
    this.#f('start-status').textContent = pose
      ? pose.confidence >= 1
        ? t('admin.wizard.start.ready')
        : t('admin.wizard.start.readyApprox')
      : t('admin.wizard.start.noPose');
  }

  #updateWalk() {
    if (!this.#route) return;
    this.#f('walk-status').textContent = t('admin.wizard.walk.status', {
      distance: Math.round(this.#route.distance),
      points: this.#route.nodes,
      scans: this.#route.scans,
    });
    this.#f('walk-hint').textContent = this.#uncertain
      ? t('admin.wizard.walk.uncertain')
      : t('admin.wizard.walk.hint');
  }

  // ------------------------------------------------------------------ names

  #nameFields(side) {
    const ward = this.#host.wardFields(this.#f(`${side}-ward`).value);
    const typed = this.#f(`${side}-name`).value.trim();
    const existing = this.#poiById(this.#f(`${side}-existing`).value);
    return { ward, name: ward?.name ?? typed, existing };
  }

  /** Make sure a place with this name sits on the node (reusing one that already does). */
  #placeAt(nodeId, name, ward) {
    if (!name) return null;
    const draft = this.#host.draft;
    const there = draft.pois.find((p) => p.node === nodeId);
    if (there) return there;
    const template = findPlace(name, this.#host.places ?? HOSPITAL_PLACES);
    const poi = draft.addPoi({
      name,
      node: nodeId,
      aliases: [...new Set([...(ward?.aliases ?? []), ...(template?.aliases ?? [])])],
      category: ward ? 'ward' : template?.category,
      access: template?.access,
    });
    if (this.#route) this.#legPois.push(poi.id);
    return poi;
  }

  // ------------------------------------------------------------------ scans

  /** Show the camera; the next code either fixes the position (known) or is recorded here (new). */
  scanHere() {
    this.#host.scan((text) => this.#onCode(text));
  }

  #onCode(text) {
    const draft = this.#host.draft;
    if (this.#host.fixToCode(text)) {
      if (this.#route) this.#route.scans += 1;
      if (this.#step === 'walk') this.onPose(this.#host.getPose());
      else this.#updateStart();
      this.#updateWalk();
      this.#autoAdvance(text);
      return null;
    }
    let pose = this.#host.getPose();
    if (!pose) {
      // The very first code of a new venue becomes the map origin.
      pose = this.#host.setPose({ x: 0, y: 0, floor: draft.floors[0].index }, { quiet: true });
    }
    const side = this.#step === 'finish' ? 'finish' : this.#step === 'start' ? 'start' : null;
    const { name } = side ? this.#nameFields(side) : { name: '' };
    ensureFloor(draft, pose.floor);
    const anchor = draft.addAnchor({
      x: pose.x,
      y: pose.y,
      z: pose.z,
      floor: pose.floor,
      heading: pose.heading ?? 0,
      name: name || undefined,
    });
    anchor.code = text;
    if (this.#route) this.#legAnchors.push(anchor.id);
    // The code now lives here: the position is exact from this point.
    this.#setPoseSelf(
      { x: anchor.x, y: anchor.y, z: anchor.z, floor: anchor.floor, heading: anchor.heading },
      { confidence: 1, quiet: true }
    );
    if (this.#route) this.#route.scans += 1;
    this.#host.toast(t('admin.wizard.codeRecorded', { code: text }));
    this.#host.changed();
    if (this.#step === 'walk') {
      this.#selfFix = true; // still our own definition of where this sticker is
      try {
        this.onPose(this.#host.getPose());
      } finally {
        this.#selfFix = false;
      }
    } else this.#updateStart();
    this.#autoAdvance(text);
    return anchor;
  }

  /**
   * A scan drives the wizard on its own: the first code of a fresh leg
   * starts it (named automatically — from a printed-code list if the venue
   * has one, else the code itself, so nothing has to be typed to capture a
   * route), and any code seen while walking ends the leg and immediately
   * starts the next one. The one exception is re-scanning the leg's own
   * start code (a mis-scan, or confirming position) — that only fixes the
   * position, so a route can't be accidentally saved with itself as both
   * ends.
   */
  #autoAdvance(text) {
    if (this.#step === 'start') {
      this.#f('start-name').value = this.#resolveScanName(text);
      this.beginWalk();
      this.#startCode = text;
    } else if (this.#step === 'walk' && text !== this.#startCode) {
      this.#f('finish-name').value = this.#resolveScanName(text);
      this.arrive();
      this.save();
      if (this.#opts.chain) {
        this.nextFromHere();
        this.#startCode = text;
      }
    }
  }

  /** The best name for a scanned code: a printed-code list, an existing record of it, or the code itself. */
  #resolveScanName(text) {
    const planName = this.#host.resolveCodeName?.(text);
    if (planName) return planName;
    const draft = this.#host.draft;
    const anchor = draft.anchors.find((a) => a.code === text);
    if (anchor?.name) return anchor.name;
    if (anchor) {
      const node = draft.snapToNode(anchor, 0.5);
      const poi = node && draft.pois.find((p) => p.node === node.id);
      if (poi) return poi.name;
    }
    return text;
  }

  // ------------------------------------------------------------------ steps

  /** Step 1 → 2: fix the start node (and place), begin dropping points. */
  beginWalk() {
    const draft = this.#host.draft;
    const { ward, name, existing } = this.#nameFields('start');
    let node;
    if (existing) {
      node = draft.nodeById(existing.node);
      this.#host.setPose(
        { x: node.x, y: node.y, z: node.z, floor: node.floor },
        { confidence: 1, quiet: true }
      );
    } else {
      const pose = this.#host.getPose();
      if (!pose) {
        this.#host.toast(t('admin.wizard.start.noPose'));
        return false;
      }
      node = draft.addNode(
        { x: pose.x, y: pose.y, z: pose.z, floor: pose.floor, name: name || undefined },
        { snap: this.#opts.snapM }
      );
      this.#placeAt(node.id, name, ward);
    }
    this.#startNode = node.id;
    this.#startName = existing?.name ?? name ?? '';
    this.#startWalk();
    this.#host.changed();
    return true;
  }

  #startWalk() {
    this.#lastNode = this.#startNode;
    this.#lastHeading = this.#host.getPose()?.heading ?? null;
    this.#route = { edges: [], nodes: 0, distance: 0, scans: 0, quality: null };
    this.#legNodes = [{ id: this.#startNode, created: false }];
    this.#legPois = [];
    this.#legAnchors = [];
    this.#lastDr = null;
    const here = this.#host.getPose();
    this.#seg = {
      start: here && here.confidence >= 1 ? { x: here.x, y: here.y, floor: here.floor } : null,
      nodes: [],
    };
    this.#uncertain = false;
    this.#startCode = null; // set by #autoAdvance right after, for a scan-started leg
    this.#host.onRecording?.(true, 0);
    this.#show('walk');
  }

  /** Set the position ourselves: it is a definition, not a measurement, so it must not pass for ground truth. */
  #setPoseSelf(point, options) {
    this.#selfFix = true;
    try {
      return this.#host.setPose(point, options);
    } finally {
      this.#selfFix = false;
    }
  }

  #sectionAttrs() {
    const attrs = {};
    const type = this.#f('section').value;
    if (type && type !== 'walk') attrs.type = type;
    if (this.#f('staff').checked) attrs.staffOnly = true;
    return attrs;
  }

  /**
   * Live position while walking: drop a point every `stepM` metres, at a
   * turn, at every exact fix, and whenever the floor changes. Uncertain
   * positions (dead reckoning gone stale) drop nothing and ask for a scan.
   */
  onPose(pose) {
    if (this.#step === 'start') this.#updateStart();
    if (this.#step !== 'walk' || !pose) return;
    const draft = this.#host.draft;
    const last = draft.nodeById(this.#lastNode);
    // An exact position straight after dead-reckoned walking is a marker being
    // read; exact positions from a continuous provider have no such walk before them.
    let markerFix = false;
    if (pose.confidence < 1) {
      this.#lastDr = { x: pose.x, y: pose.y, floor: pose.floor };
    } else if (this.#selfFix) {
      // A new sticker was just defined to be where dead reckoning says: nothing to compare with.
      this.#seg = { start: { x: pose.x, y: pose.y, floor: pose.floor }, nodes: [] };
      this.#lastDr = null;
    } else {
      markerFix = this.#lastDr !== null;
      this.#closeSegment(pose);
    }
    const uncertain = pose.confidence < this.#opts.minConfidence;
    if (uncertain !== this.#uncertain) {
      this.#uncertain = uncertain;
      this.#updateWalk();
    }
    if (uncertain || !last) return;
    const floorChanged = pose.floor !== last.floor;
    const d = floorChanged ? Infinity : metresBetween(last, pose);
    const turn =
      this.#lastHeading === null ? 0 : Math.abs(wrap180(pose.heading - this.#lastHeading));
    const exact = pose.confidence >= 1;
    if (markerFix && d >= 0.5) {
      // A marker's position is known precisely: do not snap it onto a point 1.5 m away.
      this.#drop(pose, { force: true });
    } else if (floorChanged || d >= this.#opts.stepM || (exact && d >= 0.5)) {
      this.#drop(pose);
    } else if (d >= 1 && turn >= this.#opts.turnDeg) {
      // A corner close to the last point is still a corner: do not snap it away.
      this.#drop(pose, { force: true });
    }
  }

  /**
   * The quality check. An exact position (a scan of a marker the venue
   * already knows) says where the walker really is; the stretch walked since
   * the last exact position was drawn from dead reckoning, so the gap between
   * the two is the drift of that stretch. A small gap is spread back along the
   * stretch's own points (the earlier a point, the less it moves) so the saved
   * corridor ends exactly on the marker; a big one is reported and left alone,
   * for a re-walk, rather than baked into the map.
   *
   * Nothing is judged when the stretch began at an approximate position, ran
   * across floors, or had no points.
   * @param {{ x: number, y: number, floor: number }} truth
   */
  #closeSegment(truth) {
    const route = this.#route;
    const seg = this.#seg;
    const dr = this.#lastDr;
    this.#seg = { start: { x: truth.x, y: truth.y, floor: truth.floor }, nodes: [] };
    this.#lastDr = null;
    if (!route || !seg.start || !dr || seg.nodes.length === 0) return;
    const draft = this.#host.draft;
    const points = seg.nodes.map((n) => draft.nodeById(n.id));
    if (
      points.some((n) => !n || n.floor !== truth.floor) ||
      dr.floor !== truth.floor ||
      seg.start.floor !== truth.floor
    ) {
      return;
    }
    // The stretch as dead reckoning drew it: where it began → each point
    // dropped → where dead reckoning thought it was when the marker was read.
    const path = [seg.start, ...points, dr];
    const cum = [0];
    for (let i = 1; i < path.length; i += 1) {
      cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    }
    const legM = cum.at(-1);
    const dx = truth.x - dr.x;
    const dy = truth.y - dr.y;
    const driftM = Math.hypot(dx, dy);
    const o = this.#opts;
    const verdict =
      driftM <= Math.max(o.goodM, o.goodPct * legM)
        ? 'good'
        : driftM <= Math.max(o.okM, o.okPct * legM)
          ? 'ok'
          : 'check';
    const straightDr = Math.hypot(dr.x - seg.start.x, dr.y - seg.start.y);
    const straightTrue = Math.hypot(truth.x - seg.start.x, truth.y - seg.start.y);
    const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
    // Fold this stretch into the route's overall verdict: the worst wins.
    const rank = { good: 0, ok: 1, check: 2 };
    const prev = route.quality?.verdict in rank ? route.quality : null;
    const total = {
      driftM: (prev?.driftM ?? 0) + driftM,
      legM: (prev?.legM ?? 0) + legM,
    };
    route.quality = {
      verdict: prev && rank[prev.verdict] > rank[verdict] ? prev.verdict : verdict,
      driftM: round(total.driftM),
      legM: round(total.legM),
      driftPct: total.legM > 0 ? round((100 * total.driftM) / total.legM) : 0,
      // Dead reckoning vs truth for the straight-line distance: <1 means steps were too short.
      scale: straightDr >= 8 ? round(straightTrue / straightDr, 2) : (prev?.scale ?? null),
      corrected: Boolean(prev?.corrected),
    };
    if (verdict === 'check' || legM === 0) return;

    // Spread the drift back along this stretch's own points.
    for (let i = 0; i < points.length; i += 1) {
      if (!seg.nodes[i].created) continue; // a junction shared with another route stays put
      const f = cum[i + 1] / legM;
      draft.moveNode(points[i].id, { x: points[i].x + dx * f, y: points[i].y + dy * f });
    }
    route.quality.corrected = true;
    // Edge lengths moved with the points: keep the route's own total in step.
    route.distance = route.edges.reduce((t, e) => t + (e.distance ?? 0), 0);
    this.#host.changed();
  }

  /** Take out everything a saved route created (and nothing it merely used). */
  #remove(rec) {
    const draft = this.#host.draft;
    for (const e of rec.edges) draft.removeEdge(e.from, e.to);
    for (const id of rec.pois) draft.removePoi(id);
    for (const id of [...rec.nodes].reverse()) draft.removeNode(id);
    for (const id of rec.anchors) draft.removeAnchor(id);
    this.#host.changed();
  }

  /** Whether there is a saved route to take back (before one is begun, or just after saving). */
  get canUndo() {
    return this.#saved.length > 0 && (this.#step === 'start' || this.#step === 'done');
  }

  /**
   * Take back the most recent saved route: its points, edges, the places it
   * named and any new markers it recorded, all gone; everything it only
   * passed through stays. Can be repeated to step back through the session.
   * @returns {boolean} false when there is nothing to undo, or a route is in progress.
   */
  undoLastRoute() {
    if (!this.canUndo) return false;
    this.#remove(this.#saved.pop());
    this.reset();
    this.#host.toast(t('admin.wizard.undone'));
    return true;
  }

  /**
   * Throw away the route just saved and begin it again from the same start
   * (for a route the quality check flagged).
   * @returns {boolean} false unless a route has just been saved.
   */
  rewalk() {
    if (this.#step !== 'done' || !this.#route || this.#saved.length === 0) return false;
    this.#remove(this.#saved.pop());
    const draft = this.#host.draft;
    // Back to the start, standing at it: the next scan or walk redraws the route.
    const start = draft.nodeById(this.#startNode);
    if (start) {
      this.#host.setPose(
        { x: start.x, y: start.y, z: start.z, floor: start.floor },
        { confidence: 1, quiet: true }
      );
    }
    this.#clearFields();
    this.#startWalk();
    return true;
  }

  /**
   * Start a route at the current position without scanning anything: the
   * place is named automatically. For when the position is already exact (the
   * code was just scanned) or there is no code to hand.
   * @returns {boolean} false when there is no position yet.
   */
  startHere() {
    if (this.#step !== 'start') return false;
    if (!this.#f('start-name').value.trim()) {
      this.#f('start-name').value = t('admin.wizard.autoName', {
        n: this.#host.draft.pois.length + 1,
      });
    }
    return this.beginWalk();
  }

  /**
   * End the route at the current position without scanning: named
   * automatically, saved straight away. Returns the save result.
   */
  stopHere() {
    if (this.#step !== 'walk') return null;
    this.arrive();
    if (!this.#f('finish-name').value.trim() && !this.#f('finish-existing').value) {
      this.#f('finish-name').value = t('admin.wizard.autoName', {
        n: this.#host.draft.pois.length + 1,
      });
    }
    return this.save();
  }

  /**
   * Say how the floor is about to change, so the connection recorded across
   * floors is a lift or stairs rather than the default. Call before moving the
   * position to the new floor.
   * @param {'lift' | 'stairs'} kind
   */
  noteTransfer(kind) {
    this.#transferType = kind === 'lift' ? 'lift' : 'stairs';
  }

  /** Drop a point right here (a turn the sensors did not catch). */
  markTurn() {
    const pose = this.#host.getPose();
    if (this.#step !== 'walk' || !pose) return null;
    return this.#drop(pose, { force: true });
  }

  #drop(pose, { force = false } = {}) {
    const draft = this.#host.draft;
    ensureFloor(draft, pose.floor);
    const before = draft.nodes.length;
    const from = draft.nodeById(this.#lastNode);
    const attrs = this.#sectionAttrs();
    if (from && from.floor !== pose.floor && this.#transferType) {
      attrs.type = this.#transferType; // how the floor was changed: not the default 'stairs'
      this.#transferType = null;
    }
    const node = draft.addNode(
      { x: pose.x, y: pose.y, z: pose.z, floor: pose.floor },
      { linkFrom: this.#lastNode, snap: force ? 0.5 : this.#opts.snapM, edge: attrs }
    );
    if (node.id !== this.#lastNode) {
      const entry = { id: node.id, created: draft.nodes.length > before };
      this.#legNodes.push(entry);
      this.#seg.nodes.push(entry);
      const edge = draft.edgeBetween(this.#lastNode, node.id);
      if (edge && !this.#route.edges.includes(edge)) {
        this.#route.edges.push(edge);
        this.#route.distance += edge.distance ?? 0;
      }
      this.#route.nodes += 1;
      this.#lastNode = node.id;
      this.#host.changed();
    }
    this.#lastHeading = pose.heading ?? this.#lastHeading;
    this.#updateWalk();
    this.#host.onRecording?.(true, this.#route.distance);
    return node;
  }

  /** Step 2 → 3. */
  arrive() {
    if (this.#step !== 'walk') return;
    if (this.#route && !this.#route.quality) this.#route.quality = { verdict: 'unchecked' };
    this.#show('finish');
  }

  /** Step 3 → 4: end node, destination place, accessibility, summary. */
  save() {
    if (this.#step !== 'finish') return null;
    const draft = this.#host.draft;
    const { ward, name, existing } = this.#nameFields('finish');
    let node;
    if (existing) {
      node = draft.nodeById(existing.node);
      if (node.id !== this.#lastNode && !draft.edgeBetween(this.#lastNode, node.id)) {
        const edge = draft.addEdge(this.#lastNode, node.id, this.#sectionAttrs());
        this.#route.edges.push(edge);
        this.#route.distance += edge.distance ?? 0;
      }
    } else {
      const pose = this.#host.getPose();
      if (!pose) {
        this.#host.toast(t('admin.wizard.start.noPose'));
        return null;
      }
      if (!name) {
        this.#f('finish-status').textContent = t('admin.wizard.finish.needName');
        return null;
      }
      node = this.#drop(pose, { force: true });
      if (name && !draft.nodeById(node.id).name) draft.renameNode(node.id, name);
      this.#placeAt(node.id, name, ward);
    }
    if (this.#f('no-wheelchair').checked) {
      for (const e of this.#route.edges) if (e.stepFree !== false) e.wheelchair = false;
    }
    const endName = existing?.name ?? name;
    this.#route.endNode = node.id;
    this.#route.endName = endName;
    this.#host.changed();
    this.#f('summary').textContent = t('admin.wizard.done.summary', {
      from: this.#startName || t('admin.wizard.unnamed'),
      to: endName || t('admin.wizard.unnamed'),
      distance: Math.round(this.#route.distance),
      points: this.#route.nodes,
      scans: this.#route.scans,
    });
    this.#saved.push({
      nodes: this.#legNodes.filter((n) => n.created && n.id !== this.#startNode).map((n) => n.id),
      edges: this.#route.edges.map((e) => ({ from: e.from, to: e.to })),
      pois: [...this.#legPois],
      anchors: [...this.#legAnchors],
    });
    if (this.#saved.length > 20) this.#saved.shift();
    this.#host.toast(t('admin.wizard.done.saved'));
    this.#show('done');
    return { node, distance: this.#route.distance, edges: this.#route.edges.length };
  }

  /** Step 4 → 2: the destination just reached is the next route's start. */
  nextFromHere() {
    if (this.#step !== 'done') return;
    this.#startNode = this.#route.endNode;
    this.#startName = this.#route.endName ?? '';
    this.#clearFields();
    this.#startWalk();
  }

  /** Back to step 1 with nothing carried over. */
  reset() {
    this.#startNode = null;
    this.#startName = '';
    this.#lastNode = null;
    this.#route = null;
    this.#startCode = null;
    this.#host.onRecording?.(false);
    this.#clearFields();
    this.#show('start');
  }

  /** Stop the current route; what was recorded stays in the draft (Undo removes it). */
  cancel() {
    if (this.#route) this.#host.toast(t('admin.wizard.walk.cancelled'));
    this.reset();
  }

  #clearFields() {
    for (const f of ['start-name', 'start-ward', 'finish-name', 'finish-ward'])
      this.#f(f).value = '';
    for (const f of ['start-existing', 'finish-existing']) this.#f(f).value = '';
    this.#f('no-wheelchair').checked = false;
    this.#f('finish-status').textContent = '';
  }

  destroy() {
    // Closing admin mid-walk must not leave the camera view's "Recording"
    // badge stuck on with no wizard left to ever turn it off.
    this.#host.onRecording?.(false);
    this.#el.remove();
  }
}

/** A floor the position reports but the draft does not have yet (a new venue being walked). */
function ensureFloor(draft, index) {
  if (!Number.isInteger(index) || draft.floorByIndex(index)) return;
  const name = index === 0 ? 'Ground' : index < 0 ? `Basement ${-index}` : `Level ${index}`;
  const id = index === 0 ? 'ground' : index < 0 ? `b${-index}` : `l${index}`;
  draft.addFloor({ index, id, name, elevation: index * 4 });
}

function wrap180(deg) {
  let d = ((deg + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

/** @param {WizardHost} host @param {object} [options] */
export function createRouteWizard(host, options) {
  return new RouteWizard(host, options);
}
