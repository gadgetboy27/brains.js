import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { simulate } from '../../scripts/accuracy-harness.mjs';
import { createVenue } from './venue.js';
import demo from '../venues/demo-venue.json';

const CLI = resolve(process.cwd(), 'scripts/accuracy-harness.mjs');
const dir = mkdtempSync(join(tmpdir(), 'acc-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (args) => {
  // A clean env: vitest workers are forked with an IPC channel, and a child
  // inheriting NODE_CHANNEL_FD waits on it forever instead of exiting.
  const env = { ...process.env, NODE_OPTIONS: '', VITEST: '', VITEST_WORKER_ID: '' };
  delete env.NODE_CHANNEL_FD;
  delete env.NODE_UNIQUE_ID;
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env,
    timeout: 60_000,
  });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
};

describe('accuracy-harness simulate', () => {
  it('is deterministic for a seed and reflects drift in the error', async () => {
    const venue = createVenue(structuredClone(demo));
    const a = await simulate({ venue, driftRateMps: 0, lostSpells: 0, seed: 3 });
    const b = await simulate({ venue, driftRateMps: 0.2, lostSpells: 2, seed: 3 });
    const b2 = await simulate({ venue, driftRateMps: 0.2, lostSpells: 2, seed: 3 });
    expect(a.report.position.checkpoints).toBe(15); // every named node on the walk
    expect(a.report.position.meanErrorM).toBeLessThan(2); // no drift: only fix-interval lag (≤ 2 s × 1.2 m/s)
    expect(b.report.position.meanErrorM).toBeGreaterThan(a.report.position.meanErrorM);
    expect(b.report.fixes.requests).toBe(3); // start + 2 rescans
    expect(b.report).toEqual(b2.report);
  });
});

describe('accuracy-harness CLI', () => {
  it('simulate writes a log and report reads it back', () => {
    const out = join(dir, 'walk.json');
    const sim = run(['simulate', '--drift', '0.1', '--out', out, '--seed', '7']);
    expect(sim.code, sim.stderr).toBe(0);
    expect(sim.stdout).toContain('# Positioning accuracy report');
    expect(sim.stderr).toMatch(/wrote .*walk\.json/);

    const rep = run(['report', out, '--json']);
    expect(rep.code, rep.stderr).toBe(0);
    const json = JSON.parse(rep.stdout);
    expect(json.position.checkpoints).toBe(15);
    expect(json.fixes.requests).toBe(3);

    const md = run(['report', out, '--timeout', '1']);
    expect(md.stdout).toMatch(/Failed rate/);
    expect(run(['report']).code).toBe(1);
    expect(run([]).code).toBe(2);
  });
});
