import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { entryUrl, generate } from '../../scripts/make-entrance-qr.mjs';
import { parseQrPayload } from '../providers/qr.js';
import demo from './demo-venue.json';

const dir = mkdtempSync(join(tmpdir(), 'qr-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('make-entrance-qr', () => {
  it('builds entry URLs the app and the QR provider both understand', () => {
    const url = entryUrl('https://wayfinding.example.nz', 'demo-health-centre', 'a-entrance');
    expect(url).toBe('https://wayfinding.example.nz/?v=demo-health-centre&anchor=a-entrance');
    expect(parseQrPayload(url)).toEqual({ venueId: 'demo-health-centre', anchorId: 'a-entrance' });
  });

  it('writes one SVG per anchor and a print sheet', async () => {
    const files = await generate({ venue: demo, base: 'https://x.test/', out: dir, size: 256 });
    expect(files.map((f) => f.file)).toEqual(['a-entrance.svg', 'a-lift-g.svg', 'a-lift-1.svg']);
    const names = readdirSync(dir).sort();
    expect(names).toEqual(['a-entrance.svg', 'a-lift-1.svg', 'a-lift-g.svg', 'index.html']);
    const svg = readFileSync(join(dir, 'a-entrance.svg'), 'utf8');
    expect(svg).toMatch(/^<svg/);
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(html).toContain('Demo Health Centre');
    expect(html).toContain('https://x.test/?v=demo-health-centre&amp;anchor=a-lift-1');
    expect(html.match(/<section class="card">/g)).toHaveLength(3);
  });
});
