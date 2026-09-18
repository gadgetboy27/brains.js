# Deployment

The app is a static site. It deploys to **Cloudflare Pages** over HTTPS, with a
production deploy on every push to `master` and a **preview deploy for every
pull request** (the preview URL is posted as a PR comment).

## HTTPS is not optional

`getUserMedia` (camera), `DeviceMotionEvent`, `DeviceOrientationEvent` and
`speechSynthesis` are only available in a
[secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts).
**Over plain HTTP the app cannot position the user at all**: the camera
providers report `unsupported`, motion events never fire, and the app falls
back to the floor plan with routes from the entrance. The only exception is
`http://localhost`, which browsers treat as secure — that is why `npm run dev`
works on the development machine but not from a phone on the same network.

Cloudflare Pages serves every deployment (production and previews) over HTTPS
and `assets/_headers` adds `Strict-Transport-Security` so browsers never
downgrade.

### Testing on a phone before deploying

```sh
npm run dev:https      # Vite with a self-signed certificate, on your LAN IP
```

Open `https://<your-ip>:5173/` on the phone and accept the certificate warning
once. (For a trusted certificate use [mkcert](https://github.com/FiloSottile/mkcert)
and point Vite at it via `server.https`.)

## One-time setup

1. Create the Pages project (once):
   ```sh
   npx wrangler login
   npx wrangler pages project create brains-js --production-branch master
   ```
   or in the Cloudflare dashboard: Workers & Pages → Create → Pages → Direct upload.
2. Add GitHub repository **secrets**:
   - `CLOUDFLARE_API_TOKEN` — an API token with _Cloudflare Pages: Edit_
   - `CLOUDFLARE_ACCOUNT_ID`
   - `IMMERSAL_API_KEY` — only if the venue uses the Immersal provider
     (baked into the client bundle at build time; restrict it in Immersal's portal)
3. Optional repository **variables** baked into the build: `VENUE_JSON_URL`,
   `VENUE_BASE_URL`, `RUNTIME_CONFIG_URL`, `POSITIONING_PROVIDER`.
4. Add a custom domain to the project in the Cloudflare dashboard if wanted;
   QR codes at the venue should use the final domain (see docs/entry.md).

## What the workflow does

`.github/workflows/deploy.yml`:

- **Lint and test** on every push to `master` and every PR.
- **Preview deploy** for PRs from this repository: `wrangler pages deploy dist
--branch=<pr-branch>`, giving a stable `https://<branch>.brains-js.pages.dev`
  URL per branch, posted (and updated) as a PR comment. PRs from forks are
  skipped because they cannot read the secrets.
- **Production deploy** on `master`.

Manual deploys: `npm run deploy` (production) or `npm run deploy:preview`.

## Headers and redirects

- `assets/_headers` — `Permissions-Policy` allowing camera and motion only for
  the app itself, HSTS, `X-Frame-Options: DENY`, no-cache for `/venues/*` so
  venue JSON and runtime config updates are picked up immediately.
- `assets/_redirects` — every path serves `index.html` (query strings kept),
  so venue links like `/?v=demo-health-centre&anchor=a-entrance` work.

Both are copied into `dist/` by Vite (they live in the public dir, `assets/`).
