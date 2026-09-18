# Runtime config

A small JSON file, separate from the venue map, that the operator can edit at
any time to **close a route edge** or **hide a point of interest** — no
redeploy, no rebuild. The app fetches it at startup (with a cached fallback)
and polls it every 60 s; changes take effect immediately.

## Where it lives

- `runtimeConfigUrl` in the venue JSON (relative to the venue file), or
- `?runtime=<url>` / `RUNTIME_CONFIG_URL` in the app config.

Serve it with short cache headers; the app requests it with `cache: no-store`.

## Shape

```jsonc
{
  "version": 1,
  "updatedAt": "2026-09-19T10:00:00Z", // optional, informational
  "closures": [
    { "from": "n-lift-g", "to": "n-lift-1", "reason": "Lift out of service until 3 pm" },
  ],
  "hiddenPois": ["poi-clinic-b"],
  "notice": "Clinic B is closed today.", // optional venue-wide notice
}
```

`from`/`to` name an edge in either direction. Unknown ids are reported in
diagnostics and skipped — a typo never takes the app down.

## What it does

| Where       | Effect                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing     | Closed edges are never used, whatever the filters. A route that only fails because of a closure says so ("part of the way is closed") rather than suggesting the user relax accessibility filters. |
| HUD         | A persistent notice lists closures with their reasons, plus the venue notice.                                                                                                                      |
| Floor plan  | Closed edges are drawn dashed in the closure colour with an ✕. Hidden POIs are not drawn.                                                                                                          |
| Picker / AR | Hidden POIs are not offered or drawn (still resolvable by id, e.g. from a link).                                                                                                                   |

Applying the config never mutates the loaded venue; a new `Venue` is derived
from it, so reopening is just the next poll.
