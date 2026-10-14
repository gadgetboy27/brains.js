/**
 * Off-route detection — is the user still on the route they were given?
 *
 * Two independent signals, both measured against the route polyline on the
 * pose's floor:
 *
 *  1. **Cross-track distance** — how far the pose is from the nearest route
 *     segment. A user in the right corridor is within a metre or two; one who
 *     took a side turn is not.
 *  2. **Moving away** — the distance to the next node has grown well beyond
 *     the closest it has been, which catches walking straight back the way
 *     they came (cross-track alone stays small on a corridor that is part of
 *     the route).
 *
 * Dead reckoning is noisy, so a low-confidence pose must be off by several
 * consecutive updates before it counts. An exact fix (confidence ≥ 1, a QR
 * scan) is trusted outright: if it lands off the route, the user is off the
 * route. After a reroute, `cooldownMs` stops it firing again on the same
 * wobble.
 *
 * Pure and synchronous apart from the injected clock. Compass heading is
 * deliberately not a trigger: a phone held loosely does not point where the
 * person is walking.
 */

import { metresBetween } from './distance.js';
import { projectOntoSegment } from './map-matching.js';

/** @typedef {import('./positioning.js').Pose} Pose */
/** @typedef {import('./router.js').RouteFound} RouteFound */

/**
 * Distance from a pose to the nearest segment of the route on its floor.
 *
 * @param {Pose} pose
 * @param {RouteFound} route
 * @returns {number | null} Metres, or null when the route has no same-floor segment.
 */
export function crossTrackDistance(pose, route) {
  const nodes = route.nodes;
  let best = null;
  if (nodes.length === 1) {
    return nodes[0].floor === pose.floor ? metresBetween(pose, nodes[0]) : null;
  }
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (a.floor !== pose.floor || b.floor !== pose.floor) continue;
    const d = projectOntoSegment(pose, a, b).distance;
    if (best === null || d < best) best = d;
  }
  return best;
}

/**
 * @param {RouteFound} route
 * @param {{
 *   offRouteM?: number, confirmCount?: number, awayM?: number,
 *   cooldownMs?: number, now?: () => number,
 * }} [options]
 */
export function createOffRouteDetector(route, options = {}) {
  const offRouteM = options.offRouteM ?? 5;
  const confirmCount = options.confirmCount ?? 4;
  const awayM = options.awayM ?? 5;
  const cooldownMs = options.cooldownMs ?? 8000;
  const now = options.now ?? (() => Date.now());

  let strikes = 0;
  let closestToNext = Infinity;
  let closestIndex = -1;
  let quietUntil = 0;

  return {
    /**
     * @param {Pose} pose
     * @param {import('./navigation.js').NavigationState} state  From the navigator, same pose.
     * @returns {{ offRoute: boolean, reason: 'away' | 'cross-track' | null, crossTrackM: number | null }}
     */
    update(pose, state) {
      const none = (crossTrackM) => ({ offRoute: false, reason: null, crossTrackM });
      if (state.arrived || state.offFloor) {
        strikes = 0;
        return none(null);
      }
      // Reset the "closest approach" bookkeeping whenever the target changes.
      if (state.nextIndex !== closestIndex) {
        closestIndex = state.nextIndex;
        closestToNext = state.distanceToNext;
      } else {
        closestToNext = Math.min(closestToNext, state.distanceToNext);
      }

      const crossTrackM = crossTrackDistance(pose, route);
      if (crossTrackM === null) return none(null);
      if (now() < quietUntil) return none(crossTrackM);

      const away = state.distanceToNext - closestToNext > awayM;
      const wide = crossTrackM > offRouteM;
      if (!away && !wide) {
        strikes = 0;
        return none(crossTrackM);
      }
      strikes += 1;
      const exact = pose.confidence >= 1;
      if (exact || strikes >= confirmCount) {
        strikes = 0;
        return { offRoute: true, reason: wide ? 'cross-track' : 'away', crossTrackM };
      }
      return none(crossTrackM);
    },

    /** Call after rerouting (or if the user dismisses the alert). */
    acknowledge() {
      strikes = 0;
      closestToNext = Infinity;
      closestIndex = -1;
      quietUntil = now() + cooldownMs;
    },
  };
}
