#!/usr/bin/env node
/**
 * compare-positioning — which positioning strategy drifts least?
 *
 *   node scripts/compare-positioning.mjs [--venue file] [--routes a:b,c:d] [--runs 40] [--seed 1] [--json]
 *        [--stride-error 0.08] [--compass-bias 5] [--compass-noise 6] [--disturbance 25]
 *        [--glitches 2] [--gyro-bias 0.4] [--gyro-noise 1.5]
 *
 * Simulates walks along routes of the venue with only one QR scan, at the
 * start, and runs compass-only, gyro-blended and corner-fix strategies over
 * identical footsteps and sensor noise. See src/core/pdr-sim.js for the
 * model and docs/accuracy.md for how to read it.
 */

import { readFile } from 'node:fs/promises';

import { compareVariants, formatComparison } from '../src/core/pdr-sim.js';
import { createVenue } from '../src/core/venue.js';

const DEFAULT_ROUTES = [
  ['n-entrance', 'n-clinic-a'],
  ['n-entrance', 'n-lift-g'],
  ['n-clinic-a', 'n-toilets-g'],
];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const [k, v] = argv[i].slice(2).split(/=(.*)/s);
    opts[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return opts;
}

const num = (v) => (v === undefined ? undefined : Number(v));

try {
  const opts = parseArgs(process.argv.slice(2));
  const venueFile = opts.venue ?? new URL('../src/venues/demo-venue.json', import.meta.url);
  const venue = createVenue(JSON.parse(await readFile(venueFile, 'utf8')));
  const routes = opts.routes
    ? String(opts.routes)
        .split(',')
        .map((r) => r.split(':'))
    : DEFAULT_ROUTES;
  const scenario = Object.fromEntries(
    Object.entries({
      strideError: num(opts['stride-error']),
      compassBiasDeg: num(opts['compass-bias']),
      compassNoiseDeg: num(opts['compass-noise']),
      disturbanceDeg: num(opts.disturbance),
      burstsPerWalk: num(opts.glitches),
      gyroBiasDps: num(opts['gyro-bias']),
      gyroNoiseDps: num(opts['gyro-noise']),
    }).filter(([, v]) => v !== undefined)
  );
  const result = compareVariants({
    venue,
    routes,
    runs: num(opts.runs) ?? 40,
    seed: num(opts.seed) ?? 1,
    scenario,
  });
  console.log(opts.json ? JSON.stringify(result, null, 2) : formatComparison(result));
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exit(1);
}
