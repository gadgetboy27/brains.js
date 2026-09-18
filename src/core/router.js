/**
 * Router — A* pathfinding over a venue route graph.
 *
 * ## Graph model
 *
 * The venue JSON supplies a graph of walkable nodes and the edges between
 * them:
 *
 * ```js
 * {
 *   nodes: [{ id: 'entrance', x: 0, y: 0, z: 0, floor: 0 }, …],
 *   edges: [{ from: 'entrance', to: 'atrium', type: 'walk' }, …],
 * }
 * ```
 *
 * Node coordinates are venue-local metres (see ./positioning.js). Edge fields:
 *
 * - `from`, `to` — node ids. Edges are bidirectional unless `oneWay: true`.
 * - `type` — `'walk'` (default), `'stairs'`, `'escalator'`, `'lift'`,
 *   `'ramp'`, `'door'`, `'travelator'`. Used to derive accessibility defaults.
 * - `distance` — metres; defaults to the straight-line distance between the
 *   nodes. If given it must not be *less* than the straight-line distance, or
 *   the A* heuristic stops being admissible.
 * - `stepFree` — boolean; defaults to `false` for stairs and escalators,
 *   `true` otherwise.
 * - `wheelchair` — boolean; defaults to `stepFree`. Set `false` on step-free
 *   edges a wheelchair still can't use (narrow doors, steep ramps).
 * - `accessLevel` — `'public'` (default) or `'staffOnly'`.
 * - `hours` — array of opening windows; absent means always open. Each window
 *   is `{ open: 'HH:MM', close: 'HH:MM', days?: number[] }` where `days` are
 *   0 (Sunday) – 6 (Saturday) per `Date.prototype.getDay()`. A window whose
 *   `close` is earlier than its `open` spans midnight.
 *
 * ## Filter
 *
 * `findRoute()` takes a filter describing the person and the moment:
 *
 * - `stepFree: true` — exclude edges that are not step-free.
 * - `wheelchair: true` — exclude edges not usable by a wheelchair (implies
 *   step-free).
 * - `accessLevel` — `'visitor'` (default) or `'staff'`. Visitors cannot use
 *   `staffOnly` edges.
 * - `timeOfDay` — a `Date`, or an `'HH:MM'` string. Edges with `hours` are
 *   excluded when closed at that time. With an `'HH:MM'` string the day of
 *   week is unknown, so windows' `days` restrictions are ignored. Omit it to
 *   ignore hours entirely.
 *
 * Edges that fail the filter are simply not in the graph for that search.
 */

import { metresBetween } from './distance.js';

/** @typedef {{ id: string, x: number, y: number, z?: number, floor?: number }} RouteNode */

/**
 * @typedef {Object} RouteEdge
 * @property {string} from
 * @property {string} to
 * @property {string} [type]
 * @property {number} [distance]
 * @property {boolean} [oneWay]
 * @property {boolean} [stepFree]
 * @property {boolean} [wheelchair]
 * @property {'public' | 'staffOnly'} [accessLevel]
 * @property {OpeningWindow[]} [hours]
 */

/** @typedef {{ open: string, close: string, days?: number[] }} OpeningWindow */

/** @typedef {{ nodes: RouteNode[], edges: RouteEdge[] }} RouteGraph */

/**
 * @typedef {Object} RouteFilter
 * @property {boolean} [stepFree]
 * @property {boolean} [wheelchair]
 * @property {'visitor' | 'staff'} [accessLevel]
 * @property {Date | string} [timeOfDay]
 */

/**
 * @typedef {Object} RouteFound
 * @property {true} found
 * @property {string[]} path       Node ids from start to goal inclusive.
 * @property {RouteNode[]} nodes   The same path as node objects.
 * @property {RouteEdge[]} edges   The edge taken for each step (length = path.length - 1).
 * @property {number} distance     Total metres.
 */

/**
 * @typedef {Object} RouteNotFound
 * @property {false} found
 * @property {'no-route'} reason
 * @property {string} from
 * @property {string} to
 * @property {RouteFilter} filter
 * @property {number} edgesExcluded  How many edges the filter removed — a hint
 *                                   that relaxing the filter may help.
 */

const NOT_STEP_FREE_TYPES = new Set(['stairs', 'escalator']);

// ------------------------------------------------------------------ filters

/** Parse 'HH:MM' into minutes since midnight. */
function parseHHMM(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value));
  if (!m) throw new TypeError(`expected 'HH:MM', got ${String(value)}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new RangeError(`invalid time of day ${value}`);
  return h * 60 + min;
}

/**
 * Normalise a filter's `timeOfDay` into `{ minutes, day }` (day may be
 * undefined) or `null` when no time was given.
 */
function normaliseTime(timeOfDay) {
  if (timeOfDay === undefined || timeOfDay === null) return null;
  if (timeOfDay instanceof Date) {
    if (Number.isNaN(timeOfDay.getTime())) throw new RangeError('timeOfDay is an invalid Date');
    return { minutes: timeOfDay.getHours() * 60 + timeOfDay.getMinutes(), day: timeOfDay.getDay() };
  }
  return { minutes: parseHHMM(timeOfDay), day: undefined };
}

/**
 * Whether a set of opening windows is open at a given time.
 *
 * @param {OpeningWindow[] | undefined} hours
 * @param {Date | string | undefined} timeOfDay
 * @returns {boolean}
 */
export function isOpenAt(hours, timeOfDay) {
  if (!hours) return true;
  const t = normaliseTime(timeOfDay);
  if (t === null) return true;
  if (!Array.isArray(hours)) throw new TypeError('hours must be an array of windows');

  return hours.some((w) => {
    const open = parseHHMM(w.open);
    const close = parseHHMM(w.close);
    const dayOk = t.day === undefined || !w.days || w.days.includes(t.day);
    if (!dayOk) {
      // For an overnight window, the early-morning part belongs to the
      // previous day's entry.
      if (close < open && w.days && t.day !== undefined && w.days.includes((t.day + 6) % 7)) {
        return t.minutes < close;
      }
      return false;
    }
    if (close >= open) return t.minutes >= open && t.minutes < close;
    return t.minutes >= open || t.minutes < close; // spans midnight
  });
}

/** Effective step-free flag for an edge. */
export function edgeIsStepFree(edge) {
  if (typeof edge.stepFree === 'boolean') return edge.stepFree;
  return !NOT_STEP_FREE_TYPES.has(edge.type);
}

/** Effective wheelchair flag for an edge. */
export function edgeIsWheelchair(edge) {
  if (typeof edge.wheelchair === 'boolean') return edge.wheelchair && edgeIsStepFree(edge);
  return edgeIsStepFree(edge);
}

/**
 * Whether an edge is usable under a filter.
 *
 * @param {RouteEdge} edge
 * @param {RouteFilter} [filter]
 * @returns {boolean}
 */
export function edgePassesFilter(edge, filter = {}) {
  if (filter.wheelchair && !edgeIsWheelchair(edge)) return false;
  if (filter.stepFree && !edgeIsStepFree(edge)) return false;

  const level = filter.accessLevel ?? 'visitor';
  if (level !== 'visitor' && level !== 'staff') {
    throw new RangeError(`unknown accessLevel '${level}'`);
  }
  if ((edge.accessLevel ?? 'public') === 'staffOnly' && level !== 'staff') return false;

  if (!isOpenAt(edge.hours, filter.timeOfDay)) return false;

  return true;
}

// -------------------------------------------------------------------- graph

/**
 * Validate a graph and index it. Throws on duplicate node ids or edges that
 * reference unknown nodes.
 *
 * @param {RouteGraph} graph
 * @returns {{ nodes: Map<string, RouteNode>, edges: RouteEdge[] }}
 */
export function indexGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new TypeError('graph must have nodes[] and edges[]');
  }
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (typeof node?.id !== 'string' || node.id === '') {
      throw new TypeError('every node needs a non-empty string id');
    }
    if (nodes.has(node.id)) throw new Error(`duplicate node id '${node.id}'`);
    nodes.set(node.id, node);
  }
  graph.edges.forEach((edge, i) => {
    for (const end of ['from', 'to']) {
      if (!nodes.has(edge?.[end])) {
        throw new Error(`edges[${i}].${end} references unknown node '${edge?.[end]}'`);
      }
    }
    if (edge.distance !== undefined && !(Number.isFinite(edge.distance) && edge.distance >= 0)) {
      throw new RangeError(`edges[${i}].distance must be a non-negative number`);
    }
  });
  return { nodes, edges: graph.edges };
}

/** Metres for an edge: explicit distance, else straight line. */
function edgeLength(edge, nodes) {
  if (edge.distance !== undefined) return edge.distance;
  return metresBetween(nodes.get(edge.from), nodes.get(edge.to));
}

// --------------------------------------------------------------------- heap

/** Minimal binary min-heap keyed on `priority`. */
class MinHeap {
  #items = [];

  get size() {
    return this.#items.length;
  }

  push(item, priority) {
    const items = this.#items;
    items.push({ item, priority });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].priority <= items[i].priority) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && items[l].priority < items[m].priority) m = l;
        if (r < items.length && items[r].priority < items[m].priority) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top?.item;
  }
}

// ----------------------------------------------------------------------- A*

/**
 * Find the shortest route between two nodes under a filter.
 *
 * @param {RouteGraph} graph
 * @param {string} from  Start node id.
 * @param {string} to    Goal node id.
 * @param {RouteFilter} [filter]
 * @returns {RouteFound | RouteNotFound}
 * @throws {Error} if `from` or `to` is not a node in the graph, or the graph
 *   is malformed. (An unknown node is a caller bug, not a routing outcome.)
 */
export function findRoute(graph, from, to, filter = {}) {
  const { nodes, edges } = indexGraph(graph);
  if (!nodes.has(from)) throw new Error(`unknown start node '${from}'`);
  if (!nodes.has(to)) throw new Error(`unknown goal node '${to}'`);

  // Build adjacency from the edges that survive the filter.
  /** @type {Map<string, Array<{ to: string, edge: RouteEdge, length: number }>>} */
  const adjacency = new Map();
  let edgesExcluded = 0;
  for (const edge of edges) {
    if (!edgePassesFilter(edge, filter)) {
      edgesExcluded += 1;
      continue;
    }
    const length = edgeLength(edge, nodes);
    const add = (a, b) => {
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a).push({ to: b, edge, length });
    };
    add(edge.from, edge.to);
    if (!edge.oneWay) add(edge.to, edge.from);
  }

  const goal = nodes.get(to);
  const heuristic = (id) => metresBetween(nodes.get(id), goal);

  const gScore = new Map([[from, 0]]);
  const cameFrom = new Map(); // id -> { prev, edge }
  const closed = new Set();
  const open = new MinHeap();
  open.push(from, heuristic(from));

  while (open.size > 0) {
    const current = open.pop();
    if (closed.has(current)) continue;
    if (current === to) break;
    closed.add(current);

    for (const { to: next, edge, length } of adjacency.get(current) ?? []) {
      if (closed.has(next)) continue;
      const tentative = gScore.get(current) + length;
      if (tentative < (gScore.get(next) ?? Infinity)) {
        gScore.set(next, tentative);
        cameFrom.set(next, { prev: current, edge });
        open.push(next, tentative + heuristic(next));
      }
    }
  }

  if (!gScore.has(to)) {
    return { found: false, reason: 'no-route', from, to, filter, edgesExcluded };
  }

  const path = [to];
  const pathEdges = [];
  for (let id = to; id !== from;) {
    const { prev, edge } = cameFrom.get(id);
    path.push(prev);
    pathEdges.push(edge);
    id = prev;
  }
  path.reverse();
  pathEdges.reverse();

  return {
    found: true,
    path,
    nodes: path.map((id) => nodes.get(id)),
    edges: pathEdges,
    distance: gScore.get(to),
  };
}
