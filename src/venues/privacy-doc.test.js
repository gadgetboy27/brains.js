import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { END, START, renderProviderTables, replaceTables } from '../../scripts/privacy-table.mjs';
import { ImmersalProvider } from '../providers/immersal.js';
import { QrProvider } from '../providers/qr.js';

const doc = readFileSync(resolve(process.cwd(), 'docs/PRIVACY.md'), 'utf8');

describe('docs/PRIVACY.md', () => {
  it('contains the provider tables exactly as generated from the uploads declarations', () => {
    expect(doc).toContain(START);
    expect(doc).toContain(END);
    expect(replaceTables(doc)).toBe(doc); // run `node scripts/privacy-table.mjs --write` if this fails
  });

  it('names every destination each provider declares', () => {
    for (const Class of [ImmersalProvider, QrProvider]) {
      for (const u of Class.uploads) {
        expect(doc, u.destination).toContain(u.destination.replace(/\|/g, '\\|'));
        expect(doc, u.data).toContain(u.data.split('(')[0].trim());
      }
    }
    expect(doc).toContain('Nothing leaves the phone');
  });

  it('states the never-collected list and the on-device default', () => {
    for (const phrase of [
      'No GPS',
      'No accounts',
      'Health information',
      'sets no cookies',
      'Use the floor plan only',
    ]) {
      expect(doc).toContain(phrase);
    }
    expect(renderProviderTables()).toContain('51Degrees');
  });
});
