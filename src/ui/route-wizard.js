/**
 * Route wizard — the guided, start-to-finish way to build a venue's routes
 * from inside the building, one route at a time:
 *
 *   1. Start   — stand at the start, scan the code there (or pick an
 *                existing place, or tap the plan), name it.
 *   2. Walk    — walk to the destination. Points are dropped automatically
 *                every few metres and at turns from the live position;
 *                say what the next section is (stairs, lift, door…), scan
 *                any code you pass to correct the position.
 *   3. Finish  — name the destination (or scan its code), note if the
 *                route is not wheelchair-friendly, save.
 *   4. Done    — summary; "Next route from here" chains straight into the
 *                next walk, so a whole wing is surveyed in one pass.
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
 */

const SECTION_TYPES = ['walk', 'door', 'stairs', 'lift', 'ramp', 'escalator'];
const STEPS = ['start', 'walk', 'finish', 'done'];

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

  /**
   * @param {WizardHost} host
   * @param {{ stepM?: number, turnDeg?: number, minConfidence?: number, snapM?: number }} [options]
   */
  constructor(host, options = {}) {
    if (!host?.draft || !host?.mount) throw new TypeError('RouteWizard needs a draft and a mount');
    this.#host = host;
    this.#doc = host.document ?? globalThis.document;
    this.#opts = { stepM: 3, turnDeg: 35, minConfidence: 0.3, snapM: 1.5, ...options };
    this.#render();
    this.#show('start');
  }

  get el() {
    return this.#el;
  }

  get step() {
    return this.#step;
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
      <ol class="wizard-steps" data-f="steps">
        ${STEPS.map((s, i) => `<li data-step-chip="${s}"><span>${i + 1}</span> <b data-f="chip-${s}"></b></li>`).join('')}
      </ol>
      <section data-step="start">
        <p data-f="start-hint"></p>
        <label><span data-f="start-existing-label"></span><select data-f="start-existing"><option value=""></option></select></label>
        <label><span data-f="start-name-label"></span><input data-f="start-name" list="admin-places" autocomplete="off" /></label>
        <label><span data-f="start-ward-label"></span><input type="number" min="1" max="99" inputmode="numeric" data-f="start-ward" /></label>
        <div class="admin-actions">
          <button type="button" class="btn btn-primary" data-f="start-scan"></button>
          <button type="button" class="btn" data-f="start-next"></button>
        </div>
        <p class="admin-status" data-f="start-status"></p>
      </section>
      <section data-step="walk" hidden>
        <p class="wizard-live" data-f="walk-status" role="status" aria-live="polite"></p>
        <p class="admin-status" data-f="walk-hint"></p>
        <label><span data-f="section-label"></span><select data-f="section"></select></label>
        <label class="wizard-check"><input type="checkbox" data-f="staff" /> <span data-f="staff-label"></span></label>
        <div class="admin-actions">
          <button type="button" class="btn" data-f="walk-turn"></button>
          <button type="button" class="btn" data-f="walk-scan"></button>
          <button type="button" class="btn btn-primary" data-f="walk-arrive"></button>
          <button type="button" class="btn" data-f="walk-cancel"></button>
        </div>
      </section>
      <section data-step="finish" hidden>
        <p data-f="finish-hint"></p>
        <label><span data-f="finish-existing-label"></span><select data-f="finish-existing"><option value=""></option></select></label>
        <label><span data-f="finish-name-label"></span><input data-f="finish-name" list="admin-places" autocomplete="off" /></label>
        <label><span data-f="finish-ward-label"></span><input type="number" min="1" max="99" inputmode="numeric" data-f="finish-ward" /></label>
        <label class="wizard-check"><input type="checkbox" data-f="no-wheelchair" /> <span data-f="no-wheelchair-label"></span></label>
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
    for (const s of STEPS) this.#f(`chip-${s}`).textContent = t(`admin.wizard.step.${s}`);
    const text = {
      'start-hint': 'admin.wizard.start.hint',
      'start-existing-label': 'admin.wizard.existing',
      'start-name-label': 'admin.wizard.start.name',
      'start-ward-label': 'admin.ward.number',
      'start-scan': 'admin.wizard.scanHere',
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
    for (const chip of this.#el.querySelectorAll('[data-step-chip]')) {
      const i = STEPS.indexOf(chip.dataset.stepChip);
      const cur = STEPS.indexOf(step);
      chip.setAttribute('aria-current', String(i === cur));
      chip.classList.toggle('done', i < cur);
    }
    if (step === 'start' || step === 'finish') this.#fillExisting(step);
    if (step === 'start') this.#updateStart();
    if (step === 'walk') this.#updateWalk();
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
    return draft.addPoi({
      name,
      node: nodeId,
      aliases: [...new Set([...(ward?.aliases ?? []), ...(template?.aliases ?? [])])],
      category: ward ? 'ward' : template?.category,
      access: template?.access,
    });
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
    // The code now lives here: the position is exact from this point.
    this.#host.setPose(
      { x: anchor.x, y: anchor.y, z: anchor.z, floor: anchor.floor, heading: anchor.heading },
      { confidence: 1, quiet: true }
    );
    if (this.#route) this.#route.scans += 1;
    this.#host.toast(t('admin.wizard.codeRecorded', { code: text }));
    this.#host.changed();
    if (this.#step === 'walk') this.onPose(this.#host.getPose());
    else this.#updateStart();
    return anchor;
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
    this.#route = { edges: [], nodes: 0, distance: 0, scans: 0 };
    this.#uncertain = false;
    this.#show('walk');
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
    if (floorChanged || d >= this.#opts.stepM || (exact && d >= 0.5)) {
      this.#drop(pose);
    } else if (d >= 1 && turn >= this.#opts.turnDeg) {
      // A corner close to the last point is still a corner: do not snap it away.
      this.#drop(pose, { force: true });
    }
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
    const node = draft.addNode(
      { x: pose.x, y: pose.y, z: pose.z, floor: pose.floor },
      { linkFrom: this.#lastNode, snap: force ? 0.5 : this.#opts.snapM, edge: this.#sectionAttrs() }
    );
    if (node.id !== this.#lastNode) {
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
    return node;
  }

  /** Step 2 → 3. */
  arrive() {
    if (this.#step !== 'walk') return;
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
