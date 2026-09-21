/**
 * Survey plan — the list of printed codes a venue intends to mount, so a
 * sticker survey can pre-fill the area name and floor when each code is
 * scanned. Pasted or loaded from a text file: one code per line,
 * `code, floor, mounted where`, e.g. `A03, G, Reception desk`.
 *
 * Floor letters: G = 0, B = -1 (B2 = -2), M = mezzanine is not assumed —
 * write its number. Anything else must be a number.
 */

import DEMO_HOSPITAL_PLAN from './templates/demo-hospital-survey-plan.txt?raw';

/** The demo hospital's list (A01–A24), offered in the admin panel as a starting point. */
export { DEMO_HOSPITAL_PLAN };

/** @typedef {{ code: string, floor: number, floorLabel: string, name: string }} SurveyPlanRow */

export function parseFloorLabel(label) {
  const v = String(label ?? '')
    .trim()
    .toUpperCase();
  if (v === 'G' || v === 'GF' || v === 'GROUND') return 0;
  const b = /^B(\d*)$/.exec(v);
  if (b) return -Number(b[1] || 1);
  const l = /^(?:L|LEVEL\s*)?(-?\d+)$/.exec(v);
  if (l) return Number(l[1]);
  return null;
}

/**
 * @param {string} text
 * @returns {{ rows: SurveyPlanRow[], errors: string[] }}
 */
export function parseSurveyPlan(text) {
  const rows = [];
  const errors = [];
  const seen = new Set();
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const parts = trimmed.split(/\s*[,\t]\s*/);
      const [code, floorLabel, ...rest] = parts;
      if (!code || parts.length < 3) {
        errors.push(`line ${i + 1}: expected "code, floor, where"`);
        return;
      }
      const floor = parseFloorLabel(floorLabel);
      if (floor === null) {
        errors.push(`line ${i + 1}: unknown floor "${floorLabel}" (use G, B, or a number)`);
        return;
      }
      if (seen.has(code)) {
        errors.push(`line ${i + 1}: code ${code} listed twice`);
        return;
      }
      seen.add(code);
      rows.push({ code, floor, floorLabel: floorLabel.trim(), name: rest.join(', ').trim() });
    });
  return { rows, errors };
}

/** The distinct floors a plan mentions, as venue floor definitions (index, id, name). */
export function floorsFromPlan(rows) {
  const byIndex = new Map();
  for (const r of rows) {
    if (!byIndex.has(r.floor)) {
      const name =
        r.floor === 0 ? 'Ground' : r.floor < 0 ? `Basement ${-r.floor}` : `Level ${r.floor}`;
      const id = r.floor === 0 ? 'ground' : r.floor < 0 ? `b${-r.floor}` : `l${r.floor}`;
      byIndex.set(r.floor, { index: r.floor, id, name, elevation: r.floor * 4 });
    }
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/**
 * Find a plan row for a scanned code. Matches the exact text, or a code that
 * appears as a whole token inside it (a printed URL like ".../A03").
 */
export function findPlanRow(rows, text) {
  const t = String(text ?? '').trim();
  return (
    rows.find((r) => r.code === t) ??
    rows.find((r) =>
      new RegExp(
        `(^|[^A-Za-z0-9])${r.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9]|$)`
      ).test(t)
    ) ??
    null
  );
}
