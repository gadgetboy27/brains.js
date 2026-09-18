# Handled states

Rule: **in every degraded state the 2-D floor plan stays usable** — the user
can still pick a destination and see a route, drawn from the main entrance
when their position is unknown. Nothing is ever reported with `alert()`;
the HUD carries errors (with retry), stackable notices, and live regions.

| State                         | Detection                                                                                                                              | What the user sees                                                                                                                                                        | Floor plan                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Camera permission denied      | A camera provider (`qr`, `immersal`) fails with `permission-denied` and the chain falls back to a non-camera provider, or is exhausted | Notice _"Camera access was declined — using the floor plan"_; the view switches to the floor plan and tilt no longer brings back the camera view (a manual tap still can) | usable                                                             |
| Provider failed to initialise | The chain reports `exhausted`                                                                                                          | Error _"We cannot work out where you are…"_ with **Try again**; notice _"Routes start from the main entrance"_                                                            | usable; routes from the entrance/exit POI                          |
| Venue map failed to load      | `loadVenue()` rejects                                                                                                                  | If a cached copy exists (saved on every successful load): boot from it with notice _"Showing a saved copy…"_. Otherwise: error with **Try again**                         | usable from cache; impossible on a first-ever load with no network |
| Offline                       | `navigator.onLine` and `online`/`offline` events                                                                                       | Persistent notice; cleared when back online                                                                                                                               | usable — routing and the plan are local                            |
| Low battery                   | Battery Status API: level ≤ 20 % and not charging                                                                                      | Notice; view switches to the floor plan; the 3-D scene is not rendered until charging or the level recovers                                                               | usable                                                             |

`app.state` exposes `{ cameraUsable, lowPower, online, venueFromCache,
positioning, hasPose }` for diagnostics and tests. Each row above has a
test in `src/app.test.js`.
