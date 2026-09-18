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
