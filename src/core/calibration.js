/**
 * Adaptive stride — learning this person's stride from the QR codes they pass.
 *
 * A small scalar Kalman filter. Each QR scan is an exact position, so the
 * walk since the previous scan can be compared with the truth: the metres
 * between the two markers (by the venue's own routes) divided by the steps
 * counted is this person's stride over that walk. A visitor whose stride is
 * 8% longer than the default drifts 8% short on every walk; after a scan or
 * two the estimate catches up and dead reckoning between later scans stops
 * drifting that way.
 *
 * A Kalman filter is the right amount of machinery: one number with an honest
 * uncertainty. A long walk is a better measurement than a short one and moves
 * the estimate more; a measurement far from what the filter expects (a route
 * that cut a corner or wandered, a wrong marker) is thrown out instead of
 * averaged in; the estimate moves slowly enough that one bad walk cannot wreck
 * a good calibration; and it is clamped to plausible human strides.
 *
 * It runs on the phone for one session and keeps nothing: no data leaves the
 * device and nothing is stored. It is not used on staff phones, where a survey
 * defines the map from dead reckoning and must stay on a fixed scale.
 *
 * (A matching filter for the compass offset was tried and dropped: in
 * simulation it made no consistent difference, and real compass error varies
 * from place to place, so one learned offset would likely do more harm than
 * good. See docs/accuracy.md.)
 */

const round = (n, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Scalar Kalman filter on a random-walk state, in residual form. */
class Scalar {
  constructor(value, variance, processVariance) {
    this.value = value;
    this.variance = variance;
    this.q = processVariance;
  }

  /**
   * @param {number} residual     measurement − current estimate
   * @param {number} noiseVar     variance of the measurement
   * @param {number} gate         reject if |residual| exceeds this many standard deviations
   * @returns {boolean} whether the measurement was used
   */
  update(residual, noiseVar, gate) {
    const p = this.variance + this.q; // predict: the state may have drifted a little
    const s = p + noiseVar; // innovation variance
    if (Math.abs(residual) > gate * Math.sqrt(s)) {
      this.variance = p;
      return false;
    }
    const k = p / s;
    this.value += k * residual;
    this.variance = (1 - k) * p;
    return true;
  }
}

/**
 * @param {Object} [options]
 * @param {number} [options.strideM=0.73]            Starting stride, metres.
 * @param {number} [options.strideSigma=0.08]        Initial uncertainty as a fraction of the stride.
 * @param {number} [options.minStrideM=0.5]
 * @param {number} [options.maxStrideM=1.0]
 * @param {number} [options.minSteps=10]             Walks with fewer steps teach nothing.
 * @param {number} [options.minRouteM=8]             Nor do walks between markers closer than this.
 * @param {number} [options.gate=3]                  Standard deviations beyond which a measurement is rejected.
 */
export function createCalibration(options = {}) {
  const o = {
    strideM: 0.73,
    strideSigma: 0.08,
    minStrideM: 0.5,
    maxStrideM: 1.0,
    minSteps: 10,
    minRouteM: 8,
    gate: 3,
    ...options,
  };
  const stride = new Scalar(o.strideM, (o.strideSigma * o.strideM) ** 2, (0.01 * o.strideM) ** 2);
  let walks = 0;

  return {
    /**
     * Learn from one walk between two exact fixes.
     *
     * @param {Object} walk
     * @param {number} walk.steps    Steps counted since the earlier fix.
     * @param {number} walk.routeM   Metres between the two markers by the venue's routes.
     * @returns {boolean} Whether the walk changed the estimate (false: too short, or rejected as an outlier).
     */
    observe({ steps, routeM }) {
      if (!(steps >= o.minSteps) || !(routeM >= o.minRouteM)) return false;
      // A longer walk is a better measurement: the error in where the two
      // markers sit, and in how straight the walk was, matters less.
      const measured = routeM / steps;
      const relNoise = 0.04 + 0.6 / routeM;
      const used = stride.update(measured - stride.value, (relNoise * measured) ** 2, o.gate);
      stride.value = Math.min(o.maxStrideM, Math.max(o.minStrideM, stride.value));
      if (used) walks += 1;
      return used;
    },

    /** The stride to use now, metres per step. */
    get strideM() {
      return round(stride.value);
    },
    /** Standard deviation of the estimate, metres. */
    get uncertaintyM() {
      return round(Math.sqrt(stride.variance));
    },
    /** Walks that taught the filter something. */
    get walks() {
      return walks;
    },
  };
}
