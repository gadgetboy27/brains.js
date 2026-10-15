/**
 * Scan check — does the marker just read fit where the walker was?
 *
 * A QR scan is trusted completely: it snaps the position to the marker. That
 * is right almost always, but a sticker that is on the wrong wall, a marker
 * recorded in the wrong place on the map, or the wrong sticker scanned would
 * silently teleport the user. Two independent checks catch these without
 * needing anything but what the app already knows:
 *
 *  - **match**: dead reckoning thought the walker was close to this marker,
 *    within what drift since the last exact fix allows. Everything is fine.
 *  - **check**: it is further from the estimate than drift explains, but the
 *    walker could have got there. Probably just drift, but worth a flag.
 *  - **impossible**: the previous marker and this one are further apart than
 *    the steps taken since could cover, so one of the two markers is in the
 *    wrong place on the map (or the wrong sticker was read). Dead reckoning
 *    drift cannot explain this: it is a property of the two markers' recorded
 *    positions and the steps, not of the estimate.
 *
 * Judged only where it can be: nothing to compare on the first scan, or across
 * floors (stairs and lifts are not step-counted), and "impossible" is not
 * claimed when steps are not being counted at all (motion access declined).
 *
 * Pure and synchronous.
 */

/** @typedef {{ x: number, y: number, floor: number }} Place */

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * @param {Object} input
 * @param {Place | null} input.estimate     Dead-reckoned position just before the scan.
 * @param {Place | null} input.previous     The previous exact fix (a marker or a placement).
 * @param {Place} input.scan                The marker just read.
 * @param {number} input.steps              Steps counted since the previous fix.
 * @param {number} input.distanceM          Metres dead reckoning thinks were walked since then.
 * @param {boolean} [input.stepsTrusted=true]  False when steps are not being counted at all.
 * @param {number} [input.maxStrideM=1.2]   The longest plausible stride.
 * @param {number} [input.slackM=5]         Allowance on top of steps × stride for how far they could have got.
 * @returns {{ verdict: 'first' | 'unchecked' | 'match' | 'check' | 'impossible', jumpM: number | null, toleranceM: number | null, apartM: number | null }}
 */
export function checkScan({
  estimate,
  previous,
  scan,
  steps,
  distanceM,
  stepsTrusted = true,
  maxStrideM = 1.2,
  slackM = 5,
}) {
  const none = (verdict) => ({ verdict, jumpM: null, toleranceM: null, apartM: null });
  if (!estimate || !previous) return none('first');
  if (scan.floor !== previous.floor || estimate.floor !== scan.floor) return none('unchecked');

  const jumpM = dist(estimate, scan);
  const apartM = dist(previous, scan);
  // Drift is roughly proportional to distance walked, with a floor for the marker's own placement.
  const toleranceM = 2 + 0.15 * distanceM;
  const round = (n) => Math.round(n * 10) / 10;
  const out = (verdict) => ({
    verdict,
    jumpM: round(jumpM),
    toleranceM: round(toleranceM),
    apartM: round(apartM),
  });

  if (stepsTrusted && apartM > steps * maxStrideM + slackM) return out('impossible');
  if (jumpM > toleranceM) return out('check');
  return out('match');
}
