# Privacy notice — indoor wayfinding app

_For the hospital privacy team. This describes what the app does with data,
in plain terms. It is generated in part from the software itself (the
provider tables below come from each positioning module's own declaration),
and a test fails if they fall out of step._

Last reviewed: 2026-09-19.

## In one paragraph

The app is a web page that helps a visitor find their way around a building.
It does not need an account, a name, or any personal details. To work out
where the visitor is it may use the phone's camera and motion sensors; in the
default configuration that processing happens on the phone and nothing about
the visitor is sent anywhere. The only exception is a venue that has chosen
the Immersal visual-positioning service, described below. The app never uses
GPS, never records photos or video, sets no cookies, and has no analytics or
advertising.

## What the app collects, and where it goes

### Data that stays on the phone

| Data                                                           | Why                                                      | Stored?                                                                                       | Kept for                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Camera frames (while the camera view is open)                  | Recognising markers and surroundings to find the visitor | No — processed in memory and discarded                                                        | Not kept                                                  |
| Motion and orientation sensor readings                         | Keeping the direction arrow right between camera fixes   | No                                                                                            | Not kept                                                  |
| The visitor's estimated position and route inside the building | Showing the arrow, the floor plan and instructions       | No — in memory for the session only                                                           | Until the page is closed                                  |
| Chosen destination                                             | Routing                                                  | No — in memory only                                                                           | Until the page is closed                                  |
| Settings: language, high-contrast mode, voice on/off and speed | Remembering preferences                                  | Yes, in the browser's local storage on the phone                                              | Until the visitor clears browser data                     |
| "Camera permission granted" flag                               | Not asking again on later visits                         | Yes, local storage                                                                            | Until browser data is cleared                             |
| A copy of the venue map and the venue's runtime notices        | So the floor plan still works if the network drops       | Yes, local storage                                                                            | Until browser data is cleared or replaced by a newer copy |
| Accuracy-test logs (staff testing mode only, `?harness=1`)     | Measuring positioning quality during commissioning walks | Only in memory unless a tester presses "Download log", which saves a file to their own device | At the tester's discretion                                |

None of this is sent to the venue, the hospital, or the developers.

### Data that leaves the phone — by positioning method

Which methods are in use is decided per venue in its configuration. The
first-run screen shows visitors exactly the rows below for their venue before
asking for any permission.

<!-- providers:start -->

### QR markers

Reads printed codes with the camera and decodes them on the phone.

**Nothing leaves the phone.** All processing happens on the device.

### Immersal visual positioning

Recognises the venue from camera frames using a scanned map. Only present at venues that have chosen it.

| What is sent | Where it goes | Why | Kept for |
|---|---|---|---|
| Browser and device identification (user agent / client hints) | 51Degrees device-detection service (cloud.51degrees.com), a third party | The SDK loads a 51Degrees script to identify the phone model so it can look up camera intrinsics. | Governed by 51Degrees; not controlled by this app. |
| Developer API key and the detected device vendor + model | Immersal cloud (api.immersal.com/devget) | Fetch known camera intrinsics (focal length, principal point) for this device model. | Not stated by the recipient; not controlled by this app. |
| Developer API key and the venue map id | Immersal cloud (api.immersal.com/map and /ecef) | Download the venue map for on-device localisation and its geo-reference (if any). | Not stated by the recipient; not controlled by this app. |
| Camera frames (downscaled PNG), camera intrinsics, device orientation quaternion, developer API key, map ids | Immersal cloud (api.immersal.com/localize) | Server-side localisation. Sent ONLY when mode is "server"; in the default "device" mode frames never leave the phone. | Per Immersal terms; not controlled by this app. |
| None of the user’s data (library code only) | cdnjs.cloudflare.com and cdn.jsdelivr.net | The SDK’s PNG-encoding worker imports pako and UPNG from public CDNs (server mode). | Not stated by the recipient; not controlled by this app. |

### Mock (development only)

Simulated positions; never enabled for visitors.

**Nothing leaves the phone.** All processing happens on the device.

<!-- providers:end -->

Important points for the Immersal rows:

- In the default **on-device** mode the venue map is downloaded to the phone
  and camera frames are matched locally. Frames leave the phone **only** if
  the venue is configured for server-side localisation, which we do not
  recommend and do not enable by default.
- The Immersal software contacts a third-party device-detection service
  (51Degrees) to identify the phone model. This is a property of the vendor's
  software, not something this app adds. Venues that cannot accept it should
  use QR markers only.
- The API key that authorises these requests identifies the venue's account,
  not the visitor.

### Hosting

The app is served as static files from Cloudflare Pages over HTTPS. Like any
web host, Cloudflare receives the visitor's IP address and browser details in
order to deliver the page, and keeps standard request logs under its own
retention policy. The app itself has no server: it stores nothing about
visitors anywhere, and receives no information back from them.

Venue files (the map, floor-plan images, runtime notices) are fetched from
the same host. They describe the building, not the visitor.

### QR markers

A printed marker encodes only a venue identifier and a marker identifier
(e.g. `?v=demo-health-centre&anchor=a-entrance`). Scanning it tells the app
which building and which spot the visitor is standing at. It carries no
personal information and creates no record of the scan.

## Where processing happens

| Processing                                                 | Location                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| Positioning (QR, dead reckoning, on-device Immersal)       | On the phone                                                            |
| Routing, floor plan, speech guidance                       | On the phone (speech uses the phone's built-in voices)                  |
| Immersal map download and, if enabled, server localisation | Immersal's cloud service, in the region of the venue's Immersal account |
| Device model detection (Immersal only)                     | 51Degrees cloud service                                                 |
| Page and file delivery                                     | Cloudflare's edge network                                               |

## Retention summary

| Holder                                    | What                                             | How long                                                                 |
| ----------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| The app / developers                      | Nothing about visitors                           | —                                                                        |
| The visitor's phone                       | Preferences, permission flag, cached venue files | Until browser data is cleared                                            |
| Cloudflare                                | Standard web-server request logs                 | Per Cloudflare's policy                                                  |
| Immersal (only at venues using it)        | Per the tables above                             | Per Immersal's terms — the venue should hold a data-processing agreement |
| 51Degrees (only at venues using Immersal) | Device identification request                    | Per 51Degrees' policy                                                    |

## What is never collected

- **Location outside the building.** No GPS or network geolocation is used
  or requested; the app's data format rejects GPS coordinates, and the
  browser policy sent with the page (`Permissions-Policy: geolocation=()`)
  disables the geolocation API entirely.
- **Identity.** No accounts, names, email addresses, phone numbers, patient or
  staff identifiers, or appointment details.
- **Health information** of any kind.
- **Photos or video.** Camera frames are never saved; in the default mode they
  never leave the phone.
- **Audio.** The microphone is not used and is disabled by the page's policy.
- **Contacts, calendar, Bluetooth, NFC** or other phone data.
- **A history of where the visitor went or what they searched for.**
- **Analytics, advertising identifiers, fingerprinting or tracking cookies.**
  The app sets no cookies at all.

## Visitor controls

- The first-run screen lets a visitor choose **Use the floor plan only**,
  which never opens the camera or motion sensors. Positioning then starts
  from the entrance.
- Camera and motion permissions can be withdrawn in the phone's browser
  settings at any time; the app keeps working on the floor plan.
- Clearing the browser's site data removes every stored item listed above.

## Contact and change control

The tables of what each positioning method sends are generated from the
software by `scripts/privacy-table.mjs`; changing a provider's declared data
flows without updating this notice fails the test suite. Questions about
this notice should go to the team operating the venue's deployment.
