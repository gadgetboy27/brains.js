#!/usr/bin/env node
/**
 * privacy-table — render the "what leaves the device" tables in
 * docs/PRIVACY.md from each positioning provider's static `uploads`
 * declaration, so the privacy notice cannot drift from the code.
 *
 *   node scripts/privacy-table.mjs          # print the tables
 *   node scripts/privacy-table.mjs --write  # update docs/PRIVACY.md in place
 *
 * The tables are written between the markers
 *   <!-- providers:start --> … <!-- providers:end -->
 * A test checks the file matches what this script renders.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { ImmersalProvider } from '../src/providers/immersal.js';
import { MockProvider } from '../src/providers/mock.js';
import { QrProvider } from '../src/providers/qr.js';

const PROVIDERS = [
  {
    name: 'QR markers',
    key: 'qr',
    Class: QrProvider,
    note: 'Reads printed codes with the camera and decodes them on the phone.',
  },
  {
    name: 'Immersal visual positioning',
    key: 'immersal',
    Class: ImmersalProvider,
    note: 'Recognises the venue from camera frames using a scanned map. Only present at venues that have chosen it.',
  },
  {
    name: 'Mock (development only)',
    key: 'mock',
    Class: MockProvider,
    note: 'Simulated positions; never enabled for visitors.',
  },
];

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderProviderTables() {
  const parts = [];
  for (const p of PROVIDERS) {
    const uploads = p.Class.uploads ?? [];
    parts.push(`### ${p.name}`, '', p.note, '');
    if (uploads.length === 0) {
      parts.push('**Nothing leaves the phone.** All processing happens on the device.', '');
      continue;
    }
    parts.push('| What is sent | Where it goes | Why | Kept for |', '|---|---|---|---|');
    for (const u of uploads) {
      parts.push(
        `| ${esc(u.data)} | ${esc(u.destination)} | ${esc(u.purpose)} | ${esc(u.retention ?? 'Not stated by the recipient; not controlled by this app.')} |`
      );
    }
    parts.push('');
  }
  return parts.join('\n').trimEnd();
}

export const START = '<!-- providers:start -->';
export const END = '<!-- providers:end -->';

export function replaceTables(markdown, tables = renderProviderTables()) {
  const i = markdown.indexOf(START);
  const j = markdown.indexOf(END);
  if (i < 0 || j < 0 || j < i) throw new Error('docs/PRIVACY.md is missing the providers markers');
  return `${markdown.slice(0, i + START.length)}\n\n${tables}\n\n${markdown.slice(j)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = fileURLToPath(new URL('../docs/PRIVACY.md', import.meta.url));
  if (process.argv.includes('--write')) {
    const current = await readFile(file, 'utf8');
    const next = replaceTables(current);
    if (next !== current) {
      await writeFile(file, next);
      console.error('updated docs/PRIVACY.md');
    } else console.error('docs/PRIVACY.md already up to date');
  } else {
    console.log(renderProviderTables());
  }
}
