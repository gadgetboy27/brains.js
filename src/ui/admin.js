/**
 * Admin panel — build and "train" a venue from inside the app. `?admin=1`.
 *
 * Three tools over a `VenueDraft` (src/core/venue-draft.js):
 *
 *  - **Record a route**: with positioning running, walk the venue and tap
 *    "Add node here" at each junction, door and turn. Each node is linked to
 *    the previous one (distance computed), and walking back over an existing
 *    node joins the graph instead of duplicating it. "Add place here" and
 *    "Add QR marker here" attach a POI or an anchor (with the current
 *    heading) to where you stand.
 *  - **Plan editor**: tap the 2-D floor plan to place nodes, tap two nodes to
 *    link them, select a node to rename or remove it.
 *  - **Export**: validates against the venue schema and downloads
 *    `venue.json` (or copies it). The draft is kept in local storage until
 *    exported or discarded, so a walk survives a page reload.
 *
 * The draft is drawn on the floor plan as an overlay so what you have built
 * is visible as you go. Nothing here is served to visitors; it is a staff
 * tool, and the exported JSON goes through the same validation as any
 * venue file.
 */

import { VenueDraft } from '../core/venue-draft.js';
import { categoryName, t } from './strings/index.js';
import { cssToken, ensureStyle } from './tokens.js';

const CSS = `
.admin { position: fixed; top: calc(64px + env(safe-area-inset-top)); left: 8px; right: 8px; z-index: 23; max-height: 55vh; overflow: auto;
  padding: 10px 12px; border-radius: var(--radius); background: var(--color-surface); color: var(--color-text);
  font-family: var(--font); font-size: 15px; border: 2px solid var(--color-accent); }
.admin[hidden] { display: none; }
.admin h2 { margin: 0 0 4px; font-size: 1em; }
.admin p { margin: 4px 0; }
.admin-tabs { display: flex; gap: 6px; margin: 6px 0; }
.admin-tabs .btn { min-height: 40px; padding: 6px 12px; }
.admin-tool[hidden] { display: none; }
.admin-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0; }
.admin label { display: grid; gap: 4px; margin: 6px 0; }
.admin input, .admin select { min-height: 40px; padding: 6px 10px; border: 2px solid var(--color-accent); border-radius: 8px;
  background: var(--color-surface-solid); color: var(--color-text); font: inherit; }
.admin-status { color: var(--color-text-muted); min-height: 1.4em; }
.admin ul.problems { margin: 4px 0; padding-left: 18px; color: var(--color-error); }
.admin pre { white-space: pre-wrap; font-size: 12px; max-height: 20vh; overflow: auto; background: var(--color-surface-solid); padding: 8px; border-radius: 8px; }
.admin-form { border: 1px solid var(--color-text-muted); border-radius: 8px; padding: 8px; margin: 6px 0; }
.admin-form[hidden] { display: none; }
`;

const DRAFT_KEY = 'brains:admin-draft';
const TOKEN_KEY = 'brains:admin-token';

export class AdminPanel {
  #doc;
  #el;
  #f;
  #opts;
  #draft;
  #pose = null;
  #recording = false;
  #lastNodeId = null;
  #walkNodes = 0;
  #walkEdges = 0;
  #selected = null;
  #linking = false;
  #unsub = [];
  #tab = 'record';

  /**
   * @param {Object} options
   * @param {import('../core/venue.js').Venue} options.venue          Starting point for the draft.
   * @param {import('../core/positioning.js').PositionProvider} options.provider  Pose source (the chain).
   * @param {import('./floorplan.js').Floorplan} options.floorplan     For tap-to-place and the overlay.
   * @param {HTMLElement} [options.mount]
   * @param {Document} [options.document]
   * @param {Storage | null} [options.storage]
   * @param {(name: string, text: string) => void} [options.download]
   * @param {(text: string) => Promise<void>} [options.copy]
   * @param {(message: string, defaultValue?: string) => string | null} [options.prompt]  Injectable; default window.prompt.
   * @param {() => void} [options.onClose]
   * @param {typeof fetch} [options.fetch]            For publishing (default global fetch).
   * @param {string} [options.publishUrl]             API base; default `/api/venues/<id>` on this origin.
   * @param {Storage | null} [options.sessionStorage] Keeps the publishing key for the session.
   * @param {object | null} [options.initialPose]  Last known pose, if positioning started before this panel.
   * @param {Function} [options.getComputedStyle]
   */
  constructor(options) {
    if (!options?.venue || !options?.provider || !options?.floorplan) {
      throw new TypeError('AdminPanel requires venue, provider and floorplan');
    }
    this.#doc = options.document ?? globalThis.document;
    this.#opts = {
      storage: safeStorage(),
      download: defaultDownload,
      copy: (text) => globalThis.navigator?.clipboard?.writeText?.(text),
      prompt: (m, d) => globalThis.prompt?.(m, d),
      fetch: (...a) => globalThis.fetch?.(...a),
      sessionStorage: safeSession(),
      ...options,
    };

    // Restore a draft for this venue if one exists, else start from the venue.
    let restored = false;
    const saved = this.#loadDraft();
    if (saved && saved.id === options.venue.id) {
      this.#draft = new VenueDraft(saved);
      restored = true;
    } else {
      this.#draft = new VenueDraft(options.venue.toJSON());
    }

    ensureStyle('brains-admin-style', CSS, this.#doc);
    const el = this.#doc.createElement('section');
    el.className = 'admin';
    el.setAttribute('aria-label', t('admin.title'));
    el.innerHTML = `
      <h2 data-f="title"></h2>
      <p data-f="hint"></p>
      <div class="admin-tabs" role="tablist">
        <button type="button" class="btn" role="tab" data-tab="record"></button>
        <button type="button" class="btn" role="tab" data-tab="plan"></button>
        <button type="button" class="btn" role="tab" data-tab="export"></button>
        <button type="button" class="btn" data-f="undo"></button>
        <button type="button" class="btn" data-f="close"></button>
      </div>
      <p class="admin-status" data-f="status" role="status" aria-live="polite"></p>

      <div class="admin-tool" data-tool="record" role="tabpanel">
        <div class="admin-actions">
          <button type="button" class="btn btn-primary" data-f="rec-toggle"></button>
          <button type="button" class="btn" data-f="rec-node"></button>
          <button type="button" class="btn" data-f="rec-poi"></button>
          <button type="button" class="btn" data-f="rec-anchor"></button>
        </div>
        <p data-f="rec-status"></p>
      </div>

      <div class="admin-tool" data-tool="plan" role="tabpanel" hidden>
        <p data-f="plan-hint"></p>
        <label><span data-f="floor-label"></span><select data-f="floor"></select></label>
        <div class="admin-actions" data-f="plan-actions" hidden>
          <button type="button" class="btn" data-f="plan-link"></button>
          <button type="button" class="btn" data-f="plan-rename"></button>
          <button type="button" class="btn" data-f="plan-poi"></button>
          <button type="button" class="btn" data-f="plan-remove"></button>
        </div>
      </div>

      <div class="admin-tool" data-tool="export" role="tabpanel" hidden>
        <p data-f="summary"></p>
        <p data-f="valid"></p>
        <ul class="problems" data-f="problems"></ul>
        <div class="admin-actions">
          <button type="button" class="btn btn-primary" data-f="publish"></button>
          <button type="button" class="btn" data-f="download"></button>
          <button type="button" class="btn" data-f="copy"></button>
          <button type="button" class="btn" data-f="discard"></button>
        </div>
      </div>

      <form class="admin-form" data-f="poi-form" hidden>
        <label><span data-f="poi-name-label"></span><input data-f="poi-name" required /></label>
        <label><span data-f="poi-cat-label"></span><select data-f="poi-cat"></select></label>
        <label><span data-f="poi-alias-label"></span><input data-f="poi-alias" /></label>
        <div class="admin-actions">
          <button type="submit" class="btn btn-primary" data-f="poi-ok"></button>
          <button type="button" class="btn" data-f="poi-cancel"></button>
        </div>
      </form>
    `;
    this.#el = el;
    this.#f = (n) => el.querySelector(`[data-f="${n}"]`);
    (options.mount ?? this.#doc.body).appendChild(el);

    this.#f('title').textContent = t('admin.title');
    this.#f('hint').textContent = t('admin.hint');
    for (const tab of el.querySelectorAll('[data-tab]')) {
      tab.textContent = t(`admin.tab.${tab.dataset.tab}`);
      tab.addEventListener('click', () => this.showTab(tab.dataset.tab));
    }
    this.#f('undo').textContent = t('admin.undo');
    this.#f('close').textContent = t('admin.close');
    this.#f('rec-node').textContent = t('admin.record.addNode');
    this.#f('rec-poi').textContent = t('admin.record.addPoi');
    this.#f('rec-anchor').textContent = t('admin.record.addAnchor');
    this.#f('plan-hint').textContent = t('admin.plan.hint');
    this.#f('floor-label').textContent = t('admin.plan.floor');
    this.#f('plan-link').textContent = t('admin.plan.link');
    this.#f('plan-rename').textContent = t('admin.plan.rename');
    this.#f('plan-poi').textContent = t('admin.record.addPoi');
    this.#f('plan-remove').textContent = t('admin.plan.remove');
    this.#f('publish').textContent = t('admin.export.publish');
    this.#f('download').textContent = t('admin.export.download');
    this.#f('copy').textContent = t('admin.export.copy');
    this.#f('discard').textContent = t('admin.export.discard');
    this.#f('poi-name-label').textContent = t('admin.poi.name');
    this.#f('poi-cat-label').textContent = t('admin.poi.category');
    this.#f('poi-alias-label').textContent = t('admin.poi.aliases');
    this.#f('poi-ok').textContent = t('admin.ok');
    this.#f('poi-cancel').textContent = t('admin.cancel');
    for (const c of ['clinic', 'facility', 'service', 'retail', 'food', 'exit', 'staff', 'other']) {
      const o = this.#doc.createElement('option');
      o.value = c === 'other' ? '' : c;
      o.textContent = categoryName(c);
      this.#f('poi-cat').appendChild(o);
    }

    this.#f('undo').addEventListener('click', () => this.undo());
    this.#f('close').addEventListener('click', () => this.#opts.onClose?.());
    this.#f('rec-toggle').addEventListener('click', () =>
      this.#recording ? this.stopRecording() : this.startRecording()
    );
    this.#f('rec-node').addEventListener('click', () => this.addNodeHere());
    this.#f('rec-poi').addEventListener('click', () => this.addPoiHere());
    this.#f('rec-anchor').addEventListener('click', () => this.addAnchorHere());
    this.#f('plan-link').addEventListener('click', () => {
      this.#linking = true;
      this.#status(t('admin.plan.link'));
    });
    this.#f('plan-rename').addEventListener('click', () => this.renameSelected());
    this.#f('plan-poi').addEventListener('click', () => this.#openPoiForm(this.#selected));
    this.#f('plan-remove').addEventListener('click', () => this.removeSelected());
    this.#f('publish').addEventListener('click', () => this.publish());
    this.#f('download').addEventListener('click', () => this.download());
    this.#f('copy').addEventListener('click', () => this.copy());
    this.#f('discard').addEventListener('click', () => this.discard());
    this.#f('poi-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.#submitPoiForm();
    });
    this.#f('poi-cancel').addEventListener('click', () => (this.#f('poi-form').hidden = true));

    const floorSel = this.#f('floor');
    for (const fl of this.#draft.floors) {
      const o = this.#doc.createElement('option');
      o.value = String(fl.index);
      o.textContent = fl.name;
      floorSel.appendChild(o);
    }
    floorSel.addEventListener('change', () => options.floorplan.showFloor(Number(floorSel.value)));

    // Poses drive "add here"; the floor plan gives taps and a draw hook.
    if (options.initialPose) this.#pose = options.initialPose;
    this.#unsub.push(options.provider.onPose((p) => this.#onPose(p)));
    this.#unsub.push(options.floorplan.onDraw((ctx, fp) => this.#drawOverlay(ctx, fp)));
    const onTap = (e) => this.#onPlanTap(e);
    options.floorplan.canvas.addEventListener('click', onTap);
    this.#unsub.push(() => options.floorplan.canvas.removeEventListener('click', onTap));

    this.#updateRecording();
    this.#updateExport();
    if (restored) this.#status(t('admin.draft.restored'));
    options.floorplan.render();
  }

  get el() {
    return this.#el;
  }

  get draft() {
    return this.#draft;
  }

  get recording() {
    return this.#recording;
  }

  get selected() {
    return this.#selected;
  }

  get tab() {
    return this.#tab;
  }

  showTab(name) {
    this.#tab = name;
    for (const tool of this.#el.querySelectorAll('[data-tool]'))
      tool.hidden = tool.dataset.tool !== name;
    for (const tab of this.#el.querySelectorAll('[data-tab]'))
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    if (name === 'export') this.#updateExport();
  }

  #status(text) {
    this.#f('status').textContent = text;
  }

  #changed() {
    this.#saveDraft();
    this.#updateExport();
    this.#opts.floorplan.render();
  }

  // -------------------------------------------------------------- recording

  #onPose(pose) {
    this.#pose = pose;
    this.#updateRecording();
  }

  startRecording() {
    this.#recording = true;
    this.#lastNodeId = null;
    this.#walkNodes = 0;
    this.#walkEdges = 0;
    // Start the walk from the nearest existing node if we are on one.
    if (this.#pose) {
      const near = this.#draft.snapToNode(this.#pose, 1.5);
      if (near) this.#lastNodeId = near.id;
    }
    this.#updateRecording();
  }

  stopRecording() {
    this.#recording = false;
    this.#lastNodeId = null;
    this.#updateRecording();
  }

  #updateRecording() {
    this.#f('rec-toggle').textContent = t(
      this.#recording ? 'admin.record.stop' : 'admin.record.start'
    );
    this.#f('rec-toggle').setAttribute('aria-pressed', String(this.#recording));
    const havePose = this.#pose !== null;
    for (const n of ['rec-node', 'rec-poi', 'rec-anchor']) this.#f(n).disabled = !havePose;
    this.#f('rec-status').textContent = !havePose
      ? t('admin.record.noPose')
      : this.#recording
        ? t('admin.record.status', { nodes: this.#walkNodes, edges: this.#walkEdges })
        : '';
  }

  /** Drop a node at the current position, linked to the previous one on this walk. */
  addNodeHere(name) {
    if (!this.#pose) return null;
    const before = { nodes: this.#draft.nodes.length, edges: this.#draft.edges.length };
    const node = this.#draft.addNode(
      { x: this.#pose.x, y: this.#pose.y, z: this.#pose.z, floor: this.#pose.floor, name },
      { linkFrom: this.#recording ? this.#lastNodeId : null, snap: 1.5 }
    );
    const created = this.#draft.nodes.length > before.nodes;
    this.#walkNodes += created ? 1 : 0;
    this.#walkEdges += this.#draft.edges.length - before.edges;
    this.#lastNodeId = node.id;
    this.#status(
      t(created ? 'admin.record.added' : 'admin.record.snapped', { name: node.name ?? node.id })
    );
    this.#updateRecording();
    this.#changed();
    return node;
  }

  /** A POI at the current position: creates/snaps a node, then asks for the name. */
  addPoiHere() {
    const node = this.addNodeHere();
    if (node) this.#openPoiForm(node.id);
    return node;
  }

  /** A QR anchor at the current position, facing the current heading. */
  addAnchorHere() {
    if (!this.#pose) return null;
    const name = this.#opts.prompt(t('admin.name.prompt'), '') ?? null;
    if (name === null) return null;
    const anchor = this.#draft.addAnchor({
      x: this.#pose.x,
      y: this.#pose.y,
      z: this.#pose.z,
      floor: this.#pose.floor,
      heading: this.#pose.heading,
      name: name || undefined,
    });
    this.#status(t('admin.record.added', { name: anchor.name ?? anchor.id }));
    this.#changed();
    return anchor;
  }

  // ----------------------------------------------------------- plan editor

  #onPlanTap(e) {
    if (this.#tab !== 'plan') return;
    const rect = this.#opts.floorplan.canvas.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const point = this.#opts.floorplan.fromScreen(e.clientX - rect.left, e.clientY - rect.top);
    this.tapPlan(point);
  }

  /** Handle a tap at venue coordinates on the plan (public for tests). */
  tapPlan(point) {
    const hit = this.#draft.snapToNode(point, 1.2);
    if (hit) {
      if (this.#linking && this.#selected && hit.id !== this.#selected) {
        try {
          this.#draft.addEdge(this.#selected, hit.id);
          this.#status(t('admin.record.added', { name: `${this.#selected} → ${hit.id}` }));
        } catch (err) {
          this.#status(err.message);
        }
        this.#linking = false;
        this.#changed();
        return hit;
      }
      this.#select(hit.id);
      return hit;
    }
    const node = this.#draft.addNode(point);
    this.#status(t('admin.record.added', { name: node.id }));
    this.#select(node.id);
    this.#changed();
    return node;
  }

  #select(id) {
    this.#selected = id;
    this.#linking = false;
    this.#f('plan-actions').hidden = !id;
    if (id) {
      const n = this.#draft.nodeById(id);
      this.#status(t('admin.plan.selected', { name: n?.name ?? id }));
    }
    this.#opts.floorplan.render();
  }

  renameSelected() {
    if (!this.#selected) return;
    const n = this.#draft.nodeById(this.#selected);
    const name = this.#opts.prompt(t('admin.name.prompt'), n?.name ?? '');
    if (name === null) return;
    this.#draft.renameNode(this.#selected, name);
    this.#changed();
  }

  removeSelected() {
    if (!this.#selected) return;
    this.#draft.removeNode(this.#selected);
    this.#select(null);
    this.#changed();
  }

  #openPoiForm(nodeId) {
    if (!nodeId) return;
    const form = this.#f('poi-form');
    form.dataset.node = nodeId;
    this.#f('poi-name').value = this.#draft.nodeById(nodeId)?.name ?? '';
    this.#f('poi-alias').value = '';
    form.hidden = false;
    this.#f('poi-name').focus?.();
  }

  #submitPoiForm() {
    const form = this.#f('poi-form');
    const name = this.#f('poi-name').value.trim();
    if (!name) return;
    const aliases = this.#f('poi-alias')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const category = this.#f('poi-cat').value || undefined;
    const poi = this.#draft.addPoi({ name, node: form.dataset.node, aliases, category });
    form.hidden = true;
    this.#status(t('admin.record.added', { name: poi.name }));
    this.#changed();
    return poi;
  }

  /** Submit the POI form programmatically (tests). */
  submitPoi({ name, aliases = [], category }) {
    this.#f('poi-name').value = name;
    this.#f('poi-alias').value = aliases.join(', ');
    this.#f('poi-cat').value = category ?? '';
    return this.#submitPoiForm();
  }

  undo() {
    const entry = this.#draft.undo();
    if (entry) {
      this.#status(`${t('admin.undo')}: ${entry.type}`);
      if (this.#selected && !this.#draft.nodeById(this.#selected)) this.#select(null);
      this.#changed();
    }
    return entry;
  }

  // ---------------------------------------------------------------- overlay

  #drawOverlay(ctx, fp) {
    const floor = fp.floor ?? this.#draft.floors[0].index;
    const accent = cssToken('--color-accent', {
      fallback: 'cyan',
      getComputedStyle: this.#opts.getComputedStyle,
    });
    const warn = cssToken('--color-warn', {
      fallback: 'orange',
      getComputedStyle: this.#opts.getComputedStyle,
    });
    ctx.save();
    // Draft edges not in the base venue are drawn as dashed accent lines.
    ctx.setLineDash?.([4, 4]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    for (const e of this.#draft.edges) {
      const a = this.#draft.nodeById(e.from);
      const b = this.#draft.nodeById(e.to);
      if (!a || !b || (a.floor !== floor && b.floor !== floor)) continue;
      const pa = fp.toScreen(a.x, a.y);
      const pb = fp.toScreen(b.x, b.y);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.setLineDash?.([]);
    for (const n of this.#draft.nodes) {
      if (n.floor !== floor) continue;
      const p = fp.toScreen(n.x, n.y);
      ctx.fillStyle = n.id === this.#selected ? warn : accent;
      ctx.beginPath();
      ctx.arc(p.x, p.y, n.id === this.#selected ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const a of this.#draft.anchors) {
      if (a.floor !== floor) continue;
      const p = fp.toScreen(a.x, a.y);
      ctx.strokeStyle = warn;
      ctx.strokeRect(p.x - 6, p.y - 6, 12, 12);
    }
    ctx.restore();
  }

  // ----------------------------------------------------------------- export

  #updateExport() {
    const s = this.#draft.summary;
    this.#f('summary').textContent = t('admin.export.summary', s);
    const problems = this.#draft.validate();
    const list = this.#f('problems');
    list.textContent = '';
    if (problems.length === 0) {
      this.#f('valid').textContent = t('admin.export.valid');
    } else {
      this.#f('valid').textContent = t('admin.export.invalid', { count: problems.length });
      for (const p of problems) {
        const li = this.#doc.createElement('li');
        li.textContent = `${p.path}: ${p.message}`;
        list.appendChild(li);
      }
    }
    this.#f('download').disabled = problems.length > 0;
    this.#f('publish').disabled = problems.length > 0;
  }

  /**
   * Publish the draft to the server so every visitor gets it. Asks for the
   * admin key once per session. Returns the server's answer or null.
   */
  async publish() {
    if (this.#draft.validate().length) return null;
    let token;
    try {
      token = this.#opts.sessionStorage?.getItem(TOKEN_KEY) ?? null;
    } catch {
      token = null;
    }
    if (!token) {
      token = this.#opts.prompt(t('admin.export.tokenPrompt'), '');
      if (!token) return null;
    }
    const url = this.#opts.publishUrl ?? `/api/venues/${encodeURIComponent(this.#draft.id)}`;
    this.#status(t('admin.export.publishing'));
    let res;
    try {
      res = await this.#opts.fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: this.json(),
      });
    } catch (err) {
      this.#status(t('admin.export.publishFailed', { message: err.message }));
      return null;
    }
    if (res.status === 401) {
      try {
        this.#opts.sessionStorage?.removeItem(TOKEN_KEY);
      } catch {
        // ignore
      }
      this.#status(t('admin.export.unauthorised'));
      return null;
    }
    if (res.status === 503) {
      this.#status(t('admin.export.unconfigured'));
      return null;
    }
    if (res.status === 404 || (res.headers?.get?.('content-type') ?? '').includes('text/html')) {
      // No API here (e.g. the Vite dev server serving the SPA for every path).
      this.#status(t('admin.export.devServer'));
      return null;
    }
    let body;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const detail =
        body?.problems?.map((p) => `${p.path}: ${p.message}`).join('; ') ??
        body?.error ??
        `HTTP ${res.status}`;
      this.#status(t('admin.export.publishFailed', { message: detail }));
      return null;
    }
    try {
      this.#opts.sessionStorage?.setItem(TOKEN_KEY, token);
      this.#opts.storage?.removeItem(DRAFT_KEY); // published: the draft is no longer "unsaved"
    } catch {
      // ignore
    }
    this.#status(t('admin.export.published'));
    return body;
  }

  json() {
    return JSON.stringify(this.#draft.toJSON(), null, 2);
  }

  download() {
    if (this.#draft.validate().length) return null;
    const name = `${this.#draft.id}.venue.json`;
    this.#opts.download(name, `${this.json()}\n`);
    return name;
  }

  async copy() {
    await this.#opts.copy(this.json());
    this.#status(t('admin.export.copied'));
  }

  discard() {
    this.#draft = new VenueDraft(this.#opts.venue.toJSON());
    try {
      this.#opts.storage?.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    this.#select(null);
    this.#updateExport();
    this.#opts.floorplan.render();
  }

  #saveDraft() {
    try {
      this.#opts.storage?.setItem(DRAFT_KEY, JSON.stringify(this.#draft.toJSON()));
    } catch {
      // storage may be full or unavailable
    }
  }

  #loadDraft() {
    try {
      const raw = this.#opts.storage?.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  destroy() {
    for (const off of this.#unsub) off();
    this.#el.remove();
  }
}

function defaultDownload(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function safeSession() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** @param {ConstructorParameters<typeof AdminPanel>[0]} options */
export function createAdminPanel(options) {
  return new AdminPanel(options);
}
