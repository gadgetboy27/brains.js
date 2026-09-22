# Admin mode: building a venue from inside the app

`?admin=1` adds a staff panel over the floor plan for building — and
"training" — a venue without leaving the building. It edits a **draft**
copy of the current venue and exports valid venue JSON; nothing changes for
visitors until that JSON is published.

## Is it actually recording anything?

Every scan, tap and auto-dropped point writes straight into the browser's
own storage on that device — instantly, with no network request, before
Export ever comes into it. The status line under the tab row says so in
real figures, always, on every tab:

> _Saved on this phone for "demo-hospital" — 14 nodes · 9 edges · 5 places
> · 6 markers · not yet published_

If that line shows zero counts (or a different venue id than expected),
nothing has been recorded to look at yet — try a scan and watch the
numbers move. If it shows real counts, the data exists on that device,
whatever Export does or doesn't manage afterwards (see "Export" below for
getting it out).

**The one sharp edge**: that storage is scoped to the exact page origin
(scheme + host + port) _and_ the venue id together — reopening under a
different URL (the LAN dev server vs the deployed site, `http` vs
`https`, a different `?v=`) or a different venue starts from nothing, even
though the original recording is still sitting untouched under its own
origin and id. This is the usual reason a device looks like it "recorded
nothing" when it didn't — always reopen the _exact_ URL a route was
recorded from to see it again.

## Calibrate stride (better accuracy between codes)

Between scans, the app estimates how far you've walked by counting footsteps
and multiplying by a stride length — 0.73 m (an average adult) until a venue
sets its own. The **Calibrate stride** panel, open from any tab, measures
yours: enter a distance you can walk out exactly (a marked corridor, a tape
measure — 15–20 m gives a good step count), tap **Start walking**, walk it
at a normal pace holding the phone as you would while surveying, then tap
**I've walked it**. It divides the distance by the steps counted and saves
the result to the venue (`frame.strideM`), used by every route recorded
from here on. Too few steps counted (under 3) and nothing is saved — walk
further and try again.

## Routes wizard — scan, walk, scan

The **Routes** tab — the first one, and where `?admin=1` opens — builds a
venue by scanning, nothing else:

1. **Scan the code where a route starts.** That's it — no name to type, no
   field to fill in. The place is named automatically (from a printed-code
   list, if the venue has one — see "Sticker survey" below — or the code
   itself, so nothing is ever left uncaptured for want of a name), and
   walking begins.
2. **Walk to the next place.** Points are dropped on their own from the
   live position (step-counted between codes — see "Calibrate stride"
   above). If dead reckoning goes stale, the screen says _Position
   uncertain_ and asks for a scan.
3. **Scan the code there.** That single scan ends this route, saves it, and
   starts the next one from right where you're standing — so a whole wing
   gets surveyed by walking it once, scanning at each stop along the way.
   Re-scanning the code you started this leg at (a mis-scan, or the camera
   catching the same sticker twice) only fixes the position; it doesn't end
   the route on itself.

That's the whole flow, and it's the only thing on screen by default. Naming
a place properly, picking one that already exists, tagging a section as
stairs/lift/staff-only, marking a route not wheelchair-friendly, or
starting/finishing somewhere with no code at all — all still there, under
**Advanced**, for whoever wants them; nothing scanning captures is lost by
skipping it.

Everything goes through the same draft as the other tabs: **Undo** removes
the last point, the draft autosaves on this device, and nothing reaches
visitors until you Publish.

## Sticker survey (printed codes first)

The quickest way to map a building when you already have QR stickers printed:
open `/?v=<venue-id>&survey=1`. A venue id that has never been published
starts as a blank sheet — no plan image, one floor — and the panel opens on
the **Sticker survey** tab.

1. **Printed code list** (optional). Paste the list you printed, one per line
   as `code, floor, where it goes` — e.g. `A03, G, Reception desk` — and tap
   **Use this list**. Scanning a listed code then fills in its name and floor,
   the tab shows _n of 24 recorded · next: A04 — Lift lobby (G)_, and the
   list is kept on this device per venue. **Load the demo hospital list** puts
   in the A01–A24 plan from `src/venues/templates/demo-hospital-survey-plan.txt`.
2. Stand at a sticker, type the **Area name** (or a **Ward number**), tap
   **Scan the printed code** and point the camera at it. The scan records:
   - a **marker** with the code's own text (so the scanner recognises that
     sticker from now on, and re-scanning it fixes your position there),
   - a **route node** at your position, linked to the previous stop, and
   - a **place** with that name (aliases and category from the places
     library, or `Ward N` / `W N` for wards), if you named it.
3. Walk to the next sticker. Between scans the app dead-reckons from the
   phone's motion sensors, so the next code lands at the distance and
   direction you walked; a scan of any recorded code snaps you back exactly.
   The first code of a survey becomes the map origin (0, 0).
4. Tap **Save** as you go (the draft also survives a reload), then
   **Publish** from the Export tab so every visitor gets the codes and
   places. Positions can be tidied later in the plan editor.

A typed name always wins over the list; a listed code scanned with the name
box untouched uses the list's name; an unlisted code with no name is still
recorded, by code, and can be named in the Edit tab.

## Record a route (walk it)

1. Get positioned: scan an entrance QR marker, or let the camera provider
   localise (or run with `?provider=mock` to try it at a desk).
2. **Start recording**, then walk. At every junction, door and turn tap
   **Add node here**. Each node is linked to the previous one with the
   walked distance; stepping back onto an existing node (within 1.5 m)
   joins the graph instead of duplicating it, so loops close properly.
3. **Add place here** drops a node and asks for the place's name, category
   and other names people use — that becomes a searchable POI.
4. **Add QR marker here** records an anchor at your position and facing, so
   a printed code at that spot seeds visitors' positions
   (`scripts/make-entrance-qr.mjs` prints them).
5. **Stop recording** ends the walk; start again from anywhere.

The walk is saved on the device as you go, so a reload does not lose it
("Draft restored").

## Plan editor (tap it)

Switch floors, tap the plan to place nodes, tap a node then another to link
them, select a node to rename, add a place, or remove it. **Undo** steps
back through every edit. The draft is drawn over the plan in the accent
colour (selected node in amber, anchors as squares).

## Export

The Export tab shows the draft's size and runs the venue schema validator,
listing any problems by field. **Download** works regardless — getting a
draft out to look at is exactly what it's for, valid or not; only
**Publish for everyone** is blocked while there are problems, since that's
what every visitor would get. The file is named obviously and by the
minute (`brains-<venue-id>-<date>-<time>.venue.json`) so several exports
in a row are easy to tell apart.

On a phone, **Download** uses the native share sheet (Save to Files,
AirDrop, Messages…) where the browser supports sharing a file — iOS
Safari's older download trick often produced nothing you could find. A
toast confirms the filename either way. **Copy JSON** puts the same
content on the clipboard, to paste anywhere.

Publish the file at the venue's URL (`docs/entry.md`) — visitors get it on
their next load.

If neither works — an odd browser, a locked-down device, permissions
denied — **Show the raw JSON** is a plain, read-only text box holding the
exact same content, always current, never gated on validity. Tap inside to
select it all and copy it by hand (screenshot it, dictate it, anything);
it depends on nothing but the page rendering, which is the one thing that
was already working.

## What "training" means here

Positioning quality comes from three things you can improve in this mode:

- **Route graph density** — more nodes at real decision points give better
  instructions and a smoother arrow.
- **Anchors** — QR markers at entrances and lift lobbies give instant,
  exact fixes; put them where people naturally stop.
- **Names and aliases** — what people actually call places.

Camera-map training (Immersal) is done with the Immersal Mapper app, not
here; this mode records the _graph_ that any provider navigates over.
Measure the result with the accuracy harness (`docs/accuracy.md`).
