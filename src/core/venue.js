/**
 * Venue — load, validate and index a venue JSON document.
 *
 * `createVenue(json)` validates with src/venues/schema.js (throwing a
 * `VenueValidationError` that names every bad field) and returns a `Venue`
 * with fast lookups:
 *
 *  - points of interest by id, by name, by alias, or by any of those;
 *  - nodes and POIs per floor;
 *  - the route graph in the shape `src/core/router.js` expects.
 *
 * `loadVenue(source)` is the async convenience: it accepts an object, a JSON
 * string, or a URL to fetch.
 */

import { assertVenue } from '../venues/schema.js';

export { VenueValidationError } from '../venues/schema.js';

/**
 * Normalise a name / alias for lookup: trim, collapse whitespace, lowercase.
 * Exported so UI search boxes can normalise the same way.
 *
 * @param {string} text
 * @returns {string}
 */
export function normaliseName(text) {
  return String(text).trim().replace(/\s+/g, ' ').toLowerCase();
}

export class Venue {
  /** @type {string} */ id;
  /** @type {string} */ name;
  /** @type {number} */ headingOffsetDeg;
  /** @type {object} */ providers;
  /** @type {Array<object>} floors sorted by index */ floors;
  /** @type {{ nodes: object[], edges: object[] }} */ graph;
  /** @type {ReadonlyArray<object>} */ pois;
  /** @type {ReadonlyArray<object>} */ anchors;

  #floorsByIndex = new Map();
  #floorsById = new Map();
  #nodesById = new Map();
  #nodesByFloor = new Map();
  #poisById = new Map();
  #poisByName = new Map(); // normalised name -> poi[]
  #poisByAlias = new Map(); // normalised alias -> poi[]
  #poisByFloor = new Map();
  #poisByNode = new Map();
  #anchorsById = new Map();

  /**
   * @param {object} json Already-validated venue JSON.
   * @private Use `createVenue()`.
   */
  constructor(json) {
    this.id = json.id;
    this.name = json.name;
    this.headingOffsetDeg = json.frame?.headingOffsetDeg ?? 0;
    this.providers = Object.freeze({ ...(json.providers ?? {}) });

    this.floors = [...json.floors].sort((a, b) => a.index - b.index).map(Object.freeze);
    for (const floor of this.floors) {
      this.#floorsByIndex.set(floor.index, floor);
      this.#floorsById.set(floor.id, floor);
      this.#nodesByFloor.set(floor.index, []);
      this.#poisByFloor.set(floor.index, []);
    }

    const nodes = json.nodes.map((n) => Object.freeze({ z: 0, ...n }));
    for (const node of nodes) {
      this.#nodesById.set(node.id, node);
      this.#nodesByFloor.get(node.floor).push(node);
    }

    const edges = json.edges.map(Object.freeze);
    this.graph = Object.freeze({ nodes, edges });

    const pois = json.pois.map((p) => Object.freeze({ aliases: [], ...p }));
    for (const poi of pois) {
      this.#poisById.set(poi.id, poi);
      push(this.#poisByName, normaliseName(poi.name), poi);
      for (const alias of poi.aliases) push(this.#poisByAlias, normaliseName(alias), poi);
      push(this.#poisByNode, poi.node, poi);
      this.#poisByFloor.get(this.#nodesById.get(poi.node).floor).push(poi);
    }
    this.pois = Object.freeze(pois);

    const anchors = (json.anchors ?? []).map((a) => Object.freeze({ z: 0, heading: 0, ...a }));
    for (const anchor of anchors) this.#anchorsById.set(anchor.id, anchor);
    this.anchors = Object.freeze(anchors);

    for (const list of [...this.#nodesByFloor.values(), ...this.#poisByFloor.values()]) {
      Object.freeze(list);
    }
    Object.freeze(this);
  }

  // ------------------------------------------------------------- floors

  /** @param {number} index */
  floorByIndex(index) {
    return this.#floorsByIndex.get(index);
  }

  /** @param {string} id */
  floorById(id) {
    return this.#floorsById.get(id);
  }

  // -------------------------------------------------------------- nodes

  /** @param {string} id */
  nodeById(id) {
    return this.#nodesById.get(id);
  }

  /**
   * All route nodes on a floor. Returns an empty array for an unknown floor.
   * @param {number} floorIndex
   * @returns {ReadonlyArray<object>}
   */
  nodesOnFloor(floorIndex) {
    return this.#nodesByFloor.get(floorIndex) ?? EMPTY;
  }

  // ------------------------------------------------------------ anchors

  /**
   * A physical marker (QR code) with a known standing position and facing.
   * @param {string} id
   */
  anchorById(id) {
    return this.#anchorsById.get(id);
  }

  // --------------------------------------------------------------- pois

  /** @param {string} id */
  poiById(id) {
    return this.#poisById.get(id);
  }

  /**
   * POIs whose name matches (case- and whitespace-insensitive). More than one
   * POI may share a name (e.g. "Toilets" on every floor).
   * @param {string} name
   * @returns {ReadonlyArray<object>}
   */
  poisByName(name) {
    return this.#poisByName.get(normaliseName(name)) ?? EMPTY;
  }

  /**
   * POIs with a matching alias (case- and whitespace-insensitive).
   * @param {string} alias
   * @returns {ReadonlyArray<object>}
   */
  poisByAlias(alias) {
    return this.#poisByAlias.get(normaliseName(alias)) ?? EMPTY;
  }

  /**
   * Resolve a user-supplied term to POIs: exact id first, then name, then
   * alias. Returns an empty array when nothing matches.
   * @param {string} term
   * @returns {ReadonlyArray<object>}
   */
  lookupPois(term) {
    const byId = this.poiById(term);
    if (byId) return Object.freeze([byId]);
    const byName = this.poisByName(term);
    if (byName.length > 0) return byName;
    return this.poisByAlias(term);
  }

  /**
   * Substring search over names and aliases, for type-ahead. Results are
   * unique and in venue file order.
   * @param {string} term
   * @returns {object[]}
   */
  searchPois(term) {
    const q = normaliseName(term);
    if (q === '') return [];
    return this.pois.filter(
      (poi) =>
        normaliseName(poi.name).includes(q) || poi.aliases.some((a) => normaliseName(a).includes(q))
    );
  }

  /**
   * POIs on a floor (by the floor of their node).
   * @param {number} floorIndex
   * @returns {ReadonlyArray<object>}
   */
  poisOnFloor(floorIndex) {
    return this.#poisByFloor.get(floorIndex) ?? EMPTY;
  }

  /**
   * POIs attached to a node.
   * @param {string} nodeId
   * @returns {ReadonlyArray<object>}
   */
  poisAtNode(nodeId) {
    return this.#poisByNode.get(nodeId) ?? EMPTY;
  }
}

const EMPTY = Object.freeze([]);

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

/**
 * Validate and index venue JSON.
 *
 * @param {unknown} json
 * @returns {Venue}
 * @throws {VenueValidationError} naming every invalid field.
 */
export function createVenue(json) {
  assertVenue(json);
  return new Venue(json);
}

/**
 * Load a venue from an object, a JSON string, or a URL.
 *
 * @param {object | string | URL} source
 * @param {{ fetch?: typeof fetch }} [options] Inject `fetch` for tests.
 * @returns {Promise<Venue>}
 */
export async function loadVenue(source, { fetch: fetchImpl = globalThis.fetch } = {}) {
  if (
    source instanceof URL ||
    (typeof source === 'string' && /^(https?:|\/|\.\/|\.\.\/)/.test(source))
  ) {
    if (typeof fetchImpl !== 'function')
      throw new TypeError('no fetch available to load venue URL');
    const response = await fetchImpl(String(source));
    if (!response.ok) {
      throw new Error(`failed to load venue from ${String(source)}: HTTP ${response.status}`);
    }
    return createVenue(await response.json());
  }
  if (typeof source === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch (err) {
      throw new SyntaxError(`venue JSON could not be parsed: ${err.message}`, { cause: err });
    }
    return createVenue(parsed);
  }
  return createVenue(source);
}
