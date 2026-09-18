#!/usr/bin/env node
/**
 * accuracy-harness — analyse a recorded test walk, or simulate one.
 *
 *   node scripts/accuracy-harness.mjs report <log.json> [--json] [--good 0.5] [--timeout 20000] [--max-age 3000]
 *   node scripts/accuracy-harness.mjs simulate [--venue src/venues/demo-venue.json] [--drift 0.05]
 *        [--fix-interval 2000] [--lost 2] [--out log.json] [--seed 1]
 *
 * `report` prints the mean / worst position error at checkpoints, fix
 * latency and the failed-fix rate from a log saved by the in-app harness
 * (`?harness=1` → Download log).
 *
 * `simulate` walks the demo venue's route graph with the mock provider —
 * drift, periodic fixes and a few "lost" spells — pressing a checkpoint at
 * every named node, then reports on it. Use it to sanity-check the pipeline
 * and to see what the numbers look like before a real walk.
 */

import { readFile, writeFile } from 'node:fs/promises';

import { analyseLog, createRecorder, formatReport } from '../src/core/accuracy.js';
import { createVenue } from '../src/core/venue.js';
import { MockProvider } from '../src/providers/mock.js';

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      opts[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    } else positional.push(a);
  }
  return { opts, positional };
}

/** Deterministic PRNG so simulations are reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulate a walk. Time is virtual: the mock's timers are driven by hand.
 * @returns {Promise<{ log: object, report: object }>}
 */
export async function simulate({
  venue,
  driftRateMps = 0.05,
  fixIntervalMs = 2000,
  lostSpells = 2,
  seed = 1,
  speedMps = 1.2,
} = {}) {
  const random = mulberry32(seed);
  const path = venue.graph.nodes.map(({ x, y, z, floor, id, name }) => ({
    x,
    y,
    z,
    floor,
    id,
    name,
  }));
  let now = 1_000_000;
  const timers = new Map();
  let nextTimer = 1;
  const provider = new MockProvider({
    path,
    speedMps,
    fixIntervalMs,
    driftRateMps,
    random,
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const rec = createRecorder({ now: () => now, venueId: venue.id, provider: 'mock' });
  provider.onPose((p) => rec.pose(p));
  rec.fixRequest('start');
  await provider.start();

  // Advance virtual time, firing timers in order.
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };

  // Walk the whole path, pressing a checkpoint each time the true position reaches a named node.
  const total = provider.pathLength;
  const stepMs = 250;
  let lostAt = new Set();
  for (let i = 1; i <= lostSpells; i += 1) lostAt.add(Math.round((total * i) / (lostSpells + 1)));
  let nextNode = 1;
  let lostUntil = null;
  while (provider.distanceAlongPath < total - 1e-6) {
    advance(stepMs);
    const along = provider.distanceAlongPath;
    // Lost spells: the provider stops fixing for 8 s, then recovers (a rescan).
    for (const at of lostAt) {
      if (along >= at) {
        lostAt.delete(at);
        provider.forceLost();
        rec.status('lost');
        lostUntil = now + 8000;
      }
    }
    if (lostUntil !== null && now >= lostUntil) {
      lostUntil = null;
      rec.fixRequest('rescan');
      provider.recover();
    }
    // Checkpoint when passing a named node.
    const cum = cumulative(path);
    while (nextNode < path.length && along >= cum[nextNode] - 1e-6) {
      const n = path[nextNode];
      if (n.name)
        rec.checkpoint({
          id: `node:${n.id}`,
          x: n.x,
          y: n.y,
          z: n.z,
          floor: n.floor,
          note: n.name,
        });
      nextNode += 1;
    }
  }
  await provider.stop();
  const log = rec.toJSON();
  return { log, report: analyseLog(log) };
}

function cumulative(points) {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    out.push(out[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0)));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { opts, positional } = parseArgs(process.argv.slice(2));
  const [cmd, file] = positional;
  try {
    if (cmd === 'report') {
      if (!file) throw new Error('report needs a log file');
      const log = JSON.parse(await readFile(file, 'utf8'));
      const report = analyseLog(log, {
        goodConfidence: opts.good !== undefined ? Number(opts.good) : undefined,
        fixTimeoutMs: opts.timeout !== undefined ? Number(opts.timeout) : undefined,
        maxPoseAgeMs: opts['max-age'] !== undefined ? Number(opts['max-age']) : undefined,
      });
      console.log(opts.json ? JSON.stringify(report, null, 2) : formatReport(report));
    } else if (cmd === 'simulate') {
      const venueFile = opts.venue ?? new URL('../src/venues/demo-venue.json', import.meta.url);
      const venue = createVenue(JSON.parse(await readFile(venueFile, 'utf8')));
      const { log, report } = await simulate({
        venue,
        driftRateMps: opts.drift !== undefined ? Number(opts.drift) : undefined,
        fixIntervalMs:
          opts['fix-interval'] !== undefined ? Number(opts['fix-interval']) : undefined,
        lostSpells: opts.lost !== undefined ? Number(opts.lost) : undefined,
        seed: opts.seed !== undefined ? Number(opts.seed) : undefined,
      });
      if (opts.out) {
        await writeFile(opts.out, JSON.stringify(log, null, 2));
        console.error(`wrote ${opts.out} (${log.events.length} events)`);
      }
      console.log(opts.json ? JSON.stringify(report, null, 2) : formatReport(report));
    } else {
      console.error(
        'usage: accuracy-harness report <log.json> [--json] | simulate [--venue f] [--drift m/s] [--out f]'
      );
      process.exit(2);
    }
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
