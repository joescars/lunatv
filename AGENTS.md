# AGENTS.md

## Commands

- Install/run locally: `npm ci && HDHOMERUN_HOST=<device-ip> npm start`. Node does not load `.env` itself; pass env vars explicitly.
- Run the production-like stack: `docker compose up -d --build`.
- Browser/accessibility checks: `npm run test:ui` after `npx playwright install chromium`, or `CHROME_PATH=/usr/bin/google-chrome npm run test:ui`. The suite uses synthetic device data and never tunes a real device. Live playback still needs manual verification with QSV-capable `ffmpeg` (the container provides Jellyfin ffmpeg and maps `/dev/dri`).
- Rebuild committed Material Web/Roboto assets after dependency or entry changes: `npm run build:ui`. Runtime and Docker do not require a frontend build. There are no lint, typecheck, or formatter scripts.
- Docker reads `.env`; use LAN IPs for `HDHOMERUN_HOST` and `RECORD_ENGINE_HOST`, never `localhost` or `hdhomerun.local` from inside the container.
- Trust `docker-compose.yml` over README defaults: Compose currently sets `STREAM_DECODE_MODE=sw` and `WEBVTT_SIDECAR_MODE=off`.
- The Dockerfile configures Jellyfin's repository as `amd64`; native ARM builds fail at `jellyfin-ffmpeg7`. Run the Node app locally for non-playback UI work on ARM rather than changing deployment architecture incidentally.

## Architecture

- `server.js` is the Express entrypoint. Browser pages are server-rendered EJS/htmx; the separate BrightScript/SceneGraph Roku client is in `roku/`.
- Admin routers are mounted under `/admin`; route paths inside `src/routes/{index,channels,scan,status}.js` intentionally omit that prefix. Guide, watch, recordings, and `src/routes/api.js` stay at root.
- Browser and Roku share `/api/guide` and `/stream/*`; update `roku/components/` when changing either API or handshake. Preserve `POST /start` → poll `/ready` → fetch `.m3u8`; the playlist does not exist immediately.
- Fetch a fresh `DeviceAuth` in `src/guide.js` for each guide request; it rotates and must not be cached.
- Stream sessions are keyed by channel, codec, and quality profile (`low|medium|high`, default `medium`). Browser playback must use H.264; HEVC/direct are Roku-only options.

## UI and device API gotchas

- Top-level client views use `_client_header.ejs`; admin views use `_header.ejs`; both share `_document_head.ejs`/`_app_nav.ejs` and close through `_footer.ejs`. `_` view files can also be htmx response fragments.
- `DESIGN.md` and `public/css/style.css` define shared Material 3 tokens; `public/css/client.css` owns viewer patterns. Keep theme logic in `public/js/theme.js` and shared guide controls/overlay in `public/js/guide.js`.
- In htmx URLs, percent-encode every dynamic query value. In particular, unencoded `+` becomes a space and breaks channel favorite updates.
- Always request device `lineup.json` via the existing `getLineup()` path (`?show=all`); the bare endpoint omits channels. Favorite modes are mutually exclusive: `+`, `-`, or `x`.
- The optional RECORD engine is external. Recording the current airing requires a POST rule add followed by `POST recording_events.post?sync`; do not replace the rule-add POST with GET.

## Roku

- All network I/O belongs in SceneGraph `Task` nodes, never the render thread.
- Use `roku/deploy.sh` to package/sideload; `roku/.env` supplies `ROKU_IP`, developer password, and packaged server URL, while inline env vars override it. Use `--package-only` to build without uploading.
- The script places `manifest` at zip root. Bump `roku/manifest` `build_version` before uploading an otherwise identical build; Roku permits only one sideloaded app at a time.
