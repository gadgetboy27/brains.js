# legacy/

The original GPS-based AR.js demos that this project started as. They are kept
here **for reference only**.

- **Do not edit or extend these files.** They are frozen snapshots of the old
  approach and exist so the history of how things were done isn't lost.
- New work lives outside this folder. If you need something from here, copy the
  idea, not the file.
- The files were moved in unmodified. Relative paths inside them (`config.js`,
  `assets/...`, `./style.css`, `index1.js`) still point at the repo root, so
  they are not expected to run from this location as-is.

## Contents

| File | Notes |
|---|---|
| `index.html` / `index.js` | "AR.js Location-based AR" — first entry point using `ar-threex-location-only`. The HTML references a non-existent `index1.js`. |
| `index2.js` | Foursquare places loader (via cors-anywhere) used by `index10.html`. |
| `index3.html` / `index3.js` | "AR.js Places with Images" — `gps-camera` + `gps-entity-place` scene, Foursquare-backed, loads `config.js`. |
| `index4.html` / `index4.js` | "AR.js Places Demo (Enhanced)" — iteration on `index3`. |
| `index10.html` | "GeoAR.js demo" — older jeromeetienne/ar.js build with a 3D arrow model (`assets/models/arrow-model.glb`). |
| `google.html` / `google.js` | "Street View and Places API Integration" — Google Maps Places experiment. Note: `google.html` embeds a Google Maps API key inline. |
| `navigation.html` / `navigation.js` | "Navigation AR - Direction Arrows" — `aframe-look-at-component` arrows pointing at Foursquare destinations. |

`index3.html`, `index4.html`, `navigation.html` and `navigation.js` were not
present on this branch's history and were restored verbatim from
`origin/master` when this folder was created.
