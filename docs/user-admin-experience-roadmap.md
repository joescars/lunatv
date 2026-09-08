# LunaTV User and Admin Experience Roadmap

This document turns the September 2026 project review into an implementation
roadmap. The accompanying prompt files contain self-contained tasks that can be
handed to coding agents:

- [Platform and operations prompts](agent-prompts-platform-operations.md)
- [Browser and admin prompts](agent-prompts-browser-admin.md)
- [Roku prompts](agent-prompts-roku.md)

The review was static. It covered the Express routes, EJS views, browser CSS and
JavaScript, Docker configuration, documentation, and Roku SceneGraph client. It
did not exercise a live tuner, RECORD engine, QSV transcoding, or physical Roku.

## Goals

1. Make LunaTV safe and predictable on a home network.
2. Make playback and recording failures understandable and recoverable.
3. Give operators one place to understand configuration and system health.
4. Make guide, DVR, and admin workflows accessible and efficient.
5. Preserve the fast, mobile-first experience and the existing browser/Roku API
   contracts.

## Existing strengths to preserve

- The browser guide renders a useful shell before loading guide data.
- The in-page watch overlay preserves guide position and filters.
- Browser and Roku playback use the required start, ready-poll, playlist
  handshake.
- Stream profiles, prewarming, heartbeats, explicit stop routes, guide caching,
  compression, and static caching already exist.
- Roku network activity is correctly isolated in SceneGraph Task nodes.
- Roku guide refreshes preserve focus when recent channels reorder the guide.
- Browser recording deletion already asks for confirmation.

Do not reimplement completed work merely because older files such as
`docs/proposed-updates.md` or `docs/roku-performance-ux-review.md` still describe
it as pending. Inspect current code and `CHANGELOG.md` before starting any task.

## Priority zero: trust and safety

| ID | Recommendation | Primary outcome |
|---|---|---|
| P01 | Add authentication and viewer/admin authorization | Prevent unauthorized management and diagnostics access |
| P02 | Protect state-changing requests from CSRF | Prevent cross-origin changes from an operator's browser |
| P03 | Make the trusted-network boundary explicit and configurable | Reduce accidental internet or broad-LAN exposure |
| P04 | Keep secrets out of images and run with least privilege | Harden container deployment |
| P05 | Constrain stream creation and resource use | Prevent tuner, CPU, GPU, and process exhaustion |
| P06 | Safely serialize guide data into the grid page | Remove script-injection risk |
| P07 | Resolve audited dependency vulnerabilities | Keep the runtime dependency chain supported |

## Priority one: playback and DVR correctness

| ID | Recommendation | Primary outcome |
|---|---|---|
| W03 | Add actionable live-playback retry and recovery | Avoid dead-end playback failures |
| W04 | Stop browser sessions explicitly | Release tuners promptly |
| W05 | Expose and remember playback quality | Give viewers control on weak or fast networks |
| W06 | Implement truthful recording resume behavior | Align DVR labels and behavior |
| W07 | Distinguish active recordings from completed files | Prevent confusing or unsafe DVR actions |
| W08 | Give future grid programs details and recording actions | Match user intent when selecting future programs |
| R01 | Restore Roku diagnostics access | Make existing diagnostics usable |
| R02 | Repair Roku recording-player error handling | Show recoverable errors instead of hidden/crashing states |
| R03 | Confirm Roku destructive DVR actions | Prevent accidental deletion or capture cancellation |

## Priority one: operator confidence

| ID | Recommendation | Primary outcome |
|---|---|---|
| A01 | Add a configuration and health summary | Make setup and faults diagnosable |
| A02 | Validate configuration at startup | Surface unusable settings immediately |
| A03 | Standardize htmx pending and error feedback | Make every admin action visibly succeed or fail |
| A04 | Validate channel and scan mutations | Reject malformed or unsupported operations |
| A05 | Improve channel-scan safety and completion feedback | Clarify disruptive actions and outcomes |
| A08 | Improve status polling and freshness | Distinguish current data from stale data |
| A09 | Integrate stream diagnostics into Admin | Replace undiscoverable raw JSON with an operator view |
| P09 | Add liveness, readiness, and a container healthcheck | Support monitoring and faster troubleshooting |
| P10 | Add structured request and audit logging | Correlate faults and administrative changes |

## Priority two: daily usability

| ID | Recommendation | Primary outcome |
|---|---|---|
| W01 | Add channel and program search | Navigate large lineups quickly |
| W02 | Manage favorites from the viewer guide | Avoid an unnecessary trip through Admin |
| W09 | Persist filters and add recent channels | Preserve personal viewing context |
| A06 | Make lazy-loaded channel filtering accurate | Avoid false empty states and misleading counts |
| A07 | Explain mutually exclusive channel states | Make favorite/hide side effects predictable |
| A10 | Add current-location context to admin navigation | Improve admin orientation |
| A11 | Honor the configured tuner port in the log link | Keep links correct in non-default setups |
| A12 | Reconcile configuration behavior and documentation | Reduce setup mistakes |
| R04 | Redesign Roku Settings around focusable rows | Match standard Roku interaction patterns |
| R05 | Preserve DVR focus across refreshes | Avoid interrupting browsing every 15 seconds |
| R06 | Add Roku first-run setup and retry states | Make initial connection discoverable |
| R07 | Label recent Roku channels | Explain why channels moved |

## Priority two: accessibility and resilience

| ID | Recommendation | Primary outcome |
|---|---|---|
| W11 | Add branded error, empty, and not-found states | Give users recovery paths |
| W12 | Make list and grid guide controls keyboard accessible | Support keyboard and assistive technology users |
| W13 | Add modal semantics and focus management to the watch overlay | Make embedded playback navigable |
| W14 | Announce asynchronous state changes | Expose loading, success, and failure feedback |
| W15 | Complete progress-meter semantics | Make tuner and scan values understandable |
| W16 | Respect caption preferences | Avoid forcing or duplicating caption tracks |
| P08 | Self-host critical browser assets | Keep LAN workflows functional without internet access |
| W10 | Add a real installable PWA shell | Make promoted home-screen installation complete |

## Quality foundation

| ID | Recommendation | Primary outcome |
|---|---|---|
| P11 | Add lightweight automated checks | Catch route, template, and security regressions |

## Suggested delivery waves

### Wave 1: security baseline

Implement P03, P04, P06, and P07 first because they are mostly independent.
Design P01 and P02 together. Implement P05 after the authentication boundary is
known. Add P11 early enough that later work can build on it.

### Wave 2: correctness and recovery

Implement W03 and W04 together so retry and teardown share a clear session
lifecycle. Implement W06 and W07 together so the DVR data model and controls stay
consistent. R01, R02, and R03 can proceed independently if Roku build versions
are coordinated.

### Wave 3: operations

Implement A02 and P09 before A01/A09 so the dashboard consumes stable health
signals. Implement A03 before broad admin polish so all later htmx work uses one
feedback convention. Add P10 alongside protected admin identity if P01 exposes
one.

### Wave 4: user and admin workflow improvements

Implement W01, W02, W05, W08, W09, A05, A06, A07, A10, A11, and A12. Search and
favorite controls should share guide data and avoid duplicate device requests.

### Wave 5: accessibility, offline resilience, and Roku polish

Implement W11 through W16, P08, W10, and R04 through R07. Self-host assets before
adding a service worker so the PWA cache owns stable local URLs.

## Parallel-work constraints

- P01 and P02 both modify middleware, forms, and API request conventions; assign
  them to one agent or sequence them.
- W03, W04, and W05 all modify `views/watch.ejs`; avoid parallel edits.
- W06 and W07 both modify recording metadata, routes, and templates; handle them
  together or sequentially.
- A01, A02, A09, and P09 define overlapping health concepts; agree on one health
  model first.
- A03, W14, and W11 may all add global error/status UI; establish one convention
  before parallel implementation.
- W12 and W13 both modify guide focus behavior; sequence them.
- P08 should precede W10.
- Every Roku upload requires a coordinated `build_version` bump; do not let
  parallel agents independently choose the same version.

## Definition of done for every task

- Read and follow `AGENTS.md` before changing code.
- Inspect current code and `CHANGELOG.md`; do not rely on old proposal documents.
- Keep changes narrowly scoped and preserve browser/Roku shared API contracts.
- Do not cache HDHomeRun `DeviceAuth`.
- Preserve `POST /start` -> poll `/ready` -> fetch `.m3u8`.
- Percent-encode dynamic htmx query values.
- Verify browser behavior at mobile and desktop widths where applicable.
- Verify keyboard and screen-reader semantics for UI work.
- Add or update automated checks when P11 exists; until then, document manual
  verification clearly.
- Update README or operator documentation when behavior or configuration changes.
- Record user-visible changes in `CHANGELOG.md`.
