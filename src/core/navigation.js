/**
 * Route following: given a route from `findRoute()` and a stream of poses,
 * work out which node is next, how far is left, and whether the user has
 * arrived. Pure and synchronous, so the arrow, HUD and floor plan all agree.
 *
 * Progress is monotonic: the navigator advances past a node when the user
 * comes within `advanceRadius` of it (or passes its perpendicular on the
 * segment), and never goes backwards — a noisy pose behind the user must not
 * flip the arrow around.
 */

import { metresBetween } from './distance.js';

/** @typedef {import('./positioning.js').Pose} Pose */
/** @typedef {import('./router.js').RouteFound} RouteFound */

/**
 * @typedef {Object} NavigationState
 * @property {number} nextIndex          Index into route.nodes of the node to head for.
 * @property {object} nextNode           That node.
 * @property {object | null} nextEdge    The edge leading to it (null once at the last node).
 * @property {number} distanceToNext     Metres from the pose to nextNode.
 * @property {number} distanceRemaining  Metres from the pose to the destination along the route.
 * @property {boolean} arrived           Within `arriveRadius` of the destination.
 * @property {boolean} offFloor          The pose is on a different floor from nextNode.
 * @property {{ from: object, to: object, edge: object } | null} floorChange
 *   The next floor-change step on the route, if the user has not passed it.
 */

/**
 * @param {RouteFound} route
 * @param {{ advanceRadius?: number, arriveRadius?: number }} [options]
 */
export function createNavigator(route, options = {}) {
  if (!route || route.found !== true || !Array.isArray(route.nodes) || route.nodes.length === 0) {
    throw new TypeError('createNavigator requires a found route');
  }
  const advanceRadius = options.advanceRadius ?? 2;
  const arriveRadius = options.arriveRadius ?? 3;
  const nodes = route.nodes;
  const edges = route.edges ?? [];

  // Cumulative distance from each node to the destination, along the route.
  const remainingFrom = new Array(nodes.length).fill(0);
  for (let i = nodes.length - 2; i >= 0; i -= 1) {
    const len = edges[i]?.distance ?? metresBetween(nodes[i], nodes[i + 1]);
    remainingFrom[i] = remainingFrom[i + 1] + len;
  }

  let nextIndex = nodes.length === 1 ? 0 : 1;
  let lastState = null;

  /** Has the pose passed node i on the way to node i+1? */
  function passed(pose, i) {
    const node = nodes[i];
    if (node.floor !== pose.floor) return false;
    if (metresBetween(pose, node) <= advanceRadius) return true;
    const next = nodes[i + 1];
    if (!next || next.floor !== node.floor) return false;
    // Projection of the pose onto the segment node→next: past the node if > 0
    // and the pose is close to the segment.
    const sx = next.x - node.x;
    const sy = next.y - node.y;
    const len2 = sx * sx + sy * sy;
    if (len2 === 0) return false;
    const t = ((pose.x - node.x) * sx + (pose.y - node.y) * sy) / len2;
    if (t <= 0) return false;
    const px = node.x + sx * Math.min(1, t);
    const py = node.y + sy * Math.min(1, t);
    return Math.hypot(pose.x - px, pose.y - py) <= advanceRadius * 1.5;
  }

  return {
    get route() {
      return route;
    },

    /** Current state without advancing (null before the first update). */
    get state() {
      return lastState;
    },

    /**
     * Feed a pose; returns the new navigation state.
     * @param {Pose} pose
     * @returns {NavigationState}
     */
    update(pose) {
      // Advance to the furthest node we have reached (a fix may land the user
      // several nodes ahead), never backwards.
      for (let i = nodes.length - 2; i >= Math.max(0, nextIndex - 1); i -= 1) {
        if (passed(pose, i)) {
          nextIndex = Math.max(nextIndex, i + 1);
          break;
        }
      }
      // Special case: the last node counts as reached inside arriveRadius.
      const last = nodes[nodes.length - 1];
      const distanceToDestination = metresBetween(pose, last);
      const arrived = pose.floor === last.floor && distanceToDestination <= arriveRadius;
      if (arrived) nextIndex = nodes.length - 1;

      const nextNode = nodes[nextIndex];
      const offFloor = pose.floor !== nextNode.floor;
      const distanceToNext = offFloor
        ? Math.hypot(nextNode.x - pose.x, nextNode.y - pose.y)
        : metresBetween(pose, nextNode);
      const distanceRemaining = arrived ? 0 : distanceToNext + remainingFrom[nextIndex];

      let floorChange = null;
      for (let i = Math.max(0, nextIndex - 1); i < nodes.length - 1; i += 1) {
        if (nodes[i].floor !== nodes[i + 1].floor) {
          floorChange = { from: nodes[i], to: nodes[i + 1], edge: edges[i] };
          break;
        }
      }

      lastState = {
        nextIndex,
        nextNode,
        nextEdge: nextIndex > 0 ? (edges[nextIndex - 1] ?? null) : null,
        distanceToNext,
        distanceRemaining,
        arrived,
        offFloor,
        floorChange,
      };
      return lastState;
    },

    /** Reset progress to the start of the route. */
    reset() {
      nextIndex = nodes.length === 1 ? 0 : 1;
      lastState = null;
    },
  };
}
