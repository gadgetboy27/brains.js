# Deployment

The app is a static site. It deploys to **Cloudflare** over HTTPS as a Worker
serving static assets (Cloudflare Pages is now part of Workers), with a
production deploy on every push to `master` and a **preview deploy for every
pull request** (the preview URL is posted as a PR comment).

Production: **https://brains-js.henrypeti-dev.workers.dev** (add a custom
domain in the Cloudflare dashboard → Workers & Pages → brains-js → Settings →
Domains; QR codes should use the final domain).

## HTTPS is not optional

`getUserMedia` (camera), `DeviceMotionEvent`, `DeviceOrientationEvent` and
`speechSynthesis` are only available in a
[secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts).
**Over plain HTTP the app cannot position the user at all**: the camera
providers report `unsupported`, motion events never fire, and the app falls
back to the floor plan with routes from the entrance. The only exception is
`http://localhost`, which browsers treat as secure — that is why `npm run dev`
works on the development machine but not from a phone on the same network.

Cloudflare serves every deployment (production and previews) over HTTPS and
`assets/_headers` adds `Strict-Transport-Security` so browsers never
downgrade.

### Testing on a phone before deploying

```sh
npm run dev:https      # Vite with a self-signed certificate, on your LAN IP
```

Open `https://<your-ip>:5173/` on the phone and accept the certificate warning
once. (For a trusted certificate use [mkcert](https://github.com/FiloSottile/mkcert)
and point Vite at it via `server.https`.)

## One-time setup

1. Create the Worker (done once, from a machine logged in with `npx wrangler login`):
   ```sh
   npm run deploy
   ```
   `wrangler.jsonc` names it `brains-js` and points it at `dist/` with
   single-page-app fallback, so `/?v=<venue>&anchor=<id>` links work.
2. Add GitHub repository **secrets** (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_ACCOUNT_ID` — from `npx wrangler whoami`
   - `CLOUDFLARE_API_TOKEN` — create at dash.cloudflare.com → My Profile →
     API Tokens → _Create Token_ → template **Edit Cloudflare Workers**
     (permissions: Account · Workers Scripts · Edit, plus User · User Details ·
     Read), scoped to this account. Set it with
     `gh secret set CLOUDFLARE_API_TOKEN` (prompts for the value).
   - `IMMERSAL_API_KEY` — only if the venue uses the Immersal provider
     (baked into the client bundle at build time; restrict it in Immersal's portal)
3. Optional repository **variables** baked into the build: `VENUE_JSON_URL`,
   `VENUE_BASE_URL`, `RUNTIME_CONFIG_URL`, `POSITIONING_PROVIDER`.

Until the two Cloudflare secrets exist the workflow skips deploying with a
warning rather than failing.

## What the workflow does

`.github/workflows/deploy.yml`:

- **Lint and test** on every push to `master` and every PR.
- **Preview deploy** for PRs from this repository: `wrangler versions upload
--preview-alias=<branch>`, giving
  `https://<branch>-brains-js.henrypeti-dev.workers.dev`, posted (and updated)
  as a PR comment. Nothing changes for visitors until `master` deploys. PRs
  from forks are skipped because they cannot read the secrets.
- **Production deploy** on `master`: `wrangler deploy`.

Manual deploys: `npm run deploy` (production) or `npm run deploy:preview`
(alias `preview`).

## Headers

`assets/_headers` (copied into `dist/` by Vite) sets `Permissions-Policy`
allowing camera and motion only for the app itself, HSTS,
`X-Frame-Options: DENY`, and no-cache for `/venues/*` so venue JSON and runtime
config updates are picked up immediately. Single-page-app routing comes from
`assets.not_found_handling` in `wrangler.jsonc`, not a `_redirects` file
(Workers rejects the catch-all redirect rule).
