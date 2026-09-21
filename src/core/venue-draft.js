/**
 * VenueDraft — an editable venue that starts from an existing venue JSON (or
 * a blank one) and can be grown from a walk or a plan, then exported as valid
 * venue JSON. Pure data; the admin UI drives it.
 *
 *  - `addNode(point)` places a node; with `linkFrom` it also adds an edge
 *    (distance computed), which is how a recorded walk becomes a route graph.
 *  - `addPoi`, `addAnchor`, `addEdge`, `removeNode` etc. do what they say.
 *  - `snapToNode(point, radius)` finds an existing node close enough to reuse,
 *    so walking past the same junction twice joins the graph instead of
 *    creating a duplicate.
 *  - `toJSON()` returns schema-shaped JSON; `validate()` runs the same
 *    validator as the app.
 */

import { metresBetween } from './distance.js';
import { validateVenue } from '../venues/schema.js';

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function slugify(text, fallback = 'item') {
  const s = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

const round = (n) => Math.round(n * 100) / 100;

export class VenueDraft {
  /** @param {object} [json] Existing venue JSON to start from. */
  constructor(json) {
    const base = json ? structuredClone(json) : null;
    this.schemaVersion = 1;
    this.id = base?.id ?? 'new-venue';
    this.name = base?.name ?? 'New venue';
    this.description = base?.description;
    this.frame = base?.frame ? { ...base.frame } : undefined;
    this.floors = base?.floors?.map((f) => ({ ...f })) ?? [
      { index: 0, id: 'ground', name: 'Ground', elevation: 0 },
    ];
    this.nodes = base?.nodes?.map((n) => ({ ...n })) ?? [];
    this.edges = base?.edges?.map((e) => ({ ...e })) ?? [];
    this.pois =
      base?.pois?.map((p) => ({ ...p, aliases: p.aliases ? [...p.aliases] : undefined })) ?? [];
    this.anchors = base?.anchors?.map((a) => ({ ...a })) ?? [];
    this.languages = base?.languages ? structuredClone(base.languages) : undefined;
    this.providers = base?.providers ? structuredClone(base.providers) : undefined;
    this.runtimeConfigUrl = base?.runtimeConfigUrl;
    /** Edit log, newest last, for undo. */
    this.history = [];
  }

  // ---------------------------------------------------------------- lookups

  nodeById(id) {
    return this.nodes.find((n) => n.id === id) ?? null;
  }

  floorByIndex(index) {
    return this.floors.find((f) => f.index === index) ?? null;
  }

  /** Nearest existing node on the same floor within `radius` metres, else null. */
  snapToNode(point, radius = 1.5) {
    let best = null;
    let bestD = radius;
    for (const n of this.nodes) {
      if (n.floor !== (point.floor ?? 0)) continue;
      const d = Math.hypot(n.x - point.x, n.y - point.y);
      if (d <= bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  uniqueId(prefix, name) {
    const base = `${prefix}-${slugify(name, 'x')}`;
    if (!this.#idTaken(base)) return base;
    for (let i = 2; ; i += 1) if (!this.#idTaken(`${base}-${i}`)) return `${base}-${i}`;
  }

  #idTaken(id) {
    return (
      this.nodes.some((n) => n.id === id) ||
      this.pois.some((p) => p.id === id) ||
      this.anchors.some((a) => a.id === id) ||
      this.floors.some((f) => f.id === id)
    );
  }

  // ------------------------------------------------------------------ edits

  #record(entry) {
    this.history.push(entry);
  }

  /**
   * Add a node. Returns the node. With `linkFrom` (a node id) an edge is
   * added from it; with `snap` an existing node within the radius is reused.
   *
   * @param {{ x: number, y: number, z?: number, floor?: number, name?: string, id?: string }} point
   * @param {{ linkFrom?: string | null, snap?: number, edge?: object }} [options]
   */
  addNode(point, { linkFrom = null, snap = 0, edge = {} } = {}) {
    const floor = point.floor ?? 0;
    if (!this.floorByIndex(floor)) throw new RangeError(`floor ${floor} is not defined`);
    let node = snap > 0 ? this.snapToNode({ ...point, floor }, snap) : null;
    let created = false;
    if (!node) {
      const id = point.id ?? this.uniqueId('n', point.name ?? `${this.nodes.length + 1}`);
      if (!SLUG.test(id)) throw new TypeError(`invalid node id ${id}`);
      if (this.#idTaken(id)) throw new Error(`id ${id} already exists`);
      node = {
        id,
        x: round(point.x),
        y: round(point.y),
        z: round(point.z ?? this.floorByIndex(floor).elevation ?? 0),
        floor,
      };
      if (point.name) node.name = point.name;
      this.nodes.push(node);
      created = true;
    }
    let addedEdge = null;
    if (linkFrom && linkFrom !== node.id && !this.edgeBetween(linkFrom, node.id)) {
      addedEdge = this.addEdge(linkFrom, node.id, edge, { record: false });
    }
    this.#record({
      type: 'addNode',
      node: created ? node.id : null,
      edge: addedEdge ? [addedEdge.from, addedEdge.to] : null,
    });
    return node;
  }

  edgeBetween(a, b) {
    return (
      this.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a)) ?? null
    );
  }

  /** @param {object} [attrs] type, stepFree, wheelchair, staffOnly, hours, name, distance */
  addEdge(from, to, attrs = {}, { record = true } = {}) {
    const a = this.nodeById(from);
    const b = this.nodeById(to);
    if (!a || !b) throw new Error(`unknown node ${!a ? from : to}`);
    if (from === to) throw new Error('an edge needs two different nodes');
    if (this.edgeBetween(from, to)) throw new Error(`edge ${from}–${to} already exists`);
    const e = { from, to, ...attrs };
    if (e.distance === undefined) e.distance = round(metresBetween(a, b));
    if (a.floor !== b.floor) {
      e.floorChange = true;
      if (!e.type) e.type = 'stairs';
    }
    this.edges.push(e);
    if (record) this.#record({ type: 'addEdge', edge: [from, to] });
    return e;
  }

  removeEdge(from, to) {
    const i = this.edges.findIndex(
      (e) => (e.from === from && e.to === to) || (e.from === to && e.to === from)
    );
    if (i < 0) return false;
    const [removed] = this.edges.splice(i, 1);
    this.#record({ type: 'removeEdge', edge: removed });
    return true;
  }

  moveNode(id, point) {
    const n = this.nodeById(id);
    if (!n) throw new Error(`unknown node ${id}`);
    const before = { x: n.x, y: n.y };
    n.x = round(point.x);
    n.y = round(point.y);
    if (point.z !== undefined) n.z = round(point.z);
    // Recompute distances of edges that had no explicit distance beyond the straight line.
    for (const e of this.edges) {
      if (e.from === id || e.to === id)
        e.distance = round(metresBetween(this.nodeById(e.from), this.nodeById(e.to)));
    }
    this.#record({ type: 'moveNode', node: id, before });
    return n;
  }

  renameNode(id, name) {
    const n = this.nodeById(id);
    if (!n) throw new Error(`unknown node ${id}`);
    n.name = name || undefined;
    return n;
  }

  /** Removes the node, its edges, and any POI attached to it. */
  removeNode(id) {
    const i = this.nodes.findIndex((n) => n.id === id);
    if (i < 0) return false;
    const [node] = this.nodes.splice(i, 1);
    const edges = this.edges.filter((e) => e.from === id || e.to === id);
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
    const pois = this.pois.filter((p) => p.node === id);
    this.pois = this.pois.filter((p) => p.node !== id);
    this.#record({ type: 'removeNode', node, edges, pois });
    return true;
  }

  /** @param {{ name: string, node: string, aliases?: string[], category?: string, access?: string, description?: string, id?: string }} poi */
  addPoi(poi) {
    if (!this.nodeById(poi.node)) throw new Error(`unknown node ${poi.node}`);
    if (!poi.name?.trim()) throw new TypeError('a POI needs a name');
    const id = poi.id ?? this.uniqueId('poi', poi.name);
    const p = { id, name: poi.name.trim(), node: poi.node };
    if (poi.aliases?.length) p.aliases = poi.aliases.map((a) => a.trim()).filter(Boolean);
    for (const k of ['category', 'access', 'description']) if (poi[k]) p[k] = poi[k];
    this.pois.push(p);
    this.#record({ type: 'addPoi', poi: id });
    return p;
  }

  /**
   * Change a POI's name, aliases, category, access or description.
   * @param {string} id
   * @param {{ name?: string, aliases?: string[], category?: string | null, access?: 'public' | 'staff' | null, description?: string | null }} patch
   */
  updatePoi(id, patch) {
    const p = this.pois.find((x) => x.id === id);
    if (!p) throw new Error(`unknown poi ${id}`);
    const before = { ...p };
    if (p.aliases) before.aliases = [...p.aliases];
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new TypeError('a POI needs a name');
      p.name = patch.name.trim();
    }
    if (patch.aliases !== undefined) {
      const aliases = patch.aliases.map((a) => a.trim()).filter(Boolean);
      if (aliases.length) p.aliases = aliases;
      else delete p.aliases;
    }
    for (const k of ['category', 'access', 'description']) {
      if (patch[k] === undefined) continue;
      if (patch[k]) p[k] = patch[k];
      else delete p[k];
    }
    this.#record({ type: 'updatePoi', poi: id, before });
    return p;
  }

  /** Attach a POI to a different node (e.g. "move here"). */
  movePoi(id, nodeId) {
    const p = this.pois.find((x) => x.id === id);
    if (!p) throw new Error(`unknown poi ${id}`);
    if (!this.nodeById(nodeId)) throw new Error(`unknown node ${nodeId}`);
    const before = { ...p };
    p.node = nodeId;
    if (p.floor !== undefined) p.floor = this.nodeById(nodeId).floor;
    this.#record({ type: 'updatePoi', poi: id, before });
    return p;
  }

  removePoi(id) {
    const i = this.pois.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const [poi] = this.pois.splice(i, 1);
    this.#record({ type: 'removePoi', poi });
    return true;
  }

  /** @param {{ x: number, y: number, z?: number, floor?: number, heading?: number, name?: string, id?: string }} anchor */
  addAnchor(anchor) {
    const floor = anchor.floor ?? 0;
    if (!this.floorByIndex(floor)) throw new RangeError(`floor ${floor} is not defined`);
    const id = anchor.id ?? this.uniqueId('a', anchor.name ?? `${this.anchors.length + 1}`);
    const a = {
      id,
      x: round(anchor.x),
      y: round(anchor.y),
      z: round(anchor.z ?? this.floorByIndex(floor).elevation ?? 0),
      floor,
      heading: Math.round(((anchor.heading ?? 0) % 360) + 360) % 360,
    };
    if (anchor.name) a.name = anchor.name;
    this.anchors.push(a);
    this.#record({ type: 'addAnchor', anchor: id });
    return a;
  }

  /**
   * Change a marker's name, position or heading. Its id — what is printed in
   * the QR code — never changes, so existing prints keep working.
   * @param {string} id
   * @param {{ name?: string | null, x?: number, y?: number, z?: number, floor?: number, heading?: number }} patch
   */
  updateAnchor(id, patch) {
    const a = this.anchors.find((x) => x.id === id);
    if (!a) throw new Error(`unknown anchor ${id}`);
    const before = { ...a };
    if (patch.name !== undefined) {
      if (patch.name) a.name = patch.name;
      else delete a.name;
    }
    if (patch.floor !== undefined) {
      if (!this.floorByIndex(patch.floor))
        throw new RangeError(`floor ${patch.floor} is not defined`);
      a.floor = patch.floor;
    }
    for (const k of ['x', 'y', 'z']) if (patch[k] !== undefined) a[k] = round(patch[k]);
    if (patch.heading !== undefined) a.heading = Math.round(((patch.heading % 360) + 360) % 360);
    this.#record({ type: 'updateAnchor', anchor: id, before });
    return a;
  }

  removeAnchor(id) {
    const i = this.anchors.findIndex((a) => a.id === id);
    if (i < 0) return false;
    const [anchor] = this.anchors.splice(i, 1);
    this.#record({ type: 'removeAnchor', anchor });
    return true;
  }

  addFloor({ index, id, name, elevation }) {
    if (this.floorByIndex(index)) throw new Error(`floor ${index} already exists`);
    const f = {
      index,
      id: id ?? slugify(name ?? `floor-${index}`),
      name: name ?? `Floor ${index}`,
    };
    if (elevation !== undefined) f.elevation = elevation;
    this.floors.push(f);
    this.floors.sort((a, b) => a.index - b.index);
    this.#record({ type: 'addFloor', floor: index });
    return f;
  }

  /** Undo the most recent edit. Returns the undone entry or null. */
  undo() {
    const entry = this.history.pop();
    if (!entry) return null;
    switch (entry.type) {
      case 'addNode':
        if (entry.edge)
          this.edges = this.edges.filter(
            (e) => !(e.from === entry.edge[0] && e.to === entry.edge[1])
          );
        if (entry.node) this.nodes = this.nodes.filter((n) => n.id !== entry.node);
        break;
      case 'addEdge':
        this.edges = this.edges.filter(
          (e) => !(e.from === entry.edge[0] && e.to === entry.edge[1])
        );
        break;
      case 'removeEdge':
        this.edges.push(entry.edge);
        break;
      case 'moveNode': {
        const n = this.nodeById(entry.node);
        if (n) Object.assign(n, entry.before);
        break;
      }
      case 'removeNode':
        this.nodes.push(entry.node);
        this.edges.push(...entry.edges);
        this.pois.push(...entry.pois);
        break;
      case 'addPoi':
        this.pois = this.pois.filter((p) => p.id !== entry.poi);
        break;
      case 'removePoi':
        this.pois.push(entry.poi);
        break;
      case 'updatePoi': {
        const i = this.pois.findIndex((p) => p.id === entry.poi);
        if (i >= 0) this.pois[i] = entry.before;
        break;
      }
      case 'updateAnchor': {
        const i = this.anchors.findIndex((a) => a.id === entry.anchor);
        if (i >= 0) this.anchors[i] = entry.before;
        break;
      }
      case 'addAnchor':
        this.anchors = this.anchors.filter((a) => a.id !== entry.anchor);
        break;
      case 'removeAnchor':
        this.anchors.push(entry.anchor);
        break;
      case 'addFloor':
        this.floors = this.floors.filter((f) => f.index !== entry.floor);
        break;
      default:
    }
    return entry;
  }

  // ----------------------------------------------------------------- output

  toJSON() {
    const json = {
      schemaVersion: 1,
      id: this.id,
      name: this.name,
    };
    if (this.description) json.description = this.description;
    if (this.frame) json.frame = { ...this.frame };
    json.floors = this.floors.map((f) => ({ ...f }));
    json.nodes = this.nodes.map((n) => ({ ...n }));
    json.edges = this.edges.map((e) => ({ ...e }));
    json.pois = this.pois.map((p) => ({ ...p }));
    if (this.anchors.length) json.anchors = this.anchors.map((a) => ({ ...a }));
    if (this.languages) json.languages = structuredClone(this.languages);
    if (this.providers) json.providers = structuredClone(this.providers);
    if (this.runtimeConfigUrl) json.runtimeConfigUrl = this.runtimeConfigUrl;
    return json;
  }

  /** @returns {Array<{ path: string, message: string }>} */
  validate() {
    return validateVenue(this.toJSON());
  }

  get summary() {
    return {
      floors: this.floors.length,
      nodes: this.nodes.length,
      edges: this.edges.length,
      pois: this.pois.length,
      anchors: this.anchors.length,
      problems: this.validate().length,
    };
  }
}
