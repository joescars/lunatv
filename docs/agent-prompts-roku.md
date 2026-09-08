# Agent Prompts: Roku

These prompts are self-contained handoffs for the Roku SceneGraph client. Every
task must preserve Task-node network I/O and coordinate a unique manifest
`build_version` before physical sideloading.

## R01: Restore diagnostics access

```text
Make the existing Roku live-playback diagnostics panel reachable and internally
consistent. Read AGENTS.md, Roku README, PlayerScreen.brs/xml, and stream stats APIs.

Requirements:
- Bind the documented Up key to toggleStatsPanel() during live playback.
- Define priority if another overlay is open and ensure Up does not unexpectedly
  trigger an unrelated action.
- Keep polling active only while diagnostics are visible and stop it on hide, tune,
  failure, and player close.
- Reuse a Task node for repeated stats requests where practical; all network I/O must
  stay off the render thread.
- Make on-screen hints match actual controls and make diagnostic errors visible but
  nonblocking.

Acceptance criteria:
- Up opens/closes diagnostics reliably during playback.
- Leaving playback creates no continuing stats requests.

Verification:
- Package the channel, test open/close/reopen, channel changes, playback failure,
  network failure, and Back on a Roku or documented equivalent; bump build_version
  before sideloading.
```

## R02: Recording-player error recovery

```text
Repair Roku recording playback error handling and add a usable recovery path. Read
AGENTS.md and inspect RecordingPlayerScreen.brs/xml, RecordingStreamTask, and server
recording start/ready behavior.

Requirements:
- Never dereference result.error when result is invalid; map invalid, timeout, HTTP,
  transcode, and video-node failures to safe user messages.
- Make the error overlay/status visible again when an error occurs after playback
  started.
- Offer OK to retry and Back to recordings, with clear on-screen instructions.
- Reset Video content/control and Task references before retrying; avoid parallel
  tasks or leaked playback.
- Handle finished playback with Replay and Back behavior.
- Keep network calls in Task nodes.

Acceptance criteria:
- Invalid task results and late Video errors do not crash or remain invisible.
- Retry can recover without recreating the entire app scene.

Verification:
- Test invalid result, server error, ready timeout, malformed playlist, video error,
  successful retry, playback completion, and repeated OK presses; bump build_version
  before sideloading.
```

## R03: Confirm destructive DVR actions

```text
Add confirmation dialogs before Roku recording deletion or active-capture stop.
Read AGENTS.md and inspect RecordingsScreen, delete/stop Tasks, and recording state.

Requirements:
- For completed files, say the recording will be permanently deleted.
- For active captures, say recording will stop and the partial file will be discarded.
- Show title/episode context in the dialog when space permits.
- Default focus to Cancel and prevent duplicate requests while an action is pending.
- Preserve the selected recording after cancel, failure, or refreshed results.
- Show success/failure feedback and keep all network calls in Tasks.

Acceptance criteria:
- Options never immediately destroys or stops a recording.
- The correct endpoint is chosen from current recording state after confirmation.

Verification:
- Test cancel/confirm for completed and active items, stale state, task failure,
  duplicate Options presses, and list refresh during the dialog; bump build_version.
```

## R04: Focus-based Roku Settings

```text
Redesign Roku Settings to use standard focusable rows rather than global directional
shortcuts. Read AGENTS.md and inspect SettingsScreen.brs/xml and persisted settings.

Requirements:
- Create focusable rows for server URL, codec, quality if supported, and live preview.
- Up/Down move focus; OK edits/toggles/selects the focused row; Left/Right only change
  a value when that pattern is clearly presented.
- Preserve existing registry keys and values unless a migration is necessary.
- Validate server URLs before save, then run the existing connectivity check and show
  connected/unreachable results.
- Explain codec tradeoffs, including captions and experimental Direct behavior,
  without overcrowding the screen.
- Keep focus visible and restore it after dialogs.

Acceptance criteria:
- Settings behave like a normal Roku list and accidental directional presses do not
  modify unrelated options.
- Existing users retain saved choices.

Verification:
- Test fresh install, existing registry values, every remote key, URL validation,
  keyboard cancel/save, connectivity success/failure, and relaunch persistence; bump
  build_version.
```

## R05: Preserve DVR focus across refreshes

```text
Prevent the Roku recordings list's periodic refresh from moving the user's focus.
Read AGENTS.md and inspect RecordingsScreen refresh timer, content replacement, and
recording IDs.

Requirements:
- Capture the focused recording's stable ID before refresh and restore focus to it
  after applying updated content.
- If the item disappeared, choose the nearest sensible item without jumping to the
  top unnecessarily.
- Prefer patching unchanged rows if it materially reduces visual disruption, but keep
  the smallest reliable implementation.
- Do not steal focus from confirmation dialogs or a screen that is no longer active.
- Preserve active-recording status updates every 15 seconds.

Acceptance criteria:
- Browsing position remains stable across unchanged and changed refreshes.
- Deleted/completed items yield predictable fallback focus.

Verification:
- Test unchanged refresh, item status change, insertion above focus, deletion of the
  focused item, empty list, open dialog, and leaving the screen mid-refresh; bump
  build_version.
```

## R06: First-run setup and guide retry

```text
Make Roku first-run connection setup and guide-load recovery discoverable. Read
AGENTS.md and inspect MainScene, GuideScreen, SettingsScreen, GuideTask, and registry
configuration.

Requirements:
- When no server URL has ever been saved, show a dedicated first-run state or open
  Settings automatically with concise instructions.
- Do not show a generic guide failure for missing configuration.
- On guide network/server failure, show an actionable message with OK to Retry and a
  clearly documented path to Settings.
- Prevent concurrent GuideTasks and preserve the last usable guide during transient
  refresh failures when safe.
- Keep all network activity in Task nodes.

Acceptance criteria:
- A new user can discover how to enter the server URL without knowing the Options key.
- Existing users can retry a failed guide load without restarting the channel.

Verification:
- Test empty registry, invalid URL, unreachable server, unauthorized server, malformed
  response, retry success, cached guide refresh failure, and Settings return; bump
  build_version.
```

## R07: Explain recently watched channel ordering

```text
Make Roku's recently watched channel behavior visible and controllable. Read
AGENTS.md and inspect recent-channel persistence, guide ordering, focus preservation,
and GuideRow visuals.

Requirements:
- Add a labeled Recent section or unmistakable recent indicator instead of relying
  only on a thin accent and silent reordering.
- Preserve the existing focus-by-channel behavior when ordering changes.
- Provide a discoverable Clear recent action with confirmation only if clearing is
  destructive enough to warrant it.
- Cap and deduplicate history as today, handle channels removed from the lineup, and
  retain the standard all-channels section.
- Do not mark preview-only channels as watched; record history after meaningful live
  playback begins.

Acceptance criteria:
- Users understand why a channel appears near the top and can clear that personalization.
- Guide focus does not jump when history updates.

Verification:
- Test first use, repeated channel, cap overflow, removed channel, clear action,
  preview-only navigation, filter changes, and app relaunch; bump build_version.
```
