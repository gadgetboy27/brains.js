# Publishing venues (so the next person gets them)

Admin mode (`?admin=1`) edits a draft on the staff member's phone. **Publish
for everyone** sends it to the server; from then on every visitor who opens
the venue loads that version. No redeploy, no file copying.

## How it works

The site is a Cloudflare Worker (`worker/index.js`) that serves the static
app and a small API backed by a KV namespace:

| Request                                             | Result                                                          |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `GET /venues/<id>/venue.json`                       | The published venue from KV; if none, the static file; else 404 |
| `GET /venues/<id>/runtime.json`                     | Published runtime config; else static; else an empty config     |
| `PUT /api/venues/<id>`                              | Validate and publish venue JSON (keeps the last 20 versions)    |
| `PUT /api/venues/<id>/runtime`                      | Publish a runtime config (closures, hidden POIs, notice)        |
| `GET /api/venues`                                   | Published venue ids                                             |
| `GET /api/venues/<id>/history`                      | Versions with timestamps                                        |
| `POST /api/venues/<id>/rollback` `{ "version": n }` | Restore a previous version                                      |

The app loads `/venues/<id>/venue.json` for `?v=<id>` (QR entry) and for
`DEFAULT_VENUE_ID`, and polls `/venues/<id>/runtime.json` for closures, so
published changes reach visitors on their next load (runtime config within
a minute).

Every `PUT` body goes through the same validators as the app; invalid data
is rejected with the field named and nothing is stored.

## One-time setup

1. The KV namespace `VENUES` is bound in `wrangler.jsonc`.
2. Set the publishing key (a Worker secret; never in the repo):
   ```sh
   npx wrangler secret put ADMIN_TOKEN
   ```
   Choose a long random string. Until it is set the API answers 503 and the
   admin panel says publishing is not set up.
3. Deploy (`npm run deploy`, or push to `master`).

## Using it

In admin mode → **Export** → **Publish for everyone**. The first time, the
panel asks for the publishing key and keeps it for the browser session only.
After a successful publish the local draft is cleared (it is now the
published version).

Closures without the UI, from a terminal:

```sh
curl -X PUT https://brains-js.henrypeti-dev.workers.dev/api/venues/demo-health-centre/runtime \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"version":1,"closures":[{"from":"n-lift-g","to":"n-lift-1","reason":"Lift out of service"}],"hiddenPois":[]}'
```

## Limits (pilot-grade, deliberately)

- One shared publishing key per deployment. Rotate it with
  `wrangler secret put ADMIN_TOKEN`; anyone with it can publish any venue.
- History is the last 20 versions; rollback is a publish of an old version.
- The dev server (Vite) has no API: on it, download the file instead.
