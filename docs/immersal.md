# Immersal provider

`src/providers/immersal.js` implements `PositionProvider` on top of the
[Immersal VPS for Web SDK](https://github.com/immersal/vps-for-web) (MIT).

## Setup

1. **API key** — create a developer token at
   [developers.immersal.com](https://developers.immersal.com/) and put it in
   `.env` as `IMMERSAL_API_KEY=…` (see `.env.example`). Vite inlines it into the
   client bundle at build time; the provider reads `import.meta.env.IMMERSAL_API_KEY`
   and refuses to construct without it. **Never commit `.env`.** Anything in a
   client bundle is visible to users, so restrict the token in the portal.

2. **Map** — scan the venue with the Immersal Mapper app and note the map id.

3. **Venue JSON** — add the map and the transform from the map's frame to the
   venue's:

   ```jsonc
   "providers": {
     "immersal": {
       "mapId": 12345,
       "origin": { "x": 0, "y": 0, "z": 0 },   // venue coords of the map origin
       "rotationDeg": 0,                       // yaw (CCW, degrees) turning map axes onto venue axes
       "floor": 0                              // optional; otherwise derived from floor elevations
     }
   }
   ```

4. **SDK files** — the SDK is not on npm. Copy the `js/` directory of the
   vps-for-web repository to `public/vendor/immersal/` so that
   `/vendor/immersal/immersal.js` is served. (~3.7 MB, mostly WASM.) The
   provider `import()`s it at runtime; pass `loadSdk` to load it from elsewhere.

## What leaves the device

Declared in `ImmersalProvider.uploads` and shown to users by the UI. In the
default `mode: 'device'`, camera frames are processed locally; the SDK still
contacts a third-party device-detection service (51Degrees) and Immersal's API
for intrinsics and the map download. In `mode: 'server'`, downscaled camera
frames are uploaded for each localisation.

## Coordinate conversion

Immersal maps are right-handed, Y-up, metres. The venue frame is right-handed,
Z-up. `immersalToVenue()` applies

```
venue = origin + Rz(rotationDeg) · (map.x, −map.z, map.y)
```

and derives heading (clockwise from venue +y) from the camera's forward vector.
Calibrate `origin` / `rotationDeg` by standing at a known venue point, reading
the raw map pose, and solving for the offset and yaw.
