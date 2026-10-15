# Admin mode: building a venue from inside the app

`?admin=1` adds a staff panel over the floor plan for building — and
"training" — a venue without leaving the building. It edits a **draft**
copy of the current venue and exports valid venue JSON; nothing changes for
visitors until that JSON is published.

The tools sit in a **side drawer** over the left of the map. **Show map** slides it away (a small **Tools** button stays on the map to bring it back), so the flashing Recording badge and the whole plan are visible while you walk. The top row has just two buttons: **Record routes** (opens by default) and
**Publish**. Everything else — **Undo**, **Sticker survey**, **Record a
route**, **Plan editor**, **Edit existing**, **Hide tools**, **Close admin**
— is one tap under **More ▾**, and picking one closes the menu again. In
**Record routes**, **Scan start code** and **Start here (no code)** are both
visible; while walking, **Scan code to finish here**, **Mark a turn here**,
**I have arrived** and **Cancel this route** are too. There is no separate Save button — every change autosaves the
instant it happens (see "Is it actually recording anything?" below).

## Arrival answers (on-device only)

When a visitor arrives, the HUD asks "Was the route accurate?" (Yes / Mostly /
No, plus "something was blocked or closed" and "wrong floor"). The answer is a
small bit code (`src/core/feedback.js`) saved in that phone's local storage and
**not sent anywhere**. From a test phone, open **Publish → Download answers**
to save them as a file with the readable fields.

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

**The other sharp edge, specific to a camera-only (QR) venue**: two counts
can both look right — a scan makes a new node, and the next scan makes
another — while every single one lands at the exact same coordinates. That
means the _walk in between never got recorded_, and the cause is almost
always **motion permission**. Camera and motion are two separate iOS
prompts; the app used to remember "camera granted" as "never ask again"
even when motion was silently never resolved, which left dead reckoning
permanently off on a device that had granted camera once, long ago. It now
tracks the two separately and re-asks until motion gets a decisive answer
either way — if it's declined, a notice says so outright: _"Motion access
was declined — your position may not update between scans."_ Camera
scanning still works fine in that state (the notice can be easy to miss if
you're not looking for it); it's just the movement between scans that goes
untracked.

### Where this actually lives, and what "backup" means here

There is no database on the phone, and nothing here is a file until you
make it one. What's actually happening, precisely:

1. **Browser storage** (`localStorage`, one JSON blob per origin) — every
   change writes here immediately. This is the only thing that's automatic,
   and it's what the status line above is reporting. It is not a file; it
   doesn't show up in the Files app; it isn't backed up by iCloud; and it
   can be lost — the browser clearing site data, Safari's storage limits
   under pressure, or simply opening a different URL (see above). The app
   also asks the browser to please not evict it (`navigator.storage.persist()`),
   but browsers are free to say no, especially for a page that isn't
   installed or bookmarked.
2. **A real file, on the device** — only happens when you tap **Download**
   in the Export tab (see below). That's the first point any of this
   becomes an actual file in Files/iCloud Drive, AirDrop-able, backed up
   by whatever backs up your phone.
3. **The server database** (Cloudflare KV) — only happens when you tap
   **Publish**, which needs `ADMIN_TOKEN` set up first (`docs/publishing.md`).
   This is the only copy every visitor and every device shares, and the
   only one with version history (`docs/publishing.md` covers rollback).

So: recording is automatic, but **backup is not** — nothing leaves this
one browser's storage until you Download, Copy, or Publish. To make that
impossible to miss, the status line adds a warning the moment a change
exists that hasn't been taken anywhere:

> _⚠ Only on this device — Download, Copy or Publish before you close this
> tab._

It clears the instant any of those three succeeds, and reappears on the
next change. Closing the tab (or admin) while it's showing also asks the
browser's own "leave this page?" confirmation, as a last line of defence.

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

**Finishing a route is always a scan, never a button.** There is no "I'm
done, save this" button on screen — reaching the next place and scanning
the code there both means "I've arrived" _and_ saves the leg, in one tap.
**Cancel this route**, next to the scan button, does the opposite of what
it might sound like mid-walk: it throws away the destination for the leg
in progress rather than saving it (points already dropped stay — Undo
removes them). If there's genuinely no code at the destination, open
**Advanced** and tap **I have arrived** instead, which does let you name
it and save.

Everything goes through the same draft as the other tabs: **Undo** removes
the last point, the draft autosaves on this device, and nothing reaches
visitors until you Publish.

**On the camera view itself** (not just the panel below it): a square
viewfinder frame flashes green for a moment on every code the camera
manages to decode — recognised or not — so it's obvious the camera is
actually reading frames, distinct from the phone's own "camera is on"
light. While a leg is in progress, a **"Recording — N m"** badge sits at
the top of that view with the live distance walked since the start scan,
so the answer to "is it tracking me right now" is on screen the whole
time, without switching to the floor plan to check.

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

Opening the tab leads with exactly what to do: the draft's size, whether
it validates, then **Publish for everyone** / **Download** / **Copy** —
nothing else above the fold. **Download** works regardless of validity —
getting a draft out to look at is exactly what it's for, valid or not;
only **Publish for everyone** is blocked while there are problems, since
that's what every visitor would get. The file is named obviously and by
the minute (`brains-<venue-id>-<date>-<time>.venue.json`) so several
exports in a row are easy to tell apart.

Everything else on the tab is one tap away, collapsed, instead of sitting
in the way: **QR markers (N)** opens the sticker sheet — a code image per
marker, only useful when you're actually printing — and **Discard draft**
sits at the very bottom, away from the buttons you'd actually reach for.

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

## Walk data (what the app learns on staff phones)

In admin mode the phone quietly notes two things as you walk: how many steps
it counted between two QR markers against the graph's distance between them,
and which route leg you left when the app had to reroute you. Nothing is
applied automatically and nothing is sent anywhere; visitor phones record none
of it.

Publish → **Download walk data** saves a `.learning.json` with the raw notes
and a short list of proposals:

- **stride** — appears after 3 or more walks of 15+ steps whose typical stride
  differs from the venue's by 4% or more. Enter it with the stride calibration
  box if you agree.
- **heading** — from straight marker-to-marker walks (8 m or more, no corners):
  the average angle between where dead reckoning ended up and where the second
  marker really is. Proposed as a new `frame.headingOffsetDeg` only when at
  least 3 walks agree closely; walks that disagree usually mean interference
  (metal doorframes, lifts) or a phone carried at different angles, and
  produce no proposal.
- **trouble spots** — route legs left 3 or more times. Usually a missing
  marker, a wrong edge or a confusing junction there.

Walk marker to marker along the real corridor (not cutting corners) for the
stride figure to mean anything.

## Training screen (the simple way to record routes)

Open **Training screen** at the top of the Routes tab, or add `?train=1` to the
address. Everything else steps out of the way and you get:

- a huge **live step counter** that ticks (and buzzes) on every step, so you
  can see the phone is tracking you right now;
- one big button, **START HERE**, which opens the camera: scan the QR code
  where the route starts;
- walk. Route points, corners, floor changes and names are handled for you
  (names come from the code or its printed-code list);
- the same button now says **STOP HERE**: scan the QR code where you finish.
  The route is saved, and the screen offers **Walk on from here** (that stop
  becomes the next start) or **Finished**.

No QR code to hand? "Start at my position" and "Stop at my position" do the
same without a scan, naming the places Point 1, Point 2... (rename them later
in the Edit tab).

The line under the counter tells you what to do: keep walking; scan a QR soon
(the position has drifted); no steps detected (hold the phone steady, or allow
Motion access); or paused (you stopped walking). The screen is kept awake
while it is open (a sleeping phone stops counting steps) where the browser
supports it. Counting starts after the first scan of the session, because
steps need a known starting position.

### The quality check

When a route ends at a marker the venue already knows, the app compares where
the steps said you were with where that marker really is. The gap is the
drift of that walk, shown on the result card:

- **Good**: off by only about a metre (or 5% of the walk).
- **Fixed up**: up to about 3 m (or 15%). The drift is spread back along the
  route's own points, the earlier a point the less it moves, so the saved
  corridor ends exactly on the marker.
- **Check this one**: further than that. Nothing is changed in the map, and
  **Walk it again** removes just that route's points so you can redo it.
- **Saved, nothing to check it against**: the end code is new, so there is
  no known position to compare with. Walk back to it from another marker
  later to check it.

If your steps are consistently 5% or more shorter or longer than the app
assumes, it says so. Setting your stride (More tools, stride calibration)
improves every later walk. A scan in the middle of a route is checked the
same way, stretch by stretch. A route that began at an approximate position,
or crossed floors, is not judged.

### Undo last route, and the torch

- **Undo this route** (on the result card) or **Undo last route** (at the
  start screen, until the next route begins) takes the most recent saved
  route back out: its points, its edges, the places it named and any new
  markers it recorded. Anything it only passed through (a junction shared with
  another route, a marker that already existed) stays. Repeat it to step back
  through the session. It is not offered mid-route; use Stop first.
- **Torch** appears in the corner when the camera has one (Android Chrome on
  the back camera; iPhones do not expose a torch to web pages). Switch it on to
  read a code in a dim corridor. It goes off by itself as soon as the code is
  read, or when you leave the training screen, so it does not drain the
  battery.

### Scan sounds and the scan check

Every scan now gets a sound and a check, so you do not have to look at the screen.

**Sounds** (generated by the phone; no audio files): a bright two-note chime when a
marker reads and fits; two flat tones when it read but does not fit the walk; a
low falling tone when the code is not a marker of this venue; and a rising
three-note phrase when a route is saved (flat tones instead if the quality check
flagged it). Cues queue rather than overlap. They are on by default on staff
phones and off for visitors (a quiet ward); the **Sound** button on the training
screen switches them, and the choice is remembered on the phone. Browsers only
allow sound after a tap, so the first tap on the page unlocks it. A visitor can
get them with `?sound=1`.

**The scan check** asks, for every marker read after the first: does it fit?

- **Fits**: dead reckoning had you close to this marker, within what drift
  allows (about 2 m plus 15% of the distance walked). Nothing is said to a
  visitor; the training screen shows how far off you were.
- **Check**: further off than drift explains, but you could have walked there.
  Usually drift, but worth a look: a visitor sees a short notice, the screen
  shows how far.
- **Too far**: the previous marker and this one are further apart than the steps
  you took could cover (about 1.2 m a step, plus 5 m of slack). Drift cannot
  explain this: one of the two markers is in the wrong place on the map, or the
  wrong sticker was read. The position is still updated (the marker is
  trusted), and a visitor is told to scan another marker if the arrow looks
  wrong.

Not judged: the first scan, a scan on another floor (stairs and lifts are not
step-counted), and "too far" is not claimed when no steps have been counted at
all (motion access declined), so a phone that cannot count steps does not raise
false alarms.

On staff phones every flagged scan is kept, and the walk-data export lists
**suspect markers**: pairs flagged three or more times (or "too far" twice),
which points at a misplaced marker or a sticker that has moved.

### Loop closure

When a route ends back at a marker you recorded earlier in the same session,
the gap between where the steps say you are and where that marker was recorded
is how far the whole loop drifted. It is spread back along every route in the
loop, in proportion to distance walked: the points those routes created and the
markers recorded along the way all move by their share (the earlier, the less),
and the marker you came back to stays put. The result card says "Loop closed"
with the drift and the loop's length.

It only applies to an unbroken loop (each route starts where the last ended)
that did not pass an independently known marker on the way (that already
corrected the stretch it ended). A loop that misses by more than the
good/fixed-up limits is reported and nothing is moved, so a bad walk is not
averaged into the map.

**What it cannot catch:** an out-and-back along the same corridor. The way back
undoes the way out, so a step-length or compass error cancels and the loop
closes with almost no gap even if the far end was placed too short. The result
says so when most of the way back was over points already on the map. To catch
a step-length error, set your stride first (More tools, stride calibration, by
walking a measured distance), or end the walk at a marker whose position is
already known. A real loop, with a different way back, is where this shines.

Each saved route's result (verdict, drift, length, loop or not) is kept with the
walk data: Publish, **Download walk data**.
