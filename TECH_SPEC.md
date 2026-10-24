# Ramble — Technical Design

Status: proposed implementation design; no application code or dependencies exist.

`SPEC.md` owns product behavior and acceptance criteria. This document describes
how to implement them; it does not silently approve the proposed stack or change
the product contract. Exact CLI invocations remain subject to version-specific
verification. `AGENTS.md` contains development workflow only.

## 1. Architecture

Proposed stack:

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Desktop host | Tauri 2 / Rust | Window, shortcuts, tray, IPC, settings, clipboard |
| UI | React / TypeScript / Vite | Draft editing, preview, settings, presentation |
| Domain state | TypeScript reducer and selectors | Deterministic draft and result transitions |
| Execution | Rust / Tokio | Validation, prompt construction, adapters, process supervision |
| Tests | Rust tests, Vitest, React Testing Library, Playwright | Native units, UI units, browser-level flows |

These are proposed tool choices, not installed dependencies. Select exact versions
and official Tauri plugins during implementation; commit dependency lockfiles.
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
  features/review/       result, session style, one-off instruction, split
  features/presets/      selector, quick creation, advanced template editor
  features/settings/     preferences and diagnostics
  native/                typed IPC client and event subscription
  ui/                    shared accessible primitives and design tokens
src-tauri/src/
  commands/              narrow IPC handlers
  build/                 coordinator, prompt serializer, fingerprints
  harness/               adapter trait and per-harness implementations
  templates/             typed schema, validation, safe compilation
  process/               supervisor, macOS/Windows containment
  settings/              schema, migrations, atomic storage
  desktop/               windows, tray, shortcuts, clipboard
tests/
  fixtures/              synthetic protocol data; never private prompts
  fake-harness/          controllable subprocess for supervisor tests
  e2e/                   mock-native browser flows
```

Do not create this structure until implementation is requested.

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

Disable New draft during execution or require cancellation and completed cleanup
first. Hiding is allowed. Confirmed Quit cancels and joins cleanup before exiting.
Provide `get_active_run` and a bounded in-memory terminal outcome for reconnecting
the webview without launching duplicate work; discard it on process exit/new run.

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
fidelity preamble followed by a JSON data object with `schemaVersion`, `source`,
`style`, and optional `revision: { previousText, instruction }`.

JSON escaping preserves arbitrary quotes, newlines, and delimiter-like content.
The preamble explains the roles and precedence of these fields and requires only
the final message. Structured framing is not an injection-proof sandbox; adapter
tool restrictions remain mandatory.

Keep source text unchanged. Do not include timestamps, workspace paths, the full
draft history, environment variables, or protocol metadata in the prompt. Store
the prompt only for the lifetime of the run and do not write it to disk.

## 6. Templates and presets

Use a declarative template AST, not an executable template language:

```typescript
type ArgNode =
  | { kind: "literal"; value: string }
  | { kind: "parameter"; name: string }
  | { kind: "optionalGroup"; whenPresent: string; args: ArgNode[] };

type CommandTemplate = {
  id: string;
  version: number;
  adapterId: "opencode" | "codex" | "claude";
  executableDefault: string;
  args: ArgNode[];
  promptTransport: "stdin" | "argument";
  parameters: ParameterDefinition[];
};

type Preset = {
  id: string;
  name: string;
  templateId: string;
  templateVersion: number;
  parameters: Record<string, string | number | boolean>;
};
```

The advanced editor may display `{{model}}` and `{{prompt}}`, but parses them into
whole-token parameter nodes. Do not support expression evaluation, interpolation
into executable paths, recursive expansion, shell operators, or unbounded nesting.
Executable overrides are separate explicit path settings, never prompt-derived.
Parameter values are not reparsed as templates. Optional groups disappear as a
unit when their controlling parameter is absent; empty model IDs count as absent.

Compilation pipeline:

1. Load a versioned built-in or user-edited template and named preset.
2. Validate schema, parameters, adapter compatibility, and prompt transport.
3. Resolve the executable to an absolute path and consult cached capabilities.
4. Compile user-selectable options through an adapter-specific allowlist; reject
   unknown flags, config injection, and overrides of reserved safety options.
5. Add adapter-owned isolation arguments/environment; validate the whole plan.
6. Return an immutable `ExecutionPlan` with argv, stdin payload, working directory,
   environment policy, parser, timeout, output limits, and containment policy.

Do not rely on “last flag wins” for isolation. Arbitrary editable arguments cannot
coexist with a meaningful guarantee of enforced restrictions. Unsupported options
require an adapter change, not a permissive escape hatch in the template editor.

Built-ins are versioned resources bundled with the app. User edits create an
override/fork; preserve the pristine defaults. Migrations explicitly update
template references or flag incompatible presets for repair.

## 7. Harness adapter contract and validation gate

Each adapter implements these conceptual operations:

- `probe(executable)`: bounded local version/capability check, no model request.
- `validate(template, parameters, capabilities)`: typed diagnostics.
- `compile(snapshot, configuration)`: safe execution plan.
- `parser()`: bounded incremental decoder and final-message extractor.

Maintain an adapter capability manifest containing tested versions, supported
transports/options, output protocol, configuration precedence, auth discovery,
and evidence of integration suppression. Invalidate probe caches when executable
identity/metadata, template, adapter version, or relevant configuration changes.
Probe at setup or after invalidation, not on every normal build.

Before enabling a built-in adapter, verify that its supported invocation:

- Uses a fresh noninteractive request and no shared conversation/service.
- Prevents MCP startup, tools, hooks/plugins, and project discovery before they
  initialize, while retaining only required provider configuration and auth.
- Exits after generation and leaves no owned helper processes.
- Produces a protocol whose final message can be extracted unambiguously.

Use inert canary integrations and process/network observations in opt-in adapter
validation; fake-process tests alone cannot prove a real CLI's isolation.
Do not merely search stdout for the absence of tool calls.

No exact OpenCode/Codex/Claude argv is specified here because the required flags
have not been verified. A template may exist but remain visibly unavailable until
its capability gate passes. If none of the supported versions can meet the
contract, raise a product/architecture decision rather than weaken the contract.

Environment isolation must be adapter-specific: an empty working directory alone
does not suppress ancestor or global configuration. Avoid replacing HOME blindly,
which can break auth, or copying the user's full config into a private directory.
Use verified per-process overrides; never modify global harness settings.

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
- Drain both output pipes concurrently while feeding/closing stdin. Decode UTF-8
  incrementally across chunk boundaries. Enforce parser-frame and total-byte caps.
- Proposed initial safety limits: 1 MiB serialized prompt, 8 MiB stdout, 1 MiB
  stderr. Exceeding a limit cancels the run with a typed error, never truncates a
  successful message. Tune these limits using fixtures before shipping.
- For argument transport, check the platform's serialized command-line budget,
  including Windows UTF-16 quoting/length overhead. Never split a prompt argument.
- Windows `.cmd`/`.bat` launchers require special handling: prefer the verified
  underlying executable/script runtime with direct argv. Do not pass private
  prompts through `cmd.exe`; otherwise report an unsupported launcher with setup
  guidance rather than secretly introducing shell interpolation.

A protocol success event alone is insufficient: require valid final text and a
successful process exit. Treat malformed/truncated protocol, invalid UTF-8 where
not supported by the protocol, multiple ambiguous finals, and nonzero exit as
typed failures. Do not strip Markdown fences or rewrite the returned message.

## 9. IPC and error model

Proposed commands: `get_settings`, `update_settings(expectedRevision, patch)`,
`inspect_preset`, `start_build`, `cancel_build(runId)`, `get_active_run`,
`copy_result`, `hide_window`, and `request_quit`. Native settings updates accept
validated fields, not arbitrary file paths or environment maps.

Run events carry `runId`, `draftId`, sequence number, and a tagged payload:
`started`, `phaseChanged`, `succeeded`, `failed`, `cancelled`, or `timedOut`.
Never transport raw stdout as display text. Keep terminal outcomes recoverable
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
the shortcut. A second launch focuses the existing instance. Tray actions provide
Show, Settings, and Quit even when shortcut registration fails.

Shortcut changes are transactional: register the new binding before releasing the
old one; on failure retain the working binding and return a settings error. Route
close requests through Hide, and explicit Quit through dirty-draft confirmation
and active-run cleanup. Do not persist an affirmative quit decision accidentally.

Resolve active-display placement natively; store logical dimensions and validate
coordinates after display/scaling changes. Treat macOS Spaces and Windows focus
activation as platform integration work with manual tests, not webview behavior.

Use a bundled local webview with a restrictive content-security policy, no remote
navigation, and narrowly scoped Tauri capabilities. Render source/output as text,
not HTML. Do not load remote fonts or execute message content.

## 12. Visual implementation system

Define semantic design tokens before building feature screens: surface/elevated
surface, text/muted text, accent, border, focus, danger, spacing, typography,
radii, shadows, and motion. Map both light/dark palettes to the same components.
Use system fonts and a restrained icon set; avoid platform-dependent remote assets.

Proposed starting geometry, to validate with screenshots and text scaling:
capture window around 640 × 720 logical pixels; review expands toward 1080 × 760,
clamped to display bounds. Split panels should each remain usable around 360
logical pixels wide; on constrained displays revise geometry rather than force
off-screen content. Persist review geometry separately from compact capture bounds.

Use accessible primitives for menus, dialogs, disclosure, tooltips, and the split
separator. The separator needs keyboard resizing. Centralize platform shortcut
labels and Escape handling so inline editors/dialogs consume events first.
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
| UI | Keyboard/IME flows, split resizing, errors preserve result, theme/accessibility and screenshot review |
| Real adapters | Supported versions, no integration startup, auth behavior, exact final extraction, measured overhead |
| Native platforms | Global shortcut, tray, hide/quit, PATH discovery, scaling/displays, clipboard, process containment |

Implement with a fake adapter first. Validate real invocation feasibility early,
then add OpenCode, Codex, and Claude adapters behind capability gates. Use CI for
offline tests and OS-native unit suites; never require private model credentials
in ordinary CI. Keep real-model smoke tests opt-in.

Before release, resolve stack approval, actual supported CLI versions, minimum OS
versions/CPU targets, app identifier, signing/notarization, and distribution. Track
product decisions in `SPEC.md`; record verified developer commands in `AGENTS.md`
once implementation establishes them. No build/test commands are defined yet.
