/**
 * Distance helpers.
 *
 * Two coordinate systems are supported:
 *  - Geographic (latitude/longitude in degrees) via the Haversine formula.
 *    Ported from `calculateDistance()` in legacy/navigation.js.
 *  - Venue-local cartesian ({ x, y, z } in metres) via straight Euclidean
 *    distance. This is what positioning providers report and what venue JSON
 *    uses, so it is the default for path calculations.
 *
 * All results are in metres.
 */

/** Mean Earth radius in metres, as used by the legacy implementation. */
export const EARTH_RADIUS_M = 6371e3;

const DEG_TO_RAD = Math.PI / 180;

function assertFinite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got ${String(value)}`);
  }
}

/**
 * Great-circle distance between two geographic points (Haversine).
 *
 * @param {number} lat1 - Latitude of the first point, in degrees.
 * @param {number} lon1 - Longitude of the first point, in degrees.
 * @param {number} lat2 - Latitude of the second point, in degrees.
 * @param {number} lon2 - Longitude of the second point, in degrees.
 * @returns {number} Distance in metres.
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  assertFinite(lat1, 'lat1');
  assertFinite(lon1, 'lon1');
  assertFinite(lat2, 'lat2');
  assertFinite(lon2, 'lon2');

  const φ1 = lat1 * DEG_TO_RAD;
  const φ2 = lat2 * DEG_TO_RAD;
  const Δφ = (lat2 - lat1) * DEG_TO_RAD;
  const Δλ = (lon2 - lon1) * DEG_TO_RAD;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_M * c;
}

/**
 * Straight-line distance between two venue-local cartesian points.
 *
 * `z` is optional on either point and defaults to 0, so 2-D floor-plan
 * coordinates and 3-D positions can be mixed.
 *
 * @param {{ x: number, y: number, z?: number }} a
 * @param {{ x: number, y: number, z?: number }} b
 * @returns {number} Distance in metres.
 */
export function metresBetween(a, b) {
  if (a == null || b == null) {
    throw new TypeError('metresBetween requires two points');
  }
  assertFinite(a.x, 'a.x');
  assertFinite(a.y, 'a.y');
  assertFinite(b.x, 'b.x');
  assertFinite(b.y, 'b.y');

  const az = a.z ?? 0;
  const bz = b.z ?? 0;
  assertFinite(az, 'a.z');
  assertFinite(bz, 'b.z');

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = bz - az;
  return Math.hypot(dx, dy, dz);
}

/**
 * Total length of a polyline: the sum of the distances between each pair of
 * consecutive points. An empty array or a single point has length 0.
 *
 * @template P
 * @param {P[]} points - Ordered points along the path.
 * @param {(a: P, b: P) => number} [metric=metresBetween] - Distance function
 *   for one segment. Defaults to venue-local cartesian; pass a wrapper around
 *   `calculateDistance` for lat/lon points.
 * @returns {number} Path length in metres.
 */
export function pathLength(points, metric = metresBetween) {
  if (!Array.isArray(points)) {
    throw new TypeError('pathLength requires an array of points');
  }

  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += metric(points[i - 1], points[i]);
  }
  return total;
}
