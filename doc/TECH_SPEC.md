# Ramble — Technical Design

Status: implementation design with an approved stack; core app code and offline
tests now exist. See `VALIDATION.md` for implementation coverage and release gates.

## Current design revision — 2026-10-25

The user approved general-purpose editable command templates, enabled CLI
execution without isolation validation, macOS-first validation, and a unified
floating title bar. These decisions supersede the original restricted-adapter
allowlist/isolation-gate proposals in sections 6–7 below. The current runner
compiles a saved template into literal argv/stdin, inherits native CLI auth and
environment, uses a neutral cwd, and parses only final output. It is not a sandbox.
Settings schema 8 adds a persisted `compactMode` flag, default false, preserving
schemas 1–7 values. The toolbar saves it through the same optimistic settings IPC.
Native settings saves capture current bounds, normalize them for the requested mode
and apply window minimums on the desktop main thread after dropping the settings lock.
Settings schema 7 added independent persisted `thoughtFontSize`/`messageFontSize`
integers (12–28 px, defaults 15/17) and preserves all prior saved configuration.
Settings schema 6 added default/per-app dimensions, seeded from saved bounds.
Settings schema 5 removes harness-specific parser choices in favor of one response
contract; schema 4 added single-string commands and reasoning effort, migrating
old executable/argv records losslessly. Schema 3 added placement defaults.
Preserve custom templates, presets, bounds and saved values.
The macOS platform config uses an overlay title bar, native traffic lights, and
the app toolbar as a drag region; Windows retains native chrome for now.

`SPEC.md` owns product behavior and acceptance criteria. This document describes
how to implement them using the approved stack; it does not change the product
contract. Exact CLI invocations remain subject to version-specific
verification. `../AGENTS.md` contains development workflow only.

## 1. Architecture

Approved stack (2026-10-24): Tauri 2 + React + TypeScript + Rust.
Supporting tooling and responsibilities:

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Desktop host | Tauri 2 / Rust | Window, shortcuts, tray, IPC, settings, clipboard |
| UI | React / TypeScript / Vite | Draft editing, preview, settings, presentation |
| Domain state | TypeScript reducer and selectors | Deterministic draft and result transitions |
| Execution | Rust / Tokio | Validation, prompt construction, adapters, process supervision |
| Tests | Rust tests, Vitest, React Testing Library, Playwright | Native units, UI units, browser-level flows |

The stack is implemented with dependency lockfiles. Verified developer commands
and setup are in `../AGENTS.md`; exact installed versions are recorded in the
lockfiles and the session handover. Official Tauri single-instance, global-shortcut,
and clipboard plugins are used natively, without exposing their broad APIs to JS.
Browser tests do not replace native desktop validation.

```text
React views → domain reducer → typed Tauri commands
                                  │
                    ┌─────────────┼───────────────┐
                 Settings     Build service   Desktop services
                                │              hotkey/window/clipboard
                         Template compiler
                                │
                         Harness adapter
                                │
                         Process supervisor
                                │
                      isolated one-shot CLI
                                │
                    parsed terminal run event → reducer
```

Keep the webview free of process-launch primitives. Only the native build service
may resolve an approved preset into an executable invocation.

## 2. Proposed repository layout

```text
src/
  app/                   application composition and theme
  domain/                records, reducer, selectors, run reconciliation
  features/capture/      composer, entries, inline editing, undo
  features/review/       result, session style, one-off instruction, view switching
  features/presets/      selector, quick creation, advanced template editor
  features/settings/     preferences and diagnostics
  native/                typed IPC client and event subscription
  ui/                    shared accessible primitives and design tokens
src-tauri/src/
  commands/              narrow IPC handlers
  build/                 coordinator, prompt serializer, fingerprints
  harness.rs             trusted command compiler and executable discovery
  response.rs            shared response contract and bounded JSON extraction
  templates/             typed schema, validation, safe compilation
  process/               supervisor, macOS/Windows containment
  settings/              schema, migrations, atomic storage
  desktop/               windows, tray, shortcuts, clipboard
tests/
  fixtures/              synthetic protocol data; never private prompts
  fake-harness/          controllable subprocess for supervisor tests
  e2e/                   mock-native browser flows
```

The implementation follows these boundaries with smaller files where appropriate;
see `VALIDATION.md` for deliberately gated integrations.

## 3. State ownership and records

The frontend owns the active in-memory draft and last successful result. Rust
owns persisted settings, resolved execution configuration, and active processes.
Native build snapshots are immutable; the UI receives a safe snapshot descriptor,
not credentials or an executable environment dump.

Use serialized UUID strings for draft, entry, and run identities. Use integer
revision counters for mutable UI fields and monotonic clocks for elapsed time.
Wall-clock timestamps are display metadata only.

Core records, expressed schematically rather than as generated bindings:

```typescript
type Draft = {
  id: string;
  entries: Entry[];
  composer: string;
  inlineEdit: { entryId: string; text: string } | null;
  style: string;
  pendingEdit: { text: string; revision: number };
  selectedPresetId: string;
};

type BuildRequest = {
  runId: string;
  draftId: string;
  source: string[];
  style: string;
  presetId: string;
  expectedSettingsRevision: number;
  revision: null | { previousText: string; instruction: string };
};

type RunState =
  | { kind: "idle" }
  | { kind: "running"; runId: string; draftId: string }
  | { kind: "failed" | "cancelled" | "timedOut"; runId: string };
```

`BuildResult` holds final text, the immutable request/snapshot descriptor,
configuration fingerprint, prompt version, and completion metadata. It is
independent of `RunState` and is not erased by a failed attempt.

Do not recursively retain previous result records: a revision snapshot contains
only the immediately preceding message text. This prevents a growing history
chain in memory and in every successive prompt.

## 4. Build transaction and concurrency

1. UI rejects Build while an inline edit is unresolved or another run is active.
2. In one reducer transaction, commit nonblank composer text, allocate a run ID,
   and capture source/style/preset/optional revision input. Preserve literal text;
   trimming is for emptiness checks only.
3. Subscribe to run events before sending the command. Set local running state
   before invocation so an immediate native response cannot outrun the UI.
4. Native code atomically claims a single-run slot, validates request limits and
   settings revision, resolves the preset, and constructs an immutable snapshot.
   A settings revision conflict returns an error instead of running unexpected
   arguments. Refresh settings and let the user retry.
5. Compile the prompt and invocation, spawn the CLI, supervise it, parse output.
6. Publish one terminal event only after process cleanup is complete. Frontend
   updates accept only the matching run ID and draft ID.
7. On success, replace the result atomically. Consume the submitted one-off field
   only if its text and field revision still match the captured values. Retyping
   the same text during execution counts as newer input and must be preserved.

Use one native terminal-transition arbiter for exit, cancel, timeout, and parser
failure. The first accepted terminal cause wins; cleanup must finish before the
single-run slot is released. Ignore duplicate cancellation and late events.

The toolbar New draft button remains disabled during execution. Global shortcut
summons replace the visible draft immediately and focus Thoughts; retain the old
build promise in a ref, abandon it, and disable generation (not typing) until it and
any prior reset finish. Repeated summons chain cleanup without reopening old state.
Hiding is allowed. Confirmed Quit cancels and joins cleanup before exiting.
Provide `get_active_run` and a bounded in-memory terminal outcome for reconnecting
the webview without launching duplicate work; discard it on process exit/new run.
`abandon_build(runId)` cancels the matching invocation and clears its terminal and
diagnostic cache. The coordinator remembers one abandoned ID so a delayed old start
is rejected before spawn; publication also refuses to retain abandoned output.
Frontend build/preview/output/copy callbacks guard draft or request identity, so
late responses cannot replace or hide a fresh draft. Native focus-only reopening
continues to preserve dialogs and the current view.

### Result freshness

Define a canonical input key from ordered entry text, session style, prompt
version, and resolved execution configuration. Exclude timestamps, entry IDs,
preset display names, and consumed one-off instructions. Include unsent nonblank
composer text as pending source when comparing the preview with the current UI.

Use stable canonical serialization and a SHA-256 digest in memory. An additional
nonblank pending edit is a separate “awaiting changes” condition. Configuration
digests include template/adapter versions and semantic parameter values, not the
private environment. Do not persist content hashes as a substitute for logging.

## 5. Prompt assembly

Implement a pure Rust serializer with golden tests. Produce a constant task and
fidelity preamble followed by a JSON data object with `schemaVersion: 3`,
`source`, `style`, and optional
`revision: { previousText, instruction }`.

JSON escaping preserves arbitrary quotes, newlines, and delimiter-like content.
The preamble requires exactly one `ramble_response` string property. No run ID is
included; internal run identities still own subprocesses/snapshots/diagnostics.
Avoid complete valid sample responses in the prompt. Only the extracted value enters
preview/clipboard/revision. The key is not a security boundary or origin guarantee;
response-shaped JSON echoed from source/logs can match (an accepted tradeoff).
Fingerprints include prompt version 3, not internal run IDs.

Keep source text unchanged. Do not include timestamps, workspace paths, the full
draft history, environment variables, or protocol metadata in the prompt. Store
the prompt only for the lifetime of the run and do not write it to disk.

## 6. Templates and presets

Persist a single command string; the AST is an internal compilation/migration detail:

```typescript
type CommandTemplate = {
  id: string;
  version: number;
  command: string;
  promptTransport: "stdin" | "argument";
};

type Preset = {
  id: string;
  name: string;
  templateId: string;
  templateVersion: number;
  parameters: { model?: string; reasoningEffort?: string; executable?: string };
};
```

The textarea uses `{{MODEL_ID}}`, `{{REASONING_EFFORT}}`, and `{{PROMPT}}`.
TypeScript validates the same restricted grammar as Rust; native validation is
authoritative. Parse quotes/escapes/argument boundaries before substitutions.
Tokens contain literal/variable segments so embedded values such as
`model_reasoning_effort="{{REASONING_EFFORT}}"` stay one argument. Never reparse
substituted data or permit variable executable paths. Explicit optional sections
`[[MODEL_ID … ]]`, `[[REASONING_EFFORT … ]]`, and negated guards omit entire
flag/value groups without heuristics; nested sections are bounded to four levels.
Literal `{{`/`[[` is escaped; empty quotes preserve empty arguments. Windows
backslashes remain literal unless escaping a reserved character or whitespace.

Compilation pipeline:

1. Load a versioned built-in or user-edited template and named preset.
2. Validate schema, parameters, adapter compatibility, and prompt transport.
3. Parse the literal executable and resolve it to an absolute path.
4. Inject preset model/effort and generated prompt after parsing; check argv budget.
5. Inherit the native CLI environment/auth; no output-parser selection exists.
6. Return an immutable `ExecutionPlan` with argv, stdin payload, working directory,
   environment policy, timeout, output limits, and containment policy.

These are trusted commands, not sandboxes or allowlisted adapter flags. Main-window
controls only select presets; Settings → Presets manages their model/effort and
duplication. Template edits update referencing preset versions and freshness keys;
model and reasoning effort also participate in frontend/native fingerprints.

Built-ins are bundled in `src/domain/builtins.json`. `legacy-templates-v3.json`
identifies pristine old invocations; only exact matches gain effort slots during
migration. Custom legacy argv is quoted losslessly with explicit optional guards.
Original settings remain backed up; empty pristine base presets gain Luna defaults,
while explicit custom values are retained. OpenCode composes `model#effort`, Codex
uses `-c model_reasoning_effort="…"`, and Claude uses `--effort`.
`legacy-templates-v4.json` identifies pristine event-output commands for schema-5
migration to final-text output where appropriate (OpenCode retains JSON transport).
Drop the old parser property without rewriting
custom commands or preset values. Generic extraction also accepts JSON envelopes.

Diagnostics is available to end users in all builds; there is no development-only
feature gate. The off-by-default session-only UI toggle
shows a modal before dispatching the prepared build transaction. `harness::preview`
uses the same prompt/compiler as execution, resolves locally without spawning,
and returns only a diagnostic command string and stdin. Cancel discards this
ephemeral snapshot, not the draft; Run sends exactly the previewed request.
Replay rendering is separate from `templates::quote_literal`: POSIX single quotes
with apostrophe escaping on macOS, PowerShell single quotes plus the call operator
on Windows. Template escaping protects `{{`/`[[` from Ramble's parser; it is not
shell quoting and must never be used to render the replay command. Offline shell
tests run only the fake harness and verify byte-for-byte prompt fidelity.

## 7. Shared response extraction and failure diagnostics

`response.rs` is independent of executable names and CLI event schemas. After
successful process exit/cleanup/pipe drain, scan for balanced JSON values with
string/escape awareness. Decode generic object/array values and nested JSON strings;
do not assume paths like part.text/result or interpret event types. Preserve
duplicate object keys in the internal representation so matching responses cannot
silently overwrite their fields. Validate the exact single-key `ramble_response` schema,
nonblank message and size limits. Identical responses deduplicate; conflicts fail.
Matching message contents are a leaf, not a second extraction source.

See SPEC §4 for byte/work/attempt/node/depth bounds. Schema failures and extractor
limits return only sanitized errors. Never infer completion from a CLI event:
successful exit plus a unique valid response is the universal contract. Streaming
templates should avoid emitting different complete matching response objects;
without a harness protocol Ramble intentionally cannot guess which one is final.

`execute_captured` returns bounded stdout/stderr and exit status only after cleanup.
Nonzero exit always fails even if stdout contains matching JSON. The coordinator
retains at most one failed run's bounded excerpts (256 KiB/stream, head/tail);
normal `BuildOutcome`/`get_active_run` carry only `diagnosticsAvailable`, never raw
output. `take_harness_output(runId)` requires the current retained ID and consumes
the cache; `discard_harness_output(runId)` clears it without reading. Next build,
new draft and shutdown clear it too. UI asks for consent, warns about secrets,
renders literal text and clears its copy on close; late IPC cannot reopen it.
Timeout/cancellation/pipe-limit failures need not retain output. No logs or files.

CLI help/docs and opt-in real invocation/isolation checks remain in the capability
manifest, not a launch gate. A neutral cwd/private server does not prove isolation;
preserve CLI auth and do not modify global harness settings. No model preflights.

## 8. Process supervision

- Spawn with native argument APIs, piped stdin/stdout/stderr, and no terminal.
- On Windows use no-console creation behavior and a Job Object with kill-on-close;
  assign containment before user code runs, using suspended launch where needed.
  Test nested-job behavior and fail safely if required containment is unavailable.
- On macOS use a dedicated process group, graceful termination, a short grace
  interval, then forced group termination and reaping. Process groups do not catch
  arbitrary daemonization: verify each supported CLI does not escape containment.
- On normal completion also clean up owned helpers; never target unrelated or
  shared user processes. Shutdown must handle application exit as well as Cancel.
- Drain both output pipes concurrently while feeding/closing stdin. Enforce byte
  caps, then decode and extract only after successful completion/cleanup.
- Proposed initial safety limits: 1 MiB serialized prompt, 8 MiB stdout, 1 MiB
  stderr. Exceeding a limit cancels the run with a typed error, never truncates a
  successful message. Tune these limits using fixtures before shipping.
- For argument transport, check the platform's serialized command-line budget,
  including Windows UTF-16 quoting/length overhead. Never split a prompt argument.
- Windows `.cmd`/`.bat` launchers require special handling: prefer the verified
  underlying executable/script runtime with direct argv. Do not pass private
  prompts through `cmd.exe`; otherwise report an unsupported launcher with setup
  guidance rather than secretly introducing shell interpolation.

A matching JSON response alone is insufficient: require successful process exit.
Reject invalid UTF-8, invalid/missing/conflicting matching responses and limit
violations. Unrelated logs are ignored. Do not rewrite the extracted message.

## 9. IPC and error model

Proposed commands: `get_settings`, `update_settings(expectedRevision, patch)`,
`inspect_preset`, `start_build`, `cancel_build(runId)`, `abandon_build(runId)`, `get_active_run`,
`copy_result`, `hide_window`, `hide_and_restore_focus`, `hide_restore_and_paste`,
`request_quit`, `take_harness_output(runId)` and
`discard_harness_output(runId)`. Native settings updates accept
validated fields, not arbitrary file paths or environment maps.

Run events carry `runId`, `draftId`, sequence number, and a tagged payload:
`started`, `phaseChanged`, `succeeded`, `failed`, `cancelled`, or `timedOut`.
Never include raw stdout/stderr in normal outcomes; use explicit-consent diagnostic
IPC only. Keep terminal outcomes recoverable
by run ID to cover a dropped webview event. Generate shared Rust/TypeScript
bindings or contract-test serialization to prevent hand-maintained type drift.

Use stable error codes such as `ExecutableMissing`, `UnsupportedVersion`,
`IsolationUnavailable`, `AuthenticationRequired`, `SettingsConflict`,
`InputTooLarge`, `OutputLimitExceeded`, `ProtocolError`, and `ProcessFailed`.
Only classify auth/permission failures from documented structured signals; use a
generic process failure otherwise. Default diagnostics contain codes and safe
metadata, not regex-sanitized arbitrary stderr assumed to be harmless.

## 10. Settings storage

Use the platform application-data directory exposed by the desktop host. Store
one versioned JSON document containing settings and user templates/presets; built-in
resources remain bundled. No database is needed for the MVP.

Serialize writes through one native owner with optimistic revision checks. Write
to a sibling temporary file with restrictive permissions, flush, then replace
atomically using platform-correct semantics. Keep a last-known-good settings
backup, never prompt/result data. Test replacement behavior on Windows explicitly.

Migrate before publishing settings to the frontend. For corrupt data, retain the
original file, surface recovery options, and use safe defaults only with a visible
warning. For an unknown newer schema, avoid writes that would destroy fields.
Saving the default style reports success only after durable settings write.

## 11. Desktop lifecycle

Create the single-instance host, tray/menu, and hidden window before registering
the shortcut. A shortcut press routes through `summon` / `ShowIntent::NewDraft`,
emitting `ramble:summon` after native placement/show/focus. A stable subscription
resets the draft/UI and focuses the composer on draft-ID changes, including when
Thoughts was already selected. Do not route tray/startup/second-launch/quit through
this destructive intent; their `ShowIntent::Resume` emits `ramble:focus` instead.
A second launch focuses the existing instance. Tray actions provide
Show, Settings, and Quit even when shortcut registration fails.

Shortcut changes are transactional: register the new binding before releasing the
old one; on failure retain the working binding and return a settings error. Route
close requests through Hide, and explicit Quit through dirty-draft confirmation
and active-run cleanup. Do not persist an affirmative quit decision accidentally.

`show_on_main` captures the foreground target before show/unminimize/focus, then
applies pure geometry from `placement.rs`. Nine anchor fractions align identical
points on the target and Ramble; logical signed offsets are scaled natively and
the result is clamped to a usable display area. Disabled/already-focused placement
uses a top-left zero-offset rule against the current bounds to clamp only.
`rule_for` resolves an owned rule: app width/height independently fall back to the
default dimensions. Optional default dimensions fall back to current window size.
Validate width 560–4096, height 420–4096 logical points, apply target scale before
anchor calculations and clamp size before position. Schema 6 seeds dimensions from
saved bounds or 640×480 and adds null dimensions to existing app rules. Applying a
size does not rewrite placement preferences or the default when manually resized.

`desktop_platform/macos.rs` uses NSWorkspace bundle identities, bounded AX calls
for focused-window position/size and NSScreen visibleFrame. Convert between Cocoa
bottom-left and AX top-left origins using the primary display's top edge. Window
placement stays in native points to avoid mixed-DPI origin conversions. Only the
explicit `request_placement_access` command can prompt for Accessibility access.
Without AX geometry, use Ramble's display work area and emit an explanation.
Windows uses foreground HWND, executable paths, DWM target bounds, GetWindowRect
for Ramble's full outer frame, monitor work areas and target-DPI-scaled offsets.
Its native behavior/compilation still requires Windows validation.

`get_placement_context` exposes only running app identities, last focused app,
permission state and fallback explanation; `ramble:placement` updates the notice.
Settings persist selected overrides, not app lists, titles, content or geometry.
Store logical dimensions and validate coordinates after display/scaling changes.
Focus capture also retains a native-only return target independently of geometry
access/placement settings. macOS holds the exact NSRunningApplication instance (not
a bundle ID/PID lookup); Windows remembers HWND/PID and checks the window still
belongs to that process. Already-focused summons preserve the original target;
an unavailable external capture clears stale history. No token is serialized or saved.
`hide_and_restore_focus` runs on the main thread, samples whether Ramble is still
foreground, hides successfully, then requests activation of a surviving target.
macOS uses AppKit activation without Accessibility or force/all-window flags;
Windows uses SetForegroundWindow (restoring a minimized target), without synthetic
input or thread-input attachment. OS activation can be denied; never relaunch a
closed target. Normal hide IPC does not explicitly reactivate another application.
Escape returns from Message to Thoughts without IPC; from Thoughts it uses
return-focus hide. Editor/dialog Escape still consumes it first.

`hide_restore_and_paste` is a narrow explicit-action IPC, not a general keyboard API.
Preflight checks existing macOS AX trust, a live return target and Ramble foreground
before hiding. No shortcut triggers a permission prompt. A two-second async loop
yields in 25 ms intervals and makes small main-thread checks; `paste.rs` authorizes
one gesture only after two target-foreground observations and physical modifier/
Enter key release. Show/hide/quit advance a native epoch, cancelling pending paste;
unexpected focus, dead target or timeout also cancels. The final platform call
rechecks focus/keys. macOS builds a complete Command-V chord and posts it to the
captured process using CGEventPostToPid; Windows submits one Ctrl-V SendInput batch.
Never synthesize Enter or retry a potentially delivered paste; on partial Windows
input only release synthetic keys. No clipboard read, shell automation, focus bypass,
or automatic relaunch. Errors retain the copied text and do not send to another app.
Tests must exercise pure gates/mock dispatch only, never paste into the user's apps.
Treat macOS Spaces and Windows focus
activation as platform integration work with manual tests, not webview behavior.

Use a bundled local webview with a restrictive content-security policy, no remote
navigation, and narrowly scoped Tauri capabilities. Render source/output as text,
not HTML. Do not load remote fonts or execute message content.

## 12. Visual implementation system

Define semantic design tokens before building feature screens: surface/elevated
surface, text/muted text, accent, border, focus, danger, spacing, typography,
radii, shadows, and motion. Map both light/dark palettes to the same components.
Use system fonts and a restrained icon set; avoid platform-dependent remote assets.
Apply the saved sizes through scoped CSS variables: thought entries/composer/inline
editing share one size, generated output uses the other. Keep typography out of
prompt fingerprints and clipboard data. Compact entry rows use 10 px vertical padding.
`ui/actionEnter.ts` centralizes plain Enter actions with Shift-newline, IME/keyCode
229 and repeat guards. Settings/template forms use `requestSubmit()` to retain HTML
validation and busy/read-only protection; modified global shortcuts stay separate.
Compact styling is scoped by `data-compact` in `app/compact.css`, with specificity
above the regular responsive rules. Keep core action names accessible even when text
is visually reduced to icons; never hide failures/recovery actions or shrink saved
text sizes. The mode does not enter draft snapshots or prompt fingerprints.
`Settings::minimum_window_size()` defines 560×420 regular and 360×280 compact minima
for native setup/settings saves and bounds validation. Compact `window_placement()`
clears only cloned rule dimensions so summons retain the user's current size without
rewriting saved placement defaults/overrides. On exit, normalize persisted bounds and
grow undersized native windows to the regular minimum. No auto-shrink on entry.

Use a 640 × 480 logical-pixel window with a 560 × 420 minimum. Thoughts and
Message share the same workspace, with only the selected view visible. Building
selects Message; a Back to thoughts button returns without losing state or interrupting
the run. Thoughts omits the entire secondary tab/header row; View message in the
existing composer footer reopens the result, or View build opens an active run.
Completion does not override a later view
selection. Keep both views mounted to preserve scroll and disclosure state.
The Message Back row also contains status/Copy; omit repeated visible headings
while retaining focusable screen-reader headings. Build sits beside the 58-point
composer; Rebuild sits beside its compact edit field. Keep scrolling within the
content panes and settings dialog rather than widening or growing the window.
In Message, Command/Ctrl+Enter copies and then calls `hide_and_restore_focus`, never Quit. Do not
hide on clipboard failure or without a result; dialogs/IME/key repeats are ignored.
The existing footer contains the platform-specific copy-and-hide hint in Message
and Build hint in Thoughts, without another row. A copy during rebuilding uses
the last successful text. Shift+Command/Ctrl+Enter instead calls the guarded paste
IPC after copying; its hint shares the same footer row. A ref prevents overlapping
clipboard/paste actions and key repeats from sending duplicate gestures. Shift
shortcuts do not build from Thoughts. Permission failure leaves the window open;
post-hide failure returns a recoverable error without stealing focus to show it.

`WipeIn` uses one mount-only Web Animation with a fixed 400 ms duration for both
new entries and successful results (result components keyed by run ID). Target the
inner `[data-wipe-content]` span with fit-content width, not blank flex-row space.
Use linear clip/opacity progression, useLayoutEffect and backwards fill to hide the
initial text before paint without retaining clipping after completion. New entries
scroll into view synchronously; a new result resets its preview scroll to the top.
Ordinary view changes preserve scroll and never replay the effect. Skip it under
prefers-reduced-motion; cancel animation resources on unmount. Validate actual
intermediate computed styles/pixels, not merely that Element.animate was called.

Use accessible primitives for menus, dialogs, disclosure, tooltips, and the view
switch. Centralize platform shortcut labels and Escape handling so inline
editors/dialogs consume events first.
Respect IME composition and reduced motion. Use short opacity/position transitions
only where they do not delay focus or typing; reserve space to avoid layout jumps.

Create screenshot scenarios for capture, editing, review, pending edits, preset
creation, running, and errors in both themes. Treat visual review as a release gate
alongside accessibility checks; browser snapshots alone do not validate native
window chrome, scaling, or focus behavior.

## 13. Performance and observability

Capture local monotonic timings for request acceptance, spawn, first output, final
output, process exit, and cleanup. Only label “request sent” when an adapter has a
reliable signal; first stdout is not evidence of a network request timestamp.

No background harness warm-up, extra model calls, or retained shared server.
Compare compliant invocations using opt-in cold/warm trials with the same model,
input, and quality settings. Report app overhead separately from provider latency.
Metrics stay ephemeral by default and exclude content, full argv, and environment.

Keep ordinary source editing local and synchronous. Load secondary settings UI
lazily and avoid rerendering all entries on every elapsed-time tick. Do not adopt
virtualization or additional state libraries without measured need.

## 14. Validation and delivery gates

| Layer | Required evidence |
| --- | --- |
| Domain | Composer commit, inline edit guard, stale comparisons, style boundaries, instruction consumption races |
| Templates | Literal argv fidelity, omitted optional groups, invalid placeholders, unsafe flag rejection, migrations |
| Prompt | Golden serialization, Unicode, delimiter-like data, instructed revision versus regeneration |
| Supervisor | Large concurrent output, hangs, cancellation/exit races, child cleanup, broken stdin, malformed output |
| UI | Keyboard/IME flows, view switching, errors preserve result, theme/accessibility and screenshot review |
| Real adapters | Supported versions, no integration startup, auth behavior, exact final extraction, measured overhead |
| Native platforms | Global shortcut, tray, hide/quit, PATH discovery, scaling/displays, clipboard, process containment |

Implement with a fake adapter first. Validate real invocation feasibility early,
then add OpenCode, Codex, and Claude adapters behind capability gates. Use CI for
offline tests and OS-native unit suites; never require private model credentials
in ordinary CI. Keep real-model smoke tests opt-in.

Before release, resolve actual supported CLI versions, minimum OS
versions/CPU targets, app identifier, signing/notarization, and distribution. Track
product decisions in `SPEC.md`; record verified developer commands in `../AGENTS.md`
as implementation establishes them.
