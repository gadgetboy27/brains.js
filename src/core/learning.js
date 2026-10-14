/**
 * Route learning, kept on staff phones.
 *
 * While staff walk the venue in admin mode the app notes two kinds of
 * thing that say how well the map and the dead reckoning agree with reality:
 *
 *  - **gap**: between two exact QR scans, how many steps were counted and how
 *    far apart the graph says those two markers are. Over several walks this
 *    gives the stride that really fits the building.
 *  - **off**: the route leg a walker left. Legs that keep appearing point at
 *    a missing marker, a bad edge or a confusing junction.
 *
 * Like arrival feedback (./feedback.js), entries hold no position, no device
 * id and no time finer than the day, live only in the phone's local storage,
 * and are never sent anywhere. Visitor phones never record them: the app
 * only wires this in when the admin panel is on. Nothing here changes the
 * venue by itself — {@link suggestions} produces proposals for a person to
 * apply (admin → Publish → Download learning).
 */

const KEY_PREFIX = 'brains:learning:';
const MAX_ENTRIES = 500;

const keyFor = (venueId) => `${KEY_PREFIX}${venueId}`;

/** @param {Storage | null | undefined} storage @param {string} venueId */
export function loadObservations(storage, venueId) {
  try {
    const list = JSON.parse(storage?.getItem(keyFor(venueId)) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * Store one observation. Returns it, or null if it is not valid or storage
 * is unavailable.
 *
 * @param {Storage | null | undefined} storage
 * @param {string} venueId
 * @param {{ k: 'gap', a: string, b: string, steps: number, routeM: number, dh?: number }
 *        | { k: 'off', from: string, to: string }} obs
 *   `dh` on a gap is the heading error in degrees, (-180, 180]: how far the
 *   true bearing between the two markers is clockwise of the dead-reckoned one.
 * @param {Date} [now]
 */
export function recordObservation(storage, venueId, obs, now = new Date()) {
  if (!storage || !valid(obs)) return null;
  const entry = { ...obs, d: now.toISOString().slice(0, 10) };
  try {
    const list = [...loadObservations(storage, venueId), entry].slice(-MAX_ENTRIES);
    storage.setItem(keyFor(venueId), JSON.stringify(list));
    return entry;
  } catch {
    return null;
  }
}

function valid(o) {
  if (o?.k === 'gap') {
    return (
      typeof o.a === 'string' &&
      typeof o.b === 'string' &&
      o.a !== o.b &&
      Number.isInteger(o.steps) &&
      o.steps > 0 &&
      Number.isFinite(o.routeM) &&
      o.routeM > 0 &&
      (o.dh === undefined || (Number.isFinite(o.dh) && o.dh > -180 && o.dh <= 180))
    );
  }
  if (o?.k === 'off') return typeof o.from === 'string' && typeof o.to === 'string';
  return false;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Turn observations into proposals. Conservative on purpose: too few samples,
 * or a change too small to matter, produces nothing.
 *
 * @param {object[]} observations
 * @param {{ strideM?: number, headingOffsetDeg?: number, minGaps?: number, minSteps?: number,
 *   minChange?: number, minOff?: number, minHeadingDeg?: number, minAgreement?: number }} [options]
 *   `strideM` and `headingOffsetDeg` are what the venue currently uses.
 * @returns {{ stride: null | { current: number, suggested: number, samples: number },
 *             heading: null | { currentDeg: number, suggestedDeg: number, errorDeg: number, samples: number },
 *             troubleSpots: Array<{ from: string, to: string, count: number }> }}
 */
export function suggestions(observations, options = {}) {
  const {
    strideM = 0.73,
    headingOffsetDeg = 0,
    minGaps = 3,
    minSteps = 15,
    minChange = 0.04,
    minOff = 3,
    minHeadingDeg = 3,
    minAgreement = 0.9,
  } = options;

  // Stride: route distance ÷ steps for each marker-to-marker walk. A walk
  // that cut a corner or wandered gives a stride far from any human one, so
  // implausible values are dropped rather than averaged in.
  const strides = observations
    .filter((o) => o.k === 'gap' && o.steps >= minSteps)
    .map((o) => o.routeM / o.steps)
    .filter((s) => s >= 0.4 && s <= 1.1);
  let stride = null;
  if (strides.length >= minGaps) {
    const suggested = Math.round(median(strides) * 100) / 100;
    if (Math.abs(suggested - strideM) / strideM >= minChange) {
      stride = { current: strideM, suggested, samples: strides.length };
    }
  }

  // Heading: each straight marker-to-marker walk says how far the compass is
  // off. Averaged as angles (so -179° and +179° agree) and trusted only when
  // the walks agree with each other (resultant length R near 1); a mix of
  // directions means the cause is not a constant offset (e.g. a metal
  // doorframe, or a phone carried at different angles).
  const errs = observations.filter((o) => o.k === 'gap' && Number.isFinite(o.dh)).map((o) => o.dh);
  let heading = null;
  if (errs.length >= minGaps) {
    const rad = Math.PI / 180;
    const c = errs.reduce((t, d) => t + Math.cos(d * rad), 0) / errs.length;
    const sn = errs.reduce((t, d) => t + Math.sin(d * rad), 0) / errs.length;
    const agreement = Math.hypot(c, sn);
    const errorDeg = Math.atan2(sn, c) / rad;
    if (agreement >= minAgreement && Math.abs(errorDeg) >= minHeadingDeg) {
      const wrapped = (((headingOffsetDeg + errorDeg) % 360) + 360) % 360;
      heading = {
        currentDeg: headingOffsetDeg,
        suggestedDeg: Math.round(wrapped * 10) / 10,
        errorDeg: Math.round(errorDeg * 10) / 10,
        samples: errs.length,
      };
    }
  }

  const legs = new Map();
  for (const o of observations) {
    if (o.k !== 'off') continue;
    const key = `${o.from}\u0000${o.to}`;
    legs.set(key, { from: o.from, to: o.to, count: (legs.get(key)?.count ?? 0) + 1 });
  }
  const troubleSpots = [...legs.values()]
    .filter((l) => l.count >= minOff)
    .sort((a, b) => b.count - a.count);

  return { stride, heading, troubleSpots };
}
