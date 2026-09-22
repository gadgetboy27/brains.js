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

import QRCode from 'qrcode';

import { VenueDraft } from '../core/venue-draft.js';
import { HOSPITAL_PLACES, findPlace } from '../venues/places-library.js';
import { DEMO_HOSPITAL_PLAN, findPlanRow, parseSurveyPlan } from '../venues/survey-plan.js';
import { categoryName, t } from './strings/index.js';
import { PoseFusion } from '../core/fusion.js';
import { createRouteWizard } from './route-wizard.js';
import { cssToken, ensureStyle } from './tokens.js';

const CSS = `
.admin { position: fixed; top: calc(64px + env(safe-area-inset-top)); left: 8px; right: 8px; z-index: 23; max-height: 55vh; overflow: auto;
  padding: 10px 12px; border-radius: var(--radius); background: var(--color-surface); color: var(--color-text);
  font-family: var(--font); font-size: 15px; border: 2px solid var(--color-accent); }
.admin[hidden] { display: none; }
.admin h2 { margin: 0 0 4px; font-size: 1em; }
.admin p { margin: 4px 0; }
.admin-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
.admin-tabs .btn { min-height: 40px; padding: 6px 12px; }
.admin.admin-collapsed > :not(.admin-tabs):not([data-f="status"]):not([data-f="saved"]) { display: none; }
.admin.admin-collapsed { max-height: none; }
@media (max-width: 600px) {
  .admin { top: calc(56px + env(safe-area-inset-top)); left: 4px; right: 4px; max-height: 42vh; padding: 8px 10px; font-size: 14px; }
  .admin h2, .admin > p[data-f="hint"] { display: none; }
  .admin-tabs .btn { min-height: 36px; padding: 4px 10px; font-size: 14px; }
}
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
.admin-list { list-style: none; margin: 6px 0; padding: 0; display: grid; gap: 6px; max-height: 24vh; overflow: auto; }
.admin-list button { width: 100%; text-align: left; display: grid; grid-template-columns: 1fr auto; gap: 8px; min-height: 44px; padding: 8px 12px;
  border: 1px solid var(--color-text-muted); border-radius: 8px; background: var(--color-surface-solid); color: var(--color-text); font: inherit; cursor: pointer; }
.admin-list button[aria-selected='true'] { border-color: var(--color-accent); }
.admin-list .kind { color: var(--color-text-muted); font-size: 0.9em; }
.admin-toast { margin: 6px 0; padding: 8px 12px; border-radius: 8px; background: var(--color-accent); color: var(--color-accent-contrast); font-weight: 600; }
.admin-toast:empty { display: none; }
.admin-walk { margin: 6px 0; padding-left: 18px; }
.admin-plan { margin: 6px 0; }
.wizard-live { font-weight: 600; margin: 4px 0; font-size: 1.05em; }
.wizard-summary { font-weight: 600; }
.wizard-check { display: flex !important; align-items: center; gap: 8px; }
.wizard-check input { width: 22px; height: 22px; min-height: 0; }
.btn-big { min-height: 56px; font-size: 1.1em; flex: 1 1 100%; }
.admin-plan summary { cursor: pointer; font-weight: 600; }
.admin-plan textarea { width: 100%; min-height: 6em; font: inherit; font-size: 13px; box-sizing: border-box; }
.admin-raw-json { font-family: ui-monospace, Menlo, Consolas, monospace; min-height: 10em; }
.admin-markers { list-style: none; margin: 6px 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.admin-markers li { display: grid; gap: 4px; text-align: center; font-size: 13px; }
.admin-markers img { width: 100%; max-width: 140px; margin: 0 auto; background: #fff; border-radius: 6px; }
`;

const DRAFT_KEY = 'brains:admin-draft';
const PLAN_KEY = 'brains:survey-plan';
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
  #tab = 'routes';
  #wizard = null;
  /** @type {((text: string) => unknown) | null} */
  #codeHandler = null;
  #published = true;
  #registering = false;
  #surveying = false;
  #surveyCount = 0;
  #surveyLastNode = null;
  /** @type {import('../venues/survey-plan.js').SurveyPlanRow[]} */
  #plan = [];
  #walk = [];
  #markerUrls = new Map();
  #markerRender = 0;
  #toastTimer = null;
  /** @type {{ kind: 'poi' | 'anchor', id: string } | null} */
  #editing = null;
  /** @type {{ fusion: import('../core/fusion.js').PoseFusion, detach: () => void } | null} */
  #strideCal = null;

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
   * @param {ReadonlyArray<object>} [options.places]  Place templates for the POI form (default: hospital library).
   * @param {() => void} [options.onScanRequest]   Show the camera so a marker can be scanned to fix position.
   * @param {(pose: object) => void} [options.onManualPose]  A position set by tapping the plan.
   * @param {string} [options.publicBaseUrl]         Origin printed into marker codes (default this page's origin).
   * @param {(text: string) => Promise<string>} [options.qrDataUrl]  Injectable QR renderer (tests).
   * @param {(text: string) => Promise<string>} [options.qrSvg]
   * @param {(html: string) => void} [options.openSheet]
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
      window: globalThis.window,
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
        <button type="button" class="btn" role="tab" data-tab="routes"></button>
        <button type="button" class="btn" role="tab" data-tab="survey"></button>
        <button type="button" class="btn" role="tab" data-tab="record"></button>
        <button type="button" class="btn" role="tab" data-tab="plan"></button>
        <button type="button" class="btn" role="tab" data-tab="edit"></button>
        <button type="button" class="btn" role="tab" data-tab="export"></button>
        <button type="button" class="btn" data-f="save"></button>
        <button type="button" class="btn" data-f="undo"></button>
        <button type="button" class="btn" data-f="collapse" aria-expanded="true"></button>
        <button type="button" class="btn" data-f="close"></button>
      </div>
      <p class="admin-status" data-f="status" role="status" aria-live="polite"></p>
      <p class="admin-status" data-f="saved"></p>

      <details class="admin-plan" data-f="stride-box">
        <summary data-f="stride-summary"></summary>
        <p data-f="stride-hint"></p>
        <label>
          <span data-f="stride-distance-label"></span>
          <input type="number" min="1" step="0.1" value="20" data-f="stride-distance" />
        </label>
        <div class="admin-actions">
          <button type="button" class="btn btn-primary" data-f="stride-toggle"></button>
        </div>
        <p data-f="stride-status" role="status"></p>
      </details>

      <div class="admin-tool" data-tool="routes" role="tabpanel" hidden>
        <div data-f="wizard-mount"></div>
      </div>

      <div class="admin-tool" data-tool="survey" role="tabpanel" hidden>
        <p data-f="survey-hint"></p>
        <details class="admin-plan" data-f="survey-plan-box">
          <summary data-f="survey-plan-summary"></summary>
          <p data-f="survey-plan-hint"></p>
          <textarea data-f="survey-plan" rows="6" spellcheck="false" placeholder="A03, G, Reception desk"></textarea>
          <div class="admin-actions">
            <button type="button" class="btn btn-primary" data-f="survey-plan-use"></button>
            <button type="button" class="btn" data-f="survey-plan-demo"></button>
          </div>
        </details>
        <p data-f="survey-plan-status" role="status"></p>
        <label><span data-f="survey-name-label"></span><input data-f="survey-name" list="admin-places" autocomplete="off" /></label>
        <label data-f="survey-ward-row"><span data-f="survey-ward-label"></span><input type="number" min="1" max="99" inputmode="numeric" data-f="survey-ward" /></label>
        <div class="admin-actions">
          <button type="button" class="btn btn-primary" data-f="survey-scan"></button>
        </div>
        <p data-f="survey-count"></p>
        <p class="admin-toast" data-f="survey-toast" role="status" aria-live="assertive"></p>
        <ul class="admin-walk" data-f="survey-list"></ul>
      </div>

      <div class="admin-tool" data-tool="record" role="tabpanel" hidden>
        <div class="admin-actions">
          <button type="button" class="btn btn-primary" data-f="rec-toggle"></button>
          <button type="button" class="btn" data-f="rec-node"></button>
          <button type="button" class="btn" data-f="rec-poi"></button>
          <button type="button" class="btn" data-f="rec-anchor"></button>
          <button type="button" class="btn" data-f="rec-scan"></button>
          <button type="button" class="btn" data-f="rec-register"></button>
        </div>
        <p data-f="rec-status"></p>
        <p class="admin-toast" data-f="toast" role="status" aria-live="assertive"></p>
        <p class="visually-hidden" data-f="walk-title"></p>
        <ul class="admin-walk" data-f="walk"></ul>
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

      <div class="admin-tool" data-tool="edit" role="tabpanel" hidden>
        <label><span data-f="edit-search-label"></span><input type="search" data-f="edit-search" autocomplete="off" /></label>
        <ul class="admin-list" data-f="edit-list" role="listbox"></ul>
        <form class="admin-form" data-f="edit-form" hidden>
          <p data-f="edit-kind"></p>
          <label><span data-f="edit-name-label"></span><input data-f="edit-name" required /></label>
          <label data-f="edit-alias-row"><span data-f="edit-alias-label"></span><input data-f="edit-alias" /></label>
          <label data-f="edit-cat-row"><span data-f="edit-cat-label"></span><select data-f="edit-cat"></select></label>
          <label data-f="edit-ward-row" hidden><span data-f="edit-ward-label"></span><input type="number" min="1" max="99" inputmode="numeric" data-f="edit-ward" /></label>
          <label data-f="edit-access-row"><span data-f="edit-access-label"></span>
            <select data-f="edit-access"><option value="public"></option><option value="staff"></option></select></label>
          <label data-f="edit-heading-row"><span data-f="edit-heading-label"></span><input type="number" min="0" max="359" data-f="edit-heading" /></label>
          <p class="admin-status" data-f="edit-note"></p>
          <div class="admin-actions">
            <button type="submit" class="btn btn-primary" data-f="edit-ok"></button>
            <button type="button" class="btn" data-f="edit-move"></button>
            <button type="button" class="btn" data-f="edit-remove"></button>
            <button type="button" class="btn" data-f="edit-cancel"></button>
          </div>
        </form>
      </div>

      <div class="admin-tool" data-tool="export" role="tabpanel" hidden>
        <p data-f="summary"></p>
        <p data-f="valid"></p>
        <ul class="problems" data-f="problems"></ul>
        <h3 data-f="markers-title"></h3>
        <p data-f="markers-empty" hidden></p>
        <ul class="admin-markers" data-f="markers"></ul>
        <div class="admin-actions">
          <button type="button" class="btn" data-f="print-sheet"></button>
        </div>
        <div class="admin-actions">
          <button type="button" class="btn btn-primary" data-f="publish"></button>
          <button type="button" class="btn" data-f="download"></button>
          <button type="button" class="btn" data-f="copy"></button>
          <button type="button" class="btn" data-f="discard"></button>
        </div>
        <details class="admin-plan" data-f="raw-json-box">
          <summary data-f="raw-json-summary"></summary>
          <p data-f="raw-json-hint"></p>
          <textarea data-f="raw-json" class="admin-raw-json" readonly rows="8" spellcheck="false"></textarea>
        </details>
      </div>

      <form class="admin-form" data-f="poi-form" hidden>
        <label><span data-f="poi-name-label"></span><input data-f="poi-name" list="admin-places" autocomplete="off" required /></label>
        <datalist id="admin-places" data-f="places"></datalist>
        <label><span data-f="poi-cat-label"></span><select data-f="poi-cat"></select></label>
        <label data-f="poi-ward-row" hidden><span data-f="poi-ward-label"></span><input type="number" min="1" max="99" inputmode="numeric" data-f="poi-ward" /></label>
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
    this.#f('raw-json-summary').textContent = t('admin.export.rawJson');
    this.#f('raw-json-hint').textContent = t('admin.export.rawJsonHint');
    this.#f('raw-json').addEventListener('focus', () => this.#f('raw-json').select());
    this.#f('save').textContent = t('admin.save');
    this.#f('edit-search-label').textContent = t('admin.edit.search');
    this.#f('edit-search').placeholder = t('admin.edit.placeholder');
    this.#f('edit-name-label').textContent = t('admin.name.prompt');
    this.#f('edit-alias-label').textContent = t('admin.poi.aliases');
    this.#f('edit-cat-label').textContent = t('admin.poi.category');
    this.#f('edit-access-label').textContent = t('admin.edit.access');
    this.#f('edit-access').options[0].textContent = t('admin.edit.access.public');
    this.#f('edit-access').options[1].textContent = t('admin.edit.access.staff');
    this.#f('edit-heading-label').textContent = t('admin.anchor.heading');
    this.#f('edit-ok').textContent = t('admin.save');
    this.#f('edit-move').textContent = t('admin.edit.moveHere');
    this.#f('edit-remove').textContent = t('admin.edit.remove');
    this.#f('edit-cancel').textContent = t('admin.cancel');
    this.#f('poi-name-label').textContent = t('admin.poi.name');
    this.#f('poi-cat-label').textContent = t('admin.poi.category');
    this.#f('poi-alias-label').textContent = t('admin.poi.aliases');
    this.#f('poi-ok').textContent = t('admin.ok');
    this.#f('poi-cancel').textContent = t('admin.cancel');
    const places = this.#f('places');
    for (const place of options.places ?? HOSPITAL_PLACES) {
      const o = this.#doc.createElement('option');
      o.value = place.name;
      o.label = place.aliases.slice(0, 3).join(', ');
      places.appendChild(o);
    }
    // Choosing a library place fills in its aliases and category.
    this.#f('poi-name').addEventListener('change', () => this.#applyPlaceTemplate());
    this.#f('poi-ward-label').textContent = t('admin.ward.number');
    this.#f('edit-ward-label').textContent = t('admin.ward.number');
    this.#f('collapse').textContent = t('admin.collapse');
    this.#f('rec-scan').textContent = t('admin.record.scan');
    this.#f('rec-scan').hidden = typeof options.onScanRequest !== 'function';
    this.#f('rec-register').textContent = t('admin.record.register');
    const self = this;
    this.#wizard = createRouteWizard({
      get draft() {
        return self.#draft; // discard() replaces the draft; the wizard must follow
      },
      mount: this.#f('wizard-mount'),
      document: this.#doc,
      getPose: () => this.#pose,
      setPose: (point, o) => this.setManualPose(point, o),
      scan: (handler) => this.beginCodeScan(handler),
      fixToCode: (text) => this.fixToCode(text),
      toast: (text) => this.#toast(text),
      changed: () => this.#changed(),
      showTab: (name) => this.showTab(name),
      wardFields: AdminPanel.wardFields,
      places: options.places ?? HOSPITAL_PLACES,
      resolveCodeName: (text) => findPlanRow(this.#plan, text)?.name ?? null,
    });
    this.#f('survey-hint').textContent = t('admin.survey.hint');
    this.#f('survey-name-label').textContent = t('admin.survey.name');
    this.#f('survey-ward-label').textContent = t('admin.ward.number');
    this.#f('survey-scan').textContent = t('admin.survey.scan');
    this.#f('survey-scan').hidden = typeof options.onScanRequest !== 'function';
    this.#f('survey-count').textContent = t('admin.survey.count', { count: 0 });
    this.#f('survey-plan-summary').textContent = t('admin.survey.plan');
    this.#f('survey-plan-hint').textContent = t('admin.survey.planHint');
    this.#f('survey-plan-use').textContent = t('admin.survey.planUse');
    this.#f('survey-plan-demo').textContent = t('admin.survey.planDemo');
    this.#f('survey-plan-use').addEventListener('click', () =>
      this.setSurveyPlan(this.#f('survey-plan').value)
    );
    this.#f('survey-plan-demo').addEventListener('click', () => {
      this.#f('survey-plan').value = DEMO_HOSPITAL_PLAN;
      this.setSurveyPlan(DEMO_HOSPITAL_PLAN);
    });
    this.#restorePlan();
    this.#f('stride-summary').textContent = t('admin.stride.title');
    this.#f('stride-hint').textContent = t('admin.stride.hint');
    this.#f('stride-distance-label').textContent = t('admin.stride.distance');
    this.#f('stride-toggle').textContent = t('admin.stride.start');
    this.#f('stride-status').textContent = this.#strideStatusText();
    this.#f('stride-toggle').addEventListener('click', () => this.#toggleStrideCalibration());
    this.#f('rec-register').hidden = typeof options.onScanRequest !== 'function';
    this.#f('walk-title').textContent = t('admin.record.walkList');
    this.#f('print-sheet').textContent = t('admin.export.printSheet');
    for (const c of [
      'clinic',
      'ward',
      'facility',
      'service',
      'retail',
      'food',
      'exit',
      'staff',
      'other',
    ]) {
      for (const sel of ['poi-cat', 'edit-cat']) {
        const o = this.#doc.createElement('option');
        o.value = c === 'other' ? '' : c;
        o.textContent = categoryName(c);
        this.#f(sel).appendChild(o);
      }
    }

    this.#f('save').addEventListener('click', () => this.save());
    this.#f('collapse').addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.#f('rec-scan').addEventListener('click', () => {
      this.#registering = false;
      this.#status(t('admin.record.scanning'));
      options.onScanRequest?.();
    });
    this.#f('rec-register').addEventListener('click', () => this.beginRegister());
    this.#f('survey-scan').addEventListener('click', () => this.beginSurveyScan());
    this.#f('survey-ward').addEventListener('input', () => {
      const n = Number(this.#f('survey-ward').value);
      if (n >= 1 && n <= 99) this.#f('survey-name').value = t('admin.ward.name', { n });
    });
    this.#f('print-sheet').addEventListener('click', () => this.openPrintSheet());
    // Ward category: show the number field; the name follows the number.
    for (const prefix of ['poi', 'edit']) {
      const cat = this.#f(`${prefix}-cat`);
      const ward = this.#f(`${prefix}-ward`);
      cat.addEventListener('change', () => this.#syncWardRow(prefix));
      ward.addEventListener('input', () => {
        const n = Number(ward.value);
        if (n >= 1 && n <= 99) this.#f(`${prefix}-name`).value = t('admin.ward.name', { n });
      });
    }
    this.#f('edit-search').addEventListener('input', () => this.#renderEditList());
    this.#f('edit-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveEdit();
    });
    this.#f('edit-move').addEventListener('click', () => this.moveEditedHere());
    this.#f('edit-remove').addEventListener('click', () => this.removeEdited());
    this.#f('edit-cancel').addEventListener('click', () => this.#closeEdit());
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
    if (options.initialPose) {
      this.#pose = options.initialPose;
      this.#wizard.onPose(this.#pose);
    }
    this.#unsub.push(options.provider.onPose((p) => this.#onPose(p)));
    this.#unsub.push(options.floorplan.onDraw((ctx, fp) => this.#drawOverlay(ctx, fp)));
    const onTap = (e) => this.#onPlanTap(e);
    options.floorplan.canvas.addEventListener('click', onTap);
    this.#unsub.push(() => options.floorplan.canvas.removeEventListener('click', onTap));

    this.#updateRecording();
    this.#updateExport();
    this.showTab('routes');
    this.#published = !restored;
    this.#updateSaved();
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
    if (name === 'edit') this.#renderEditList();
  }

  // ------------------------------------------------------------ saved state

  /** Save the draft on this device now (it also autosaves on every change). */
  save() {
    this.#saveDraft();
    this.#status(t('admin.saved.now'));
    this.#updateSaved();
  }

  /** 'published' once the server has the current draft; else 'local'. */
  get savedState() {
    return this.#published ? 'published' : 'local';
  }

  /**
   * The one line visible on every tab that answers "is this actually
   * recording anything?" without digging into Export: real counts, for
   * this venue by id, right now — not just a status word. Storage here is
   * this browser's localStorage, scoped to this exact origin (scheme +
   * host + port) and this venue id; opening a different URL or a
   * different venue does not carry it over, which is the usual reason
   * "nothing" seems to be there when something was in fact saved.
   */
  #updateSaved() {
    const { nodes, edges, pois, anchors } = this.#draft.summary;
    this.#f('saved').textContent = t(
      this.#published ? 'admin.saved.published' : 'admin.saved.local',
      { id: this.#draft.id, nodes, edges, pois, anchors }
    );
  }

  #status(text) {
    this.#f('status').textContent = text;
  }

  #changed() {
    this.#published = false;
    this.#saveDraft();
    this.#updateExport();
    this.#updateSaved();
    if (this.#tab === 'edit') this.#renderEditList();
    this.#opts.floorplan.render();
  }

  // -------------------------------------------------------------- recording

  #onPose(pose) {
    this.#pose = pose;
    this.#updateRecording();
    this.#wizard?.onPose(pose);
  }

  /** The guided start-to-finish route builder (the Routes tab). */
  get wizard() {
    return this.#wizard;
  }

  /**
   * Show the camera; the next decoded code the venue does not recognise
   * goes to `handler` (a recognised one fixes the position as usual).
   * @param {(text: string) => unknown} handler
   */
  beginCodeScan(handler) {
    this.#codeHandler = handler;
    this.#surveying = false;
    this.#registering = false;
    this.#status(t('admin.survey.scanning'));
    this.#opts.onScanRequest?.();
    return true;
  }

  /** Whether the next unrecognised scan should come to {@link registerCode}. */
  get expectingCode() {
    return this.#codeHandler !== null || this.#surveying || this.#registering;
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
    // Buttons stay tappable without a position so they can explain what to do.
    for (const n of ['rec-node', 'rec-poi', 'rec-anchor']) {
      this.#f(n).setAttribute('aria-disabled', String(!havePose));
    }
    this.#f('rec-status').textContent = !havePose
      ? t('admin.record.noPoseHint')
      : this.#recording
        ? t('admin.record.status', { nodes: this.#walkNodes, edges: this.#walkEdges })
        : '';
  }

  /** Loud, transient feedback for a completed action (with a buzz where supported). */
  #toast(text) {
    const el = this.#f('toast');
    el.textContent = text;
    this.#status(text);
    try {
      globalThis.navigator?.vibrate?.(40);
    } catch {
      // ignore
    }
    clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => {
      if (el.textContent === text) el.textContent = '';
    }, 4000);
  }

  #addedOnWalk(kind, name) {
    this.#walk.unshift({ kind, name });
    this.#walk = this.#walk.slice(0, 8);
    const list = this.#f('walk');
    list.textContent = '';
    for (const item of this.#walk) {
      const li = this.#doc.createElement('li');
      const kind = item.kind === 'node' ? 'Node' : t(`admin.edit.kind.${item.kind}`);
      li.textContent = `${kind}: ${item.name}`;
      list.appendChild(li);
    }
  }

  /** Items added on this walk (newest first). */
  get walk() {
    return [...this.#walk];
  }

  /**
   * Set the working position by hand (a tap on the plan) so the "here"
   * buttons work before any marker exists. Confidence is deliberately low.
   * @param {{ x: number, y: number, floor?: number, z?: number }} point
   */
  setManualPose(point, { confidence = 0.5, quiet = false } = {}) {
    const floor = point.floor ?? this.#pose?.floor ?? this.#draft.floors[0].index;
    const pose = {
      x: point.x,
      y: point.y,
      z: point.z ?? this.#draft.floorByIndex(floor)?.elevation ?? 0,
      floor,
      heading: point.heading ?? this.#pose?.heading ?? 0,
      confidence,
      timestamp: Date.now(),
    };
    this.#pose = pose;
    this.#updateRecording();
    if (!quiet) this.#toast(t('admin.record.poseFromPlan'));
    this.#opts.onManualPose?.(pose);
    return pose;
  }

  /** Drop a node at the current position, linked to the previous one on this walk. */
  addNodeHere(name) {
    if (!this.#pose) {
      this.#toast(t('admin.record.noPoseHint'));
      return null;
    }
    const before = { nodes: this.#draft.nodes.length, edges: this.#draft.edges.length };
    const node = this.#draft.addNode(
      { x: this.#pose.x, y: this.#pose.y, z: this.#pose.z, floor: this.#pose.floor, name },
      { linkFrom: this.#recording ? this.#lastNodeId : null, snap: 1.5 }
    );
    const created = this.#draft.nodes.length > before.nodes;
    this.#walkNodes += created ? 1 : 0;
    this.#walkEdges += this.#draft.edges.length - before.edges;
    this.#lastNodeId = node.id;
    const label = node.name ?? node.id;
    this.#toast(t(created ? 'admin.record.added.node' : 'admin.record.snapped', { name: label }));
    if (created) this.#addedOnWalk('node', label);
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
    if (!this.#pose) {
      this.#toast(t('admin.record.noPoseHint'));
      return null;
    }
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
    this.#toast(t('admin.record.added.anchor', { name: anchor.name ?? anchor.id }));
    this.#addedOnWalk('anchor', anchor.name ?? anchor.id);
    this.#changed();
    return anchor;
  }

  // ---------------------------------------------------- stride calibration

  #strideStatusText() {
    const set = this.#draft.frame?.strideM;
    return set ? t('admin.stride.current', { m: set.toFixed(2) }) : t('admin.stride.default');
  }

  /**
   * Walk a measured distance, then divide it by the steps counted to set
   * this venue's `strideM` (see `src/core/fusion.js`) — closer to this
   * surveyor's actual stride than the population-average default, so
   * dead-reckoned points between codes land more accurately.
   */
  #toggleStrideCalibration() {
    if (this.#strideCal) {
      const steps = this.#strideCal.fusion.stepCount;
      this.#strideCal.detach();
      this.#strideCal = null;
      this.#f('stride-toggle').textContent = t('admin.stride.start');
      const distanceM = Number(this.#f('stride-distance').value);
      if (!(distanceM > 0) || steps < 3) {
        this.#f('stride-status').textContent = t('admin.stride.tooFewSteps', { steps });
        return;
      }
      const strideM = Math.round((distanceM / steps) * 100) / 100;
      this.#draft.frame = { ...(this.#draft.frame ?? {}), strideM };
      this.#f('stride-status').textContent = t('admin.stride.saved', { m: strideM, steps });
      this.#toast(t('admin.stride.saved', { m: strideM, steps }));
      this.#changed();
      return;
    }
    const win = this.#opts.window;
    if (!win?.addEventListener) {
      this.#f('stride-status').textContent = t('admin.stride.unavailable');
      return;
    }
    const fusion = new PoseFusion({ now: () => Date.now() });
    fusion.applyFix({
      x: 0,
      y: 0,
      z: 0,
      floor: 0,
      heading: 0,
      confidence: 1,
      timestamp: Date.now(),
    });
    const detach = fusion.attach(win);
    this.#strideCal = { fusion, detach };
    this.#f('stride-toggle').textContent = t('admin.stride.stop');
    this.#f('stride-status').textContent = t('admin.stride.walking');
    fusion.on('pose', () => {
      if (!this.#strideCal) return;
      this.#f('stride-status').textContent = t('admin.stride.counting', {
        steps: fusion.stepCount,
      });
    });
  }

  // ------------------------------------------------------- sticker survey

  /**
   * Start a survey scan: the next code seen is recorded here with the area
   * name typed above. No position yet? The first code becomes the origin.
   */
  beginSurveyScan() {
    this.#surveying = true;
    this.#registering = false;
    this.#codeHandler = null;
    this.#status(t('admin.survey.scanning'));
    this.#opts.onScanRequest?.();
    return true;
  }

  get surveying() {
    return this.#surveying;
  }

  /**
   * Record a scanned printed code as a marker at the current position, with a
   * route node (linked to the previous survey stop) and, if named, a place.
   * @param {string} text  The code's own text.
   */
  surveyCode(text) {
    this.#surveying = false;
    if (this.fixToCode(text)) return null; // re-scanning a recorded code
    const row = findPlanRow(this.#plan, text);
    if (row) this.#ensureFloor(row.floor);
    let firstAtOrigin = false;
    if (!this.#pose) {
      firstAtOrigin = true;
      this.setManualPose(
        { x: 0, y: 0, floor: row?.floor ?? this.#draft.floors[0].index },
        { quiet: true }
      );
    } else if (row && row.floor !== this.#pose.floor) {
      // The list says this code is on another floor: the survey moved floors.
      this.setManualPose({ x: this.#pose.x, y: this.#pose.y, floor: row.floor }, { quiet: true });
      this.#surveyLastNode = null; // do not link across floors by walking
    }
    const pose = this.#pose;
    const nameField = this.#f('survey-name');
    // A name filled in from the list only counts if the scanned code is that
    // listed code; a typed name always wins.
    const typed =
      nameField.value.trim() && nameField.value.trim() !== nameField.dataset.prefill
        ? nameField.value.trim()
        : '';
    const wardN = this.#f('survey-ward').value;
    const planWard = /^ward\s*(\d{1,2})\b/i.exec(row?.name ?? '');
    const ward = AdminPanel.wardFields(wardN || (typed ? '' : (planWard?.[1] ?? '')));
    const name = ward?.name ?? (typed || row?.name || '');

    const node = this.#draft.addNode(
      { x: pose.x, y: pose.y, z: pose.z, floor: pose.floor, name: name || undefined },
      { linkFrom: this.#surveyLastNode, snap: 1.5 }
    );
    this.#surveyLastNode = node.id;
    const anchor = this.#draft.addAnchor({
      x: pose.x,
      y: pose.y,
      z: pose.z,
      floor: pose.floor,
      heading: pose.heading,
      name: name || undefined,
    });
    anchor.code = text;
    let poi = null;
    if (name) {
      const template = findPlace(name, this.#opts.places ?? HOSPITAL_PLACES);
      poi = this.#draft.addPoi({
        name,
        node: node.id,
        aliases: [...new Set([...(ward?.aliases ?? []), ...(template?.aliases ?? [])])],
        category: ward ? 'ward' : template?.category,
        access: template?.access,
      });
    }
    this.#surveyCount += 1;
    this.#f('survey-count').textContent = t('admin.survey.count', { count: this.#surveyCount });
    const li = this.#doc.createElement('li');
    li.textContent = `${name || anchor.id} · ${text}`;
    this.#f('survey-list').prepend(li);
    this.#surveyToast(
      firstAtOrigin
        ? t('admin.survey.firstAtOrigin')
        : name
          ? t('admin.survey.recorded', { name, code: text })
          : t('admin.survey.recordedNoName', { code: text })
    );
    this.#f('survey-name').value = '';
    this.#f('survey-ward').value = '';
    this.#addedOnWalk('anchor', name || anchor.id);
    this.#changed();
    this.#updatePlanStatus();
    // The code now lives here, so the position is exact from this point:
    // dead reckoning restarts from it for the walk to the next code.
    this.setManualPose(
      { x: anchor.x, y: anchor.y, z: anchor.z, floor: anchor.floor, heading: anchor.heading },
      { confidence: 1, quiet: true }
    );
    return { anchor, node, poi };
  }

  /**
   * Set the list of printed codes for this survey (`code, floor, where` per
   * line). A scanned code on the list gets its name and floor filled in, and
   * the tab shows what is still to do. Kept on this device per venue.
   * @param {string} text
   * @returns {{ rows: object[], errors: string[] }}
   */
  setSurveyPlan(text) {
    const parsed = parseSurveyPlan(text);
    this.#plan = parsed.rows;
    try {
      const key = `${PLAN_KEY}:${this.#draft.id}`;
      if (parsed.rows.length) this.#opts.storage?.setItem(key, text);
      else this.#opts.storage?.removeItem(key);
    } catch {
      /* storage unavailable */
    }
    if (parsed.errors.length) {
      this.#toast(
        t('admin.survey.planErrors', { count: parsed.errors.length, first: parsed.errors[0] })
      );
    } else if (parsed.rows.length) {
      this.#f('survey-plan-box').open = false;
    }
    this.#updatePlanStatus();
    return parsed;
  }

  get surveyPlan() {
    return this.#plan;
  }

  #restorePlan() {
    try {
      const text = this.#opts.storage?.getItem(`${PLAN_KEY}:${this.#draft.id}`);
      if (text) {
        this.#f('survey-plan').value = text;
        this.#plan = parseSurveyPlan(text).rows;
      }
    } catch {
      /* storage unavailable */
    }
    this.#updatePlanStatus();
  }

  /** Listed codes not yet recorded, in list order. */
  #planRemaining() {
    const done = new Set(this.#draft.anchors.map((a) => a.code).filter(Boolean));
    return this.#plan.filter((r) => !done.has(r.code));
  }

  #updatePlanStatus() {
    const el = this.#f('survey-plan-status');
    const nameField = this.#f('survey-name');
    if (!this.#plan.length) {
      el.textContent = '';
      delete nameField.dataset.prefill;
      return;
    }
    const remaining = this.#planRemaining();
    const next = remaining[0] ?? null;
    el.textContent =
      t('admin.survey.planStatus', {
        done: this.#plan.length - remaining.length,
        total: this.#plan.length,
      }) +
      (next
        ? ` · ${t('admin.survey.planNext', { code: next.code, name: next.name, floor: next.floorLabel })}`
        : '');
    // Offer the next listed name; it is only used if that code is scanned.
    if (next && (!nameField.value.trim() || nameField.value === nameField.dataset.prefill)) {
      nameField.value = next.name;
      nameField.dataset.prefill = next.name;
    } else if (!next) {
      delete nameField.dataset.prefill;
    }
  }

  #ensureFloor(index) {
    if (this.#draft.floorByIndex(index)) return;
    const name = index === 0 ? 'Ground' : index < 0 ? `Basement ${-index}` : `Level ${index}`;
    const id = index === 0 ? 'ground' : index < 0 ? `b${-index}` : `l${index}`;
    this.#draft.addFloor({ index, id, name, elevation: index * 4 });
  }

  /**
   * A scan of a code this draft already knows (recorded on this device but
   * not yet published, so the scanner itself cannot place it): fix the
   * position at that marker. Returns whether the code was known.
   * @param {string} text
   */
  fixToCode(text) {
    const known = this.#draft.anchors.find((a) => a.code === text);
    if (!known) return false;
    this.setManualPose(
      { x: known.x, y: known.y, z: known.z, floor: known.floor, heading: known.heading },
      { confidence: 1, quiet: true }
    );
    this.#surveyToast(t('admin.survey.known', { name: known.name ?? known.id }));
    return true;
  }

  #surveyToast(text) {
    const el = this.#f('survey-toast');
    el.textContent = text;
    this.#toast(text);
  }

  // ------------------------------------------------- register a printed code

  /** Next scanned code that the venue does not know becomes a marker here. */
  beginRegister() {
    if (!this.#pose) {
      this.#toast(t('admin.record.noPoseHint'));
      return false;
    }
    this.#registering = true;
    this.#surveying = false;
    this.#codeHandler = null;
    this.#status(t('admin.record.registering'));
    this.#opts.onScanRequest?.();
    return true;
  }

  get registering() {
    return this.#registering;
  }

  /**
   * Called by the app with the raw text of a scanned code. While registering,
   * an unknown code becomes a marker at the current position (its text is
   * stored so the scanner recognises that sticker from now on).
   * @param {string} text
   * @returns {object | null} The anchor created, if any.
   */
  registerCode(text) {
    if (this.#codeHandler) {
      const handler = this.#codeHandler;
      this.#codeHandler = null;
      return handler(text) ?? null;
    }
    if (this.#surveying) return this.surveyCode(text);
    if (!this.#registering || !this.#pose) return null;
    const known = this.#draft.anchors.find((a) => a.code === text);
    if (known) {
      this.#toast(t('admin.record.registerKnown', { name: known.name ?? known.id }));
      this.#registering = false;
      return null;
    }
    const name = this.#opts.prompt(t('admin.name.prompt'), '') ?? '';
    const anchor = this.#draft.addAnchor({
      x: this.#pose.x,
      y: this.#pose.y,
      z: this.#pose.z,
      floor: this.#pose.floor,
      heading: this.#pose.heading,
      name: name || undefined,
    });
    anchor.code = text;
    this.#registering = false;
    this.#toast(t('admin.record.registered', { name: anchor.name ?? anchor.id }));
    this.#addedOnWalk('anchor', anchor.name ?? anchor.id);
    this.#changed();
    return anchor;
  }

  // ----------------------------------------------------------- plan editor

  #onPlanTap(e) {
    if (!['plan', 'record', 'routes'].includes(this.#tab)) return;
    const rect = this.#opts.floorplan.canvas.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const point = this.#opts.floorplan.fromScreen(e.clientX - rect.left, e.clientY - rect.top);
    if (this.#tab !== 'plan') {
      this.setManualPose(point);
      return;
    }
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
    const isWard = this.#f('poi-cat').value === 'ward';
    if (!name && !(isWard && AdminPanel.wardFields(this.#f('poi-ward').value))) return;
    const aliases = this.#f('poi-alias')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const category = this.#f('poi-cat').value || undefined;
    const access = form.dataset.access === 'staff' ? 'staff' : undefined;
    const ward = category === 'ward' ? AdminPanel.wardFields(this.#f('poi-ward').value) : null;
    const poi = this.#draft.addPoi({
      name: ward?.name ?? name,
      node: form.dataset.node,
      aliases: ward ? [...new Set([...ward.aliases, ...aliases])] : aliases,
      category,
      access,
    });
    form.dataset.access = '';
    form.hidden = true;
    this.#toast(t('admin.record.added.poi', { name: poi.name }));
    this.#addedOnWalk('poi', poi.name);
    this.#changed();
    return poi;
  }

  #applyPlaceTemplate() {
    const template = findPlace(this.#f('poi-name').value, this.#opts.places ?? HOSPITAL_PLACES);
    if (!template) return;
    this.#f('poi-name').value = template.name;
    if (!this.#f('poi-alias').value.trim())
      this.#f('poi-alias').value = template.aliases.join(', ');
    this.#f('poi-cat').value = template.category === 'other' ? '' : template.category;
    this.#f('poi-form').dataset.access = template.access ?? '';
  }

  /** Submit the POI form programmatically (tests). */
  submitPoi({ name = '', aliases = [], category, ward }) {
    this.#f('poi-name').value = name;
    this.#f('poi-alias').value = aliases.join(', ');
    this.#f('poi-cat').value = category ?? '';
    this.#syncWardRow('poi');
    if (ward !== undefined) this.#f('poi-ward').value = String(ward);
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

  // ------------------------------------------------------------ edit existing

  /** Places and markers matching the search box, for the list. */
  editCandidates(query = this.#f('edit-search').value) {
    const q = String(query ?? '')
      .trim()
      .toLowerCase();
    const hit = (v) =>
      !q ||
      String(v ?? '')
        .toLowerCase()
        .includes(q);
    const floorName = (i) => this.#draft.floorByIndex(i)?.name ?? String(i);
    const out = [];
    for (const p of this.#draft.pois) {
      const node = this.#draft.nodeById(p.node);
      if (hit(p.name) || (p.aliases ?? []).some(hit) || hit(p.id)) {
        out.push({
          kind: 'poi',
          id: p.id,
          name: p.name,
          floor: floorName(p.floor ?? node?.floor ?? 0),
        });
      }
    }
    for (const a of this.#draft.anchors) {
      if (hit(a.name) || hit(a.id))
        out.push({ kind: 'anchor', id: a.id, name: a.name ?? a.id, floor: floorName(a.floor) });
    }
    return out;
  }

  #renderEditList() {
    const list = this.#f('edit-list');
    list.textContent = '';
    const items = this.editCandidates();
    if (items.length === 0) {
      const li = this.#doc.createElement('li');
      li.textContent = t('admin.edit.none');
      list.appendChild(li);
      return;
    }
    for (const item of items) {
      const li = this.#doc.createElement('li');
      const btn = this.#doc.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'option');
      btn.dataset.kind = item.kind;
      btn.dataset.id = item.id;
      btn.setAttribute(
        'aria-selected',
        String(this.#editing?.id === item.id && this.#editing?.kind === item.kind)
      );
      btn.innerHTML = '<span class="name"></span><span class="kind"></span>';
      btn.querySelector('.name').textContent = item.name;
      btn.querySelector('.kind').textContent =
        `${t(`admin.edit.kind.${item.kind}`)} · ${item.floor}`;
      btn.addEventListener('click', () => this.openEdit(item.kind, item.id));
      li.appendChild(btn);
      list.appendChild(li);
    }
  }

  /** Open the edit form for a place ('poi') or marker ('anchor'). */
  openEdit(kind, id) {
    const form = this.#f('edit-form');
    const isPoi = kind === 'poi';
    const item = isPoi
      ? this.#draft.pois.find((p) => p.id === id)
      : this.#draft.anchors.find((a) => a.id === id);
    if (!item) throw new Error(`unknown ${kind} ${id}`);
    this.#editing = { kind, id };
    this.#f('edit-kind').textContent = t(`admin.edit.kind.${kind}`);
    this.#f('edit-name').value = item.name ?? '';
    this.#f('edit-name').required = isPoi;
    this.#f('edit-alias-row').hidden = !isPoi;
    this.#f('edit-cat-row').hidden = !isPoi;
    this.#f('edit-access-row').hidden = !isPoi;
    this.#f('edit-heading-row').hidden = isPoi;
    if (isPoi) {
      this.#f('edit-alias').value = (item.aliases ?? []).join(', ');
      this.#f('edit-cat').value = item.category ?? '';
      this.#f('edit-access').value = item.access ?? 'public';
      this.#f('edit-note').textContent = '';
      const n = /^\D*(\d{1,2})\b/.exec(item.name ?? '')?.[1];
      this.#f('edit-ward').value = item.category === 'ward' && n ? n : '';
      this.#syncWardRow('edit');
    } else {
      this.#f('edit-heading').value = String(item.heading ?? 0);
      this.#f('edit-note').textContent = t('admin.edit.markerId', { id });
    }
    this.#f('edit-move').disabled = !this.#pose;
    form.hidden = false;
    this.#renderEditList();
    this.#f('edit-name').focus?.();
  }

  #syncWardRow(prefix) {
    const isWard = this.#f(`${prefix}-cat`).value === 'ward';
    this.#f(`${prefix}-ward-row`).hidden = !isWard;
    if (isWard) this.#f(`${prefix}-ward`).focus?.();
  }

  /** Ward number → canonical name and aliases (e.g. "Ward 12", ["W12", "Ward12"]). */
  static wardFields(n) {
    const num = Number(n);
    if (!(Number.isInteger(num) && num >= 1 && num <= 99)) return null;
    return { name: t('admin.ward.name', { n: num }), aliases: [`W${num}`, `Ward${num}`] };
  }

  /** Collapse the panel to its tab row so the map is visible on a phone. */
  setCollapsed(on) {
    this.#el.classList.toggle('admin-collapsed', Boolean(on));
    this.#f('collapse').textContent = t(on ? 'admin.expand' : 'admin.collapse');
    this.#f('collapse').setAttribute('aria-expanded', String(!on));
  }

  get collapsed() {
    return this.#el.classList.contains('admin-collapsed');
  }

  #closeEdit() {
    this.#editing = null;
    this.#f('edit-form').hidden = true;
    this.#renderEditList();
  }

  /** Apply the edit form. */
  saveEdit() {
    if (!this.#editing) return null;
    const { kind, id } = this.#editing;
    let item;
    if (kind === 'poi') {
      const category = this.#f('edit-cat').value || null;
      const ward = category === 'ward' ? AdminPanel.wardFields(this.#f('edit-ward').value) : null;
      const typed = this.#f('edit-alias').value.split(',');
      // On renumbering, old W4 / Ward4 style aliases are replaced, not kept.
      const kept = typed.map((v) => v.trim()).filter((v) => v && !/^(w|ward)\s*\d{1,2}$/i.test(v));
      item = this.#draft.updatePoi(id, {
        name: ward?.name ?? this.#f('edit-name').value,
        aliases: ward ? [...new Set([...ward.aliases, ...kept])] : typed,
        category,
        access: this.#f('edit-access').value === 'staff' ? 'staff' : null,
      });
    } else {
      item = this.#draft.updateAnchor(id, {
        name: this.#f('edit-name').value.trim() || null,
        heading: Number(this.#f('edit-heading').value) || 0,
      });
    }
    this.#status(t('admin.edit.saved', { name: item.name ?? item.id }));
    this.#closeEdit();
    this.#changed();
    return item;
  }

  /** Move the edited place/marker to the current position. */
  moveEditedHere() {
    if (!this.#editing || !this.#pose) return null;
    const { kind, id } = this.#editing;
    let item;
    if (kind === 'poi') {
      // A place lives on a node: reuse a node within 1.5 m or make one here.
      const node = this.#draft.addNode(
        { x: this.#pose.x, y: this.#pose.y, z: this.#pose.z, floor: this.#pose.floor },
        { snap: 1.5 }
      );
      item = this.#draft.movePoi(id, node.id);
    } else {
      item = this.#draft.updateAnchor(id, {
        x: this.#pose.x,
        y: this.#pose.y,
        z: this.#pose.z,
        floor: this.#pose.floor,
        heading: this.#pose.heading,
      });
      this.#f('edit-heading').value = String(item.heading);
    }
    this.#status(t('admin.edit.moved', { name: item.name ?? item.id }));
    this.#changed();
    return item;
  }

  removeEdited() {
    if (!this.#editing) return false;
    const { kind, id } = this.#editing;
    const item =
      kind === 'poi'
        ? this.#draft.pois.find((p) => p.id === id)
        : this.#draft.anchors.find((a) => a.id === id);
    const ok = kind === 'poi' ? this.#draft.removePoi(id) : this.#draft.removeAnchor(id);
    if (ok) this.#status(t('admin.edit.removed', { name: item?.name ?? id }));
    this.#closeEdit();
    this.#changed();
    return ok;
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
    // Download is never blocked: getting a broken draft out to look at what's
    // wrong with it is exactly what it's for. Publishing broken JSON to
    // every visitor's copy is the thing actually worth stopping.
    this.#f('publish').disabled = problems.length > 0;
    // A plain, always-visible copy of the same JSON: no download, share
    // sheet or clipboard permission involved, so it works even when those
    // don't — tap in, select all, copy by hand.
    this.#f('raw-json').value = this.json();
    void this.#renderMarkers();
  }

  /** The text a marker's QR code carries (its own code if registered from a sticker). */
  markerPayload(anchor) {
    if (anchor.code) return anchor.code;
    const base = this.#opts.publicBaseUrl ?? globalThis.location?.origin ?? '';
    return `${base}/?v=${encodeURIComponent(this.#draft.id)}&anchor=${encodeURIComponent(anchor.id)}`;
  }

  async #renderMarkers() {
    const anchors = this.#draft.anchors;
    this.#f('markers-title').textContent = t('admin.export.markers', { count: anchors.length });
    this.#f('markers-empty').hidden = anchors.length > 0;
    this.#f('markers-empty').textContent = t('admin.export.noMarkers');
    this.#f('print-sheet').disabled = anchors.length === 0;
    const list = this.#f('markers');
    const token = (this.#markerRender = (this.#markerRender ?? 0) + 1);
    const frag = this.#doc.createDocumentFragment();
    const render =
      this.#opts.qrDataUrl ??
      ((text) => QRCode.toDataURL(text, { errorCorrectionLevel: 'H', margin: 1, width: 280 }));
    for (const a of anchors) {
      const li = this.#doc.createElement('li');
      const img = this.#doc.createElement('img');
      img.alt = `QR code for ${a.name ?? a.id}`;
      const payload = this.markerPayload(a);
      try {
        if (!this.#markerUrls.has(payload)) this.#markerUrls.set(payload, await render(payload));
        img.src = this.#markerUrls.get(payload);
      } catch {
        img.alt = payload;
      }
      const name = this.#doc.createElement('strong');
      name.textContent = a.name ?? a.id;
      const code = this.#doc.createElement('span');
      code.textContent = a.code ? t('admin.export.markerCode', { text: a.code }) : a.id;
      li.append(img, name, code);
      frag.appendChild(li);
    }
    if (token !== this.#markerRender) return; // a newer render superseded this one
    list.textContent = '';
    list.appendChild(frag);
  }

  /** Build the print sheet HTML (one marker per page). */
  async printSheetHtml() {
    const esc = (v) =>
      String(v).replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
      );
    const render =
      this.#opts.qrSvg ??
      ((text) => QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'H', margin: 2 }));
    const cards = [];
    for (const a of this.#draft.anchors) {
      const payload = this.markerPayload(a);
      const svg = await render(payload);
      cards.push(
        `<section class="card">${svg}<h1>${esc(this.#draft.name)}</h1><p>Scan with your phone camera to start wayfinding — no app to install.</p><p><strong>${esc(a.name ?? a.id)}</strong></p><code>${esc(payload)}</code></section>`
      );
    }
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(this.#draft.name)} — QR markers</title><style>
body{font-family:system-ui,sans-serif;margin:0}.card{page-break-after:always;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px;box-sizing:border-box}
.card svg{width:min(70vw,420px);height:auto}h1{font-size:26px;margin:8px 0}p{font-size:18px;margin:4px 0}code{font-size:12px;color:#555;word-break:break-all}
</style></head><body>${cards.join('')}</body></html>`;
  }

  /** Open the print sheet in a new tab (print or share from there). */
  async openPrintSheet() {
    if (this.#draft.anchors.length === 0) return null;
    const html = await this.printSheetHtml();
    const open =
      this.#opts.openSheet ??
      ((h) => {
        const blob = new Blob([h], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        globalThis.open?.(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      });
    open(html);
    return html;
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
    this.#published = true;
    this.#updateSaved();
    this.#status(t('admin.export.published'));
    return body;
  }

  json() {
    return JSON.stringify(this.#draft.toJSON(), null, 2);
  }

  /**
   * Save the draft to a file, named obviously and by the minute so several
   * exports never look the same: `brains-<venue-id>-<date>-<time>.venue.json`.
   * Never blocked by validation problems — an export is exactly how you'd
   * get an invalid draft out to look at what's wrong with it.
   */
  download() {
    const name = this.#exportFilename();
    this.#opts.download(name, `${this.json()}\n`);
    this.#toast(t('admin.export.downloaded', { name }));
    return name;
  }

  #exportFilename() {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    return `brains-${this.#draft.id}-${stamp}.venue.json`;
  }

  async copy() {
    await this.#opts.copy(this.json());
    this.#toast(t('admin.export.copied'));
  }

  discard() {
    this.#draft = new VenueDraft(this.#opts.venue.toJSON());
    this.#wizard?.reset();
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
    this.#strideCal?.detach();
    this.#wizard?.destroy();
    this.#el.remove();
  }
}

/**
 * Save a file for the person using the browser. iOS Safari's classic
 * `<a download>` trick is unreliable for a JSON blob — it often does
 * nothing visible at all, which is exactly what looks like "nothing was
 * saved". Where the Web Share API can share a *file* (iOS Safari, most
 * mobile browsers), that is used instead: it opens the native share sheet
 * ("Save to Files", AirDrop, Messages…), which unambiguously produces a
 * file the person can find. Desktop browsers, which support `<a download>`
 * properly and mostly don't support sharing files, get that instead.
 */
export function defaultDownload(name, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const nav = globalThis.navigator;
  let file = null;
  try {
    file = new File([blob], name, { type: 'application/json' });
  } catch {
    // File unavailable (very old browser): fall through to the anchor trick.
  }
  const canShareFile =
    file &&
    typeof nav?.share === 'function' &&
    (typeof nav.canShare !== 'function' || safeCanShare(nav, file));
  if (canShareFile) {
    nav.share({ files: [file], title: name }).catch(() => anchorDownload(name, blob));
    return;
  }
  anchorDownload(name, blob);
}

function safeCanShare(nav, file) {
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function anchorDownload(name, blob) {
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
