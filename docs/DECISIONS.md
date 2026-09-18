# Architecture Decision Records

This file records the significant architectural decisions behind the indoor AR
rebuild, in the order they were made. Each entry states the context, the
decision, and its consequences. Entries are never edited once accepted; a
change of course gets a new entry that supersedes the old one.

Status values: **Accepted**, **Superseded by ADR-N**, **Deprecated**.

---

## ADR-001: Drop GPS-based positioning

**Status:** Accepted — 2026-09-19

### Context

The original demos (now in `legacy/`) positioned the user and placed AR content
using AR.js `gps-camera` / `gps-entity-place`, which rely on the device's
satellite fix. The rebuild targets venue interiors: shopping centres, museums,
transport hubs and similar.

### Decision

GPS is dropped entirely as a positioning method. No part of the new app reads
`navigator.geolocation` for placement of content.

### Rationale

- Satellite signal is unreliable indoors. Roofs, floors and steel structure
  attenuate and reflect it, so a fix is frequently unavailable or drifts by
  tens of metres — far beyond the room-scale accuracy indoor wayfinding needs.
- Even when a fix exists it carries no floor / level information, so a
  multi-storey venue cannot be resolved from it.
- Building around GPS would force every later feature to work around its
  failure modes rather than on top of a dependable position.

### Consequences

- The `legacy/` demos are frozen as reference only and are not extended.
- A different primary positioning method is required (see ADR-004).
- Outdoor approach-to-venue guidance, if ever wanted, must be a separate
  concern layered on top rather than the foundation.

---

## ADR-002: Drop Foursquare as the points-of-interest source

**Status:** Accepted — 2026-09-19

### Context

The legacy demos fetched nearby places from the Foursquare v2 places API
(through a public `cors-anywhere` proxy) and rendered each result as an AR
marker.

### Decision

Foursquare — and public place APIs in general — are removed as a data source.
Points of interest come from **venue JSON supplied by the venue operator**.

### Rationale

- **Venue interiors are not in public place APIs.** Foursquare and its peers
  model a venue as a single point (the building). Individual shops, exhibits,
  gates, toilets and desks inside it are absent or, at best, inconsistently
  geocoded, so the data cannot drive indoor wayfinding.
- **The v2 endpoints are deprecated.** Foursquare has retired the v2 API the
  demos depended on; continuing to build on it would mean a forced migration
  on someone else's schedule.
- Operator-supplied JSON gives the venue direct control over names,
  positions, floors, opening hours and categories, and removes a network
  dependency, an API-key secret and a third-party proxy from the runtime.

### Consequences

- All Foursquare code, config fields, API constants and the `cors-anywhere`
  proxy have been deleted from the active codebase; they survive only in
  `legacy/`.
- The Foursquare credentials that were once committed to this repository
  must still be rotated (see `scripts/scrub-history.sh`).
- A venue JSON schema, loader and validator are required (`src/venues/`).
- Onboarding a venue now requires the operator to author or export that
  JSON; tooling for this is a future concern.

---

## ADR-003: Abstract positioning behind a provider interface

**Status:** Accepted — 2026-09-19

### Context

Indoor positioning is a fast-moving vendor market. Visual positioning
systems, UWB, BLE beacon meshes and Wi-Fi RTT all exist, each with different
coverage, accuracy, cost and platform support, and the leading vendors change
year to year.

### Decision

The rest of the app never talks to a positioning vendor directly. It depends
on a single provider interface defined in `src/core/`; concrete integrations
live in `src/providers/` and are selected at startup. A provider is
responsible for producing a pose (position, orientation, floor, confidence)
in the venue's coordinate frame and reporting its own status.

### Rationale

- **The vendor can be swapped.** If a provider's pricing, coverage or platform
  support changes, or a better one appears, only `src/providers/` changes.
- Multiple providers can coexist — e.g. a fallback provider when the primary
  loses tracking, or a fixed-pose mock provider for development and tests.
- Core, UI and venue logic can be unit-tested against a mock provider without
  cameras, network access or vendor SDKs.

### Consequences

- `src/core/` must define the interface and the venue coordinate frame that
  every provider maps into.
- Vendor-specific concepts (map IDs, API keys, SDK lifecycles) stay inside
  the provider and are configured through environment variables
  (`.env.example`), never referenced from core or UI.
- Some vendor capabilities may be left unused if they don't fit the common
  interface; that is an accepted cost of portability.

---

## ADR-004: Camera-based visual positioning as the primary method

**Status:** Accepted — 2026-09-19

### Context

With GPS gone (ADR-001) and a provider abstraction in place (ADR-003), a
primary positioning method must be chosen for the first provider.

### Decision

Camera-based visual positioning (VPS) is the primary positioning method. The
first provider integrates Immersal; its API key and map ID are the
`IMMERSAL_*` variables in `.env.example`.

### Rationale

- **Accuracy.** Visual localisation against a pre-scanned map of the venue
  gives centimetre-to-decimetre pose with full 6-DoF orientation, which is
  what stable AR overlays need. Beacon and Wi-Fi approaches give a position
  but not a reliable heading.
- **No venue hardware.** The venue supplies a scan, not an installed beacon
  or anchor network, so onboarding cost and maintenance are lower.
- **Uses what the app already has.** An AR wayfinding app is already holding
  the camera up; visual positioning is derived from that same feed with no
  extra permission prompts or sensors.
- **Works on the web.** It runs in a browser with camera access, matching the
  project's web-first deployment (see `legacy/` and the Vite build).

### Consequences

- Each venue must be scanned and its map maintained when the interior
  changes (refits, seasonal displays); this is an operational commitment the
  operator takes on.
- Localisation needs adequate lighting and visually distinctive surroundings;
  featureless corridors or dark spaces may fail to localise. A fallback or
  dead-reckoning strategy between fixes is a likely follow-up decision.
- Camera frames are sent to the vendor for localisation; privacy
  implications must be surfaced to users and to the venue operator.
- The vendor choice (Immersal) is itself replaceable under ADR-003; this ADR
  commits to the _method_, not the vendor.
