/**
 * Ready card — the single "Start" tap between choosing a destination and the
 * arrow appearing. It shows where the route goes and roughly how far, and its
 * button is the user gesture iOS needs before it will hand over motion data,
 * so pressing it also (re)asks for motion access. Nothing is stored.
 */

import { formatMetres, t } from './strings/index.js';
import { ensureStyle } from './tokens.js';

const WALK_M_PER_MIN = 72; // ~1.2 m/s, an unhurried indoor pace

const CSS = `
.ready { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; box-sizing: border-box; padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
  background: var(--color-surface); color: var(--color-text); font-family: var(--font); font-size: var(--font-size);
  border-top: 3px solid var(--color-accent); border-radius: var(--radius) var(--radius) 0 0; display: grid; gap: 10px; }
.ready[hidden] { display: none; }
.ready h2 { margin: 0; font-size: var(--font-size-large); }
.ready p { margin: 0; }
.ready-detail { color: var(--color-text-muted); }
.ready .btn { min-height: var(--touch-target); }
`;

/**
 * @param {{ document?: Document, mount?: HTMLElement, onStart?: (poi: object) => void, onChange?: () => void }} options
 */
export function createReadyCard(options = {}) {
  const doc = options.document ?? globalThis.document;
  const mount = options.mount ?? doc.body;
  ensureStyle('brains-ready-style', CSS, doc);
  const el = doc.createElement('section');
  el.className = 'ready';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', t('ready.title'));
  el.innerHTML = `
    <h2 data-f="title"></h2>
    <p data-f="route"></p>
    <p class="ready-detail" data-f="detail"></p>
    <button type="button" class="btn btn-primary btn-big" data-f="start"></button>
    <button type="button" class="btn" data-f="change"></button>
  `;
  mount.appendChild(el);
  const f = (n) => el.querySelector(`[data-f="${n}"]`);
  f('title').textContent = t('ready.title');
  f('start').textContent = t('ready.start');
  f('change').textContent = t('ready.change');
  let poi = null;
  f('start').addEventListener('click', () => {
    const chosen = poi;
    hide();
    if (chosen) options.onStart?.(chosen);
  });
  f('change').addEventListener('click', () => {
    hide();
    options.onChange?.();
  });

  function hide() {
    el.hidden = true;
    poi = null;
  }

  return {
    el,
    get visible() {
      return !el.hidden;
    },
    /**
     * @param {{ poi: { name: string }, fromName: string, distanceM: number, viaTypes?: string[] }} info
     */
    show({ poi: chosen, fromName, distanceM, viaTypes = [] }) {
      poi = chosen;
      f('route').textContent = t('ready.route', { from: fromName, to: chosen.name });
      const minutes = Math.max(1, Math.round(distanceM / WALK_M_PER_MIN));
      let detail = t('ready.detail', { distance: formatMetres(distanceM), minutes });
      const via = [...new Set(viaTypes)]
        .filter((v) => v !== 'walk' && v !== 'door')
        .map((v) => t(`admin.wizard.section.${v}`).toLowerCase());
      if (via.length) detail += ' · ' + t('ready.via', { via: via.join(', ') });
      f('detail').textContent = detail;
      el.hidden = false;
      f('start').focus?.();
    },
    hide,
    destroy() {
      el.remove();
    },
  };
}
