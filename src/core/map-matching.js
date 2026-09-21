/**
 * Map matching — giving the app a sense of where it is from what it already
 * knows about the building.
 *
 * Between exact fixes (a QR scan, a VPS localisation) the position comes from
 * dead reckoning and drifts. But the venue's route graph says where people
 * can actually walk, and the places and markers say what is where. So:
 *
 *  1. **Snap to the graph.** A pose within `maxSnapM` of a corridor edge on
 *     its floor is projected onto that edge — you cannot be inside a wall —
 *     with hysteresis so the estimate does not hop between parallel
 *     corridors on every update. An exact fix (confidence ≥ 1) is never
 *     moved. Confidence gets a small boost when the pose is on the graph.
 *  2. **Recognise landmarks.** Places, markers and named nodes within
 *     `landmarkRadiusM` are reported as the user enters and leaves their
 *     vicinity ("passing Reception"), for speech, the HUD, and logs. As more
 *     places are added the building becomes more legible to the app without
 *     any new hardware.
 *
 * Pure and synchronous. The app feeds it every pose.
 */

import { metresBetween } from './distance.js';

/** @typedef {import('./positioning.js').Pose} Pose */
/** @typedef {import('./venue.js').Venue} Venue */

/** Closest point on segment ab to p (2-D), with the parameter t in [0, 1]. */
export function projectOntoSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y, t: 0, distance: Math.hypot(p.x - a.x, p.y - a.y) };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return { x, y, t, distance: Math.hypot(p.x - x, p.y - y) };
}

/**
 * The nearest walkable edge on the pose's floor.
 * @param {Pose} pose
 * @param {Venue} venue
 * @param {{ maxDistance?: number, includeStaff?: boolean }} [options]
 * @returns {{ edge: object, point: { x: number, y: number }, distance: number, t: number } | null}
 */
export function nearestEdge(pose, venue, { maxDistance = Infinity, includeStaff = false } = {}) {
  let best = null;
  for (const edge of venue.graph.edges) {
    if (edge.closed === true) continue;
    if (edge.staffOnly && !includeStaff) continue;
    const a = venue.nodeById(edge.from);
    const b = venue.nodeById(edge.to);
    if (!a || !b || a.floor !== pose.floor || b.floor !== pose.floor) continue; // stairs/lifts are not corridors
    const proj = projectOntoSegment(pose, a, b);
    if (proj.distance <= maxDistance && (!best || proj.distance < best.distance)) {
      best = { edge, point: { x: proj.x, y: proj.y }, distance: proj.distance, t: proj.t };
    }
  }
  return best;
}

/**
 * Landmarks within `radius` of a pose on its floor, nearest first: places and
 * markers, plus named nodes when `includeNodes` is set (corridor names are
 * usually noise to a visitor, but useful for staff surveys).
 * @param {Pose} pose
 * @param {Venue} venue
 * @param {number} [radius=6]
 * @param {{ includeNodes?: boolean }} [options]
 * @returns {Array<{ kind: 'poi' | 'anchor' | 'node', id: string, name: string, distance: number }>}
 */
export function nearbyLandmarks(pose, venue, radius = 6, { includeNodes = false } = {}) {
  const out = [];
  for (const poi of venue.pois) {
    if (poi.hidden || (poi.access ?? 'public') !== 'public') continue;
    const node = venue.nodeById(poi.node);
    if (!node || node.floor !== pose.floor) continue;
    const d = metresBetween(pose, { ...node, z: pose.z ?? 0 });
    if (d <= radius) out.push({ kind: 'poi', id: poi.id, name: poi.name, distance: d });
  }
  for (const a of venue.anchors) {
    if (a.floor !== pose.floor) continue;
    const d = Math.hypot(a.x - pose.x, a.y - pose.y);
    if (d <= radius) out.push({ kind: 'anchor', id: a.id, name: a.name ?? a.id, distance: d });
  }
  const poiNodes = new Set(venue.pois.map((p) => p.node));
  for (const n of includeNodes ? venue.nodesOnFloor(pose.floor) : []) {
    if (!n.name || poiNodes.has(n.id)) continue; // a place already names it
    const d = Math.hypot(n.x - pose.x, n.y - pose.y);
    if (d <= radius) out.push({ kind: 'node', id: n.id, name: n.name, distance: d });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * Stateful matcher: snaps poses to the graph with hysteresis and tracks
 * which landmarks the user is passing.
 */
export class MapMatcher {
  #venue;
  #opts;
  #lastEdge = null;
  #near = new Map(); // landmark key -> landmark, currently within radius

  /**
   * @param {Venue} venue
   * @param {{ maxSnapM?: number, stickyM?: number, landmarkRadiusM?: number, exitRadiusM?: number, includeStaff?: boolean, onGraphConfidenceBoost?: number }} [options]
   */
  constructor(venue, options = {}) {
    if (!venue?.graph) throw new TypeError('MapMatcher requires a Venue');
    this.#venue = venue;
    this.#opts = {
      maxSnapM: 4, // further than this from any corridor: leave the pose alone
      stickyM: 2, // keep the previous edge unless another is this much closer
      landmarkRadiusM: 6,
      exitRadiusM: 9, // hysteresis: further than this before "passed"
      includeStaff: false,
      includeNodes: false,
      onGraphConfidenceBoost: 0.1,
      ...options,
    };
  }

  /** Swap the venue (e.g. after a runtime-config update). Keeps landmark state by key. */
  setVenue(venue) {
    this.#venue = venue;
    this.#lastEdge = null;
  }

  /**
   * @param {Pose} pose
   * @returns {{ pose: Pose, snapped: boolean, edge: object | null, offPathM: number | null, entered: object[], left: object[], nearby: object[] }}
   */
  update(pose) {
    // --- snap
    let out = pose;
    let snapped = false;
    let edge = null;
    let offPathM = null;
    if (pose.confidence < 1) {
      const candidates = nearestEdge(pose, this.#venue, {
        maxDistance: this.#opts.maxSnapM,
        includeStaff: this.#opts.includeStaff,
      });
      let chosen = candidates;
      // Hysteresis: prefer the edge we were on unless the new one is clearly closer.
      if (this.#lastEdge && candidates && candidates.edge !== this.#lastEdge) {
        const a = this.#venue.nodeById(this.#lastEdge.from);
        const b = this.#venue.nodeById(this.#lastEdge.to);
        if (a && b && a.floor === pose.floor && b.floor === pose.floor) {
          const prev = projectOntoSegment(pose, a, b);
          if (
            prev.distance <= this.#opts.maxSnapM &&
            prev.distance - candidates.distance < this.#opts.stickyM
          ) {
            chosen = {
              edge: this.#lastEdge,
              point: { x: prev.x, y: prev.y },
              distance: prev.distance,
              t: prev.t,
            };
          }
        }
      }
      if (chosen) {
        edge = chosen.edge;
        offPathM = chosen.distance;
        out = {
          ...pose,
          x: chosen.point.x,
          y: chosen.point.y,
          confidence: Math.min(0.99, pose.confidence + this.#opts.onGraphConfidenceBoost),
        };
        snapped = true;
        this.#lastEdge = chosen.edge;
      } else {
        this.#lastEdge = null;
      }
    } else {
      // An exact fix re-anchors: remember the edge it lies on, if any.
      const on = nearestEdge(pose, this.#venue, {
        maxDistance: this.#opts.maxSnapM,
        includeStaff: this.#opts.includeStaff,
      });
      this.#lastEdge = on?.edge ?? null;
      edge = on?.edge ?? null;
      offPathM = on?.distance ?? null;
    }

    // --- landmarks with enter/leave hysteresis
    const nearby = nearbyLandmarks(out, this.#venue, this.#opts.exitRadiusM, {
      includeNodes: this.#opts.includeNodes,
    });
    const entered = [];
    const left = [];
    const seen = new Set();
    for (const lm of nearby) {
      const key = `${lm.kind}:${lm.id}`;
      seen.add(key);
      if (!this.#near.has(key) && lm.distance <= this.#opts.landmarkRadiusM) {
        this.#near.set(key, lm);
        entered.push(lm);
      }
    }
    for (const [key, lm] of this.#near) {
      if (!seen.has(key)) {
        this.#near.delete(key);
        left.push(lm);
      }
    }
    return {
      pose: out,
      snapped,
      edge,
      offPathM,
      entered,
      left,
      nearby: nearby.filter((l) => l.distance <= this.#opts.landmarkRadiusM),
    };
  }

  /** Landmarks currently within range. */
  get near() {
    return [...this.#near.values()];
  }

  reset() {
    this.#lastEdge = null;
    this.#near.clear();
  }
}
