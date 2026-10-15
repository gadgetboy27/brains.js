# Measuring positioning accuracy

Before trusting a venue's positioning, walk it and measure. The harness
records what the app _thought_ against where the tester _actually was_.

## In the app: `?harness=1`

A panel appears with one button per ground-truth checkpoint — the venue's
anchors and every named node. Walk the venue; when you are standing exactly
on a checkpoint, tap it. The panel records every pose, every fix request
(start, fallback, rescan) and each checkpoint press.

- **Show report** — analyses in place.
- **Download log** — saves `accuracy-<venue>-<time>.json` for the script.

## Metrics

| Metric          | Definition                                                                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Position error  | Horizontal distance between the checkpoint and the latest estimate when it was pressed (an estimate older than 3 s counts as "no estimate"). Reported as mean, median, p95 and worst (naming the checkpoint), plus how many were on the wrong floor. |
| Fix latency     | Time from a fix request (session start, provider fallback, or a rescan prompt) to the next pose with confidence ≥ 0.5. Mean, median, max.                                                                                                            |
| Failed-fix rate | Fix requests with no confident pose within 20 s, as a fraction of all requests.                                                                                                                                                                      |

Thresholds are options: `--good`, `--timeout`, `--max-age` on the script.

## Script

```sh
node scripts/accuracy-harness.mjs report walk.json           # Markdown
node scripts/accuracy-harness.mjs report walk.json --json    # machine-readable
node scripts/accuracy-harness.mjs simulate --drift 0.1 --lost 2 --out sim.json
```

`simulate` drives the mock provider along the demo venue's graph with drift,
periodic fixes and "lost" spells, pressing a checkpoint at every named node,
so the pipeline can be checked without a walk. It is deterministic per
`--seed`.

## Reading the numbers

- Mean error under 2 m with worst under 5 m is comfortable for corridor-level
  guidance; the arrow targets nodes, so errors smaller than node spacing are
  invisible to users.
- A high failed-fix rate at particular checkpoints usually means featureless
  walls or poor lighting there — add a QR anchor or re-scan the map.
- Fix latency dominates the first impression: if it is over ~5 s, put an
  entrance anchor where people naturally stop.

## Map matching (how the app keeps a sense of where it is)

Between exact fixes the app runs every pose through `src/core/map-matching.js`:

- **Snapping** — a dead-reckoned pose within 4 m of a corridor on its floor is
  projected onto that corridor (you cannot be inside a wall), with hysteresis
  so it does not hop between parallel corridors. An exact fix (a scan, a VPS
  localisation) is never moved. On-graph poses get a small confidence boost.
- **Landmarks** — places and markers within 6 m are recognised as the user
  enters their vicinity ("Passing Reception", spoken and shown), and
  forgotten only once 9 m away, so a cluster does not chatter.

The more places and markers staff add, the more legible the building becomes
to the app without any new hardware — which is also why the accuracy harness
records the _matched_ position: it is what the visitor sees.

Options: `mapMatching: { maxSnapM, stickyM, landmarkRadiusM, exitRadiusM, includeNodes }`
in `bootApp()`, or `mapMatching: false` to compare raw positioning.

## Corner correction

Between QR scans the app watches for a sustained change of walking direction
(steady heading, then a different steady heading, while walking) and checks
whether exactly one mapped junction nearby fits that turn's direction in,
direction out and angle. If so, the dead-reckoned position is moved onto that
junction, keeping the distance walked since the corner, and confidence is set
to a soft 0.75 (never exact). Ambiguous turns, turns into rooms and turns on
the spot change nothing. It is off in admin mode so surveys are not pulled
towards the map still being drawn, and `turnCorrection: false` disables it.

Map matching already snaps the _displayed_ position onto the corridor; this
corrects the estimate underneath, which every later step builds on. It helps
most in corridors with several turns, where drift would otherwise accumulate
past the snap radius, and not at all on a long straight run with no corners.
Check it on a real walk with the accuracy harness before relying on it.

## Heading: gyroscope blended with the compass

The compass alone is noisy indoors and is thrown by steel, lifts and
equipment; a gyroscope alone is smooth but drifts. Where the phone reports a
rotation rate the two are blended: the gyro carries the heading between
compass readings (so turns are smooth and a brief magnetic disturbance is
ignored), and the compass pulls it back slowly (time constant 4 s) so gyro
drift never builds up. A compass reading more than 45 degrees from the
blended heading is treated as interference, unless it persists for 3 s, when
the compass is believed. The first reading after a QR scan sets the heading
outright, and a phone with no gyroscope uses the compass directly, as before.

The turn rate is taken about the vertical (found from gravity), so it works
however the phone is held. Platforms differ in the sign of what they report,
so the app learns the sign from the first real turn where the compass and
gyro disagree on direction, and snaps to the compass when it flips.

Tuning: `compassTimeConstantS` (longer trusts the gyro more; steady drift
error is about gyro bias times this), `compassRejectDeg`,
`compassTrustAfterMs`. The unit tests simulate the sensors; confirm on real
phones (iPhone and Android) with the accuracy harness before relying on it.

## Comparing positioning strategies (simulation)

```sh
node scripts/compare-positioning.mjs                       # default scenario
node scripts/compare-positioning.mjs --disturbance 40 --glitches 4 --compass-noise 10   # a harsh building
node scripts/compare-positioning.mjs --routes n-entrance:n-lift-g --runs 100 --json
```

Simulates people walking routes of the venue with **one QR scan at the start
and none after**, with plausible sensor errors (stride 8% longer than assumed,
a slightly wrong compass offset, compass noise and magnetic wobble, a few
large compass glitches, gyro bias and noise). Every strategy sees identical
footsteps and noise, and runs the app's real `PoseFusion`, `MapMatcher` and
corner-correction code, so differences are down to the strategy. Flags set the
scenario (`--stride-error`, `--compass-bias`, `--compass-noise`,
`--disturbance`, `--glitches`, `--gyro-bias`, `--gyro-noise`).

Results on the demo venue (3 routes, 40 walks each, default scenario; mean
error of the displayed position, and error at the end of the walk):

| Strategy                  | Mean (m) | End (m) | Time over 3 m off |
| ------------------------- | -------: | ------: | ----------------: |
| Compass only              |     3.02 |    5.10 |               40% |
| Compass + corner fixes    |     3.11 |    4.69 |               40% |
| Gyro blended with compass |     1.83 |    3.04 |               21% |
| Gyro blend + corner fixes |     1.86 |    2.13 |               17% |

What it shows:

- **Gyro blending is the big win**: about 40% less mean error, and half the
  time spent more than 3 m off. It matters most when the compass is disturbed.
- **Corner fixes help the gyro-blended position at the end of a walk** (3.0 m
  to 2.1 m) and in harsh conditions, and are neutral when sensors are already
  good (they ignore corrections under 1 m, which otherwise add jitter). When
  they fire they cut the error from about 1.8 m to 1.0 m.
- **Corner fixes on top of a bad compass do not help**: the turn is then
  matched against the wrong direction, so the mean is no better and the worst
  case can be worse. They are worth having only with the gyro blend.
- Even the best strategy drifts to 2 m or so after a single scan on these
  routes, and the 95th percentile is over 4 m. That is why markers still
  matter: space them so no stretch between scans is longer than the distance
  over which these figures stay under your tolerance.

Caveats: the sensor models are plausible, not measured on real phones; the
1 m dead band was tuned on these same scenarios; and the demo routes are
short with few corners. Treat the numbers as a ranking of strategies and a
way to try "what if the compass is worse here", then confirm on a real walk
with `?harness=1`.

## Adaptive stride (visitors' phones learn their own stride)

Dead reckoning assumes everyone's stride is the same, and it is not. A visitor
whose stride is 8% longer than the default drifts 8% short on every walk. Each
QR scan between two markers is a measurement: the venue's own distance between
them divided by the steps counted is that person's stride. A small Kalman
filter (`src/core/calibration.js`) folds each such walk into a running
estimate, weighting long walks more than short ones, rejecting a walk that
cannot have been this person following the route (wandered, took another way
round), and clamping to 0.5 to 1.0 m. The next steps use the new stride.

It runs on the phone for one session and keeps nothing: no stored data, nothing
sent anywhere. It is off on staff phones (a survey defines the map from dead
reckoning and must stay on one scale) and when `adaptiveStride: false`. A
stretch that included a reroute is not used.

Simulated, with a marker every 15 to 40 m along a multi-leg tour (mean error /
error at the end of the walk, metres; "gyro + corners" with a fixed stride vs
the same plus learning):

| Conditions (marker every 25 m) | Fixed stride | Learns stride |
| ------------------------------ | -----------: | ------------: |
| Stride 8% longer than assumed  |  1.33 / 1.44 |   1.22 / 1.12 |
| Stride 15% longer              |  1.53 / 1.69 |   1.33 / 1.20 |
| Stride 10% shorter             |  0.90 / 1.02 |   0.86 / 0.97 |
| Stride already right           |  0.98 / 1.23 |   0.98 / 1.19 |
| Harsh compass                  |  2.26 / 3.15 |   2.22 / 2.81 |

Over 21 combinations of conditions and marker spacing, it was never worse on
mean error and was clearly better wherever the stride was off (for example,
3.22 to 1.72 m at the end of a long walk with a 15% long stride, markers 40 m
apart). It does nothing with a single marker, since there is nothing to learn
from; it needs at least one scan after the start.

**A compass-offset filter was tried too and dropped.** Learning a correction
to the compass heading from the same scans made no consistent difference in
simulation (within about 0.05 m either way), and real compass error varies from
place to place (a lift, a steel door), so a single learned offset would likely
do more harm than good in a real building. Run
`node scripts/compare-positioning.mjs --markers 25 --routes n-entrance:n-lift-g:n-toilets-g:n-clinic-a:n-entrance`
to reproduce the comparison (the `--markers`, `--map-error` and tour `a:b:c`
options are new).

The same caveats as above apply: the sensor models are plausible, not
measured, and the demo venue is small. Confirm on a real walk.
