/**
 * Pure building blocks for scripts/build-venue.mjs — kept dependency-free and
 * side-effect-free so they can be unit-tested.
 *
 * Input conventions (see scripts/build-venue.mjs --help for the CSV columns):
 *
 *  - Node/anchor coordinates are given either in floor-plan image pixels
 *    (`units: 'px'`, the default) or directly in metres (`units: 'm'`).
 *  - Pixel coordinates follow image convention (origin top-left, y down).
 *    They are converted to the venue frame (y up) with
 *        x_m = (px - originPx.x) * metresPerPixel
 *        y_m = (originPx.y - py) * metresPerPixel
 *    where `originPx` defaults to the image's bottom-left corner, so the
 *    plan's bottom-left is venue (0, 0) and "up" on the plan is venue +y.
 *  - Edge distances are computed from node coordinates (including height)
 *    unless the CSV supplies one; a supplied distance shorter than the
 *    straight line is an error because it would break route optimality.
 */

import { metresBetween } from '../../src/core/distance.js';

// ------------------------------------------------------------------- CSV

/**
 * Minimal RFC 4180 CSV parser: quoted fields, doubled quotes, CRLF/LF.
 * Returns one object per data row keyed by the (trimmed) header names.
 * Blank lines and lines starting with `#` are skipped.
 *
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text).replace(/^﻿/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  if (inQuotes) throw new SyntaxError('CSV: unterminated quoted field');

  const meaningful = rows.filter(
    (r) => !(r.length === 1 && r[0].trim() === '') && !r[0].startsWith('#')
  );
  if (meaningful.length === 0) return [];
  const header = meaningful[0].map((h) => h.trim());
  return meaningful.slice(1).map((r, i) => {
    const obj = {};
    header.forEach((key, j) => {
      obj[key] = (r[j] ?? '').trim();
    });
    obj.__line = i + 2;
    return obj;
  });
}

// ----------------------------------------------------------------- image

/**
 * Read the pixel dimensions of a PNG or JPEG from its header bytes.
 *
 * @param {Uint8Array | Buffer} bytes
 * @returns {{ width: number, height: number, type: 'png' | 'jpeg' }}
 */
export function imageSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

  // PNG: 8-byte signature, then IHDR chunk with width/height at 16..24.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20), type: 'png' };
  }

  // JPEG: scan segments for a SOFn marker carrying the frame size.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const length = view.getUint16(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) {
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5), type: 'jpeg' };
      }
      i += 2 + length;
    }
    throw new Error('JPEG: no frame header found');
  }

  throw new Error('unsupported image format (expected PNG or JPEG)');
}

// --------------------------------------------------------------- helpers

const TRUE = new Set(['true', 'yes', 'y', '1']);
const FALSE = new Set(['false', 'no', 'n', '0', '']);

function bool(value, where) {
  const v = String(value ?? '')
    .trim()
    .toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  throw new TypeError(`${where}: expected true/false, got ${JSON.stringify(value)}`);
}

function num(value, where, { required = true, integer = false } = {}) {
  const v = String(value ?? '').trim();
  if (v === '') {
    if (required) throw new TypeError(`${where}: is required`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n))
    throw new TypeError(`${where}: expected a number, got ${JSON.stringify(value)}`);
  if (integer && !Number.isInteger(n))
    throw new TypeError(`${where}: expected an integer, got ${v}`);
  return n;
}

function str(value, where, { required = true } = {}) {
  const v = String(value ?? '').trim();
  if (v === '') {
    if (required) throw new TypeError(`${where}: is required`);
    return undefined;
  }
  return v;
}

/**
 * Parse `HH:MM-HH:MM[;d,d,…]` windows separated by `|` into schema hours.
 * @param {string} value
 * @param {string} where
 */
export function parseHours(value, where) {
  const v = String(value ?? '').trim();
  if (v === '') return undefined;
  return v.split('|').map((win, i) => {
    const [range, days] = win.split(';').map((s) => s.trim());
    const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(range ?? '');
    if (!m)
      throw new TypeError(
        `${where}: window ${i + 1} must be HH:MM-HH:MM, got ${JSON.stringify(win)}`
      );
    const out = { open: m[1], close: m[2] };
    if (days) {
      out.days = days
        .split(',')
        .map((d) => num(d, `${where}: window ${i + 1} days`, { integer: true }));
    }
    return out;
  });
}

function round(n, dp = 3) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ----------------------------------------------------------------- build

/**
 * @typedef {Object} FloorInput
 * @property {number} index
 * @property {string} id
 * @property {string} name
 * @property {number} [elevation]
 * @property {{ image?: string, width: number, height: number, metresPerPixel?: number, originPx?: { x: number, y: number } }} [plan]
 */

/**
 * @typedef {Object} BuildInput
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {number} [headingOffsetDeg]
 * @property {FloorInput[]} [floors]      If omitted, derived from the node floor indices.
 * @property {Array<Record<string,string>>} nodes
 * @property {Array<Record<string,string>>} edges
 * @property {Array<Record<string,string>>} [pois]
 * @property {Array<Record<string,string>>} [anchors]
 * @property {'px' | 'm'} [units='px']
 * @property {number} [metresPerPixel]   Required for px units unless every floor plan has one.
 * @property {object} [providers]
 */

/**
 * Build a venue JSON object from parsed CSV rows.
 *
 * @param {BuildInput} input
 * @returns {{ venue: object, warnings: string[] }}
 */
export function buildVenue(input) {
  const warnings = [];
  const units = input.units ?? 'px';
  if (units !== 'px' && units !== 'm')
    throw new RangeError(`units must be 'px' or 'm', got ${units}`);

  // --- floors
  let floors = input.floors;
  if (!floors || floors.length === 0) {
    const indexes = [
      ...new Set(
        input.nodes.map((n) => num(n.floor, `nodes line ${n.__line} floor`, { integer: true }))
      ),
    ];
    indexes.sort((a, b) => a - b);
    floors = indexes.map((index) => ({
      index,
      id: `floor-${index}`.replace('-', index < 0 ? '-b' : '-'),
      name: `Floor ${index}`,
    }));
    warnings.push(
      `no floors given; derived ${floors.length} floor(s) from node data with generic names`
    );
  }
  const floorByIndex = new Map(floors.map((f) => [f.index, f]));

  const toMetres = (row, where) => {
    const floorIndex = num(row.floor, `${where} floor`, { integer: true });
    const floor = floorByIndex.get(floorIndex);
    if (!floor) throw new TypeError(`${where}: floor ${floorIndex} is not defined`);
    const px = num(row.x, `${where} x`);
    const py = num(row.y, `${where} y`);
    let x;
    let y;
    if (units === 'm') {
      x = px;
      y = py;
    } else {
      const plan = floor.plan;
      const mpp = plan?.metresPerPixel ?? input.metresPerPixel;
      if (!mpp)
        throw new TypeError(
          `${where}: pixel units need metresPerPixel (--scale) or a floor plan scale`
        );
      if (!plan?.height && !plan?.originPx) {
        throw new TypeError(
          `${where}: pixel units need a floor plan image for floor ${floorIndex} (to flip y)`
        );
      }
      const origin = plan.originPx ?? { x: 0, y: plan.height };
      x = (px - origin.x) * mpp;
      y = (origin.y - py) * mpp;
    }
    const z = num(row.z, `${where} z`, { required: false }) ?? floor.elevation ?? 0;
    return { x: round(x), y: round(y), z: round(z), floor: floorIndex };
  };

  // --- nodes
  const nodes = input.nodes.map((row) => {
    const where = `nodes line ${row.__line}`;
    const id = str(row.id, `${where} id`);
    const node = { id, ...toMetres(row, where) };
    const name = str(row.name, `${where} name`, { required: false });
    if (name) node.name = name;
    return node;
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // --- edges
  const edges = input.edges.map((row) => {
    const where = `edges line ${row.__line}`;
    const from = str(row.from, `${where} from`);
    const to = str(row.to, `${where} to`);
    const a = nodeById.get(from);
    const b = nodeById.get(to);
    if (!a) throw new TypeError(`${where}: from references unknown node ${JSON.stringify(from)}`);
    if (!b) throw new TypeError(`${where}: to references unknown node ${JSON.stringify(to)}`);

    const edge = { from, to };
    const type = str(row.type, `${where} type`, { required: false });
    if (type) edge.type = type;

    const straight = round(metresBetween(a, b));
    const given = num(row.distance, `${where} distance`, { required: false });
    if (given !== undefined) {
      if (given + 1e-6 < straight) {
        throw new RangeError(
          `${where}: distance ${given} is shorter than the straight line between its nodes (${straight} m)`
        );
      }
      edge.distance = given;
    } else {
      edge.distance = straight;
    }

    for (const key of ['oneWay', 'stepFree', 'wheelchair', 'staffOnly']) {
      if (row[key] !== undefined && row[key] !== '') edge[key] = bool(row[key], `${where} ${key}`);
    }
    if (a.floor !== b.floor) edge.floorChange = true;
    if (row.floorChange !== undefined && row.floorChange !== '') {
      const fc = bool(row.floorChange, `${where} floorChange`);
      if (fc !== (a.floor !== b.floor)) {
        throw new RangeError(
          `${where}: floorChange=${fc} disagrees with node floors ${a.floor} and ${b.floor}`
        );
      }
    }
    const hours = parseHours(row.hours, `${where} hours`);
    if (hours) edge.hours = hours;
    const name = str(row.name, `${where} name`, { required: false });
    if (name) edge.name = name;
    return edge;
  });

  // --- pois
  const pois = (input.pois ?? []).map((row) => {
    const where = `pois line ${row.__line}`;
    const poi = {
      id: str(row.id, `${where} id`),
      name: str(row.name, `${where} name`),
      node: str(row.node, `${where} node`),
    };
    if (!nodeById.has(poi.node))
      throw new TypeError(`${where}: node references unknown node ${JSON.stringify(poi.node)}`);
    const aliases = str(row.aliases, `${where} aliases`, { required: false });
    if (aliases)
      poi.aliases = aliases
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
    const floor = num(row.floor, `${where} floor`, { required: false, integer: true });
    if (floor !== undefined) poi.floor = floor;
    for (const key of ['category', 'access', 'description']) {
      const v = str(row[key], `${where} ${key}`, { required: false });
      if (v) poi[key] = v;
    }
    const hours = parseHours(row.hours, `${where} hours`);
    if (hours) poi.hours = hours;
    return poi;
  });

  // --- anchors
  const anchors = (input.anchors ?? []).map((row) => {
    const where = `anchors line ${row.__line}`;
    const anchor = { id: str(row.id, `${where} id`), ...toMetres(row, where) };
    const heading = num(row.heading, `${where} heading`, { required: false });
    if (heading !== undefined) anchor.heading = heading;
    return anchor;
  });

  // --- assemble
  const venue = {
    schemaVersion: 1,
    id: input.id,
    name: input.name,
  };
  if (input.description) venue.description = input.description;
  if (input.headingOffsetDeg !== undefined)
    venue.frame = { headingOffsetDeg: input.headingOffsetDeg };
  venue.floors = floors.map((f) => {
    const out = { index: f.index, id: f.id, name: f.name };
    if (f.elevation !== undefined) out.elevation = f.elevation;
    if (f.plan?.image) {
      out.plan = { image: f.plan.image, widthPx: f.plan.width, heightPx: f.plan.height };
      const mpp = f.plan.metresPerPixel ?? input.metresPerPixel;
      if (mpp) out.plan.metresPerPixel = mpp;
      out.plan.originPx = f.plan.originPx ?? { x: 0, y: f.plan.height };
    }
    return out;
  });
  venue.nodes = nodes;
  venue.edges = edges;
  venue.pois = pois;
  if (anchors.length > 0) venue.anchors = anchors;
  if (input.providers) venue.providers = input.providers;

  return { venue, warnings };
}
