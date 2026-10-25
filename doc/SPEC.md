# Ramble — Product and Technical Specification

Status: MVP specification; implementation in progress. Editable command templates
and real CLI execution are enabled; macOS is the current validation focus.
See [implementation validation](VALIDATION.md) for evidence and remaining work.
Platforms: macOS and Windows desktop.
Working product name: Ramble.

## 1. Purpose

Ramble is a hotkey-accessible floating scratch conversation that turns a series
of rough thoughts into one polished message using a locally installed agent CLI.
It is a writing utility, not a chat assistant or coding agent frontend.

The core loop is: summon → capture thoughts → edit → build → review/refine style
→ copy. The user's source thoughts remain available throughout this loop.

## 2. MVP scope

### Required

- A configurable global hotkey summons a floating, always-on-top window.
- A Slack-like source pane accepts multiple submitted entries, each of which may
  contain multiple lines. Previously submitted entries are editable and deletable.
- One action combines all entries and a style instruction into a single prompt.
- The prompt runs through any user-configured command-line executable and literal
  arguments. OpenCode, Codex and Claude Code are editable starting templates, not
  the only supported programs; OpenCode is selected initially.
- Each build is a fresh, noninteractive one-shot invocation, not a resumed chat.
- Harness execution is speed-first: prefer one-shot invocations and best-effort
  suppression of unnecessary integrations. Isolation validation is deferred, not
  a gate on execution. Do not claim a sandbox or verified integration suppression.
- Ship three reusable command templates (OpenCode, Codex, Claude Code), with
  easy named presets for model IDs and other supported invocation variations.
- The result shares a compact workspace with source thoughts; show one view at a time.
- The preview includes an editable session style and a rebuild action.
- Rebuild also accepts a separate, optional short edit instruction for that run.
- Style changes affect only the current draft unless explicitly saved as default.
- A copy action copies only the final message to the system clipboard.
- Settings, presets, and the default style persist across application restarts.

### Not in the MVP

- Slack integration, sending messages, or background/unrequested pasting into other
  apps. Only the explicit Message copy-and-paste shortcut below may request a paste.
- Cloud accounts, sync, collaboration, or an app-managed model subscription.
- File attachments, speech input, autonomous tools, or repository access.
- A history browser, multiple simultaneous drafts, or multi-agent workflows.
- Linux support, automatic updates, and app-managed CLI installation/login.

## 3. User experience

### 3.1 Summon and dismiss

- Run as a single-instance background application with a tray/menu-bar entry.
- On macOS use a unified floating surface: overlay/hidden title bar, native traffic
  lights integrated into the app toolbar, native rounded corners/shadow, and a
  draggable toolbar. Preserve resizing and native window controls. Other platforms
  may retain native decorations until their custom chrome is designed/validated.
- Default hotkey: `Control+Shift+Y` on both macOS and Windows, using the actual
  Control key on macOS rather than Command. This binding is user-approved, not
  guaranteed conflict-free. Allow changing it in Settings; preserve saved bindings.
- The hotkey shows the existing window, starts a fresh draft in Thoughts and
  focuses the empty composer, even when Ramble is already visible. This deliberately
  discards the previous draft without confirmation, including its result, pending
  edits, session style and diagnostics, and dismisses dialogs/previews. Snapshot the
  saved default style and selected preset for the new draft; settings remain intact.
- If a build is active, abandon/cancel it and ignore all late replies. Allow typing
  immediately, but do not permit another generation until the prior invocation has
  completed cleanup. An already-queued old start must never launch after abandonment.
- Tray/menu Show and second-launch activation resume the existing draft/view rather
  than resetting it. Only the global shortcut requests a fresh draft.
- Capture the previously focused application/window before showing or activating
  Ramble, then position relative to that window. Settings → Placement offers an
  enable toggle, a default nine-point anchor and signed X/Y offsets in logical
  points (±4096). Align the same anchor on Ramble and the focused window; default
  to centered with zero offsets. Disabling placement preserves the current position.
- Placement also offers width/height in logical points, applied before anchoring
  on summon. Defaults are 640×480; width must be 560–4096 and height 420–4096.
  Each app can override either dimension independently; blank app dimensions inherit
  defaults, and blank default dimensions keep the current size. Clamp to the usable
  display area. Disabled placement or an already-focused Ramble preserves its size.
  Schema 6 migrates default dimensions from saved bounds (640×480 if absent), with
  existing app rules inheriting those defaults; preserve all custom settings.
- Allow per-application rules, selected from searchable running applications or
  the last focused app, without typing IDs. Persist stable bundle IDs on macOS
  and executable paths on Windows; overrides survive the application closing.
- Clamp placement to native usable display areas, avoiding menu bars, Dock and
  taskbar. Use the display with largest target-window overlap (nearest when off
  screen). When Ramble is already focused, preserve its position except clamping.
- On macOS, exact focused-window geometry uses Accessibility access. Request it
  only through the explicit Enable access button in Placement settings. Read app
  identity and window geometry, never titles or contents. If access or geometry
  is unavailable, use a display fallback and show a dismissible explanation with
  a shortcut to Placement settings. Do not block capture/build on permission.
- The window stays above ordinary application windows. Do not promise display
  over secure desktops, permission prompts, or every exclusive full-screen app.
- Losing focus does not hide the window. Escape hides it when no editor/dialog
  is consuming Escape and returns focus to the original app without copying or
  pasting. The close button hides rather than quits.
- Hide preserves the draft and any in-progress build until a new-draft action or
  shortcut summon replaces them. Expose an explicit Quit.
- Failure to register a hotkey must be visible with a recovery path through the
  tray/menu-bar entry. Never silently leave the application inaccessible.

### 3.2 Capture pane

- Show chronological, visually distinct entries above a multiline composer.
  This resembles a single-user Slack room, not alternating user/agent messages.
- Enter submits a nonblank entry; Shift+Enter inserts a newline. Respect IME
  composition so confirming composed text never accidentally submits it.
- Clear the composer after successful entry submission and preserve its focus.
- Preserve literal text, paragraph breaks, Unicode, and code-like content.
- Edit an entry inline with explicit Save and Cancel. Keep its identity and
  chronological position. Escape cancels editing before it can hide the window.
- Allow deletion with a short-lived Undo action. No drag reordering in the MVP.
- A Build action includes all saved entries, in displayed order.
- If composer text is nonblank, Build first commits it as the last entry. If an
  inline edit is open, require Save or Cancel before building; do not silently
  run against an older revision.
- Disable Build when there is no nonblank source text.
- Toolbar New draft requires confirmation when it would discard content. The global
  shortcut itself explicitly requests a fresh draft and does not ask for confirmation.

### 3.3 Build and review

- Start in Thoughts. Build switches to Message for progress, result, and session
  style. Thoughts has no secondary navigation/header row. Message offers a Back
  to thoughts button, status and Copy in one compact row. After a build, a small
  View message link in the existing composer footer reopens the preserved result
  without rebuilding; while running, View build opens progress.
- Within Message show the result first, with a clearly labeled expandable
  session-style editor underneath. Keep the editor available alongside preview.
- Use independently scrollable views. Switching preserves entries, composer text,
  inline edits, result, session style, pending rebuild instructions, and active runs.
  Return focus to the composer in Thoughts and the heading in Message. Do not
  switch views automatically on completion if the user has returned to Thoughts.
  Default to a 640 × 480 window with a 560 × 420 minimum; preserve existing saved
  sizes and user resizing. Share status and Copy with the Message Back row,
  remove repeated pane headings, place Build beside the compact composer, and
  keep the additional-edit field and Rebuild inline to reclaim vertical space.
- Provide a preset selector in the main window. Switching presets takes one
  selection, affects the next build only, and persists the last selection.
- Keep preset creation and duplication out of the main toolbar. Settings → Presets
  owns creation, duplication, selection, renaming, deletion, template choice, and
  direct Model ID / Reasoning Effort editing, including existing default presets.
  Users need not edit commands or JSON to change those preset values.
- Default OpenCode uses Model ID `openai/gpt-6-luna`, effort `medium`; default Codex
  uses Codex's bare `gpt-6-luna` identifier and effort `medium`. Preserve explicit
  saved customizations. Supported effort values depend on the CLI/model.
- Show running state, elapsed time, Cancel, and the active preset. Do not open
  a terminal window or expose raw protocol events as message text.
- Only one build may run at once. Editing source/style remains possible while
  running, but the run always uses its immutable starting snapshot.
- Commit a result atomically after successful completion. Streaming preview is
  optional, not an MVP dependency.
- Preserve the last successful result during rebuilds, cancellation, and errors.
- Mark a result as out of date whenever current source, style, or preset differs
  from the snapshot used to produce it. Returning exactly to that snapshot clears
  the marker. A successful build of an older snapshot remains visibly out of date.
- Copy stays available for the last successful result, including when out of
  date; label that state clearly. Copy never includes style, source, or metadata.
- In Message, Command+Enter on macOS / Ctrl+Enter on Windows copies the last
  successful message and only then hides the window (never quits), returning focus
  to the application/window captured before Ramble was shown. Clipboard failure
  leaves it open with a recoverable error; no result means no copy/hide. The shortcut
  can copy a prior result during a rebuild without cancelling it, ignores dialogs,
  and has a small hint in the existing footer. In Thoughts it remains Build, with
  the matching platform-specific hint in the same footer position; no added row.
- In Message only, Command+Shift+Enter / Ctrl+Shift+Enter copies, hides, returns
  focus and requests exactly one OS paste gesture (Command-V / Ctrl-V), never Enter
  or Send. Add its hint beside the existing footer hint without increasing height.
  Ignore repeats/overlapping copy actions; do not make Shift+Enter a build shortcut
  in Thoughts. Missing results or clipboard failure cannot hide or paste.
- Paste requires a live original target and, on macOS, existing Accessibility access.
  If preflight fails, leave Ramble open with an actionable error and the message
  copied. Do not automatically prompt: Settings → Placement → Enable access is the
  explicit permission action. Normal Copy, copy/close and Escape need no such access.
- After hiding, verify the target is foreground on two polls and wait for the
  physical shortcut modifiers/Enter to be released, within two seconds. Cancel if
  focus changes, the target closes, Ramble is shown again, another hide/quit occurs,
  or the timeout expires. Recheck immediately before injection, never retry a chord
  after possible partial delivery, and never read the clipboard or launch a target.
  OS/app input restrictions can reject paste; keep the copied message available and
  report the failure without redirecting keystrokes elsewhere.
- Capture the focus-return target even when focused-window placement is disabled.
  Keep it native-only and in memory; do not overwrite it when Ramble is already
  foreground. Return focus only after successful copy and hide, and only if Ramble
  was still foreground before hiding (do not steal focus after an intervening app
  switch). Restoration is best effort under OS activation policy: never relaunch a
  closed app or request Accessibility. Synthetic input is restricted to the explicit
  paste action above. Normal Copy and window-close behavior stay unchanged; Escape
  now uses return-focus hide while preserving editor/dialog cancellation semantics.
- Newly inserted thoughts and each successful generated message wipe in over a
  fixed 400 ms regardless of text length. Use a steady reveal across the text's own
  bounds (not empty row space), starting before the first paint. Bring newly inserted
  thoughts into view immediately and return new successful results to the top of
  the preview, so scrolling does not consume the animation offscreen. Editing,
  failure and switching views do not replay it; disable it for reduced motion.
- Present output as selectable plain text with preserved line breaks. The MVP
  does not need rich Markdown rendering; literal Markdown can still be copied.
- Empty output, malformed structured output, and nonzero exit status are errors,
  not successful previews. A copy failure must be visible and allow retry.

### 3.4 Style semantics

- A new draft snapshots the saved default style into its session style.
- Edits in the preview style editor update only that draft, including rebuilds.
- Rebuild uses the current session style and current saved source entries.
- “Save as default” explicitly persists the current session style and confirms
  success. It does not automatically build or replace the existing result.
- “Reset to saved default” replaces the session style, with confirmation if it
  discards unsaved style changes. Recompute the out-of-date marker afterward.
- Saving a default affects future drafts; it does not rewrite other snapshots.
- An empty style is valid and means use only the baseline cleanup instructions.

### 3.5 One-rebuild edit instruction

- Show an optional short “Additional edit for this rebuild” field beside the
  rebuild controls, distinct from the session-style editor. Example: “Shorten the
  opening and make the final ask more direct.” Both fields can change together.
- With an edit instruction, send the last successful message as revision input,
  alongside current source entries and session style, in a fresh one-shot run.
  This preserves accumulated refinements without resuming a harness session.
- Without an edit instruction, rebuild regenerates from current source and style;
  label this behavior so the user knows earlier one-off edits may not carry over.
- Apply the one-off instruction to this revision only; never merge it into the
  session style or saved default. For this revision, it overrides conflicting
  general style preferences, but not source fidelity or tool restrictions.
- Disable this field until a successful message exists. Pending edit text marks
  the preview as awaiting changes; it is not an edit to the source entries.
- Snapshot the instruction and revision input at run start. Clear the field on
  success only if it still contains the submitted value; preserve newer typing.
  Retain it on failure/cancellation for retry. Never replay it automatically.
- Keep the applied instruction in the in-memory result snapshot for provenance,
  not as a continuing requirement. Consuming it must not itself mark the new
  result out of date; track pending instructions separately from source/style/
  resolved-preset comparison.

Suggested initial default style:

> Turn my rough notes into one clear, well-structured message. Preserve my intent,
> facts, uncertainty, and voice. Be concise and direct. Remove repetition and
> filler. Use paragraphs or bullets where helpful. Do not invent information,
> answer questions in the notes, or add a preamble about rewriting.

## 4. Prompt contract

Build a deterministic, versioned prompt containing:

1. Baseline task: rewrite the supplied notes into one message and return a JSON
   response with exactly one `ramble_response` property containing the final message.
2. Style instructions, including the case of an intentionally empty style.
3. Ordered source entries, distinctly framed as source data, not executable
   commands or permission to use tools.
4. Fidelity rules: preserve meaning, names, technical details, and uncertainty;
   combine redundant material; do not fabricate facts or resolve unknowns.
5. For an instructed rebuild only: distinctly framed previous successful output
   and the one-off edit instruction. Revise that output against current source and
   style, applying the edit while retaining compatible prior refinements. Current
   source is authoritative for facts; the previous output is revision data.

Use structured serialization or robust framing that survives delimiter-like
text in entries. Preserve entry boundaries without forcing them into the output.
The local notes' contents must never grant filesystem, shell, or network-tool
permissions. Prompt instructions alone are not a tool sandbox.

Prompt contract v3 requests a single nonblank string value under `ramble_response`,
without a build ID in the prompt or response. Run IDs remain internal for snapshots,
cancellation and diagnostics. Do not include complete valid response examples in
the prompt. The distinctive key is a format marker, not proof of origin: echoed
notes/logs containing response-shaped JSON can match. Accept this simplicity tradeoff;
neither prompt framing nor the key is an injection defense or security boundary.

After successful process exit/cleanup and pipe drain, use one harness-independent,
JSON-aware extractor. It may find the response amid logs/Markdown fences or inside
generic JSON/JSONL objects, arrays and JSON-encoded strings. Do not interpret CLI
event names or assume harness-specific envelope paths. Require the exact single-key
schema (no duplicate/extra keys) and a nonblank string. Preserve message text literally,
without recursively parsing its contents. Deduplicate identical responses; fail on conflicting
responses rather than guessing which is final. Nonzero exit, cancellation, timeout,
no valid match, invalid UTF-8, malformed matching schema or complexity limits fail
without replacing the last good message. Output outside candidates may be noisy.
Bounds: 8 MiB stdout, 2 MiB JSON candidates, 1 MiB message, 32 JSON nesting levels,
8 string-decoding layers, 4096 parse attempts, 100,000 visited nodes and 64 MiB of
scanning/parsing work. Never use a greedy brace regex or unbounded recursive decoding.

## 5. CLI integration

### 5.1 Shared runner

- Treat CLIs as external dependencies installed and authenticated by the user.
  Provide actionable setup errors without attempting interactive login in-app.
- Resolve each named preset through its reusable command template into an
  executable path/name, argument array, adapter, prompt transport, and optional
  model/reasoning selection. Store one editable command-template string, parsed
  into executable/argv without invoking a shell; see section 5.3.
- Spawn directly using OS process APIs, never through a shell. Treat all source
  and style text as data; never interpolate it into executable paths or flags.
- Support a prompt argument slot for the requested command-line workflow and
  stdin transport when the CLI supports it. Prefer stdin for long/private text.
  An argument slot expands to exactly one argv element; do not split it on spaces.
- Respect Windows command-line length limits. If an argument-only invocation is
  too large, show a clear error or use a verified supported transport; never
  truncate. Do not silently put private prompts into temporary files.
- Explain that argv prompts can be visible in OS process listings. CLI providers
  may send content to remote models and retain it under their own policies.
- Use an app-controlled neutral working directory, not the user's active repo.
  Built-in starting templates use documented noninteractive/minimal options where
  available, without requiring isolation canaries before execution. Inherited
  CLI configuration, managed settings and integrations may still apply.
- Choose the fastest supported noninteractive path: one generation, minimal
  bootstrap/context, no planning or tool loops, and immediate exit after output.
  Prefer low-latency model/reasoning options where supported and user-selected;
  never silently replace an explicitly chosen model or quality setting.
- No preflight network/model calls, version probes on every build, or background
  warm-up services. Cache local capability checks by executable/version and
  invalidate when configuration or the executable changes. Measure launch-to-
  request and total duration locally without recording message contents.
- Preserve output correctness, bounded execution, and cancellation even when
  isolation has not been verified. External commands are trusted configuration.
- Inherit the native environment and normal CLI authentication/provider discovery
  to make installed commands usable. Do not persist the environment or mutate the
  user's global harness settings. CLI auth secrets are not exposed over IPC.
- A private process/server is not proof of configuration isolation or absence of
  provider-side history. Document any remaining inheritance and retention.
- Do not resume sessions, auto-approve tools, or use bypass-permission modes.
  Block unattended permission prompts and fail with an actionable explanation.
- Do not require a tool-denial/isolation validation gate. Built-in options are
  best-effort defaults, not restrictions on custom templates. Any saved executable
  and arguments run with the user's permissions and may have side effects. Make
  that trust boundary explicit, while never interpolating prompt text as a shell
  command automatically or exposing a raw shell API to the webview.
- Close stdin after sending the prompt. Drain stdout/stderr concurrently with
  bounded buffers. Prefer final-text output: the prompt asks the model for Ramble's
  own JSON response. Use the same response extractor for every template, with no
  built-in harness output parsers or selectable parser field.
- Keep diagnostics separate from output. Never heuristically strip arbitrary
  lines from the final message or silently treat tool logs as the answer.
- Suggested initial timeout: 120 seconds, configurable. Cancel/timeout terminates
  the invocation's process tree, including private helper servers, without
  terminating shared user services. Ignore late events from cancelled runs.
- Reap processes and remove app-created transient resources on success or failure.
- Resolve executables correctly for GUI-launched apps with a reduced PATH; allow
  an explicit executable override and show the resolved path in Settings.
  Account for Windows launcher/script behavior without shell interpolation.

### 5.2 Built-in command templates and default presets

| Preset | Intent | Follow-up validation (not an execution gate) |
| --- | --- | --- |
| OpenCode (default) | Noninteractive `run`, private standalone service, fresh session, minimal integrations | Confirm combined flags, prompt transport, config isolation, tool denial, output protocol, service teardown |
| Codex | Noninteractive execution, fresh session, writing-only restrictions | Confirm installed version's execution flags, prompt transport, permissions, output protocol, config inheritance |
| Claude Code | Noninteractive print execution, fresh session, writing-only restrictions | Confirm installed version's print flags, prompt transport, tool denial, output protocol, config inheritance |

Base arguments on installed help/official documentation and test parser fixtures.
Enable the starting templates without waiting for isolation validation or real
model smoke tests. Record what was actually checked rather than claiming verified
compatibility. Do not invoke a paid model to check installation.

OpenCode V2 documentation confirms `opencode run` is the automation entry point,
`--standalone` uses a private server, and `mini` is interactive, so `mini` is not
the appropriate integration. The documentation does not establish every flag
needed for this preset; combined invocation and isolation remain implementation
validation work. Never globally disable the user's shared OpenCode service.

Reference: https://opencode.ai/v2/docs/cli (consulted 2026-10-24).

### 5.3 Template system and quick custom presets

- A command template defines a name, a single editable command string containing
  the executable and arguments, and stdin/argument prompt transport.
  Ship editable OpenCode,
  Codex and Claude Code starting templates and a default preset for each. Users
  can create additional templates for any installed CLI/runtime, without code changes.
- A preset is a named template instance: stable ID, template ID/version, and
  parameter values such as executable override, model ID, and supported reasoning
  or latency options. Store differences rather than copied command strings.
- The creation flow in Settings → Presets is New preset → name/template → Model ID
  and Reasoning Effort → Save settings. Duplicate there to retain existing values.
- Expose fields only when the adapter supports them. Validate required values,
  types, and supported option combinations locally before a run. Model IDs may
  be entered directly; do not require a network model-list lookup to save/select.
- Provide one multiline command textarea, not separate executable/argument rows.
  Variables use exactly `{{MODEL_ID}}`, `{{REASONING_EFFORT}}`, and `{{PROMPT}}`.
  Quotes group arguments and backslashes escape quote/backslash/whitespace or
  literal opening braces/brackets. Preserve ordinary Windows path separators.
  Parse first, inject second: even embedded substitutions remain within the same
  argv element and injected quotes/whitespace/variables are never reparsed.
- Optional flag sections use `[[MODEL_ID --model {{MODEL_ID}} ]]` (similarly for
  REASONING_EFFORT). `[[!REASONING_EFFORT … ]]` applies only when effort is blank.
  These preserve optional flag/value behavior without guessing which flag to omit.
  PROMPT cannot be optional. Empty quoted arguments remain valid. There is no
  shell expansion, pipeline execution, environment lookup or expression evaluation.
- Validate placeholder names, required prompt transport, and adapter compatibility
  on save. Executables must be literal, not prompt-derived. Argument transport
  requires exactly one PROMPT; stdin templates omit it and receive the prompt via stdin.
- Do not restrict custom arguments to an adapter allowlist or enforce mandatory
  isolation flags outside the template. Validate structural correctness and prompt
  transport on save, not whether the user's trusted program is writing-only.
- Saved presets appear immediately in the main selector, survive restarts, and
  can be renamed, duplicated, or deleted. Deleting the selected preset falls back
  to the default OpenCode preset. Built-in templates remain available as bases.
- Template changes apply to subsequent runs only. Snapshot resolved arguments,
  parameters, adapter and template versions at build time; changes to the selected
  preset/template must make an older preview out of date even if its name is equal.
- Version template/settings schemas. Migrations must preserve custom values and
  make incompatible changes actionable rather than silently changing commands.
- Schema 4 converts schema-2/3 executable/argv records to command strings without
  losing literal characters, empty arguments or optional groups. Untouched starting
  invocations gain effort placeholders; customized commands retain their behavior.
  Empty untouched default presets gain the requested Luna defaults; explicit
  model/effort/executable customizations and other settings are preserved.
- Schema 5 removes legacy output-parser choices. Only exact pristine Codex/Claude
  commands switch to final-text output; OpenCode retains JSON transport. Custom
  command strings and preset values stay unchanged. All commands now must return
  the matching Ramble JSON response;
  arbitrary plain messages no longer count as success. The template editor explains
  the shared contract instead of offering harness-specific parser choices.

### 5.4 Invocation diagnostics

- Show a Diagnostics tab in all builds, including release builds for end users.
- Offer an off-by-default “Preview generated command before build” toggle. It is
  session-only, applies immediately, and never adds diagnostics/draft data to settings.
- When enabled, Build/Rebuild opens a popup with the resolved executable/arguments
  and any stdin prompt before launching. Run build uses that immutable request;
  Cancel/Escape closes the preview without launching or consuming composer text.
  Missing executables/validation errors are recoverable without losing notes.
- Native preview and execution share the same prompt/template compiler. Display
  private text as plain text, only in memory; never log or persist it. The browser
  demo labels its synthetic preview and never claims native resolution/execution.
- Quote diagnostic replay commands for zsh/bash on macOS and PowerShell on Windows,
  separately from the template editor's escaping rules. Preserve prompt JSON,
  apostrophes, newlines, backslashes and shell-looking text exactly when pasted;
  identify the intended terminal and explain that stdin must be supplied separately.
  Actual Ramble builds continue to launch directly without a shell.
- On invalid/missing/conflicting responses or unsuccessful harness exits with
  captured output, ask whether the user wants to view harness output for diagnostics.
  Do not automatically fetch/display private stdout/stderr or include it in normal
  error IPC. Show View harness output / Not now and warn about prompts/secrets.
- Retain only bounded in-memory excerpts of the latest failed run: at most 256 KiB
  per stream (head/tail), labeled when truncated; invalid UTF-8 is displayed with
  replacement characters. Viewing consumes the native cache; closing discards the
  UI copy. Declining, the next build, new draft or quitting clears retained output.
  Render as literal text, never HTML. No output history, logging, file export or
  automatic clipboard copy. Cancellation/timeouts/pipe failures may have no excerpt.

## 6. Persistence and privacy

- Store versioned settings in the platform's per-user application data location,
  not the repository: default style, templates, presets, selected preset, hotkey, window
  bounds, placement rules/application overrides, and timeout. Write atomically
  with migration and corruption recovery. Schema 3 adds centered placement defaults
  to schemas 1/2 without replacing custom templates, presets, styles or hotkeys.
- Running-app lists, last-focused-app metadata, and captured geometry are transient;
  persist application identities only when explicitly saved as placement overrides.
- MVP drafts, composer text, session style overrides, one-off edit instructions,
  revision inputs, and results live in memory
  only. They survive hiding the window, not quitting or a crash. State this in
  the UI and confirm explicit Quit if nonempty content would be lost.
- No draft history, telemetry, prompt logging, or raw output logging by default.
- Do not store API keys. Use the installed CLIs' existing authentication.
- Normal error messages stay sanitized. Raw failed-run stdout/stderr may be shown
  only through the explicit-consent, bounded, session-only viewer above; stderr is
  not assumed safe and the user is warned that prompts/credentials may be present.
- Copy is user initiated. Do not read clipboard content, clear it later, or paste
  except through the explicit Message paste shortcut above. Acknowledge that
  clipboard history tools may retain copies.

## 7. Implementation architecture

Approved stack (2026-10-24): Tauri 2 + React + TypeScript frontend, with a Rust
native backend. This fits a lightweight desktop
window, global shortcuts, clipboard access, and native child-process management.

- Frontend: capture/edit UI, switched message preview, style editor, run state, accessibility.
- Native backend: settings, single instance, tray/menu bar, window focus, global
  shortcut registration, clipboard, executable discovery, process supervision.
- Pure prompt builder: versioned serialization with deterministic unit tests.
- Command compiler: literal argument construction and transport, with one shared
  response extractor separate from process supervision. Isolation checks are
  optional future diagnostics, not launch gates.
- Narrow typed frontend/backend commands. Do not expose a general-purpose shell
  API to the webview. Restrict native capabilities and disallow remote web content.

Suggested domain records:

- `Entry`: stable ID, text, creation time, update time.
- `Draft`: ordered entries, composer text, session style, pending edit instruction,
  selected preset.
- `BuildSnapshot`: run ID, source entries, style, resolved preset/model config,
  template/adapter versions, optional edit instruction and revision input,
  prompt version, input fingerprint, start time.
- `BuildResult`: snapshot, final text, completion time.
- `CommandTemplate`: ID/version, compatibility version, command string, prompt
  transport and setup notes; output extraction is universal, not template-specific.
- `Preset`: ID, name, template reference, parameter overrides.
- `Settings`: schema version, saved style, templates, presets, selected preset, hotkey,
  window bounds, placement/default rule/application overrides, timeout.

Keep run status (`idle`, `running`, `failed`, `cancelled`, `timedOut`) separate
from the last successful result. Compare current inputs against that result's
snapshot to compute whether it is out of date.

## 8. Platform and quality requirements

- **Required UI reference:** use the latest height-optimized
  [`doc/concepts/ramble-ui-flow-compact.png`](concepts/ramble-ui-flow-compact.png)
  for layout, with the original
  [`concept`](concepts/ramble-ui-concept-final.png) for visual feel. Review these before
  designing or implementing the interface, and compare implementation screenshots
  against it during visual review.
- Preserve the reference's compact floating-window proportions, single toolbar,
  source and message typography, dense source rows, bottom composer and
  rebuild controls, and collapsible session-style section. Replace its side-by-side layout with
   the compact view switching and height-saving controls described in section 3.3.
   The compact-flow image supersedes the earlier two-flow image. Match its dark graphite
  surfaces, restrained mint accents, typography, spacing, subtle borders, and
  speech-bubble branding. Carry this visual language into the light theme and
  states not pictured. Adapt dimensions for readability, accessibility, and native
  platform conventions while retaining the compact layout and overall feel.
- The image guides presentation; the behavior and acceptance criteria in this
  specification remain required, including controls or states not visible in the
  concept. Use the supplied vector brand assets for the implemented logo.
- The UI must look beautiful: polished, cohesive, and intentionally designed,
  not a generic settings form or bare developer-tool prototype. Visual quality
  is a core product requirement, not optional post-MVP cleanup.
- Aim for a calm, elegant writing surface with excellent typography, generous
  but efficient spacing, clear hierarchy, refined colors, and consistent icons,
  borders, corner radii, and subtle elevation. Keep capture and the final message
  visually dominant; secondary settings should not clutter the main flow.
- Carry the same finish through entry editing, message preview, style/rebuild
  controls, preset selection, empty/loading/error states, and focus/hover states.
  Support cohesive light and dark themes that follow the system by default.
- Use restrained transitions and respect reduced-motion preferences. Beauty must
  not compromise readability, accessibility, keyboard use, or fast interaction.
- Review actual screenshots on macOS before calling its UI complete. Windows
  validation is deferred for now, while retaining portable APIs and native process
  containment paths. Do not infer Windows validation from a macOS run.
- Keyboard-operable capture, edits, preset selection, build, cancel, and copy.
  Use platform-correct shortcut labels, visible focus, screen-reader labels,
  sufficient contrast, and system text scaling.
- Test hotkey conflicts, focus restoration on summon, multiple monitors, scaling,
  tray behavior, and hide-versus-quit behavior on both target operating systems.
- Test macOS Spaces/full-screen behavior and Windows focus restrictions rather
  than assuming an always-on-top flag guarantees every desired behavior.
- Never request Accessibility or other elevated permissions speculatively;
  explain permissions only if the chosen implementation actually requires them.
- Target a warm summon within 300 ms on a typical development machine. This is
  an implementation target, not a measured guarantee. Model latency is external.
- Initial packaging target: macOS Apple Silicon and Windows x64. Intel macOS and
  Windows ARM64 are follow-up candidates, pending user confirmation. Exact minimum
  OS versions, signing/notarization, and distribution are pre-release decisions.

### 8.1 Selected visual identity

The selected Ramble logo direction is option 4 from the icon exploration sheet:
a speech bubble with three thought-lines converging into one. Reusable vector,
wordmark, monochrome, raster, and application-icon assets and their usage guidance
live in [`brand/README.md`](brand/README.md). This replaces the leaf
placeholder in earlier UI concepts when application branding is implemented.

## 9. Acceptance criteria

1. On both operating systems, a registered hotkey focuses a floating window above
   ordinary windows with a fresh Thoughts draft and focused composer. Hide followed
   by tray/menu Show preserves source, preview and view instead.
2. A user submits at least three entries, including multiline and Unicode text,
   edits an older entry, and deletes/undoes another without losing order.
3. Building includes pending composer text and all latest saved entries exactly
   once, with the session style and correct selected preset.
4. A fake CLI verifies argv/stdin fidelity with quotes, newlines, shell-looking
   text, delimiter-like text, and long input; none is executed as shell syntax.
5. OpenCode, Codex and Claude starting presets can launch one-shot CLI execution
   without opening a TUI or restarting Ramble. A custom template can run a different
   executable through the same build, cancellation and final-result path.
6. Source remains editable by switching back to Thoughts; the result is preserved. Changes made during a run cannot
   corrupt its snapshot or incorrectly label its result as current.
7. Session style edits affect rebuilds but not the saved default. Explicit save
   survives restart; a new draft uses that saved default.
8. Copy writes exactly the preview's final text, and visibly reports success or
   failure. Empty/error/protocol output never becomes a successful message.
9. Missing executable, missing auth, unsupported version, permission prompt,
   invalid output, timeout, and cancellation leave the source and last good
   result intact, with retry possible and no orphaned owned process tree.
10. Restart restores settings but not private draft contents; the UI makes that
    persistence boundary clear. No default logs contain source or final text.
11. An instructed rebuild applies both changed session style and a one-off edit
    to the previous result against current source. Success consumes only that
    instruction; failure retains it. Neither action changes the saved default.
12. A user creates, duplicates and selects presets in Settings → Presets and edits
    existing Model ID / Reasoning Effort values without JSON/commands or restarting.
    The toolbar has only a preset selector, not add/duplicate actions. Templates
    are editable command strings with literal variable injection; settings persist.
13. Offline fixture tests cover custom templates, literal argv/stdin fidelity,
    parsers, migration and process cleanup. Real-harness isolation canaries, Windows
    validation and paid-model benchmarks are deferred; no isolation or speed
     guarantees may be inferred from the offline tests.
14. Summoning captures focus before activation, applies the default or matching
    app override, and clamps to a usable display area. Permission denial and
    unavailable geometry fall back visibly without interrupting the draft. App
    selection, signed offsets, rule persistence, and explicit permission opt-in
    are covered by offline tests; actual desktop behavior requires native checks.
15. Diagnostics is available in all builds. With command preview enabled, Build
     displays the resolved invocation before launching; Cancel preserves source,
     Run uses the previewed request, and no private preview data is persisted/logged.
16. Every command shares the single-key `ramble_response` JSON contract. No valid
    response, conflicting responses or unsuccessful exit preserves the last good
    message and offers explicit-consent viewing of captured harness output.
    Declining/viewing, the next build, new draft and quit discard retained output;
    raw stdout/stderr never appears in normal outcomes, settings or logs.
17. Placement default/per-app width and height survive restart, inherit independently,
    apply before scaling/anchoring and clamp to work areas. Existing saved dimensions
    and rules migrate without loss. Message copy-and-hide shortcuts preserve draft
    and in-progress work; failures never hide the window. Fixed-duration wipe-ins
    respect reduced motion and do not replay on view changes.
18. Shortcut summons reset an already-visible Thoughts/Message view and dismiss
    dialogs/previews without confirmation. Active work is cancelled and joined before
    another build; late results/diagnostics/preview/copy replies cannot resurrect the
    old draft or hide the new one. Repeated summons keep input focus and settings.

## 10. Suggested implementation sequence

1. Use the approved stack; confirm keyboard defaults, draft persistence policy, supported
   CPU/OS targets, and actual harness isolation capabilities. Verify CLI versions
   and record supported invocations without building the full UI first.
2. Implement the native window/hotkey lifecycle and capture/edit UI with a fake
   harness; include settings and session/default-style semantics.
3. Implement process supervision and adapters with offline fake-process tests;
   integrate OpenCode first, then Codex and Claude Code.
4. Finish the switched message preview, cancellation, stale-result handling, clipboard, errors,
   and keyboard/accessibility details.
5. Perform opt-in real-harness smoke tests on macOS and Windows, then package.

The recommendations and proposed defaults above allow development planning
without implying user approval of unrequested implementation work.
