# Using the wayfinding app on site

A shareable, designed version of this page: https://claude.ai/artifact/EmBJRVxfYMn7uDuj8P4vCn

## Staff: setting up a venue

Time: about 40 minutes of walking per floor, plus printing. Cost: printing.

1. **Open admin mode** on a phone: `https://brains-js.henrypeti-dev.workers.dev/?v=<venue-id>&admin=1`. Choose the venue id once — it is printed on every marker. Allow camera and motion.
2. **Get a start position**: tap the plan where you stand, or scan an existing marker.
3. **Record the routes people take**: _Record a route → Start recording_; tap **Add node here** at every junction, door, lift lobby and turn. Nodes link with the walked distance; stepping back onto an existing node joins the graph. **Add place here** at destinations (start typing — _Main reception_, _ED reception_, _Radiology_ — and pick from the list). **Add QR marker here** where a marker will go, standing and facing as a visitor would. Ride the lift and take the stairs once each; mark staff shortcuts as staff.
4. **Tidy on the plan**: tap to add, tap two nodes to link, rename, remove, undo. The draft is saved on the phone.
5. **Publish for everyone** (_Export_ tab). The venue is validated, then stored on the server; every visitor gets it from then on. The publishing key is set once per deployment with `npx wrangler secret put ADMIN_TOKEN`.
6. **Print the markers**: `node scripts/make-entrance-qr.mjs --venue venue.json --base https://brains-js.henrypeti-dev.workers.dev/ --out qr/` — one page per marker. Stick them at eye height where you recorded them.
7. **Check it**: `…&harness=1`, walk again, tap each checkpoint as you stand on it, _Show report_. Mean under 2 m, worst under 5 m is comfortable; a bad checkpoint wants a marker.
8. **Closures**: publish a runtime config (see `publishing.md`) — no redeploy; visitors see it within a minute.

### Where markers go

| Place                                   | Why                               |
| --------------------------------------- | --------------------------------- |
| Every public entrance, inside the doors | Sets the visitor's start exactly  |
| Each lift lobby, both floors            | Position is lost in a lift        |
| Receptions and waiting areas            | People stop and re-orient here    |
| Long corridors, every 20–30 m           | Estimation drifts between markers |
| Where corridors fork                    | Where wrong turns happen          |

## Visitors

1. Point the phone camera at the code by the door and tap the link — nothing to install.
2. **Allow camera and motion** for the arrow view, or **Use the floor plan only**; both are fine.
3. Type or browse for where you're going (_toilets_, _x-ray_, _ED_, _café_).
4. Hold the phone up to follow the arrow, or flat for the map; it switches by itself. The bottom of the screen shows the destination, distance and next step.
5. Voice guidance can be muted or slowed at the bottom; it works with screen readers.
6. If it says _Position uncertain_, scan the nearest code on the wall.

Languages: English and te reo Māori (venues can add more). High contrast and large buttons are on the destination screen. `?wheelchair=1` routes by lifts and ramps only. Your data stays on your phone.
