/**
 * End-to-end tests for scripts/build-venue.mjs and its library.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildVenue, imageSize, parseCsv, parseHours } from '../../scripts/lib/venue-builder.mjs';
import { findRoute } from '../core/router.js';
import { createVenue } from '../core/venue.js';
import { validateVenue } from './schema.js';
import schema from './schema.json';

const CLI = resolve(process.cwd(), 'scripts/build-venue.mjs');

/** A syntactically valid PNG header (signature + IHDR) with the given size. */
function pngHeader(width, height) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13); // IHDR length
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

/** A minimal JPEG: SOI, then a SOF0 segment with the given size. */
function jpegHeader(width, height) {
  const b = new Uint8Array(2 + 2 + 2 + 5 + 4);
  const v = new DataView(b.buffer);
  b.set([0xff, 0xd8, 0xff, 0xc0], 0);
  v.setUint16(4, 11); // segment length
  b[6] = 8; // precision
  v.setUint16(7, height);
  v.setUint16(9, width);
  return b;
}

// Plan: 400 × 300 px at 0.05 m/px → 20 m × 15 m. Bottom-left is venue (0,0).
const NODES_CSV = `id,floor,x,y,z,name
n-entrance,0,0,300,,Main entrance
n-lobby,0,0,180,,Lobby
n-corridor,0,200,180,,Corridor
n-clinic,0,200,60,,Clinic
n-stairs-g,0,0,240,,Stairs
n-stairs-1,1,0,240,,Stairs up
n-office,1,200,180,,Office
`;

const EDGES_CSV = `from,to,type,distance,oneWay,stepFree,wheelchair,staffOnly,floorChange,hours,name
n-entrance,n-lobby,door,,,,,,,,Front doors
n-lobby,n-corridor,walk,,,,,,,,
n-corridor,n-clinic,door,,,,,,,,
n-lobby,n-clinic,walk,14,,,,yes,,,Staff short cut
n-lobby,n-stairs-g,walk,,,,,,,,
n-stairs-g,n-stairs-1,stairs,5,,,,,true,,Main stairs
n-stairs-1,n-office,walk,,,,,,,"08:00-18:00;1,2,3,4,5|10:00-14:00;6",Office corridor
`;

const POIS_CSV = `id,name,node,aliases,floor,category,access,description,hours
poi-clinic,Clinic,n-clinic,Physio|Rehab,0,clinic,,"Ground floor, east",
poi-office,Office,n-office,,1,staff,staff,,
`;

const ANCHORS_CSV = `id,floor,x,y,z,heading
a-entrance,0,0,280,,90
`;

const FLOORS_CSV = `index,id,name,elevation,plan
0,ground,Ground,0,ground.png
1,first,First,4,first.jpg
`;

let dir;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'build-venue-'));
  writeFileSync(join(dir, 'ground.png'), pngHeader(400, 300));
  writeFileSync(join(dir, 'first.jpg'), jpegHeader(400, 300));
  writeFileSync(join(dir, 'nodes.csv'), NODES_CSV);
  writeFileSync(join(dir, 'edges.csv'), EDGES_CSV);
  writeFileSync(join(dir, 'pois.csv'), POIS_CSV);
  writeFileSync(join(dir, 'anchors.csv'), ANCHORS_CSV);
  writeFileSync(join(dir, 'floors.csv'), FLOORS_CSV);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const run = (args, opts = {}) => {
  // A clean env: the child must not inherit vitest's NODE_OPTIONS loader hooks.
  // A clean env: vitest workers are forked with an IPC channel, and a child
  // inheriting NODE_CHANNEL_FD waits on it forever instead of exiting.
  const env = { ...process.env, NODE_OPTIONS: '', VITEST: '', VITEST_WORKER_ID: '' };
  delete env.NODE_CHANNEL_FD;
  delete env.NODE_UNIQUE_ID;
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env,
    timeout: 30_000,
    ...opts,
  });
  if (res.error) throw res.error;
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
};

describe('parseCsv', () => {
  it('parses headers, quotes, embedded commas/newlines, CRLF, BOM and comments', () => {
    const rows = parseCsv('﻿a,b\r\n1,"x, y"\r\n# comment\r\n\r\n"multi\nline","q""uote"\n');
    expect(rows).toEqual([
      { a: '1', b: 'x, y', __line: 2 },
      { a: 'multi\nline', b: 'q"uote', __line: 3 },
    ]);
  });

  it('returns [] for empty input and throws on an unterminated quote', () => {
    expect(parseCsv('')).toEqual([]);
    expect(() => parseCsv('a\n"oops')).toThrow(SyntaxError);
  });
});

describe('imageSize', () => {
  it('reads PNG and JPEG dimensions and rejects other formats', () => {
    expect(imageSize(pngHeader(640, 480))).toEqual({ width: 640, height: 480, type: 'png' });
    expect(imageSize(jpegHeader(1024, 768))).toEqual({ width: 1024, height: 768, type: 'jpeg' });
    expect(() => imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toThrow(
      /unsupported image format/
    );
  });
});

describe('parseHours', () => {
  it('parses windows, days and multiple windows', () => {
    expect(parseHours('06:00-22:00', 'x')).toEqual([{ open: '06:00', close: '22:00' }]);
    expect(parseHours('08:00-18:00;1,2,3,4,5|10:00-14:00;6', 'x')).toEqual([
      { open: '08:00', close: '18:00', days: [1, 2, 3, 4, 5] },
      { open: '10:00', close: '14:00', days: [6] },
    ]);
    expect(parseHours('', 'x')).toBeUndefined();
    expect(() => parseHours('9-5', 'edges line 3 hours')).toThrow(
      /edges line 3 hours: window 1 must be HH:MM-HH:MM/
    );
  });
});

describe('buildVenue', () => {
  const input = () => ({
    id: 'test-venue',
    name: 'Test Venue',
    floors: [
      {
        index: 0,
        id: 'ground',
        name: 'Ground',
        elevation: 0,
        plan: { image: 'ground.png', width: 400, height: 300 },
      },
      {
        index: 1,
        id: 'first',
        name: 'First',
        elevation: 4,
        plan: { image: 'first.jpg', width: 400, height: 300 },
      },
    ],
    nodes: parseCsv(NODES_CSV),
    edges: parseCsv(EDGES_CSV),
    pois: parseCsv(POIS_CSV),
    anchors: parseCsv(ANCHORS_CSV),
    units: 'px',
    metresPerPixel: 0.05,
  });

  it('converts pixels to venue metres with y flipped and z from the floor elevation', () => {
    const { venue } = buildVenue(input());
    const node = Object.fromEntries(venue.nodes.map((n) => [n.id, n]));
    expect(node['n-entrance']).toMatchObject({ x: 0, y: 0, z: 0, floor: 0, name: 'Main entrance' });
    expect(node['n-lobby']).toMatchObject({ x: 0, y: 6, z: 0 });
    expect(node['n-corridor']).toMatchObject({ x: 10, y: 6 });
    expect(node['n-clinic']).toMatchObject({ x: 10, y: 12 });
    expect(node['n-stairs-1']).toMatchObject({ x: 0, y: 3, z: 4, floor: 1 });
    expect(venue.anchors[0]).toEqual({ id: 'a-entrance', x: 0, y: 1, z: 0, floor: 0, heading: 90 });
  });

  it('computes edge distances from node coordinates, keeps explicit ones, and flags floor changes', () => {
    const { venue } = buildVenue(input());
    const edge = (from, to) => venue.edges.find((e) => e.from === from && e.to === to);
    expect(edge('n-entrance', 'n-lobby').distance).toBe(6);
    expect(edge('n-lobby', 'n-corridor').distance).toBe(10);
    expect(edge('n-lobby', 'n-clinic')).toMatchObject({
      distance: 14,
      staffOnly: true,
      name: 'Staff short cut',
    });
    expect(edge('n-stairs-g', 'n-stairs-1')).toMatchObject({
      type: 'stairs',
      distance: 5,
      floorChange: true,
    });
    expect(edge('n-stairs-1', 'n-office').hours).toEqual([
      { open: '08:00', close: '18:00', days: [1, 2, 3, 4, 5] },
      { open: '10:00', close: '14:00', days: [6] },
    ]);
    expect(edge('n-entrance', 'n-lobby').floorChange).toBeUndefined();
  });

  it('rejects an explicit distance shorter than the straight line', () => {
    const bad = input();
    bad.edges[0].distance = '1';
    expect(() => buildVenue(bad)).toThrow(
      /edges line 2: distance 1 is shorter than the straight line/
    );
  });

  it('rejects a floorChange flag that disagrees with the nodes', () => {
    const bad = input();
    bad.edges[0].floorChange = 'true';
    expect(() => buildVenue(bad)).toThrow(/edges line 2: floorChange=true disagrees/);
  });

  it('names the CSV line and column for bad input', () => {
    const bad = input();
    bad.nodes[2].x = 'far';
    expect(() => buildVenue(bad)).toThrow(/nodes line 4 x: expected a number/);
    const bad2 = input();
    bad2.edges[1].to = 'n-nowhere';
    expect(() => buildVenue(bad2)).toThrow(/edges line 3: to references unknown node "n-nowhere"/);
    const bad3 = input();
    bad3.edges[0].oneWay = 'maybe';
    expect(() => buildVenue(bad3)).toThrow(/edges line 2 oneWay: expected true\/false/);
  });

  it('builds POIs with aliases, access and description; records plans on floors', () => {
    const { venue } = buildVenue(input());
    expect(venue.pois[0]).toEqual({
      id: 'poi-clinic',
      name: 'Clinic',
      node: 'n-clinic',
      aliases: ['Physio', 'Rehab'],
      floor: 0,
      category: 'clinic',
      description: 'Ground floor, east',
    });
    expect(venue.pois[1]).toMatchObject({ access: 'staff', floor: 1 });
    expect(venue.floors[0].plan).toEqual({
      image: 'ground.png',
      widthPx: 400,
      heightPx: 300,
      metresPerPixel: 0.05,
      originPx: { x: 0, y: 300 },
    });
  });

  it('derives floors from node data when none are given, with a warning', () => {
    const noFloors = input();
    delete noFloors.floors;
    noFloors.units = 'm'; // pixel values become metres; explicit distances no longer apply
    for (const e of noFloors.edges) e.distance = '';
    const { venue, warnings } = buildVenue(noFloors);
    expect(venue.floors.map((f) => f.index)).toEqual([0, 1]);
    expect(warnings[0]).toMatch(/derived 2 floor\(s\)/);
  });

  it('requires a scale and a plan for pixel units', () => {
    const noScale = input();
    delete noScale.metresPerPixel;
    expect(() => buildVenue(noScale)).toThrow(/pixel units need metresPerPixel/);
    const noPlan = input();
    delete noPlan.floors[0].plan;
    expect(() => buildVenue(noPlan)).toThrow(/pixel units need a floor plan image for floor 0/);
  });

  it('produces a venue that validates and routes', () => {
    const { venue } = buildVenue(input());
    expect(validateVenue(venue)).toEqual([]);
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(venue), JSON.stringify(validate.errors)).toBe(true);

    const v = createVenue(venue);
    const visitor = findRoute(v.graph, 'n-entrance', 'n-clinic');
    expect(visitor.path).toEqual(['n-entrance', 'n-lobby', 'n-corridor', 'n-clinic']);
    expect(visitor.distance).toBe(22);
    const staff = findRoute(v.graph, 'n-entrance', 'n-clinic', { accessLevel: 'staff' });
    expect(staff.distance).toBe(20);
    expect(
      findRoute(v.graph, 'n-entrance', 'n-office', { timeOfDay: new Date(2026, 8, 20, 12) }).found
    ).toBe(false); // Sunday
    expect(
      findRoute(v.graph, 'n-entrance', 'n-office', { timeOfDay: new Date(2026, 8, 21, 12) }).found
    ).toBe(true); // Monday
  });
});

describe('build-venue.mjs CLI', () => {
  it('--validate accepts the demo venue and rejects a broken file', () => {
    const ok = run(['--validate', resolve('src/venues/demo-venue.json')]);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/valid — 2 floor\(s\), 16 nodes/);

    const broken = join(dir, 'broken.json');
    writeFileSync(
      broken,
      JSON.stringify({
        schemaVersion: 1,
        id: 'x',
        name: 'X',
        floors: [],
        nodes: [],
        edges: [],
        pois: [],
      })
    );
    const bad = run(['--validate', broken]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/Invalid venue JSON/);
    expect(bad.stderr).toMatch(/floors: must have at least 1 item/);
    expect(bad.stderr).toMatch(/does not match schema\.json/);

    writeFileSync(broken, '{ not json');
    expect(run(['--validate', broken])).toMatchObject({ code: 1 });
  });

  it('builds a venue from plan + CSVs and writes valid JSON', () => {
    const out = join(dir, 'venue.json');
    const res = run(
      [
        '--id',
        'cli-venue',
        '--name',
        'CLI Venue',
        '--description',
        'built by test',
        '--heading-offset',
        '12.5',
        '--scale',
        '0.05',
        '--floors',
        join(dir, 'floors.csv'),
        '--nodes',
        join(dir, 'nodes.csv'),
        '--edges',
        join(dir, 'edges.csv'),
        '--pois',
        join(dir, 'pois.csv'),
        '--anchors',
        join(dir, 'anchors.csv'),
        '--out',
        out,
      ],
      { cwd: dir }
    );
    expect(res.code, res.stderr).toBe(0);
    expect(res.stderr).toMatch(/wrote .*venue\.json: 2 floor\(s\), 7 nodes, 7 edges, 2 POIs/);

    const check = run(['--validate', out]);
    expect(check.code, check.stderr).toBe(0);

    const venue = createVenue(JSON.parse(readFileSync(out, 'utf8')));
    expect(venue.id).toBe('cli-venue');
    expect(venue.headingOffsetDeg).toBe(12.5);
    expect(venue.floors[1].plan.image).toBe('first.jpg');
    expect(venue.nodeById('n-clinic')).toMatchObject({ x: 10, y: 12 });
  });

  it('writes to stdout without --out, and --plan applies to floor 0', () => {
    const res = run(
      [
        '--id',
        'v',
        '--name',
        'V',
        '--scale',
        '0.05',
        '--plan',
        join(dir, 'ground.png'),
        '--nodes',
        join(dir, 'nodes.csv'),
        '--edges',
        join(dir, 'edges.csv'),
        '--quiet',
      ],
      { cwd: dir }
    );
    // Floors come from the plans given, so floor 1 is undefined → error names it.
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/floor 1 is not defined/);

    const res2 = run(
      [
        '--id',
        'v',
        '--name',
        'V',
        '--scale',
        '0.05',
        '--plan',
        join(dir, 'ground.png'),
        '--plan',
        `1=${join(dir, 'first.jpg')}`,
        '--nodes',
        join(dir, 'nodes.csv'),
        '--edges',
        join(dir, 'edges.csv'),
        '--quiet',
      ],
      { cwd: dir }
    );
    expect(res2.code, res2.stderr).toBe(0);
    const json = JSON.parse(res2.stdout);
    expect(json.floors.map((f) => f.id)).toEqual(['floor-0', 'floor-1']);
    expect(validateVenue(json)).toEqual([]);
  });

  it('reports usage errors with exit code 2 and prints help', () => {
    const res = run(['--nodes', 'x.csv']);
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/--id and --name are required/);
    expect(res.stderr).toMatch(/Usage:/);
    const help = run(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/--validate <file>/);
  });
});
