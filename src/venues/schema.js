/**
 * Venue JSON schema and validator.
 *
 * A venue file is authored by the venue operator and is the only source of
 * points of interest and routes (docs/DECISIONS.md, ADR-002). This module
 * defines the shape and validates it without any dependency. Validation
 * collects every problem it finds and throws one `VenueValidationError` whose
 * message names each offending field by path, e.g. `nodes[3].floor`.
 *
 * ## Shape (schema version 1)
 *
 * ```jsonc
 * {
 *   "schemaVersion": 1,
 *   "id": "westfield-north",            // slug, unique per operator
 *   "name": "Westfield North",
 *   "frame": {                           // optional
 *     "headingOffsetDeg": 12.5           // compass → venue +y (see fusion.js)
 *   },
 *   "floors": [
 *     { "index": 0, "id": "g", "name": "Ground", "elevation": 0 },
 *     { "index": 1, "id": "l1", "name": "Level 1", "elevation": 4.2 }
 *   ],
 *   "nodes": [                           // route graph vertices, venue-local metres
 *     { "id": "n-entrance", "x": 0, "y": 0, "z": 0, "floor": 0 }
 *   ],
 *   "edges": [                           // see src/core/router.js for fields
 *     { "from": "n-entrance", "to": "n-atrium", "type": "walk" }
 *   ],
 *   "anchors": [                         // optional: physical QR-code markers
 *     {
 *       "id": "a-entrance",
 *       "x": 0.5, "y": 1.0, "z": 0,      // where the user STANDS when scanning
 *       "floor": 0,
 *       "heading": 90                    // direction the user faces when scanning
 *     }
 *   ],
 *   "pois": [
 *     {
 *       "id": "poi-info",
 *       "name": "Information desk",
 *       "aliases": ["Help desk", "Info"],
 *       "node": "n-atrium",              // where routing delivers the user
 *       "category": "service",           // free text
 *       "description": "…",              // optional
 *       "hours": [{ "open": "09:00", "close": "21:00" }],   // optional
 *       "floor": 0,                      // optional; must match the node's floor
 *       "access": "public"               // or "staff"; optional
 *     }
 *   ],
 *   "languages": {                       // optional community languages (see src/ui/strings/)
 *     "sm": { "name": "Gagana Sāmoa", "strings": { "picker.title": "…" } }
 *   },
 *   "providers": {                       // optional, opaque per-provider config
 *     "immersal": { "mapId": 12345 }
 *   }
 * }
 * ```
 *
 * Venue JSON must not contain GPS coordinates anywhere (ADR-003 privacy
 * rules); a `lat` / `lon` / `latitude` / `longitude` / `lng` key at any
 * checked level is an error.
 */

export const SCHEMA_VERSION = 1;

export const EDGE_TYPES = Object.freeze([
  'walk',
  'stairs',
  'escalator',
  'lift',
  'ramp',
  'door',
  'travelator',
]);

export const ACCESS = Object.freeze(['public', 'staff']);

const GPS_KEYS = ['lat', 'lon', 'lng', 'latitude', 'longitude'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Thrown when venue JSON fails validation. `errors` lists every problem;
 * `message` renders them all.
 */
export class VenueValidationError extends Error {
  /** @type {Array<{ path: string, message: string }>} */
  errors;

  constructor(errors) {
    const count = errors.length;
    const lines = errors.map((e) => `  - ${e.path}: ${e.message}`);
    super(`Invalid venue JSON (${count} problem${count === 1 ? '' : 's'}):\n${lines.join('\n')}`);
    this.name = 'VenueValidationError';
    this.errors = errors;
  }
}

// ------------------------------------------------------------------ helpers

class Collector {
  errors = [];

  add(path, message) {
    this.errors.push({ path, message });
  }

  isObject(value, path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.add(path, `must be an object, got ${describe(value)}`);
      return false;
    }
    return true;
  }

  isArray(value, path, { minLength = 0 } = {}) {
    if (!Array.isArray(value)) {
      this.add(path, `must be an array, got ${describe(value)}`);
      return false;
    }
    if (value.length < minLength) {
      this.add(path, `must have at least ${minLength} item${minLength === 1 ? '' : 's'}`);
      return false;
    }
    return true;
  }

  isString(value, path, { required = true, pattern, patternHint } = {}) {
    if (value === undefined) {
      if (required) this.add(path, 'is required');
      return false;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      this.add(path, `must be a non-empty string, got ${describe(value)}`);
      return false;
    }
    if (pattern && !pattern.test(value)) {
      this.add(path, `${patternHint}, got ${JSON.stringify(value)}`);
      return false;
    }
    return true;
  }

  isNumber(value, path, { required = true, integer = false, min } = {}) {
    if (value === undefined) {
      if (required) this.add(path, 'is required');
      return false;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.add(path, `must be a finite number, got ${describe(value)}`);
      return false;
    }
    if (integer && !Number.isInteger(value)) {
      this.add(path, `must be an integer, got ${value}`);
      return false;
    }
    if (min !== undefined && value < min) {
      this.add(path, `must be >= ${min}, got ${value}`);
      return false;
    }
    return true;
  }

  isBoolean(value, path) {
    if (value === undefined) return true;
    if (typeof value !== 'boolean') {
      this.add(path, `must be true or false, got ${describe(value)}`);
      return false;
    }
    return true;
  }

  isEnum(value, path, allowed, { required = false } = {}) {
    if (value === undefined) {
      if (required) this.add(path, 'is required');
      return !required;
    }
    if (!allowed.includes(value)) {
      this.add(path, `must be one of ${allowed.join(', ')}, got ${describe(value)}`);
      return false;
    }
    return true;
  }

  noGps(value, path) {
    if (value === null || typeof value !== 'object') return;
    for (const key of GPS_KEYS) {
      if (Object.hasOwn(value, key)) {
        this.add(`${path}.${key}`, 'venue JSON must not contain GPS coordinates');
      }
    }
  }
}

function describe(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object') return 'an object';
  return String(value);
}

function checkHours(c, hours, path) {
  if (hours === undefined) return;
  if (!c.isArray(hours, path)) return;
  hours.forEach((w, i) => {
    const p = `${path}[${i}]`;
    if (!c.isObject(w, p)) return;
    c.isString(w.open, `${p}.open`, { pattern: HHMM_PATTERN, patternHint: "must be 'HH:MM'" });
    c.isString(w.close, `${p}.close`, { pattern: HHMM_PATTERN, patternHint: "must be 'HH:MM'" });
    if (w.days !== undefined && c.isArray(w.days, `${p}.days`, { minLength: 1 })) {
      w.days.forEach((d, j) => {
        if (!Number.isInteger(d) || d < 0 || d > 6) {
          c.add(
            `${p}.days[${j}]`,
            `must be an integer 0 (Sunday) – 6 (Saturday), got ${describe(d)}`
          );
        }
      });
    }
  });
}

/** Check `items[].<key>` are unique; report each duplicate. */
function checkUnique(c, items, key, path) {
  const seen = new Map();
  items.forEach((item, i) => {
    const value = item?.[key];
    if (value === undefined) return;
    if (seen.has(value)) {
      c.add(
        `${path}[${i}].${key}`,
        `duplicate ${key} ${JSON.stringify(value)} (first used at ${path}[${seen.get(value)}])`
      );
    } else {
      seen.set(value, i);
    }
  });
}

/** Validate the providers block: `order` plus the known provider configs. */
function checkProviders(c, providers) {
  if (
    providers.order !== undefined &&
    c.isArray(providers.order, 'providers.order', { minLength: 1 })
  ) {
    providers.order.forEach((name, i) => {
      c.isString(name, `providers.order[${i}]`, {
        pattern: ID_PATTERN,
        patternHint: 'must be a slug',
      });
    });
    checkUniqueValues(c, providers.order, 'providers.order');
  }
  for (const [name, block] of Object.entries(providers)) {
    if (name === 'order') continue;
    c.isObject(block, `providers.${name}`);
  }
  const im = providers.immersal;
  if (im !== undefined && im !== null && typeof im === 'object' && !Array.isArray(im)) {
    c.isNumber(im.mapId, 'providers.immersal.mapId', { integer: true, min: 1 });
    if (im.origin !== undefined && c.isObject(im.origin, 'providers.immersal.origin')) {
      for (const k of ['x', 'y', 'z']) c.isNumber(im.origin[k], `providers.immersal.origin.${k}`);
    }
    c.isNumber(im.rotationDeg, 'providers.immersal.rotationDeg', { required: false });
    c.isNumber(im.floor, 'providers.immersal.floor', { required: false, integer: true });
  }
}

/** Report duplicate primitive values in a list. */
function checkUniqueValues(c, list, path) {
  const seen = new Map();
  list.forEach((value, i) => {
    if (seen.has(value)) {
      c.add(
        `${path}[${i}]`,
        `duplicate ${JSON.stringify(value)} (first used at ${path}[${seen.get(value)}])`
      );
    } else {
      seen.set(value, i);
    }
  });
}

// ---------------------------------------------------------------- validate

/**
 * Validate venue JSON. Returns the list of problems (empty when valid)
 * without throwing.
 *
 * @param {unknown} venue
 * @returns {Array<{ path: string, message: string }>}
 */
export function validateVenue(venue) {
  const c = new Collector();
  if (!c.isObject(venue, 'venue')) return c.errors;

  c.noGps(venue, 'venue');

  // --- header
  if (venue.schemaVersion !== SCHEMA_VERSION) {
    c.add('schemaVersion', `must be ${SCHEMA_VERSION}, got ${describe(venue.schemaVersion)}`);
  }
  c.isString(venue.id, 'id', {
    pattern: ID_PATTERN,
    patternHint: 'must be a slug (letters, digits, . _ -)',
  });
  c.isString(venue.name, 'name');

  if (venue.frame !== undefined && c.isObject(venue.frame, 'frame')) {
    c.noGps(venue.frame, 'frame');
    c.isNumber(venue.frame.headingOffsetDeg, 'frame.headingOffsetDeg', { required: false });
  }

  if (venue.languages !== undefined && c.isObject(venue.languages, 'languages')) {
    for (const [code, lang] of Object.entries(venue.languages)) {
      const p = `languages.${code}`;
      if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code)) {
        c.add(p, 'must be keyed by a BCP 47 language code such as "mi" or "en-NZ"');
      }
      if (!c.isObject(lang, p)) continue;
      c.isString(lang.name, `${p}.name`);
      if (c.isObject(lang.strings, `${p}.strings`)) {
        for (const [key, value] of Object.entries(lang.strings)) {
          if (typeof value !== 'string')
            c.add(`${p}.strings.${key}`, `must be a string, got ${describe(value)}`);
        }
      }
    }
  }

  if (venue.providers !== undefined && c.isObject(venue.providers, 'providers')) {
    checkProviders(c, venue.providers);
  }

  // --- floors
  const floorIndexes = new Set();
  if (c.isArray(venue.floors, 'floors', { minLength: 1 })) {
    venue.floors.forEach((floor, i) => {
      const p = `floors[${i}]`;
      if (!c.isObject(floor, p)) return;
      c.noGps(floor, p);
      if (c.isNumber(floor.index, `${p}.index`, { integer: true })) floorIndexes.add(floor.index);
      c.isString(floor.id, `${p}.id`, { pattern: ID_PATTERN, patternHint: 'must be a slug' });
      c.isString(floor.name, `${p}.name`);
      c.isNumber(floor.elevation, `${p}.elevation`, { required: false });
      if (floor.plan !== undefined && c.isObject(floor.plan, `${p}.plan`)) {
        c.isString(floor.plan.image, `${p}.plan.image`);
        c.isNumber(floor.plan.widthPx, `${p}.plan.widthPx`, { integer: true, min: 1 });
        c.isNumber(floor.plan.heightPx, `${p}.plan.heightPx`, { integer: true, min: 1 });
        c.isNumber(floor.plan.metresPerPixel, `${p}.plan.metresPerPixel`, { required: false });
        if (
          floor.plan.originPx !== undefined &&
          c.isObject(floor.plan.originPx, `${p}.plan.originPx`)
        ) {
          c.isNumber(floor.plan.originPx.x, `${p}.plan.originPx.x`);
          c.isNumber(floor.plan.originPx.y, `${p}.plan.originPx.y`);
        }
      }
    });
    checkUnique(c, venue.floors, 'index', 'floors');
    checkUnique(c, venue.floors, 'id', 'floors');
  }

  // --- nodes
  const nodeIds = new Set();
  const nodeFloors = new Map();
  if (c.isArray(venue.nodes, 'nodes', { minLength: 1 })) {
    venue.nodes.forEach((node, i) => {
      const p = `nodes[${i}]`;
      if (!c.isObject(node, p)) return;
      c.noGps(node, p);
      if (c.isString(node.id, `${p}.id`, { pattern: ID_PATTERN, patternHint: 'must be a slug' })) {
        nodeIds.add(node.id);
      }
      c.isNumber(node.x, `${p}.x`);
      c.isNumber(node.y, `${p}.y`);
      c.isNumber(node.z, `${p}.z`, { required: false });
      if (c.isNumber(node.floor, `${p}.floor`, { integer: true })) {
        if (!floorIndexes.has(node.floor)) {
          c.add(`${p}.floor`, `references undefined floor index ${node.floor}`);
        } else if (typeof node.id === 'string') {
          nodeFloors.set(node.id, node.floor);
        }
      }
    });
    checkUnique(c, venue.nodes, 'id', 'nodes');
  }

  // --- edges
  if (c.isArray(venue.edges, 'edges')) {
    venue.edges.forEach((edge, i) => {
      const p = `edges[${i}]`;
      if (!c.isObject(edge, p)) return;
      for (const end of ['from', 'to']) {
        if (c.isString(edge[end], `${p}.${end}`) && !nodeIds.has(edge[end])) {
          c.add(`${p}.${end}`, `references unknown node ${JSON.stringify(edge[end])}`);
        }
      }
      if (edge.from !== undefined && edge.from === edge.to) {
        c.add(`${p}.to`, 'must differ from edges.from (self-loop)');
      }
      c.isEnum(edge.type, `${p}.type`, EDGE_TYPES);
      c.isNumber(edge.distance, `${p}.distance`, { required: false, min: 0 });
      c.isBoolean(edge.oneWay, `${p}.oneWay`);
      c.isBoolean(edge.stepFree, `${p}.stepFree`);
      c.isBoolean(edge.wheelchair, `${p}.wheelchair`);
      c.isBoolean(edge.staffOnly, `${p}.staffOnly`);
      if (c.isBoolean(edge.floorChange, `${p}.floorChange`) && edge.floorChange !== undefined) {
        const a = nodeFloors.get(edge.from);
        const b = nodeFloors.get(edge.to);
        if (a !== undefined && b !== undefined && edge.floorChange !== (a !== b)) {
          c.add(
            `${p}.floorChange`,
            `is ${edge.floorChange} but its nodes are on ${a === b ? 'the same floor' : `floors ${a} and ${b}`}`
          );
        }
      }
      checkHours(c, edge.hours, `${p}.hours`);
    });
  }

  // --- anchors (optional)
  if (venue.anchors !== undefined && c.isArray(venue.anchors, 'anchors')) {
    venue.anchors.forEach((anchor, i) => {
      const p = `anchors[${i}]`;
      if (!c.isObject(anchor, p)) return;
      c.noGps(anchor, p);
      c.isString(anchor.id, `${p}.id`, { pattern: ID_PATTERN, patternHint: 'must be a slug' });
      c.isNumber(anchor.x, `${p}.x`);
      c.isNumber(anchor.y, `${p}.y`);
      c.isNumber(anchor.z, `${p}.z`, { required: false });
      if (
        c.isNumber(anchor.floor, `${p}.floor`, { integer: true }) &&
        !floorIndexes.has(anchor.floor)
      ) {
        c.add(`${p}.floor`, `references undefined floor index ${anchor.floor}`);
      }
      if (
        c.isNumber(anchor.heading, `${p}.heading`, { required: false, min: 0 }) &&
        anchor.heading >= 360
      ) {
        c.add(`${p}.heading`, `must be < 360, got ${anchor.heading}`);
      }
    });
    checkUnique(c, venue.anchors, 'id', 'anchors');
  }

  // --- pois
  if (c.isArray(venue.pois, 'pois')) {
    venue.pois.forEach((poi, i) => {
      const p = `pois[${i}]`;
      if (!c.isObject(poi, p)) return;
      c.noGps(poi, p);
      c.isString(poi.id, `${p}.id`, { pattern: ID_PATTERN, patternHint: 'must be a slug' });
      c.isString(poi.name, `${p}.name`);
      if (c.isString(poi.node, `${p}.node`) && !nodeIds.has(poi.node)) {
        c.add(`${p}.node`, `references unknown node ${JSON.stringify(poi.node)}`);
      }
      if (poi.aliases !== undefined && c.isArray(poi.aliases, `${p}.aliases`)) {
        poi.aliases.forEach((a, j) => c.isString(a, `${p}.aliases[${j}]`));
      }
      c.isString(poi.category, `${p}.category`, { required: false });
      c.isString(poi.description, `${p}.description`, { required: false });
      c.isEnum(poi.access, `${p}.access`, ACCESS);
      if (
        c.isNumber(poi.floor, `${p}.floor`, { required: false, integer: true }) &&
        poi.floor !== undefined
      ) {
        const nodeFloor = nodeFloors.get(poi.node);
        if (!floorIndexes.has(poi.floor)) {
          c.add(`${p}.floor`, `references undefined floor index ${poi.floor}`);
        } else if (nodeFloor !== undefined && nodeFloor !== poi.floor) {
          c.add(
            `${p}.floor`,
            `is ${poi.floor} but node ${JSON.stringify(poi.node)} is on floor ${nodeFloor}`
          );
        }
      }
      checkHours(c, poi.hours, `${p}.hours`);
    });
    checkUnique(c, venue.pois, 'id', 'pois');
  }

  return c.errors;
}

/**
 * Validate venue JSON and throw a `VenueValidationError` listing every
 * problem if it is invalid.
 *
 * @param {unknown} venue
 * @returns {asserts venue is object}
 */
export function assertVenue(venue) {
  const errors = validateVenue(venue);
  if (errors.length > 0) throw new VenueValidationError(errors);
}
