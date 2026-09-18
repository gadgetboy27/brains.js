#!/usr/bin/env node
/**
 * build-venue — turn a floor plan + CSV tables into valid venue JSON, or
 * validate an existing venue file.
 *
 * Usage:
 *
 *   node scripts/build-venue.mjs \
 *     --id demo --name "Demo Centre" \
 *     --plan ground.png [--plan 1=first.png …] --scale 0.05 \
 *     --nodes nodes.csv --edges edges.csv [--pois pois.csv] [--anchors anchors.csv] \
 *     [--floors floors.csv] [--units px|m] [--origin-px x,y] [--heading-offset 12.5] \
 *     [--description "…"] [--out venue.json]
 *
 *   node scripts/build-venue.mjs --validate venue.json
 *
 * Options:
 *   --plan <file> | --plan <floorIndex>=<file>
 *                     Floor-plan image (PNG or JPEG). A bare file applies to floor 0.
 *                     Only the header is read (for pixel size); the image is not copied.
 *   --scale <m>       Metres per pixel of the plan(s). Required with pixel units.
 *   --units px|m      Coordinate units in nodes/anchors CSVs. Default px.
 *   --origin-px x,y   Pixel that becomes venue (0,0). Default: bottom-left of the plan.
 *   --floors <csv>    Columns: index,id,name[,elevation][,plan][,scale]. Optional; otherwise
 *                     floors are derived from the node data with generic names.
 *   --nodes <csv>     Columns: id,floor,x,y[,z][,name]
 *   --edges <csv>     Columns: from,to[,type][,distance][,oneWay][,stepFree][,wheelchair]
 *                     [,staffOnly][,floorChange][,hours][,name]
 *                     distance is computed from node coordinates when blank.
 *                     hours: HH:MM-HH:MM[;days]  windows separated by |, e.g.
 *                     "06:00-22:00" or "08:00-18:00;1,2,3,4,5|10:00-16:00;6"
 *   --pois <csv>      Columns: id,name,node[,aliases (| separated)][,floor][,category]
 *                     [,access][,description][,hours]
 *   --anchors <csv>   Columns: id,floor,x,y[,z][,heading]
 *   --out <file>      Output path. Default: stdout.
 *   --validate <file> Validate an existing venue JSON against the schema and exit.
 *   --quiet           Suppress warnings.
 *   -h, --help        This text.
 *
 * Exit codes: 0 ok, 1 invalid input or validation failure, 2 usage error.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertVenue, VenueValidationError } from '../src/venues/schema.js';
import { buildVenue, imageSize, parseCsv } from './lib/venue-builder.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(here, '../src/venues/schema.json');

// -------------------------------------------------------------------- args

function parseArgs(argv) {
  const opts = { plan: [] };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    let [key, value] = arg.slice(2).split(/=(.*)/s);
    if (value === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i += 1;
      } else {
        value = true;
      }
    }
    if (key === 'plan') opts.plan.push(value);
    else opts[key] = value;
  }
  return { opts, positional };
}

function usage(stream = process.stderr) {
  const text = /\/\*\*([\s\S]*?)\*\//
    .exec(HELP_SOURCE)[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim();
  stream.write(`${text}\n`);
}
const HELP_SOURCE = await readFile(fileURLToPath(import.meta.url), 'utf8');

// -------------------------------------------------------------- validate

async function validateFile(file) {
  const text = await readFile(file, 'utf8');
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    console.error(`${file}: not valid JSON — ${err.message}`);
    return 1;
  }
  let ok = true;
  try {
    assertVenue(json);
  } catch (err) {
    if (!(err instanceof VenueValidationError)) throw err;
    ok = false;
    console.error(`${file}: ${err.message}`);
  }
  // Full JSON Schema check as well, when ajv is available (it is a dev dependency).
  try {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    if (!validate(json)) {
      ok = false;
      console.error(`${file}: does not match schema.json:`);
      for (const e of validate.errors) console.error(`  - ${e.instancePath || '/'}: ${e.message}`);
    }
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    console.error('(ajv not installed; JSON Schema check skipped — run npm install)');
  }
  if (ok) {
    console.log(
      `${file}: valid — ${json.floors.length} floor(s), ${json.nodes.length} nodes, ${json.edges.length} edges, ${json.pois.length} POIs${json.anchors ? `, ${json.anchors.length} anchors` : ''}`
    );
  }
  return ok ? 0 : 1;
}

// ------------------------------------------------------------------ build

async function readCsv(file, what) {
  if (!file) return [];
  try {
    return parseCsv(await readFile(file, 'utf8'));
  } catch (err) {
    throw new Error(`${what} (${file}): ${err.message}`, { cause: err });
  }
}

async function readPlan(file) {
  const bytes = await readFile(file);
  const size = imageSize(bytes);
  return { image: basename(file), width: size.width, height: size.height };
}

async function build(opts) {
  if (!opts.id || !opts.name) throw new UsageError('--id and --name are required');
  if (!opts.nodes || !opts.edges) throw new UsageError('--nodes and --edges are required');

  const units = opts.units ?? 'px';
  const metresPerPixel = opts.scale !== undefined ? Number(opts.scale) : undefined;
  if (units === 'px' && !(metresPerPixel > 0)) {
    throw new UsageError(
      '--scale <metres per pixel> is required with pixel units (or use --units m)'
    );
  }

  // Plans: "--plan file" → floor 0; "--plan 2=file" → floor 2.
  const plans = new Map();
  for (const spec of opts.plan) {
    const m = /^(-?\d+)=(.+)$/.exec(spec);
    const index = m ? Number(m[1]) : 0;
    const file = m ? m[2] : spec;
    plans.set(index, await readPlan(file));
  }
  let originPx;
  if (opts['origin-px']) {
    const [x, y] = String(opts['origin-px']).split(',').map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new UsageError('--origin-px must be x,y');
    originPx = { x, y };
  }

  // Floors: from CSV, else from plans, else derived later from nodes.
  let floors;
  const floorRows = await readCsv(opts.floors, 'floors CSV');
  if (floorRows.length > 0) {
    floors = [];
    for (const row of floorRows) {
      const index = Number(row.index);
      const floor = { index, id: row.id, name: row.name };
      if (row.elevation) floor.elevation = Number(row.elevation);
      if (row.plan) plans.set(index, await readPlan(resolve(dirname(opts.floors), row.plan)));
      floors.push(floor);
    }
  } else if (plans.size > 0) {
    floors = [...plans.keys()]
      .sort((a, b) => a - b)
      .map((index) => ({ index, id: `floor-${index}`, name: `Floor ${index}` }));
  }
  if (floors) {
    for (const floor of floors) {
      const plan = plans.get(floor.index);
      if (plan) floor.plan = { ...plan, originPx };
    }
  }

  const { venue, warnings } = buildVenue({
    id: opts.id,
    name: opts.name,
    description: opts.description,
    headingOffsetDeg:
      opts['heading-offset'] !== undefined ? Number(opts['heading-offset']) : undefined,
    floors,
    nodes: await readCsv(opts.nodes, 'nodes CSV'),
    edges: await readCsv(opts.edges, 'edges CSV'),
    pois: await readCsv(opts.pois, 'POIs CSV'),
    anchors: await readCsv(opts.anchors, 'anchors CSV'),
    units,
    metresPerPixel,
  });

  if (!opts.quiet) for (const w of warnings) console.error(`warning: ${w}`);

  assertVenue(venue); // throws VenueValidationError with every problem named

  const text = `${JSON.stringify(venue, null, 2)}\n`;
  if (opts.out) {
    await writeFile(opts.out, text);
    console.error(
      `wrote ${opts.out}: ${venue.floors.length} floor(s), ${venue.nodes.length} nodes, ${venue.edges.length} edges, ${venue.pois.length} POIs`
    );
  } else {
    process.stdout.write(text);
  }
  return 0;
}

class UsageError extends Error {}

// ------------------------------------------------------------------- main

const { opts } = parseArgs(process.argv.slice(2));
try {
  if (opts.help) {
    usage(process.stdout);
    process.exit(0);
  }
  if (opts.validate) {
    process.exit(await validateFile(String(opts.validate)));
  }
  process.exit(await build(opts));
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`error: ${err.message}\n`);
    usage();
    process.exit(2);
  }
  console.error(err instanceof VenueValidationError ? err.message : `error: ${err.message}`);
  process.exit(1);
}
