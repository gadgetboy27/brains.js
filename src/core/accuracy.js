/**
 * Accuracy harness — record a test walk and measure positioning quality.
 *
 * A **log** is a list of timestamped events:
 *  - `pose`         every pose the app received (estimated position);
 *  - `checkpoint`   the tester pressed "I am here" at a marked ground-truth
 *                   point (an anchor or node with known venue coordinates);
 *  - `fix-request`  positioning (re)started or asked for a rescan — the clock
 *                   for fix latency starts here;
 *  - `status`       provider / chain status changes, for context.
 *
 * `analyseLog()` turns a log into a report:
 *  - **position error** at each checkpoint: horizontal distance between the
 *    checkpoint and the latest estimate at that moment (within `maxPoseAgeMs`;
 *    older or absent → the checkpoint counts as "no estimate"), plus whether
 *    the floor was right. Mean, median, p95 and worst (with which checkpoint).
 *  - **fix latency**: from each fix-request to the next pose with confidence
 *    ≥ `goodConfidence`. Mean, median, max.
 *  - **failed-fix rate**: fix-requests with no confident pose within
 *    `fixTimeoutMs`, over all requests.
 *
 * Pure functions, shared by the in-app harness UI and scripts/accuracy-harness.mjs.
 */

export const LOG_VERSION = 1;

/**
 * @typedef {Object} AccuracyLog
 * @property {1} version
 * @property {string} [venueId]
 * @property {string} [provider]
 * @property {number} startedAt
 * @property {Array<object>} events
 */

/** Build a log incrementally. `now()` is injectable for tests. */
export function createRecorder({ now = () => Date.now(), venueId, provider } = {}) {
  const startedAt = now();
  /** @type {object[]} */
  const events = [];
  const push = (e) => {
    events.push({ t: now(), ...e });
    return e;
  };
  return {
    pose: (pose) => push({ type: 'pose', pose: { ...pose } }),
    checkpoint: ({ id, x, y, z = 0, floor, note }) =>
      push({ type: 'checkpoint', id, x, y, z, floor, ...(note ? { note } : {}) }),
    fixRequest: (reason = 'start') => push({ type: 'fix-request', reason }),
    status: (status, detail) => push({ type: 'status', status, ...(detail ? { detail } : {}) }),
    get events() {
      return [...events];
    },
    get count() {
      return events.length;
    },
    toJSON() {
      return {
        version: LOG_VERSION,
        venueId,
        provider,
        startedAt,
        endedAt: now(),
        events: [...events],
      };
    },
  };
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i];
}
const round = (n, dp = 2) =>
  n === null || n === undefined ? null : Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * @param {AccuracyLog} log
 * @param {{ goodConfidence?: number, fixTimeoutMs?: number, maxPoseAgeMs?: number }} [options]
 */
export function analyseLog(log, options = {}) {
  if (!log || log.version !== LOG_VERSION || !Array.isArray(log.events)) {
    throw new TypeError('analyseLog: expected a version 1 accuracy log');
  }
  const { goodConfidence = 0.5, fixTimeoutMs = 20_000, maxPoseAgeMs = 3_000 } = options;
  const events = [...log.events].sort((a, b) => a.t - b.t);
  const poses = events.filter((e) => e.type === 'pose');

  // --- checkpoints
  const checkpoints = events
    .filter((e) => e.type === 'checkpoint')
    .map((cp) => {
      let latest = null;
      for (const p of poses) {
        if (p.t > cp.t) break;
        latest = p;
      }
      if (!latest || cp.t - latest.t > maxPoseAgeMs) {
        return {
          id: cp.id,
          t: cp.t,
          error: null,
          floorCorrect: null,
          poseAgeMs: latest ? cp.t - latest.t : null,
          note: cp.note,
        };
      }
      const dx = latest.pose.x - cp.x;
      const dy = latest.pose.y - cp.y;
      return {
        id: cp.id,
        t: cp.t,
        error: Math.hypot(dx, dy),
        floorCorrect: latest.pose.floor === cp.floor,
        confidence: latest.pose.confidence,
        poseAgeMs: cp.t - latest.t,
        estimate: { x: latest.pose.x, y: latest.pose.y, floor: latest.pose.floor },
        truth: { x: cp.x, y: cp.y, floor: cp.floor },
        note: cp.note,
      };
    });
  const errors = checkpoints.filter((c) => c.error !== null).map((c) => c.error);
  const worst =
    checkpoints.filter((c) => c.error !== null).sort((a, b) => b.error - a.error)[0] ?? null;

  // --- fix latency / failed fixes
  const requests = events.filter((e) => e.type === 'fix-request');
  const fixes = requests.map((req) => {
    const fix = poses.find((p) => p.t >= req.t && p.pose.confidence >= goodConfidence);
    const latency = fix ? fix.t - req.t : null;
    const failed = latency === null || latency > fixTimeoutMs;
    return { t: req.t, reason: req.reason, latencyMs: latency, failed };
  });
  const latencies = fixes.filter((f) => !f.failed).map((f) => f.latencyMs);

  const durationMs = poses.length ? poses.at(-1).t - poses[0].t : 0;
  return {
    venueId: log.venueId ?? null,
    provider: log.provider ?? null,
    startedAt: log.startedAt,
    options: { goodConfidence, fixTimeoutMs, maxPoseAgeMs },
    poses: {
      count: poses.length,
      durationMs,
      perSecond: durationMs > 0 ? round((poses.length - 1) / (durationMs / 1000)) : null,
      meanConfidence: round(mean(poses.map((p) => p.pose.confidence))),
    },
    position: {
      checkpoints: checkpoints.length,
      measured: errors.length,
      noEstimate: checkpoints.length - errors.length,
      meanErrorM: round(mean(errors)),
      medianErrorM: round(quantile(errors, 0.5)),
      p95ErrorM: round(quantile(errors, 0.95)),
      worstErrorM: worst ? round(worst.error) : null,
      worstCheckpoint: worst ? worst.id : null,
      wrongFloor: checkpoints.filter((c) => c.floorCorrect === false).length,
      details: checkpoints.map((c) => ({
        ...c,
        error: round(c.error),
        confidence: round(c.confidence),
      })),
    },
    fixes: {
      requests: requests.length,
      succeeded: latencies.length,
      failed: fixes.filter((f) => f.failed).length,
      failedRate: requests.length
        ? round(fixes.filter((f) => f.failed).length / requests.length, 3)
        : null,
      meanLatencyMs: round(mean(latencies), 0),
      medianLatencyMs: round(quantile(latencies, 0.5), 0),
      maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
      details: fixes,
    },
  };
}

/** Human-readable report (Markdown). */
export function formatReport(report) {
  const p = report.position;
  const f = report.fixes;
  const m = (v, unit = '') => (v === null || v === undefined ? 'n/a' : `${v}${unit}`);
  const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)} %`);
  const lines = [
    `# Positioning accuracy report`,
    ``,
    `- Venue: ${report.venueId ?? 'unknown'}  ·  Provider: ${report.provider ?? 'unknown'}`,
    `- Started: ${new Date(report.startedAt).toISOString()}  ·  Poses: ${report.poses.count} over ${Math.round(report.poses.durationMs / 1000)} s (${m(report.poses.perSecond, '/s')}, mean confidence ${m(report.poses.meanConfidence)})`,
    ``,
    `## Position error at checkpoints (${p.measured} of ${p.checkpoints} measured)`,
    ``,
    `| Mean | Median | p95 | Worst | Wrong floor | No estimate |`,
    `|---|---|---|---|---|---|`,
    `| ${m(p.meanErrorM, ' m')} | ${m(p.medianErrorM, ' m')} | ${m(p.p95ErrorM, ' m')} | ${m(p.worstErrorM, ' m')}${p.worstCheckpoint ? ` (${p.worstCheckpoint})` : ''} | ${p.wrongFloor} | ${p.noEstimate} |`,
    ``,
    `| Checkpoint | Error | Floor ok | Confidence | Pose age |`,
    `|---|---|---|---|---|`,
    ...p.details.map(
      (c) =>
        `| ${c.id}${c.note ? ` — ${c.note}` : ''} | ${m(c.error, ' m')} | ${c.floorCorrect === null ? 'n/a' : c.floorCorrect ? 'yes' : 'NO'} | ${m(c.confidence)} | ${m(c.poseAgeMs, ' ms')} |`
    ),
    ``,
    `## Fixes (${f.requests} requested)`,
    ``,
    `| Succeeded | Failed | Failed rate | Mean latency | Median | Max |`,
    `|---|---|---|---|---|---|`,
    `| ${f.succeeded} | ${f.failed} | ${pct(f.failedRate)} | ${m(f.meanLatencyMs, ' ms')} | ${m(f.medianLatencyMs, ' ms')} | ${m(f.maxLatencyMs, ' ms')} |`,
    ``,
    `A fix counts as failed when no pose with confidence ≥ ${report.options.goodConfidence} arrived within ${report.options.fixTimeoutMs / 1000} s of the request.`,
  ];
  return lines.join('\n');
}
