/**
 * Turn correction — using the building's own corners as free position fixes.
 *
 * Between QR scans the position is dead-reckoned, and its worst error is
 * *along* the corridor: a stride that is a few percent off puts you 3 m
 * short of, or past, a junction. Map matching (./map-matching.js) already
 * fixes sideways drift but cannot tell how far along you are. A turn can:
 * people turn at junctions, and the venue graph says where those are.
 *
 *  1. {@link createTurnDetector} watches the heading stream for a sustained
 *     change of direction (steady heading, then a different steady heading),
 *     while the user is walking, and reports how big the turn was and where
 *     dead reckoning *thought* it happened.
 *  2. {@link matchTurn} looks for graph junctions near that spot whose
 *     incoming direction, outgoing direction and turn angle all fit. Only if
 *     **exactly one** junction fits is the position corrected, by the offset
 *     from where the turn was thought to be to where it must have been, so
 *     the metres walked since the corner are kept. An ambiguous turn (two
 *     similar junctions) or an unmapped one (a doorway, a room) changes
 *     nothing: a wrong correction is worse than none.
 *
 * It never produces an exact fix (confidence 1): the caller treats the result
 * as a soft fix. It assumes the phone points the way the person walks, the
 * same assumption pedestrian dead reckoning already makes.
 *
 * Headings are degrees clockwise from venue +y, as in ./fusion.js.
 */

/** @typedef {import('./positioning.js').Pose} Pose */
/** @typedef {import('./venue.js').Venue} Venue */

/** Signed smallest difference a−b in degrees, in (-180, 180]. */
export function angleDiff(a, b) {
  const d = ((((a - b) % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}

const RAD = Math.PI / 180;

function circularMean(values) {
  const c = values.reduce((t, v) => t + Math.cos(v * RAD), 0) / values.length;
  const s = values.reduce((t, v) => t + Math.sin(v * RAD), 0) / values.length;
  return { mean: Math.atan2(s, c) / RAD, r: Math.hypot(c, s) };
}

/**
 * @typedef {Object} Turn
 * @property {number} angle          Signed turn in degrees, clockwise positive.
 * @property {number} headingBefore  Steady heading before the turn.
 * @property {number} headingAfter   Steady heading after it.
 * @property {number} x              Where dead reckoning put the turn.
 * @property {number} y
 * @property {number} floor
 */

/**
 * @param {{ minTurnDeg?: number, steadyR?: number, beforeMs?: [number, number],
 *   afterMs?: number, minSamples?: number, minWalkedM?: number, cooldownMs?: number }} [options]
 */
export function createTurnDetector(options = {}) {
  const {
    minTurnDeg = 55,
    steadyR = 0.9, // 1 = identical headings; 0.9 ≈ ±26° spread
    beforeMs = [2500, 6000], // the "before" window: this long ago…
    afterMs = 1500, // …and the "after" window: the last this-many ms
    minSamples = 4,
    minWalkedM = 2,
    cooldownMs = 5000,
  } = options;

  /** @type {Array<{ t: number, x: number, y: number, h: number, floor: number }>} */
  let samples = [];
  let quietUntil = 0;

  return {
    /**
     * Feed the fused pose (any rate); returns a turn when one has just completed.
     * @param {Pose} pose
     * @returns {Turn | null}
     */
    update(pose) {
      const t = pose.timestamp;
      if (!Number.isFinite(t) || !Number.isFinite(pose.heading)) return null;
      const last = samples.at(-1);
      if (last && (pose.floor !== last.floor || t < last.t)) samples = []; // new floor / clock reset
      samples.push({ t, x: pose.x, y: pose.y, h: pose.heading, floor: pose.floor });
      samples = samples.filter((s) => t - s.t <= beforeMs[1]);
      if (t < quietUntil) return null;

      const before = samples.filter((s) => t - s.t >= beforeMs[0]);
      const after = samples.filter((s) => t - s.t <= afterMs);
      if (before.length < minSamples || after.length < minSamples) return null;

      const b = circularMean(before.map((s) => s.h));
      const a = circularMean(after.map((s) => s.h));
      if (b.r < steadyR || a.r < steadyR) return null;
      const angle = angleDiff(a.mean, b.mean);
      if (Math.abs(angle) < minTurnDeg) return null;

      // A turn on the spot is not a corner: they must have been walking.
      const first = before[0];
      const lastBefore = before.at(-1);
      if (Math.hypot(lastBefore.x - first.x, lastBefore.y - first.y) < minWalkedM) return null;

      // Where it happened: the first sample that has left the old heading.
      const departed = samples.find(
        (s) => s.t > lastBefore.t && Math.abs(angleDiff(s.h, b.mean)) > minTurnDeg / 2
      );
      const at = departed ?? samples.at(-1);

      quietUntil = t + cooldownMs;
      samples = after;
      return {
        angle,
        headingBefore: (b.mean + 360) % 360,
        headingAfter: (a.mean + 360) % 360,
        x: at.x,
        y: at.y,
        floor: pose.floor,
      };
    },

    reset() {
      samples = [];
      quietUntil = 0;
    },
  };
}

const bearing = (from, to) => (Math.atan2(to.x - from.x, to.y - from.y) / RAD + 360) % 360;

/**
 * Which junction was that turn? Returns the offset to add to the current
 * dead-reckoned position, or null unless exactly one junction fits.
 *
 * @param {Turn} turn
 * @param {Venue} venue
 * @param {{ radiusM?: number, turnTolDeg?: number, legTolDeg?: number, includeStaff?: boolean }} [options]
 * @returns {{ node: object, dx: number, dy: number, distanceM: number } | null}
 */
export function matchTurn(turn, venue, options = {}) {
  const { radiusM = 6, turnTolDeg = 35, legTolDeg = 40, includeStaff = false } = options;

  // Walkable neighbours of each node on this floor.
  const neighbours = new Map();
  const link = (a, b) => {
    if (!neighbours.has(a.id)) neighbours.set(a.id, []);
    neighbours.get(a.id).push(b);
  };
  for (const e of venue.graph.edges) {
    if (e.closed === true || (e.staffOnly && !includeStaff)) continue;
    const a = venue.nodeById(e.from);
    const b = venue.nodeById(e.to);
    if (!a || !b || a.floor !== turn.floor || b.floor !== turn.floor) continue;
    link(a, b);
    if (e.oneWay !== true) link(b, a);
  }

  const fits = [];
  for (const node of venue.nodesOnFloor(turn.floor)) {
    const distanceM = Math.hypot(node.x - turn.x, node.y - turn.y);
    if (distanceM > radiusM) continue;
    const around = neighbours.get(node.id) ?? [];
    const ok = around.some((u) =>
      around.some((w) => {
        if (u === w) return false;
        const inB = bearing(u, node); // walking u → node …
        const outB = bearing(node, w); // … then node → w
        return (
          Math.abs(angleDiff(angleDiff(outB, inB), turn.angle)) <= turnTolDeg &&
          Math.abs(angleDiff(inB, turn.headingBefore)) <= legTolDeg &&
          Math.abs(angleDiff(outB, turn.headingAfter)) <= legTolDeg
        );
      })
    );
    if (ok) fits.push({ node, distanceM });
  }
  if (fits.length !== 1) return null; // none (unmapped turn) or ambiguous
  const { node, distanceM } = fits[0];
  return { node, dx: node.x - turn.x, dy: node.y - turn.y, distanceM };
}

/**
 * The whole corner-correction step, shared by the app and the accuracy
 * simulator so both run exactly the same logic: feed the fused pose to the
 * detector and, if that completes a corner that matches exactly one junction,
 * re-seed the fusion there as a soft fix.
 *
 * @param {import('./fusion.js').PoseFusion} fusion
 * @param {ReturnType<typeof createTurnDetector>} detector
 * @param {Venue} venue
 * @param {Pose} fused  The fusion's current pose.
 * @param {{ minOffsetM?: number }} [options]  Ignore corrections smaller than this (default 1 m).
 * @returns {Pose | null} The corrected pose, or null when nothing changed.
 */
export function applyCornerCorrection(fusion, detector, venue, fused, { minOffsetM = 1 } = {}) {
  const turn = detector.update(fused);
  if (!turn) return null;
  const match = matchTurn(turn, venue, {
    radiusM: Math.min(10, 3 + 0.2 * fusion.distanceSinceFix),
  });
  if (!match) return null;
  // Dead reckoning already agrees with the map to within the noise in where
  // the turn is placed: moving it would add jitter, not remove drift.
  if (Math.hypot(match.dx, match.dy) < minOffsetM) return null;
  // Same walked distance since the corner, but from where the corner really is.
  // A soft fix: it is not a scan, so confidence stays below exact.
  fusion.applySoftFix({
    ...fused,
    x: fused.x + match.dx,
    y: fused.y + match.dy,
    confidence: Math.max(fused.confidence, 0.75),
  });
  return fusion.getPose();
}
