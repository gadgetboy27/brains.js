# Admin mode: building a venue from inside the app

`?admin=1` adds a staff panel over the floor plan for building — and
"training" — a venue without leaving the building. It edits a **draft**
copy of the current venue and exports valid venue JSON; nothing changes for
visitors until that JSON is published.

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

The Export tab shows the draft's size and runs the venue schema validator;
**Download venue.json** is enabled only when it is valid, and the problems
are listed by field otherwise. Copy JSON is the alternative on devices
where downloads are awkward. Publish the file at the venue's URL
(`docs/entry.md`) — visitors get it on their next load.

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
