#!/usr/bin/env node
/**
 * make-entrance-qr — print-ready QR codes for a venue's anchors.
 *
 * Each code opens the web app directly at the venue and marker, with no app
 * install:  https://<app>/?v=<venueId>&anchor=<anchorId>
 * The QR positioning provider recognises the same URL when scanned in-app.
 *
 * Usage:
 *   node scripts/make-entrance-qr.mjs --venue src/venues/demo-venue.json \
 *     --base https://wayfinding.example.nz/ --out out/qr [--size 512]
 *
 * Writes one SVG per anchor plus index.html, a printable sheet with the
 * venue name, the anchor id and a short instruction under each code.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import QRCode from 'qrcode';

import { assertVenue } from '../src/venues/schema.js';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split(/=(.*)/s);
    opts[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return opts;
}

/** The URL encoded into a marker. */
export function entryUrl(base, venueId, anchorId) {
  const b = base.endsWith('/') ? base : `${base}/`;
  const u = new URL(b);
  u.searchParams.set('v', venueId);
  u.searchParams.set('anchor', anchorId);
  return u.href;
}

export async function generate({ venue, base, out, size = 512 }) {
  await mkdir(out, { recursive: true });
  const files = [];
  for (const anchor of venue.anchors ?? []) {
    const url = entryUrl(base, venue.id, anchor.id);
    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 2,
      width: size,
    });
    const file = `${anchor.id}.svg`;
    await writeFile(join(out, file), svg);
    files.push({ anchor, url, file });
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(venue.name)} — entrance QR codes</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; }
  .card { page-break-after: always; display: grid; place-items: center; min-height: 100vh; text-align: center; padding: 24px; box-sizing: border-box; }
  .card img { width: min(70vw, 480px); height: auto; }
  h1 { font-size: 28px; margin: 0 0 8px; } p { font-size: 20px; margin: 4px 0; } code { font-size: 14px; color: #555; }
</style></head><body>
${files
  .map(
    (f) => `<section class="card">
  <h1>${esc(venue.name)}</h1>
  <img src="${f.file}" alt="QR code opening the wayfinding app at ${esc(f.anchor.name ?? f.anchor.id)}">
  <p>Scan with your phone camera to start wayfinding — no app to install.</p>
  <p><strong>${esc(f.anchor.name ?? f.anchor.id)}</strong></p>
  <code>${esc(f.url)}</code>
</section>`
  )
  .join('\n')}
</body></html>
`;
  await writeFile(join(out, 'index.html'), html);
  return files;
}

function esc(s) {
  return String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.venue || !opts.base || !opts.out) {
    console.error(
      'usage: make-entrance-qr --venue <venue.json> --base <https://app/> --out <dir> [--size 512]'
    );
    process.exit(2);
  }
  const venue = JSON.parse(await readFile(opts.venue, 'utf8'));
  assertVenue(venue);
  if (!(venue.anchors?.length > 0)) {
    console.error(`${opts.venue}: the venue has no anchors — add anchors[] (see docs/entry.md)`);
    process.exit(1);
  }
  const files = await generate({
    venue,
    base: opts.base,
    out: opts.out,
    size: Number(opts.size ?? 512),
  });
  for (const f of files) console.log(`${f.file}\t${f.url}`);
  console.log(`wrote ${files.length} code(s) and index.html to ${opts.out}`);
}
