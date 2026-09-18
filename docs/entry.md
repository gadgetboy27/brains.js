# No-install entry: QR codes at the entrance

A visitor points their phone camera at a printed code by the entrance and the
web app opens at that venue, already knowing where they stand. Nothing to
install, no account.

## The link

```
https://<app domain>/?v=<venueId>&anchor=<anchorId>
```

- `v` — the venue id; the app loads `${VENUE_BASE_URL}/<id>/venue.json`
  (default base `/venues/`). Host each venue's JSON, runtime config and plan
  images at that path.
- `anchor` — an entry in the venue's `anchors[]`: where the person stands and
  faces when scanning. The app seeds their position from it immediately (and
  the QR provider treats it as a fix), so the floor plan and the first
  instruction are right before any camera fix.

The same URL is recognised by the in-app QR scanner, so one set of printed
markers serves both purposes.

## Printing the codes

```sh
node scripts/make-entrance-qr.mjs --venue path/to/venue.json \
  --base https://wayfinding.example.nz/ --out out/qr
```

Writes one SVG per anchor (error-correction level H, so a partly damaged
print still scans) and `index.html`, a print sheet with one code per page.
Use the final domain: codes cannot be changed once printed.

## First run

The first time the app starts on a phone it shows a short screen before
asking the operating system for anything:

- **why the camera** (recognising surroundings to find you; only while the
  camera view is open),
- **why motion sensors** (keeping the arrow right between camera fixes),
- **what leaves the phone**, generated from the positioning providers' own
  `uploads` declarations for this venue — so a QR-only venue says "Nothing",
- **what is never collected**, with a link to the privacy notice,
- **Allow camera and motion**, or **Use the floor plan only** as an equal
  choice.

On iOS the motion permission can only be requested from a tap, which is why
the request happens on that button. A granted camera is remembered so the
screen is not shown again; declining is not remembered, so the choice is
offered afresh next time.
