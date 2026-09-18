/**
 * Accuracy harness UI — a panel for test walks. Enabled with `?harness=1`.
 *
 * It records every pose the app receives and every fix request (start,
 * fallback, rescan), and gives the tester one big button per ground-truth
 * checkpoint (the venue's anchors, plus named nodes) to press when standing
 * on it. "Download log" saves the JSON; "Show report" runs the analysis in
 * place. The same log feeds scripts/accuracy-harness.mjs.
 */

import { analyseLog, createRecorder, formatReport } from '../core/accuracy.js';
import { t } from './strings/index.js';
import { ensureStyle } from './tokens.js';

const CSS = `
.harness { position: fixed; top: calc(64px + env(safe-area-inset-top)); left: 8px; right: 8px; z-index: 22; max-height: 45vh; overflow: auto;
  padding: 10px 12px; border-radius: var(--radius); background: var(--color-surface); color: var(--color-text);
  font-family: var(--font); font-size: 15px; border: 2px solid var(--color-warn); }
.harness[hidden] { display: none; }
.harness h2 { margin: 0 0 4px; font-size: 1em; }
.harness p { margin: 4px 0; }
.harness-cps { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin: 8px 0; }
.harness-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.harness pre { white-space: pre-wrap; font-size: 12px; background: var(--color-surface-solid); padding: 8px; border-radius: 8px; }
`;

export class Harness {
  #doc;
  #el;
  #f;
  #rec;
  #opts;
  #unsub = [];
  #checkpointCount = 0;

  /**
   * @param {Object} options
   * @param {import('../core/venue.js').Venue} options.venue
   * @param {import('../core/positioning.js').PositionProvider} options.provider  Usually the chain.
   * @param {string} [options.providerName]
   * @param {HTMLElement} [options.mount]
   * @param {Document} [options.document]
   * @param {() => number} [options.now]
   * @param {(name: string, text: string) => void} [options.download]  Injectable file saver.
   */
  constructor(options) {
    if (!options?.venue || !options?.provider)
      throw new TypeError('Harness requires a venue and a provider');
    this.#doc = options.document ?? globalThis.document;
    this.#opts = { now: () => Date.now(), download: defaultDownload, ...options };
    this.#rec = createRecorder({
      now: this.#opts.now,
      venueId: options.venue.id,
      provider: options.providerName,
    });
    ensureStyle('brains-harness-style', CSS, this.#doc);

    const el = this.#doc.createElement('section');
    el.className = 'harness';
    el.setAttribute('aria-label', t('harness.title'));
    el.innerHTML = `
      <h2 data-f="title"></h2>
      <p data-f="hint"></p>
      <p data-f="status" role="status" aria-live="polite"></p>
      <h3 class="visually-hidden" data-f="cps-title"></h3>
      <div class="harness-cps" data-f="cps" role="group"></div>
      <div class="harness-actions">
        <button type="button" class="btn" data-f="download"></button>
        <button type="button" class="btn btn-primary" data-f="report"></button>
        <button type="button" class="btn" data-f="reset"></button>
      </div>
      <pre data-f="out" hidden></pre>
    `;
    this.#el = el;
    this.#f = (n) => el.querySelector(`[data-f="${n}"]`);
    (options.mount ?? this.#doc.body).appendChild(el);

    this.#f('title').textContent = t('harness.title');
    this.#f('hint').textContent = t('harness.hint');
    this.#f('cps-title').textContent = t('harness.checkpoints');
    this.#f('cps').setAttribute('aria-label', t('harness.checkpoints'));
    this.#f('download').textContent = t('harness.download');
    this.#f('report').textContent = t('harness.report');
    this.#f('reset').textContent = t('harness.reset');

    for (const cp of this.checkpoints()) {
      const btn = this.#doc.createElement('button');
      btn.type = 'button';
      btn.className = 'btn';
      btn.dataset.checkpoint = cp.id;
      btn.textContent = t('harness.here', { name: cp.name });
      btn.addEventListener('click', () => this.mark(cp.id));
      this.#f('cps').appendChild(btn);
    }
    this.#f('download').addEventListener('click', () => this.download());
    this.#f('report').addEventListener('click', () => this.showReport());
    this.#f('reset').addEventListener('click', () => this.reset());

    const provider = options.provider;
    this.#rec.fixRequest('start');
    this.#unsub.push(provider.onPose((p) => this.#onPose(p)));
    if (typeof provider.onChange === 'function') {
      this.#unsub.push(
        provider.onChange((e) => {
          this.#rec.status(e.type, e.to ?? e.reason);
          if (e.type === 'fallback' || e.type === 'started') this.#rec.fixRequest(e.type);
          this.#watchRescan(e.state?.provider);
        })
      );
      this.#watchRescan(provider.state?.provider ?? provider.active);
    } else {
      this.#watchRescan(provider);
    }
    this.#updateStatus();
  }

  #rescanOff = null;
  #watchRescan(active) {
    this.#rescanOff?.();
    this.#rescanOff = null;
    if (active && typeof active.onRescanNeeded === 'function') {
      this.#rescanOff = active.onRescanNeeded(() => {
        this.#rec.fixRequest('rescan');
        this.#f('status').textContent = t('harness.rescan');
      });
    }
  }

  get el() {
    return this.#el;
  }

  /** Ground-truth points: anchors first, then named nodes. */
  checkpoints() {
    const v = this.#opts.venue;
    const anchors = v.anchors.map((a) => ({
      id: `anchor:${a.id}`,
      name: a.name ?? a.id,
      x: a.x,
      y: a.y,
      z: a.z ?? 0,
      floor: a.floor,
    }));
    const nodes = v.graph.nodes
      .filter((n) => n.name)
      .map((n) => ({
        id: `node:${n.id}`,
        name: n.name,
        x: n.x,
        y: n.y,
        z: n.z ?? 0,
        floor: n.floor,
      }));
    return [...anchors, ...nodes];
  }

  #onPose(pose) {
    this.#rec.pose(pose);
    this.#updateStatus();
  }

  /** Record that the tester is standing on a checkpoint right now. */
  mark(id, note) {
    const cp = this.checkpoints().find((c) => c.id === id);
    if (!cp) throw new RangeError(`unknown checkpoint ${id}`);
    this.#rec.checkpoint({
      id: cp.id,
      x: cp.x,
      y: cp.y,
      z: cp.z,
      floor: cp.floor,
      note: note ?? cp.name,
    });
    this.#checkpointCount += 1;
    this.#f('status').textContent = t('harness.recorded', {
      name: cp.name,
      count: this.#checkpointCount,
    });
  }

  #updateStatus() {
    const poses = this.#rec.events.filter((e) => e.type === 'pose').length;
    this.#f('title').textContent =
      `${t('harness.title')} · ${t('harness.poses', { count: poses })}`;
  }

  get log() {
    return this.#rec.toJSON();
  }

  report(options) {
    return analyseLog(this.log, options);
  }

  showReport() {
    const r = this.report();
    const out = this.#f('out');
    out.textContent = formatReport(r);
    out.hidden = false;
    this.#f('status').textContent = t('harness.summary', {
      mean: r.position.meanErrorM ?? 'n/a',
      worst: r.position.worstErrorM ?? 'n/a',
      failed: r.fixes.failedRate === null ? 'n/a' : `${Math.round(r.fixes.failedRate * 100)} %`,
    });
    return r;
  }

  download() {
    const name = `accuracy-${this.#opts.venue.id}-${new Date(this.#opts.now()).toISOString().replace(/[:.]/g, '-')}.json`;
    this.#opts.download(name, JSON.stringify(this.log, null, 2));
    return name;
  }

  reset() {
    this.#rec = createRecorder({
      now: this.#opts.now,
      venueId: this.#opts.venue.id,
      provider: this.#opts.providerName,
    });
    this.#rec.fixRequest('start');
    this.#checkpointCount = 0;
    this.#f('out').hidden = true;
    this.#f('status').textContent = '';
    this.#updateStatus();
  }

  destroy() {
    for (const off of this.#unsub) off();
    this.#rescanOff?.();
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

/** @param {ConstructorParameters<typeof Harness>[0]} options */
export function createHarness(options) {
  return new Harness(options);
}
