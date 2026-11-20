# LunaTV

A self-hosted web and Roku client for watching live TV from an [HDHomeRun](https://www.silicondust.com/). It includes a responsive guide, live playback, optional RECORD DVR support, and an admin panel for device management.

## Features

- **Guide** (`/` or `/guide`) with search, favorites, hidden-channel filters, program details, artwork, and a desktop grid (`/guide/grid`). Stale guides refresh when a background tab resumes without losing filters, focus, or scroll position.
- **Live playback** in an overlay. The server converts HDHomeRun MPEG-2/AC-3 to H.264/AAC HLS for browsers, using QSV encoding by default. Browser playback includes captions, hls.js recovery, native-HLS error handling, and bfcache recovery.
- **DVR recordings** (`/recordings`) through an optional [HDHomeRun RECORD](https://info.hdhomerun.com/info/dvr) engine. Recordings are seekable HLS streams and clean up automatically after playback.
- **Admin tools** for device information, channel lineup/favorites/hidden channels, channel scans, and tuner status.
- **Roku client** in [`roku/`](roku/) with live TV, guide previews, H.264/HEVC/Direct modes, captions, diagnostics, recordings, and optional DVR scheduling.
- Responsive Material 3 UI with light/dark themes. Browser dependencies are vendored locally for offline operation.

See [`roku/README.md`](roku/README.md) for Roku setup and sideloading.

## Docker Compose

The default Compose file runs the published image, pinned to an immutable digest (`ghcr.io/joescars/lunatv@sha256:…`) rather than the mutable `latest` tag, so a restart never silently pulls different code. Create `.env` beside it:

```dotenv
HDHOMERUN_HOST=192.168.1.100
HDHOMERUN_PORT=80
LUNATV_BIND_ADDRESS=127.0.0.1
STREAM_DECODE_MODE=sw
WEBVTT_SIDECAR_MODE=off
SOURCE_CAPTION_PROBE=off
RECORD_ENGINE_HOST=
RECORD_ENGINE_PORT=37899
```

Use LAN IP addresses for `HDHOMERUN_HOST` and `RECORD_ENGINE_HOST`; do not use `.local` names or `localhost` from inside the container.

```bash
docker compose up -d
```

Open `http://127.0.0.1:8080` on the Docker host (see [Network exposure](#network-exposure) to reach it from other devices). The container maps `/dev/dri` for Intel QSV and drops the application process to a non-root user while retaining the GPU device groups. The image is amd64-only because of the Jellyfin ffmpeg dependency; use local Node development on ARM.

To run the local checkout instead of the published image:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

The override builds `lunatv:dev` and keeps the same port binding; plain `docker compose up -d` only runs the digest-pinned published image.

### Network exposure

Compose publishes port 8080 on `127.0.0.1` by default (`LUNATV_BIND_ADDRESS`). The admin pages and mutation routes (channel changes, scans, recording rules) should be treated as trusted-network-only unless authentication is enabled for your version; do not expose the port to the internet or an untrusted network.

- **Same machine only (default):** leave `LUNATV_BIND_ADDRESS=127.0.0.1`.
- **Roku or other LAN devices:** set `LUNATV_BIND_ADDRESS` to the Docker host's trusted LAN IP (for example `192.168.1.50`) and point the Roku `HDHOMERUN_WEB_URL` at `http://<that-ip>:8080`. Use `0.0.0.0` only behind a firewall that limits who can reach the port.
- **Remote access:** put an authenticated reverse proxy or VPN in front and keep the bind address on loopback or a private interface.

Docker's published ports bypass some host firewall rules (`ufw`), so binding to a specific address is more reliable than a firewall rule alone.

### Updating the pinned image

The digest in `docker-compose.yml` is the image index for the `latest` tag at the commit named in the comment above it. To upgrade, review the target release or commit, then resolve its digest instead of copying a tag:

```bash
docker buildx imagetools inspect ghcr.io/joescars/lunatv:latest   # or :sha-<full commit> / :vX.Y.Z
```

Confirm the image's `org.opencontainers.image.revision` label matches the reviewed commit, replace the `@sha256:…` value in `docker-compose.yml`, then run `docker compose pull && docker compose up -d`.

## Configuration

`HDHOMERUN_HOST` is required. Other settings:

| Variable | Default | Purpose |
|---|---:|---|
| `HDHOMERUN_PORT` | `80` | HDHomeRun HTTP port. |
| `PORT` | `8080` | Web server port inside the container. |
| `STREAM_DECODE_MODE` | `sw` | `sw` preserves browser CEA-608 captions while QSV still encodes; `qsv` reduces CPU use but does not preserve embedded captions. QSV automatically selects the source decoder. |
| `WEBVTT_SIDECAR_MODE` | `off` | Experimental WebVTT caption extraction. |
| `SOURCE_CAPTION_PROBE` | `off` | Raw-input caption diagnostics. |
| `RECORD_ENGINE_HOST` | — | Optional RECORD engine address; enables DVR controls. |
| `RECORD_ENGINE_PORT` | `37899` | RECORD engine HTTP port. |
| `STREAM_MAX_SESSIONS` | `4` | Fallback concurrent live-session limit when the device does not report its tuner count. Excess starts return 503. |

The default Compose configuration is software decode plus QSV encode. QSV playback requires an Intel GPU and `/dev/dri`; the guide, lineup, scan, and status pages work without it.

## Local development

```bash
npm ci
HDHOMERUN_HOST=<device-ip> npm start
```

Live playback also requires an ffmpeg build with QSV support. The Docker image supplies Jellyfin ffmpeg and the Intel media driver.

## API handshake

The browser and Roku clients share these stream endpoints:

1. `POST /stream/<channel>/<codec>[/<profile>]/start`
2. Poll `GET .../ready` until `ready: true` or stop on `failed: true`.
3. Fetch `GET .../stream.m3u8` and its segments.

Codecs are `h264`, `hevc`, or `direct`; profiles are `low`, `medium` (default), or `high`. Browsers should use H.264. A start can return 404 for an unavailable lineup channel or 503 when tuners/session capacity are exhausted. Playlist and segment GETs never create a session and return 404 without a prior start. Identified viewers use `?viewer=<id>` so one viewer stopping cannot terminate a shared session.

DVR playback uses the same handshake:

- `POST /recordings/<id>/<profile>/start`
- `GET /recordings/<id>/<profile>/ready`
- `GET /recordings/<id>/<profile>/stream.m3u8`
- `POST /recordings/<id>/<profile>/stop`

Recording playlists retain segments for seeking. Temporary files are removed on stop, after 60 seconds of inactivity for an active transcode, or after 10 minutes for a finished one. A two-hour medium-quality recording can use roughly 3 GB temporarily.

State-changing requests from another site receive 403. Reverse proxies must preserve the original `Host` or set `X-Forwarded-Host`.

## UI checks

The browser suite uses synthetic device data and never tunes a real device:

```bash
npx playwright install chromium
CHROME_PATH=/usr/bin/google-chrome npm run test:ui
```

Additional regression suites:

```bash
npm run test:server
npm run test:streams
node --test tests/roku-static.cjs
```

After changing frontend dependencies or `frontend/material.js`, rebuild checked-in assets:

```bash
npm run build:ui
```

## Project layout

```text
server.js              Express entrypoint
src/                   HDHomeRun, guide, stream, recording, and route code
views/                 Server-rendered EJS templates
public/                CSS, JavaScript, and vendored browser assets
roku/                  BrightScript/SceneGraph client
Dockerfile             Published amd64 image
```

## Screenshots

The current browser design is documented in [`DESIGN.md`](DESIGN.md). UI tests produce synthetic screenshots under `.impeccable/review/`.
