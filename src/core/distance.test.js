import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M, calculateDistance, metresBetween, pathLength } from './distance.js';

// One degree of arc along a great circle, in metres (R * π / 180).
const ONE_DEGREE_M = (EARTH_RADIUS_M * Math.PI) / 180;

describe('calculateDistance (Haversine)', () => {
  it('returns 0 for identical points', () => {
    expect(calculateDistance(51.5, -0.12, 51.5, -0.12)).toBe(0);
  });

  it('matches one degree of latitude anywhere on the globe', () => {
    expect(calculateDistance(0, 0, 1, 0)).toBeCloseTo(ONE_DEGREE_M, 3);
    expect(calculateDistance(50, 10, 51, 10)).toBeCloseTo(ONE_DEGREE_M, 3);
  });

  it('matches one degree of longitude at the equator', () => {
    expect(calculateDistance(0, 0, 0, 1)).toBeCloseTo(ONE_DEGREE_M, 3);
  });

  it('shrinks longitude spacing with latitude', () => {
    // At 60° N a degree of longitude is cos(60°) = 0.5 of its equatorial length.
    const atEquator = calculateDistance(0, 0, 0, 1);
    const at60N = calculateDistance(60, 0, 60, 1);
    expect(at60N / atEquator).toBeCloseTo(0.5, 3);
  });

  it('gives half the circumference for antipodal points', () => {
    expect(calculateDistance(0, 0, 0, 180)).toBeCloseTo(Math.PI * EARTH_RADIUS_M, 3);
    expect(calculateDistance(90, 0, -90, 0)).toBeCloseTo(Math.PI * EARTH_RADIUS_M, 3);
  });

  it('is symmetric', () => {
    const ab = calculateDistance(48.8566, 2.3522, 51.5074, -0.1278);
    const ba = calculateDistance(51.5074, -0.1278, 48.8566, 2.3522);
    expect(ab).toBeCloseTo(ba, 9);
  });

  it('computes a known city-pair distance (Paris to London)', () => {
    // Notre-Dame to Charing Cross, ~343.5 km great-circle.
    const d = calculateDistance(48.853, 2.3499, 51.5074, -0.1278);
    expect(d).toBeGreaterThan(343_000);
    expect(d).toBeLessThan(344_000);
  });

  it('handles crossing the antimeridian', () => {
    const across = calculateDistance(0, 179.5, 0, -179.5);
    expect(across).toBeCloseTo(ONE_DEGREE_M, 3);
  });

  it('handles short indoor-scale distances without collapsing to 0', () => {
    // ~1 m north.
    const d = calculateDistance(51.5, 0, 51.5 + 1 / ONE_DEGREE_M, 0);
    expect(d).toBeCloseTo(1, 4);
  });

  it('rejects non-finite input', () => {
    expect(() => calculateDistance(NaN, 0, 0, 0)).toThrow(TypeError);
    expect(() => calculateDistance(0, Infinity, 0, 0)).toThrow(TypeError);
    expect(() => calculateDistance(0, 0, '51', 0)).toThrow(TypeError);
    expect(() => calculateDistance(0, 0, 0, undefined)).toThrow(TypeError);
  });
});

describe('metresBetween (venue-local cartesian)', () => {
  it('returns 0 for identical points', () => {
    expect(metresBetween({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 })).toBe(0);
  });

  it('computes a 3-4-5 triangle in 2-D', () => {
    expect(metresBetween({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('computes a 1-2-2-3 triple in 3-D', () => {
    expect(metresBetween({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 2 })).toBe(3);
  });

  it('treats a missing z as 0', () => {
    expect(metresBetween({ x: 0, y: 0 }, { x: 0, y: 0, z: 2.5 })).toBe(2.5);
    expect(metresBetween({ x: 0, y: 0, z: 2.5 }, { x: 0, y: 0 })).toBe(2.5);
  });

  it('handles negative coordinates and is symmetric', () => {
    const a = { x: -3, y: 7, z: -1 };
    const b = { x: 2, y: -5, z: 4 };
    expect(metresBetween(a, b)).toBeCloseTo(Math.sqrt(25 + 144 + 25), 12);
    expect(metresBetween(a, b)).toBe(metresBetween(b, a));
  });

  it('ignores extra properties on the points', () => {
    const a = { x: 0, y: 0, floor: 1, name: 'Entrance' };
    const b = { x: 6, y: 8, floor: 1, name: 'Info desk' };
    expect(metresBetween(a, b)).toBe(10);
  });

  it('rejects missing or non-numeric points', () => {
    expect(() => metresBetween(null, { x: 0, y: 0 })).toThrow(TypeError);
    expect(() => metresBetween({ x: 0, y: 0 }, undefined)).toThrow(TypeError);
    expect(() => metresBetween({ x: 0 }, { x: 0, y: 0 })).toThrow(TypeError);
    expect(() => metresBetween({ x: '0', y: 0 }, { x: 0, y: 0 })).toThrow(TypeError);
    expect(() => metresBetween({ x: 0, y: 0, z: NaN }, { x: 0, y: 0 })).toThrow(TypeError);
  });
});

describe('pathLength', () => {
  it('is 0 for an empty path', () => {
    expect(pathLength([])).toBe(0);
  });

  it('is 0 for a single point', () => {
    expect(pathLength([{ x: 5, y: 5 }])).toBe(0);
  });

  it('equals metresBetween for two points', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 3, y: 4 };
    expect(pathLength([a, b])).toBe(metresBetween(a, b));
  });

  it('sums the perimeter of a closed square', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    expect(pathLength(square)).toBe(40);
  });

  it('follows the path rather than the straight line', () => {
    // Detour around a corner: 3 + 4 = 7, not the 5 m straight line.
    const detour = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(pathLength(detour)).toBe(7);
  });

  it('counts vertical travel between floors when z is present', () => {
    const stairs = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 4 },
      { x: 3, y: 0, z: 4 },
    ];
    expect(pathLength(stairs)).toBe(7);
  });

  it('accepts a custom metric for lat/lon points', () => {
    const geo = (a, b) => calculateDistance(a.lat, a.lon, b.lat, b.lon);
    const route = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
      { lat: 2, lon: 0 },
    ];
    expect(pathLength(route, geo)).toBeCloseTo(2 * ONE_DEGREE_M, 3);
  });

  it('propagates errors from the metric for bad points', () => {
    expect(() =>
      pathLength([
        { x: 0, y: 0 },
        { x: 'oops', y: 0 },
      ])
    ).toThrow(TypeError);
  });

  it('rejects a non-array argument', () => {
    expect(() => pathLength(null)).toThrow(TypeError);
    expect(() => pathLength({ x: 0, y: 0 })).toThrow(TypeError);
  });
});
