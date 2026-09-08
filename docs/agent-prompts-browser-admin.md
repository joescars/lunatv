# Agent Prompts: Browser and Admin

These prompts cover viewer workflows, browser accessibility, and administrator
workflows. Read `docs/user-admin-experience-roadmap.md` before assigning tasks
that touch the same files.

## W01: Channel and program search

```text
Add fast channel and program search to LunaTV's browser guide. Read AGENTS.md and
trace /guide, /guide/fragment, /guide/grid, guide caching, and current filtering.

Requirements:
- Search channel number, channel name, current title, and loaded upcoming titles.
- Clearly distinguish channel matches from program matches in copy or presentation.
- Keep search responsive with large lineups and compatible with Favorites/Hidden
  filters in list and grid views.
- Use client-side search for already-loaded data unless server search has a proven
  need. Do not trigger new cloud requests on every keystroke.
- Provide a clear/reset action, no-results state, keyboard support, and an accessible
  result-count announcement.
- Decide and document whether search state belongs in the URL or localStorage.

Acceptance criteria:
- Partial, case-insensitive channel/title searches work in both guide modes.
- Search combines predictably with existing filters and does not start playback.
- Mobile layout remains usable at 320px width.

Verification:
- Test large fixtures, punctuation, channel subnumbers, empty queries, no results,
  keyboard-only use, mobile, and desktop.
```

## W02: In-guide favorite controls

```text
Allow viewers to favorite or unfavorite channels directly from the browser guide.
Read AGENTS.md, especially htmx URL encoding and mutually exclusive channel-state
rules. Inspect browser and Roku favorite endpoints before adding another API.

Requirements:
- Add an accessible star control to list rows and an appropriate grid interaction.
- Reuse one validated server mutation contract rather than duplicating logic.
- Provide optimistic or pending feedback, prevent duplicate requests, and roll back
  or show a visible retryable error on failure.
- Update Favorites-filter membership and count immediately after success.
- Explain if favoriting a hidden channel also unhides it because device modes are
  mutually exclusive.
- Protect the mutation according to the selected auth/CSRF design.

Acceptance criteria:
- Favorite state remains synchronized with the tuner and all affected guide views.
- Controls expose state with aria-pressed and a channel-specific accessible name.
- Dynamic guide values are percent-encoded.

Verification:
- Test favorite/unfavorite, hidden-to-favorite transition, active Favorites filter,
  request failure, keyboard use, and repeat clicks.
```

## W03: Live playback retry and recovery

```text
Make browser live-playback failures actionable and recoverable. Read AGENTS.md and
trace views/watch.ejs, src/routes/watch.js, and src/stream.js. Preserve the required
start -> ready poll -> playlist handshake.

Requirements:
- Check response.ok for start and ready requests and parse structured error details.
- Classify busy tuner, unavailable channel/signal, transcode, timeout, authorization,
  rate-limit, and network failures into concise user-facing messages.
- Add visible Retry and Back/Close actions. Retry must use the selected profile and
  cleanly reset prior Hls/video/session state.
- Implement bounded hls.js recovery for recoverable network/media errors and a clean
  full restart for fatal errors.
- Prevent concurrent retry loops, duplicate Hls instances, and heartbeat leaks.
- Announce state changes accessibly without exposing raw ffmpeg errors by default.

Acceptance criteria:
- Every startup or fatal playback failure offers a working next action.
- A successful retry reaches playback without reloading the entire guide.
- Retries do not leave duplicate sessions or timers.

Verification:
- Simulate busy, 4xx/5xx start, malformed ready response, timeout, fatal network,
  fatal media, recovery success, and repeated Retry clicks.
```

## W04: Explicit browser stream teardown

```text
Release browser live-stream sessions promptly when playback closes. Read AGENTS.md
and inspect the overlay iframe lifecycle, standalone watch lifecycle, heartbeat,
stop routes, and delayed-stop race protection.

Requirements:
- Send a best-effort keepalive POST to the exact channel/codec/profile stop endpoint
  on pagehide and explicit overlay close.
- Ensure the child watch iframe owns teardown or establish a clear parent-child
  message contract; do not issue conflicting duplicate stop operations blindly.
- Preserve the server idle timeout as a fallback.
- Do not let a delayed close stop a newer same-key session.
- Destroy hls.js, pause/reset video, and clear heartbeat/retry timers locally.

Acceptance criteria:
- Closing embedded or standalone playback frees the session promptly.
- Back navigation and rapid close/reopen do not kill the newly opened stream.

Verification:
- Observe protected stream metrics during close, pagehide, browser Back, overlay Back,
  rapid reopen, network loss, and tab termination.
```

## W05: Viewer quality selection

```text
Expose Auto, Low, Medium, and High quality selection for live and recorded browser
playback. Read AGENTS.md and inspect stream profile definitions, automatic network
selection, and recording profiles.

Requirements:
- Use server-exported profile data rather than duplicating bitrate assumptions.
- Keep Auto as the default network-aware behavior and display the resolved profile.
- Remember the viewer's preference locally and allow a URL override where useful.
- For live playback, changing quality must perform a controlled session transition
  and release the old profile.
- For recordings, stop hardcoding medium and restart/seek as safely as supported.
- Explain that quality affects bandwidth and transcoding, not source resolution
  guarantees.

Acceptance criteria:
- Choice persists across visits and applies consistently to live and DVR playback.
- Invalid stored/query values fall back safely.
- Switching does not leak old sessions.

Verification:
- Test every profile, Auto under mocked connection hints, persistence, invalid values,
  switching during playback, and browser Back behavior.
```

## W06: Recording resume semantics

```text
Make the browser DVR Resume badge truthful. Read AGENTS.md and investigate the exact
meaning and units of the RECORD engine's Resume field before implementing behavior.

Requirements:
- Confirm whether Resume is a time offset, byte position, percentage, or another
  engine-specific value using real payloads or authoritative behavior.
- If reliable, present "Resume from <time>" and "Start over" choices, seek only after
  metadata is available, and handle offsets beyond duration safely.
- Decide whether LunaTV can persist progress back to the RECORD engine. If not,
  document that the engine owns progress and do not imply LunaTV synchronization.
- If Resume cannot be used reliably, remove or replace the badge with truthful copy.
- Keep Roku behavior consistent where the same metadata is exposed.

Acceptance criteria:
- Selecting Resume starts near the displayed point; Start over begins at zero.
- Missing, zero, invalid, and completed offsets do not produce misleading UI.

Verification:
- Test fresh, partially watched, almost complete, invalid-offset, and seek-failure
  recordings against representative engine data.
```

## W07: Active recording controls

```text
Distinguish active captures from completed recordings in the browser DVR. Read
AGENTS.md and inspect hdhomerunRecord.js, browser routes/templates, and the existing
Roku stop-recording workflow.

Requirements:
- Display a prominent Recording now state with channel and timing/progress when data
  permits.
- Replace Delete with "Stop recording and discard partial file" for active items.
- Use the dedicated stopRecording workflow so both the one-time rule and partial file
  are handled consistently.
- Keep permanent Delete for completed items with action-specific confirmation copy.
- Prevent double submission, show pending/success/failure feedback, and refresh while
  captures are active without unnecessarily resetting the page.
- Protect both actions with authorization and CSRF controls.

Acceptance criteria:
- Active and completed items cannot be confused.
- Stopping an active capture removes the rule and partial file as documented.
- Failures leave the item visible with a retry path.

Verification:
- Test active-to-complete transition, stop success/failure, completed delete, stale
  state conflicts, and simultaneous refresh/action behavior.
```

## W08: Future-program interactions in the grid

```text
Change desktop guide-grid interactions so future programs do not behave like
"watch now." Read AGENTS.md and inspect guide-grid rendering and current-airing DVR
scheduling limitations.

Requirements:
- Keep channel cells and currently airing blocks as explicit Watch live actions.
- Open an accessible detail surface for future blocks showing title, local start/end,
  episode metadata, synopsis, and artwork where available.
- If the RECORD engine supports scheduling that exact future airing, add a protected
  Record action using the program's identifiers and times. Do not reuse the
  current-airing endpoint incorrectly.
- If scheduling is unavailable, omit the action and keep details truthful.
- Support keyboard activation, focus return, Escape/Back, and mobile overflow.

Acceptance criteria:
- Selecting a future show never unexpectedly tunes the current channel.
- Current shows remain quick to watch.
- Recording uses the selected future airing, not the current airing.

Verification:
- Test current, future, boundary-time, missing-metadata, DVR-disabled, scheduling
  success/failure, keyboard, and touch cases.
```

## W09: Persistent filters and recent channels

```text
Preserve browser viewing context with persistent guide filters and a local recent-
channels feature. Read AGENTS.md and inspect both guide modes plus overlay playback.

Requirements:
- Persist Favorites, Show Hidden, and preferred guide mode using localStorage or URL
  parameters with a visible reset path.
- Record a channel as recent only when playback meaningfully starts, not merely when
  a row is clicked or prewarmed.
- Add a clearly labeled Recent filter/section without silently reordering the full
  guide. Cap entries and provide Clear history.
- Keep history device-local unless a future authenticated synchronization design is
  explicitly approved.
- Handle removed/hidden channels and unavailable localStorage safely.

Acceptance criteria:
- Reloading preserves filter intent and recent channels without overriding explicit
  URL state.
- Clearing history works and is understandable.

Verification:
- Test playback success/failure, repeat channels, cap ordering, private mode/storage
  denial, removed channels, filter combinations, and list/grid transitions.
```

## W10: Installable PWA shell

```text
Complete LunaTV's promoted home-screen experience as a small, safe PWA. Read
AGENTS.md and implement this only after critical browser assets are self-hosted.

Requirements:
- Add a web app manifest with LunaTV name, icons, theme/background colors, start URL,
  scope, and standalone display behavior.
- Add a service worker that caches only the static application shell and local
  versioned assets. Do not cache live HLS, recordings, guide responses, credentials,
  admin mutations, health responses, or sensitive API data.
- Provide a useful offline page that says the tuner/server is unavailable rather
  than showing stale live data.
- Define update behavior so a new deployment activates predictably without trapping
  users on old assets.
- Preserve normal browser use when service workers are unsupported.

Acceptance criteria:
- Installation works on supported mobile browsers and launches within LunaTV scope.
- Going offline shows a truthful shell/error state, never stale playback or admin
  success.

Verification:
- Run manifest/service-worker browser audits and manually test install, update,
  offline, reconnect, logout/auth changes, and cache clearing.
```

## W11: Global error, empty, and not-found states

```text
Create consistent, branded recovery states across LunaTV browser pages. Read
AGENTS.md and inventory route errors, fragment errors, empty states, and Express's
terminal 404/error behavior.

Requirements:
- Add application-shell 404 and unexpected-error pages.
- Replace raw upstream messages with friendly categories and optional/copyable
  technical detail suitable for support.
- Add Retry, Back, Settings/Admin, or Clear filters actions according to context.
- Keep proper HTTP status codes for full pages, fragments, and JSON APIs.
- Cover guide, recordings, channel lineup, scans, status, watch, and recording watch.
- Do not expose secrets, internal filesystem paths, DeviceAuth, or full upstream URLs.

Acceptance criteria:
- No common browser workflow ends at unstyled raw text.
- Empty data, filtered-empty data, configuration absence, upstream failure, and 404
  are visually and semantically distinct.

Verification:
- Force representative route, upstream, timeout, empty, filtered-empty, and unknown-
  URL cases and verify recovery actions.
```

## W12: Keyboard-accessible list and grid guides

```text
Make both browser guide modes fully operable by keyboard and understandable to
assistive technology. Read AGENTS.md and inspect current collapse, Watch, channel,
and program-block markup.

Requirements:
- Replace clickable divs with native buttons/links where actions exist.
- Give list expansion one authoritative control and synchronized aria-expanded state.
- Give the desktop grid meaningful row/channel/time semantics using a real table or
  a carefully implemented ARIA grid.
- Provide program accessible names containing channel, title, local time, and action.
- Add visible focus styles, logical tab order, and no keyboard traps.
- Preserve touch target size, sticky headers/columns, and mobile scrolling.

Acceptance criteria:
- A keyboard-only user can filter, inspect programs, watch current TV, and return.
- Screen readers receive channel/time context rather than a sequence of generic divs.

Verification:
- Test Tab, Shift+Tab, Enter, Space, arrows if using ARIA grid semantics, zoom, and a
  representative desktop screen reader.
```

## W13: Watch-overlay dialog and focus management

```text
Make the in-page watch overlay behave as an accessible modal while preserving its
iframe playback architecture. Read AGENTS.md and inspect guide.ejs, watch.ejs, and
the overlay's history behavior.

Requirements:
- Add dialog semantics, an accessible name, aria-modal, and background inertness.
- Store the invoking Watch control, move focus into the overlay on open, contain focus,
  and restore focus on close.
- Make Escape work when focus is in the parent or player iframe through an explicit
  same-origin message/handler design.
- Preserve device Back/history behavior without duplicate history entries.
- Couple close with explicit stream teardown and restore body scroll robustly.
- Keep the close control reachable above safe-area insets and native video chrome.

Acceptance criteria:
- Keyboard and screen-reader focus cannot wander into the hidden guide while open.
- Every close path restores the exact guide state and invoking control where possible.

Verification:
- Test mouse, touch, keyboard, Escape in parent/iframe, browser Back, iOS-style Back,
  rapid open/close, and focus restoration after filtered rows change.
```

## W14: Accessible asynchronous announcements

```text
Add a consistent accessible status-announcement pattern for LunaTV's dynamic
browser UI. Read AGENTS.md and inventory htmx swaps, playback statuses, recording
actions, loading placeholders, scans, and tuner polling.

Requirements:
- Use polite live regions for loading, tuning, refresh, and success; reserve assertive
  alerts for failures requiring immediate action.
- Avoid repeatedly announcing unchanged three-second polling content.
- Announce pending and final outcomes for favorite/hide, scan, recording schedule,
  stop/delete, retry, and quality changes.
- Keep visible messages useful to sighted users; do not hide all feedback solely for
  screen readers.
- Establish shared partial/script conventions instead of one-off live regions.

Acceptance criteria:
- Important asynchronous outcomes are announced once with meaningful context.
- Routine polling does not create continuous screen-reader noise.

Verification:
- Exercise each mutation and loading path with a screen reader and inspect live-region
  updates for duplicate or missing announcements.
```

## W15: Accessible progress and signal meters

```text
Complete accessibility semantics for scan progress and tuner signal meters. Read
AGENTS.md and inspect _scan_status.ejs and _tuner_status.ejs.

Requirements:
- Add aria-valuemin, aria-valuemax, aria-valuenow, and metric-specific accessible
  labels to determinate bars.
- Use an indeterminate pattern when a scan has no trustworthy percentage.
- Clamp malformed values for visual width while preserving a useful unknown state.
- Keep visible numeric values and explain abbreviated labels such as Symbol Q.
- Ensure polling replacements do not announce every unchanged value.

Acceptance criteria:
- Assistive technology identifies each tuner, metric, value, and scan progress.
- Invalid upstream values cannot break layout or produce invalid ARIA.

Verification:
- Render 0, intermediate, 100, missing, negative, and over-100 fixture values and
  inspect the accessibility tree.
```

## W16: Caption preference and status UX

```text
Respect viewer caption preferences and simplify browser caption feedback. Read
AGENTS.md, docs/closed-captioning-options.md, watch.ejs, stream configuration, and
native-HLS versus hls.js behavior.

Requirements:
- Do not forcibly enable embedded tracks on every playback unless a documented
  platform limitation requires a narrowly scoped workaround.
- Prefer the user's prior caption choice and provide an explicit, accessible captions
  control when native controls are insufficient.
- Avoid simultaneously enabling embedded and WebVTT sidecar tracks.
- Replace technical always-visible diagnostics with concise viewer status; keep
  detailed source/track diagnostics behind an optional disclosure.
- Use one canonical effective WEBVTT configuration value so route UI and stream
  behavior cannot disagree.

Acceptance criteria:
- Captions stay off for users who turned them off and return for users who enabled
  them where the platform permits.
- Duplicate captions do not appear when both sources exist.

Verification:
- Test hls.js and native HLS with embedded-only, sidecar-only, both, neither, reload,
  and stored preference cases.
```

## A01: Configuration and health summary

```text
Add an authenticated, read-only Admin Configuration and Health page. Read AGENTS.md
and inspect device, guide, stream, ffmpeg, QSV, RECORD, and cache modules.

Requirements:
- Show effective non-secret configuration, tuner reachability/identity, guide
  freshness, RECORD availability, ffmpeg presence/version, QSV device/readiness,
  cache state, uptime, and application version.
- Distinguish healthy, degraded, optional-disabled, and failed states with actionable
  remediation text.
- Redact DeviceAuth, credentials, full sensitive URLs, and filesystem internals.
- Avoid expensive probes on page render; consume the canonical readiness model and
  bounded cached checks.
- Mark restart-required settings and link to the exact documentation section.
- Provide a copyable sanitized diagnostics summary.

Acceptance criteria:
- An operator can identify the likely cause of common setup/playback failures from
  one page without opening raw JSON or container logs.

Verification:
- Test healthy, missing tuner, guide failure, DVR disabled/down, ffmpeg missing, and
  QSV unavailable fixtures and review redaction.
```

## A02: Startup configuration validation

```text
Validate LunaTV configuration at startup and expose clear remediation. Read AGENTS.md,
.env.example, README.md, docker-compose.yml, and every process.env access.

Requirements:
- Define one typed configuration module with defaults and validation for addresses,
  ports, enums, booleans, durations, profile limits, and optional integrations.
- Do not silently fall back to hdhomerun.local in the standard container when the
  required host is absent.
- Fail fast for structurally invalid required settings; allow startup with a clear
  degraded status when that better supports first-run diagnostics.
- Print a concise redacted startup summary and expose the same effective values to
  Admin/health consumers.
- Remove inconsistent defaults, including route/stream WEBVTT disagreement.
- Update .env.example, README, Compose, and CHANGELOG.

Acceptance criteria:
- Invalid values produce one actionable error naming the variable and accepted form.
- Documentation, Compose, and runtime defaults agree.

Verification:
- Start with valid, missing, malformed, boundary, Docker, and local-development
  configurations and compare logs/health output.
```

## A03: Standard htmx pending and error feedback

```text
Create a consistent interaction pattern for all htmx-powered admin and DVR actions.
Read AGENTS.md and inventory htmx requests, fragments, status codes, and targets.

Requirements:
- Disable the initiating control while a request is pending and expose aria-busy.
- Show concise success/error feedback in a persistent alert/toast region with Retry
  where safe.
- Handle non-2xx responses globally without replacing useful rows with raw text.
- Preserve correct HTTP status codes for observability.
- Prevent duplicate submissions and restore controls after failure.
- Keep no-JavaScript form behavior functional where practical.

Acceptance criteria:
- Every channel, scan, recording, and refresh action visibly succeeds or fails.
- A failed row mutation leaves the original row intact and usable.

Verification:
- Simulate timeout, 400, 401/403, 409, 429, and 502 responses for representative
  actions and test keyboard/screen-reader feedback.
```

## A04: Server-side admin mutation validation

```text
Harden validation for admin channel and scan mutations. Read AGENTS.md and compare
src/routes/channels.js, src/routes/scan.js, src/routes/api.js, and hdhomerun.js.

Requirements:
- Validate guide numbers with one shared rule and reject missing values.
- Allow only documented channel modes +, -, and x; account for URL decoding where +
  can become a space and require encoded dynamic values.
- Validate scan source against the device-reported SourceList, including changed
  device state between page render and submission.
- Return structured, client-appropriate 400/409 errors instead of forwarding invalid
  values upstream.
- Keep authorization, CSRF, and audit logging hooks intact.

Acceptance criteria:
- Invalid channel, mode, or source never reaches the tuner API.
- Valid favorite/hide and scan operations remain compatible with the device.

Verification:
- Test missing, malformed, encoded plus, unsupported source, stale source, and valid
  values at route and browser levels.
```

## A05: Safer channel scans

```text
Improve channel-scan safety, progress, and completion feedback. Read AGENTS.md and
trace scan routes, fragments, polling, and device status capabilities.

Requirements:
- Explain that scans may consume a tuner and may change the lineup.
- Add a labeled signal-source selector with contextual help.
- Confirm start and abort when disruption/data loss is meaningful.
- Disable controls immediately while requests are pending and prevent duplicates.
- Show numeric accessible progress, channels found, elapsed time, last update, and a
  clear completion/aborted/failed state.
- If device data permits, summarize added/removed channels; otherwise do not invent
  a diff.
- Return proper failure status while still rendering useful htmx feedback.

Acceptance criteria:
- Operators always know whether a scan started, is current, completed, aborted, or
  failed and what to do next.

Verification:
- Test start, duplicate start, abort, failed start, polling failure/recovery,
  completion, source selection, and page reload mid-scan.
```

## A06: Accurate filtering with lazy channel loading

```text
Fix Admin Channel Lineup filtering and counts when rows are lazy-loaded. Read
AGENTS.md and inspect channel batching, revealed triggers, and browser filtering.

Requirements:
- Choose a design where Favorites/HD/Hidden filters apply to the complete lineup,
  not only currently loaded DOM rows. Prefer server-side filtered pagination or a
  lightweight complete metadata index.
- Keep initial render fast for large cable lineups.
- Display unambiguous counts such as shown, loaded, and total when those differ.
- Provide an explicit Load more/retry fallback if automatic revealed loading fails.
- Preserve filters across row mutation and pagination.

Acceptance criteria:
- A matching channel in a later batch appears when a filter is selected.
- Empty states are truthful and totals do not silently change meaning.

Verification:
- Test 200+ channel fixtures with matches only in late batches, combined filters,
  mutations, failed batch loads, keyboard use, and mobile scrolling.
```

## A07: Predictable favorite/hidden channel states

```text
Make the tuner's mutually exclusive channel flags understandable in Admin. Read
AGENTS.md and verify actual +, -, and x behavior through the existing adapter.

Requirements:
- Present favorite/normal/hidden as one coherent state model, or explicitly explain
  side effects when keeping separate controls.
- After each mutation, announce the complete resulting state, such as "favorited and
  unhidden."
- Use state-aware accessible names and aria-pressed or radio semantics as appropriate.
- Ensure filters and counts update when a state transition changes visibility.
- Do not emulate unsupported combinations that the tuner cannot store.

Acceptance criteria:
- Operators can predict what happens when favoriting a hidden channel or hiding a
  favorite channel.
- UI state always reflects a fresh device response.

Verification:
- Exercise all transitions among normal, favorite, and hidden with active filters and
  failed upstream updates.
```

## A08: Freshness-aware status polling

```text
Improve Admin tuner/scan polling so operators can judge freshness without wasting
requests. Read AGENTS.md and inspect htmx polling fragments.

Requirements:
- Show last successful update time and a stale/error state without discarding the
  last known data.
- Add a manual Refresh control.
- Pause or slow polling while the document is hidden and resume promptly when visible.
- Back off after repeated failures and recover automatically after success.
- Avoid duplicate polling loops after htmx swaps.
- Do not repeatedly announce unchanged status to screen readers.

Acceptance criteria:
- Operators can distinguish current data, stale cached data, and no data.
- Hidden tabs and prolonged outages do not continue aggressive polling.

Verification:
- Test visible/hidden transitions, repeated failures, recovery, manual refresh, htmx
  swaps, and multiple open admin tabs.
```

## A09: Admin stream diagnostics

```text
Integrate existing stream metrics and per-session diagnostics into authenticated
Admin UI. Read AGENTS.md and inspect getMetrics(), per-stream stats, tuner status,
session lifecycle, and Roku diagnostics.

Requirements:
- Show active sessions with channel, codec/profile, age, idle/heartbeat age, startup
  state, bitrate/progress, caption state, tuner signal, and sanitized recent error.
- Highlight likely stale or failed sessions and explain automatic cleanup behavior.
- Add a carefully authorized, confirmed Stop stale session action that cannot stop a
  newly replaced same-key session.
- Provide copyable sanitized diagnostics and links from relevant health failures.
- Keep raw detailed metrics protected and avoid exposing host paths or command lines.
- Poll with visibility awareness and bounded frequency.

Acceptance criteria:
- An operator can identify which session holds a tuner and why playback is failing.
- Stopping a stale session is auditable and race-safe.

Verification:
- Test no sessions, starting, ready, failed, stale, active heartbeat, concurrent
  profiles, stop race, and diagnostics redaction.
```

## A10: Admin navigation context

```text
Improve orientation and consistency in LunaTV Admin navigation. Read AGENTS.md and
inspect all admin templates and mobile navbar behavior.

Requirements:
- Mark the current section visually and with aria-current="page".
- Use consistent labels and icon treatment across the navbar and landing cards.
- Keep TV Guide clearly separate from administrative sections.
- Ensure the collapsed mobile navigation exposes current location and has correct
  focus behavior.
- Preserve light/dark theme behavior.

Acceptance criteria:
- Operators can identify their current section at desktop and mobile widths.
- Navigation remains keyboard and screen-reader accessible.

Verification:
- Visit every admin route, including error states, at mobile/desktop widths and inspect
  focus and accessibility state.
```

## A11: Correct device-system-log URL

```text
Make the Admin link to the HDHomeRun system log honor HDHOMERUN_PORT. Read AGENTS.md
and inspect the canonical tuner base URL in hdhomerun.js and app locals in server.js.

Requirements:
- Build the log link from the same validated host/port configuration used for tuner
  API calls.
- Handle IPv4, hostnames, and bracketed IPv6 safely if IPv6 is supported by config.
- Label the link clearly as opening the tuner's own interface in a new tab.
- Do not expose credentials in the URL.

Acceptance criteria:
- Default and non-default tuner ports produce the correct URL.

Verification:
- Test representative host/port values and inspect rendered href/accessible text.
```

## A12: Configuration and documentation reconciliation

```text
Reconcile LunaTV's operator documentation with actual runtime and Compose behavior.
Read AGENTS.md, README.md, .env.example, docker-compose.yml, Dockerfile, and every
process.env reference. Inspect current code rather than copying old proposal docs.

Requirements:
- Document every supported operator-facing variable, accepted values, default,
  deployment context, and restart requirement.
- Resolve the Compose PORT mismatch and route/stream WEBVTT default inconsistency.
- Document GUIDE_CACHE_TTL_MS, CHANNEL_BATCH_SIZE, ASSET_VERSION, caption diagnostics,
  ffprobe override, authentication, limits, and health settings if retained.
- Use npm ci in reproducible setup instructions.
- Add first-run verification and troubleshooting steps for tuner, guide cloud API,
  ffmpeg/QSV, /dev/dri, and optional RECORD engine.
- Add upgrade/rollback and security-boundary guidance.

Acceptance criteria:
- Every documented default matches code and Compose.
- A new operator can reach a meaningful readiness result without reading source.

Verification:
- Generate a process.env inventory, compare it to docs and examples, run Compose
  config, and follow the setup instructions from a clean environment where feasible.
```
