# Agent Prompts: Platform and Operations

These prompts are self-contained handoffs for platform, security, deployment,
and observability work. Use the task IDs from
`docs/user-admin-experience-roadmap.md` when tracking progress.

## P01: Authentication and authorization

```text
Implement optional authentication and authorization for LunaTV. Read AGENTS.md
and CHANGELOG.md first, then inspect every route in server.js and src/routes/.
Do not edit Roku behavior until you have identified how it authenticates to the
shared JSON and stream APIs.

Requirements:
- Support a secure deployment mode with at least viewer and administrator
  capabilities. Viewer access may browse/watch; administrator access is required
  for channel flags, scans, detailed diagnostics, and destructive DVR actions.
- Preserve a documented trusted-LAN mode if authentication is explicitly disabled.
- Store password-equivalent secrets outside source control and images. Never log
  credentials or tokens.
- Define how browser sessions, Roku API requests, HLS segment requests, and direct
  links authenticate without putting long-lived credentials into URLs.
- Return appropriate HTML or JSON errors for each client. Avoid redirecting HLS or
  JSON requests to HTML login pages.
- Add secure cookie settings, login/logout behavior, and brute-force protection if
  application-managed passwords are used.
- Update README, .env.example, and CHANGELOG with setup and migration guidance.

Acceptance criteria:
- Anonymous users cannot reach protected operations when auth is enabled.
- Viewer credentials cannot perform admin mutations or view protected diagnostics.
- Browser playback and Roku playback still complete the start/ready/HLS handshake.
- Existing trusted-LAN installs have an explicit, documented upgrade path.

Verification:
- Exercise anonymous, viewer, and admin access against HTML and JSON endpoints.
- Verify HLS playlists and segments, recording playback, and Roku API behavior.
- Add route-level authorization tests if a test harness exists; otherwise provide a
  reproducible curl/manual verification matrix.
```

## P02: CSRF and same-origin mutation protection

```text
Protect LunaTV's state-changing browser requests against CSRF. Read AGENTS.md and
inspect all POST routes, EJS forms, htmx calls, and fetch calls. Coordinate with
the authentication implementation rather than treating authentication as CSRF
protection.

Requirements:
- Inventory every state-changing endpoint: channel flags, scan start/abort,
  recording scheduling/deletion/stop, stream start/heartbeat/stop, and any new
  admin controls.
- Add CSRF tokens to cookie-authenticated HTML/htmx/fetch mutations, or implement a
  comparably robust same-origin design.
- Validate Origin for browser mutations. Do not break Roku clients that use a
  separate authenticated API mechanism and do not possess browser cookies.
- Require explicit content types for JSON mutations where practical.
- Produce consistent HTML-fragment and JSON error responses.
- Document the trust model and testing approach.

Acceptance criteria:
- A cross-origin form or fetch cannot perform an authenticated mutation.
- Valid browser htmx and fetch actions still work.
- Roku start, heartbeat, stop, favorite, recording, and DVR actions remain usable.

Verification:
- Test valid token, missing token, invalid token, same-origin, and cross-origin
  cases for representative HTML and JSON mutations.
```

## P03: Network exposure and deployment boundary

```text
Make LunaTV's network exposure explicit and configurable without changing its
default behavior silently. Read AGENTS.md, README.md, docker-compose.yml, and the
current route inventory.

Requirements:
- Add a prominent README security section stating whether authentication exists,
  which operations are sensitive, and that unprotected deployments belong only on
  a trusted LAN.
- Make the Compose bind address and host port configurable with safe, clearly
  documented examples for loopback-only, LAN, and reverse-proxy deployments.
- Explain HTTPS termination, firewall expectations, and why direct internet
  exposure is unsafe.
- Reconcile PORT documentation with Compose's actual container and host mappings.
- Do not introduce host networking as the default.

Acceptance criteria:
- An operator can tell exactly which interface and port are exposed.
- The documented environment variables match Compose behavior.
- Existing standard deployments continue to work unless a deliberate migration is
  documented.

Verification:
- Run docker compose config with defaults and with custom bind/port values.
- Confirm the rendered port mapping matches the documentation.
```

## P04: Secret-safe, least-privilege container

```text
Harden LunaTV's Docker image build and runtime. Read AGENTS.md, Dockerfile,
docker-compose.yml, .dockerignore, .gitignore, and the Roku deployment docs.

Requirements:
- Exclude .env, .env.*, roku/.env, credentials, generated Roku packages, logs,
  temporary streams, and unnecessary local artifacts from the Docker build context;
  keep intentional example files included.
- Use npm ci rather than npm install when the lockfile is present.
- Run Node and ffmpeg as a non-root user while retaining only the group/device
  access required for /dev/dri and writable stream-temp paths.
- Do not bake runtime secrets into image layers or environment declarations.
- Keep QSV operation compatible with the existing Jellyfin ffmpeg installation.
- Document any host group-ID or permission setup needed by Compose.

Acceptance criteria:
- Image inspection cannot find repository .env files or Roku credentials.
- The container process is non-root.
- Guide/admin operation and QSV transcoding remain functional on the supported
  amd64 deployment.

Verification:
- Build the image, inspect its user and filesystem, and search only through Docker
  tooling for accidentally included secret files.
- Run a non-playback smoke test and, where hardware is available, the documented QSV
  validation command.
```

## P05: Stream resource controls

```text
Prevent unauthenticated or malformed stream requests from exhausting tuners,
ffmpeg processes, CPU, or GPU. Read AGENTS.md and trace src/routes/watch.js,
src/stream.js, browser playback, and Roku playback before editing.

Requirements:
- Verify requested channels against getLineup() while preserving the required
  ?show=all device path and allowing legitimate hidden channels only according to
  the chosen authorization policy.
- Require an existing session for playlist/segment GETs rather than creating a new
  ffmpeg session from an arbitrary file request.
- Add configurable global and per-client/session concurrency limits.
- Rate-limit start attempts and return structured busy/rate-limit errors that both
  browser and Roku can translate into useful messages.
- Preserve session sharing by channel, codec, and profile and the delayed-stop race
  protection.
- Preserve browser H.264 restrictions and Roku HEVC/direct options.
- Expose limit rejection counts in protected metrics.

Acceptance criteria:
- Synthetic channel/profile URLs cannot spawn unbounded processes.
- Normal browser and Roku playback still share/release sessions correctly.
- Limits fail predictably without killing healthy sessions.

Verification:
- Test valid channels, invalid but syntactically valid channels, repeated starts,
  concurrent sessions, stale segment requests, stop/start races, and cleanup.
```

## P06: Safe guide serialization

```text
Remove script-injection risk from the desktop guide's server-provided data. Read
AGENTS.md and inspect views/guide-grid.ejs plus the route that supplies channels.

Requirements:
- Replace raw JSON insertion into executable JavaScript with safe serialization.
  Prefer a non-executable application/json script element or an equivalent pattern
  that safely escapes <, >, &, U+2028, and U+2029.
- Preserve all guide fields and current grid behavior.
- Do not solve this with ad hoc title-only replacements; protect the complete
  serialized object.
- Add a focused regression test if the repository has a test harness.

Acceptance criteria:
- A title or synopsis containing </script><script> cannot execute or corrupt the
  page.
- Apostrophes, Unicode, HTML-looking text, and ordinary guide data render correctly.

Verification:
- Render the grid with a malicious fixture and inspect both the HTML source and
  browser behavior.
```

## P07: Dependency vulnerability remediation

```text
Resolve the current npm audit findings without broad dependency churn. Read
AGENTS.md and inspect package.json/package-lock.json. The review found moderate
qs vulnerabilities through Express/body-parser.

Requirements:
- Apply the smallest compatible dependency updates that clear the advisories.
- Keep Express behavior compatible with existing route parsing and EJS rendering.
- Use npm install only to update dependency metadata as needed; preserve lockfile
  reproducibility and keep runtime dependencies minimal.
- Do not add unrelated frameworks or perform an Express major-version migration
  unless required and explicitly justified.
- Record dependency changes in CHANGELOG.md when behavior or deployment is affected.

Acceptance criteria:
- npm audit --omit=dev reports no known vulnerabilities, or any remaining advisory
  is explicitly documented with rationale.
- The app starts and representative guide, admin, mutation, and stream routes work.

Verification:
- Run npm ci, npm audit --omit=dev, and available smoke/tests.
```

## P08: Self-host critical browser assets

```text
Make LunaTV's browser and admin interfaces usable when the LAN has no internet
connection. Read AGENTS.md and inventory all CDN references in views/.

Requirements:
- Self-host pinned production assets for Bootstrap CSS/JS, Bootstrap Icons, htmx,
  and hls.js using a maintainable dependency/copy strategy.
- Keep the no-build-step architecture unless a build step has a clear, documented
  benefit and is approved.
- Preserve asset versioning and long-lived static caching.
- Remove obsolete CDN URLs after local assets are proven.
- Establish a Content Security Policy compatible with local assets where feasible;
  document remaining inline-script constraints rather than weakening CSP silently.
- Update licensing notices if required by bundled assets.

Acceptance criteria:
- Guide loading, admin htmx actions, icons, styling, and HLS playback work with
  external network access blocked.
- Browser cache behavior remains correct after deployment updates.

Verification:
- Test desktop and mobile pages with network requests to public CDNs blocked.
- Confirm no critical runtime request leaves the LunaTV origin.
```

## P09: Liveness, readiness, and container health

```text
Add operational health endpoints and a Docker healthcheck. Read AGENTS.md and
inspect server startup, HDHomeRun access, guide access, ffmpeg configuration,
RECORD integration, and docker-compose.yml.

Requirements:
- Add a lightweight liveness endpoint that only confirms the Node process can
  serve requests.
- Add a readiness endpoint with bounded checks and structured statuses for required
  tuner connectivity plus optional ffmpeg/QSV, guide, and RECORD dependencies.
- Clearly distinguish required failures, optional unavailable services, degraded
  state, and diagnostic detail.
- Do not expose DeviceAuth, credentials, filesystem paths, raw upstream URLs, or
  sensitive session details to unauthenticated callers.
- Add a Compose healthcheck using a tool already available in the image.
- Avoid causing tuner activity or expensive checks on every probe; cache bounded
  readiness results if needed.

Acceptance criteria:
- Orchestrators can distinguish process liveness from service readiness.
- An unavailable optional RECORD engine does not mark a non-DVR installation dead.
- Probe traffic does not create stream sessions.

Verification:
- Test healthy, tuner-down, ffmpeg-missing, and optional-RECORD-down scenarios.
- Confirm docker compose reports the expected health state.
```

## P10: Structured request and audit logging

```text
Improve LunaTV logging for troubleshooting and administrative accountability.
Read AGENTS.md and inspect requestTiming middleware plus every mutation route.

Requirements:
- Emit structured logs with timestamp, severity, request ID, method, normalized
  route, status, duration, and response size.
- Propagate or generate a safe request ID and return it in a response header.
- Add explicit audit events for scans, channel-state changes, recording schedule,
  stop/delete, administrative session termination, and authentication events.
- Include actor identity only when authentication provides one; otherwise record a
  privacy-conscious client identifier or anonymous actor.
- Redact credentials, tokens, DeviceAuth, cookies, sensitive query values, and
  recording URLs.
- Keep logs useful in Docker stdout/stderr and document retention expectations.

Acceptance criteria:
- An operator can correlate a UI error with one request and relevant subsystem logs.
- Destructive actions have success/failure audit entries without leaking secrets.

Verification:
- Exercise representative success and failure routes and inspect emitted JSON/log
  lines for correlation and redaction.
```

## P11: Lightweight automated quality checks

```text
Introduce a small automated test and static-check foundation for LunaTV without
turning the project into a heavy framework migration. Read AGENTS.md and inspect
the current CommonJS/Express/EJS architecture and Roku source layout.

Requirements:
- Add scripts for tests and a fast syntax/static check suitable for local use and CI.
- Cover route validation, authorization boundaries when present, CSRF behavior,
  safe guide serialization, health responses, and representative EJS rendering.
- Mock HDHomeRun, cloud guide, RECORD, and ffmpeg boundaries; tests must not require
  a physical tuner, GPU, internet connection, or Roku.
- Add a minimal CI workflow running npm ci, audit policy, checks, and tests.
- Document hardware/manual verification separately for playback paths that cannot
  be meaningfully automated.
- Keep test dependencies focused and pin them through package-lock.json.

Acceptance criteria:
- A clean checkout can run one documented command and detect route/template
  regressions without external hardware.
- CI reports actionable failures and does not expose secrets.

Verification:
- Run the full check from a clean npm ci installation and confirm expected failure
  behavior by temporarily exercising a local test mutation before reverting it.
```
