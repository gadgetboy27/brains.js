/**
 * Pedestrian dead-reckoning simulator — walk a route with imperfect sensors
 * and measure how far off each positioning strategy ends up.
 *
 * The same synthetic walk (the same footsteps, compass noise, gyro bias and
 * magnetic disturbances) is fed to several configurations of the real
 * `PoseFusion`, `MapMatcher` and corner-correction code, so differences in
 * the results are down to the strategy, not luck. Only ONE exact fix is
 * given, at the start (a single QR marker); everything after is dead
 * reckoning, which is the hard case worth measuring.
 *
 * What it is and is not: the sensor models below are plausible, not measured.
 * It shows whether a strategy helps *in principle* and by how much under the
 * stated conditions; it cannot replace walking a real venue with the
 * in-app harness (docs/accuracy.md).
 */

import { findRoute } from './router.js';
import { MapMatcher } from './map-matching.js';
import { PoseFusion } from './fusion.js';
import { applyCornerCorrection, createTurnDetector } from './turn-correction.js';

/** Deterministic PRNG so runs are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal from a uniform generator (Box–Muller). */
function gaussian(random) {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const wrap360 = (d) => ((d % 360) + 360) % 360;
const angleDiff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

/**
 * @typedef {Object} Scenario
 * @property {number} [strideM=0.73]            What the app assumes.
 * @property {number} [strideError=0.08]        True stride is this much longer (0.08 = +8%).
 * @property {number} [compassBiasDeg=5]        Constant compass error (a headingOffsetDeg that is slightly off).
 * @property {number} [compassNoiseDeg=6]       Per-reading compass noise, 1σ.
 * @property {number} [disturbanceDeg=25]       Peak slow magnetic wobble along the route.
 * @property {number} [burstsPerWalk=2]         Short, large compass glitches (a lift, a steel door).
 * @property {number} [gyroBiasDps=0.4]         Constant gyro bias.
 * @property {number} [gyroNoiseDps=1.5]        Gyro noise, 1σ.
 */

const SCENARIO = Object.freeze({
  strideM: 0.73,
  strideError: 0.08,
  compassBiasDeg: 5,
  compassNoiseDeg: 6,
  disturbanceDeg: 25,
  burstsPerWalk: 2,
  gyroBiasDps: 0.4,
  gyroNoiseDps: 1.5,
});

export const VARIANTS = Object.freeze([
  { id: 'compass', label: 'Compass only', gyro: false, corners: false },
  { id: 'compass+corners', label: 'Compass + corner fixes', gyro: false, corners: true },
  { id: 'gyro', label: 'Gyro blended with compass', gyro: true, corners: false },
  { id: 'gyro+corners', label: 'Gyro blend + corner fixes', gyro: true, corners: true },
]);

/**
 * Build the sensor stream and ground truth for one walk along `nodes`.
 * @param {Array<{ x: number, y: number }>} nodes
 * @param {Scenario} scenario
 * @param {() => number} random
 */
export function generateWalk(nodes, scenario, random) {
  const sc = { ...SCENARIO, ...scenario };
  const dt = 0.05; // 20 Hz sensors
  const cum = [0];
  for (let i = 1; i < nodes.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y));
  }
  const total = cum.at(-1);
  const segAt = (d) => {
    let i = 0;
    while (i < nodes.length - 2 && d >= cum[i + 1]) i += 1;
    return i;
  };
  const bearing = (i) =>
    wrap360((Math.atan2(nodes[i + 1].x - nodes[i].x, nodes[i + 1].y - nodes[i].y) * 180) / Math.PI);

  const strideTrue = sc.strideM * (1 + sc.strideError);
  const stepPeriod = 0.55;
  const speed = strideTrue / stepPeriod;
  const duration = total / speed;
  const bursts = Array.from({ length: sc.burstsPerWalk }, () => ({
    at: 2 + random() * Math.max(1, duration - 5),
    len: 1.5 + random(),
    deg: (random() < 0.5 ? -1 : 1) * (40 + random() * 30),
  }));
  const wavelength = 10 + random() * 8;
  const phase = random() * Math.PI * 2;

  let d = 0;
  let heading = bearing(0);
  let nextStep = stepPeriod;
  const samples = [];
  for (let t = dt; d < total; t += dt) {
    d = Math.min(total, d + speed * dt);
    const target = bearing(segAt(Math.min(d, total - 1e-6)));
    const turn = Math.max(-150 * dt, Math.min(150 * dt, angleDiff(target, heading)));
    heading = wrap360(heading + turn);
    const yawRateCw = turn / dt;

    const seg = segAt(Math.min(d, total - 1e-6));
    const f = (d - cum[seg]) / (cum[seg + 1] - cum[seg]);
    const truth = {
      x: nodes[seg].x + (nodes[seg + 1].x - nodes[seg].x) * f,
      y: nodes[seg].y + (nodes[seg + 1].y - nodes[seg].y) * f,
    };

    const burst = bursts.find((b) => t >= b.at && t < b.at + b.len)?.deg ?? 0;
    const wobble = sc.disturbanceDeg * Math.sin((2 * Math.PI * d) / wavelength + phase);
    const compass = wrap360(
      heading + sc.compassBiasDeg + wobble + burst + gaussian(random) * sc.compassNoiseDeg
    );

    let peak = 0.2;
    if (t >= nextStep) {
      peak = 2.5;
      nextStep += stepPeriod;
    }
    samples.push({
      t,
      truth,
      compass,
      motion: {
        // Phone flat, face up: anticlockwise turns are positive about z.
        rotationRate: {
          alpha: -yawRateCw + sc.gyroBiasDps + gaussian(random) * sc.gyroNoiseDps,
          beta: gaussian(random) * 0.5,
          gamma: gaussian(random) * 0.5,
        },
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 + gaussian(random) * 0.3 },
        acceleration: { x: 0, y: peak, z: 0 },
      },
    });
  }
  return { samples, initialHeading: bearing(0), total };
}

/**
 * Feed one generated walk to one variant of the app's positioning.
 * @returns {{ displayErrors: number[], rawErrors: number[], finalError: number,
 *   corrections: Array<{ before: number, after: number }> }}
 */
export function runVariant(venue, nodes, walk, variant, scenario = {}) {
  const sc = { ...SCENARIO, ...scenario };
  let nowMs = 1_000_000;
  const fusion = new PoseFusion({ now: () => nowMs, strideM: sc.strideM });
  const turns = createTurnDetector();
  const matcher = new MapMatcher(venue);
  fusion.applyFix({
    x: nodes[0].x,
    y: nodes[0].y,
    z: 0,
    floor: nodes[0].floor ?? 0,
    heading: walk.initialHeading,
    confidence: 1,
    timestamp: nowMs,
  });

  const displayErrors = [];
  const rawErrors = [];
  const corrections = [];
  let lastTick = 0;
  let last = null;
  for (const s of walk.samples) {
    nowMs = 1_000_000 + Math.round(s.t * 1000);
    fusion.handleMotion(
      variant.gyro ? s.motion : { acceleration: s.motion.acceleration } // no rotationRate: compass only
    );
    fusion.handleOrientation({ webkitCompassHeading: s.compass });
    last = s;
    if (s.t - lastTick >= 0.25) {
      lastTick = s.t;
      let fused = fusion.getPose();
      if (variant.corners) {
        const corrected = applyCornerCorrection(fusion, turns, venue, fused);
        if (corrected) {
          corrections.push({
            before: Math.hypot(fused.x - s.truth.x, fused.y - s.truth.y),
            after: Math.hypot(corrected.x - s.truth.x, corrected.y - s.truth.y),
          });
          fused = corrected;
        }
      }
      const shown = matcher.update(fused).pose;
      rawErrors.push(Math.hypot(fused.x - s.truth.x, fused.y - s.truth.y));
      displayErrors.push(Math.hypot(shown.x - s.truth.x, shown.y - s.truth.y));
      fusion.tick();
    }
  }
  const end = fusion.getPose();
  return {
    displayErrors,
    rawErrors,
    finalError: Math.hypot(end.x - last.truth.x, end.y - last.truth.y),
    corrections,
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : 0;
};

/**
 * Compare the variants over many random walks of the given routes.
 *
 * @param {object} options
 * @param {import('./venue.js').Venue} options.venue
 * @param {Array<[string, string]>} options.routes  [from node id, to node id] pairs.
 * @param {number} [options.runs=40]   Random walks per route.
 * @param {Scenario} [options.scenario]
 * @param {number} [options.seed=1]
 */
export function compareVariants({ venue, routes, runs = 40, scenario = {}, seed = 1 }) {
  const acc = Object.fromEntries(
    VARIANTS.map((v) => [v.id, { display: [], raw: [], finals: [], corrections: [] }])
  );
  let walks = 0;
  routes.forEach(([from, to], routeIndex) => {
    const route = findRoute(venue.graph, from, to);
    if (!route.found) throw new Error(`no route from ${from} to ${to}`);
    for (let r = 0; r < runs; r += 1) {
      // Same seed for every variant: identical footsteps and sensor noise.
      const walk = generateWalk(
        route.nodes,
        scenario,
        mulberry32(seed * 100003 + routeIndex * 1009 + r)
      );
      walks += 1;
      for (const v of VARIANTS) {
        const out = runVariant(venue, route.nodes, walk, v, scenario);
        acc[v.id].display.push(...out.displayErrors);
        acc[v.id].raw.push(...out.rawErrors);
        acc[v.id].finals.push(out.finalError);
        acc[v.id].corrections.push(...out.corrections);
      }
    }
  });
  const results = VARIANTS.map((v) => {
    const a = acc[v.id];
    return {
      id: v.id,
      label: v.label,
      meanM: mean(a.display),
      p95M: quantile(a.display, 0.95),
      worstM: Math.max(...a.display),
      finalMeanM: mean(a.finals),
      rawMeanM: mean(a.raw),
      correctionsPerWalk: a.corrections.length / walks,
      correctionsHelpedPct: a.corrections.length
        ? (100 * a.corrections.filter((c) => c.after < c.before).length) / a.corrections.length
        : null,
      correctionMeanBeforeM: a.corrections.length ? mean(a.corrections.map((c) => c.before)) : null,
      correctionMeanAfterM: a.corrections.length ? mean(a.corrections.map((c) => c.after)) : null,
      over3mPct: (100 * a.display.filter((e) => e > 3).length) / a.display.length,
    };
  });
  return { walks, runs, routes, scenario: { ...SCENARIO, ...scenario }, results };
}

/** Markdown table of a comparison. */
export function formatComparison(c) {
  const f = (n) => n.toFixed(2);
  const lines = [
    `# Positioning strategy comparison`,
    '',
    `${c.walks} simulated walks (${c.runs} per route, ${c.routes.length} routes), one QR scan at the start and none after.`,
    '',
    `Scenario: stride ${c.scenario.strideM} m assumed, true stride ${(c.scenario.strideError * 100).toFixed(0)}% longer; ` +
      `compass bias ${c.scenario.compassBiasDeg}°, noise ${c.scenario.compassNoiseDeg}°, magnetic wobble ±${c.scenario.disturbanceDeg}° ` +
      `and ${c.scenario.burstsPerWalk} glitches per walk; gyro bias ${c.scenario.gyroBiasDps}°/s, noise ${c.scenario.gyroNoiseDps}°/s.`,
    '',
    '| Strategy | Mean error (m) | 95th pct (m) | Worst (m) | Error at the end (m) | Time > 3 m off | Mean error before map snapping (m) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...c.results.map(
      (r) =>
        `| ${r.label} | ${f(r.meanM)} | ${f(r.p95M)} | ${f(r.worstM)} | ${f(r.finalMeanM)} | ${r.over3mPct.toFixed(0)}% | ${f(r.rawMeanM)} |`
    ),
    '',
    ...c.results
      .filter((r) => r.correctionsHelpedPct !== null)
      .map(
        (r) =>
          `${r.label}: corner fixes fired ${r.correctionsPerWalk.toFixed(1)} times per walk and reduced the error ${r.correctionsHelpedPct.toFixed(0)}% of the time (${f(r.correctionMeanBeforeM)} m → ${f(r.correctionMeanAfterM)} m on average when they fired).`
      ),
    '',
    'Errors are the displayed position (after map snapping) against the true position, sampled four times a second.',
  ];
  return lines.join('\n');
}
