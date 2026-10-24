# Ramble — Product and Technical Specification

Status: proposed MVP specification; no application has been implemented.
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
- The prompt runs through a configurable command-line harness, defaulting to
  OpenCode, with quickly selectable Codex and Claude Code presets.
- Each build is a fresh, noninteractive one-shot invocation, not a resumed chat.
- Harness execution is speed-first: no MCP startup, tools, plugins, repository
  scanning, or other unnecessary initialization. Get one answer and exit.
- Ship three reusable command templates (OpenCode, Codex, Claude Code), with
  easy named presets for model IDs and other supported invocation variations.
- The result appears beside the source in a vertical split (left/right panes).
- The preview includes an editable session style and a rebuild action.
- Rebuild also accepts a separate, optional short edit instruction for that run.
- Style changes affect only the current draft unless explicitly saved as default.
- A copy action copies only the final message to the system clipboard.
- Settings, presets, and the default style persist across application restarts.

### Not in the MVP

- Slack integration, sending messages, or automatic pasting into other apps.
- Cloud accounts, sync, collaboration, or an app-managed model subscription.
- File attachments, speech input, autonomous tools, or repository access.
- A history browser, multiple simultaneous drafts, or multi-agent workflows.
- Linux support, automatic updates, and app-managed CLI installation/login.

## 3. User experience

### 3.1 Summon and dismiss

- Run as a single-instance background application with a tray/menu-bar entry.
- Suggested initial hotkey: `Command+Shift+Space` on macOS and
  `Control+Shift+Space` on Windows. These are proposed defaults, not guaranteed
  available bindings. Allow changing them in Settings.
- The hotkey shows and focuses the existing window; pressing it while visible
  focuses it rather than discarding input or starting another instance.
- Open on the active display and clamp remembered bounds to available displays.
- The window stays above ordinary application windows. Do not promise display
  over secure desktops, permission prompts, or every exclusive full-screen app.
- Losing focus does not hide the window. Escape hides it when no editor/dialog
  is consuming Escape; the close button hides rather than quits.
- Hide preserves the draft and any in-progress build. Expose an explicit Quit.
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
- New draft is explicit and requires confirmation when it would discard content.

### 3.3 Build and review

- Initially prioritize the capture pane. The first build reveals a left/right
  split: editable source on the left, result and session style on the right.
- Within the right pane show the result first, with a clearly labeled expandable
  session-style editor underneath. Keep the editor available alongside preview.
- Use a resizable divider and scrollable panes. Enforce a minimum window size
  that keeps both panes usable rather than silently changing to a stacked layout.
- Provide a preset selector in the main window. Switching presets takes one
  selection, affects the next build only, and persists the last selection.
- Beside the selector, offer “New preset from template” and “Duplicate preset.”
  A named OpenCode variant with a specific model ID must be creatable without
  writing a command line or JSON, then immediately selectable before building.
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

1. Baseline task: rewrite the supplied notes into one message; return only that
   message, without an explanation or an enclosing code fence.
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

## 5. CLI integration

### 5.1 Shared runner

- Treat CLIs as external dependencies installed and authenticated by the user.
  Provide actionable setup errors without attempting interactive login in-app.
- Resolve each named preset through its reusable command template into an
  executable path/name, argument array, adapter, prompt transport, and optional
  model selection. No shell command strings; see section 5.3.
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
  Disable inherited project discovery, tools, MCP, plugins, skills discovery,
  hooks, repository indexing, and other unnecessary integrations before startup.
  MCP servers must not even initialize or connect, rather than merely being
  forbidden during generation. Verify actual isolation per adapter.
- Choose the fastest supported noninteractive path: one generation, minimal
  bootstrap/context, no planning or tool loops, and immediate exit after output.
  Prefer low-latency model/reasoning options where supported and user-selected;
  never silently replace an explicitly chosen model or quality setting.
- No preflight network/model calls, version probes on every build, or background
  warm-up services. Cache local capability checks by executable/version and
  invalidate when configuration or the executable changes. Measure launch-to-
  request and total duration locally without recording message contents.
- Speed must not weaken isolation or output correctness. If a CLI cannot prevent
  unnecessary integrations from initializing, do not advertise that configuration
  as a compliant minimal preset; show the limitation and require correction.
- Preserve only configuration/authentication needed for model access. Do not
  mutate the user's global harness settings to achieve minimal operation.
- A private process/server is not proof of configuration isolation or absence of
  provider-side history. Document any remaining inheritance and retention.
- Do not resume sessions, auto-approve tools, or use bypass-permission modes.
  Block unattended permission prompts and fail with an actionable explanation.
- Require verified tool-denial behavior for built-in presets. If a supported CLI
  version cannot provide it, report the limitation rather than claim safe
  writing-only execution. Custom executable overrides remain explicitly trusted
  user configuration; they are not a sandbox for arbitrary programs.
- Close stdin after sending the prompt. Drain stdout/stderr concurrently with
  bounded buffers. Use structured output when supported and extract only the
  final assistant message through a preset-specific parser.
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

| Preset | Intent | Validation required before shipping |
| --- | --- | --- |
| OpenCode (default) | Noninteractive `run`, private standalone service, fresh session, minimal integrations | Confirm combined flags, prompt transport, config isolation, tool denial, output protocol, service teardown |
| Codex | Noninteractive execution, fresh session, writing-only restrictions | Confirm installed version's execution flags, prompt transport, permissions, output protocol, config inheritance |
| Claude Code | Noninteractive print execution, fresh session, writing-only restrictions | Confirm installed version's print flags, prompt transport, tool denial, output protocol, config inheritance |

Do not ship guessed command templates. Validate each against supported CLI
versions, record the version range, and test adapter fixtures. Do not invoke a
paid model merely to check whether an executable is installed.

OpenCode V2 documentation confirms `opencode run` is the automation entry point,
`--standalone` uses a private server, and `mini` is interactive, so `mini` is not
the appropriate integration. The documentation does not establish every flag
needed for this preset; combined invocation and isolation remain implementation
validation work. Never globally disable the user's shared OpenCode service.

Reference: https://opencode.ai/v2/docs/cli (consulted 2026-10-24).

### 5.3 Template system and quick custom presets

- A command template defines the harness adapter, executable default, safe argv
  layout, prompt transport, output parser, supported parameter definitions, and
  mandatory minimal/no-tool configuration. Ship OpenCode, Codex, and Claude Code
  templates plus one ready-to-use default preset for each; select OpenCode first.
- A preset is a named template instance: stable ID, template ID/version, and
  parameter values such as executable override, model ID, and supported reasoning
  or latency options. Store differences rather than copied command strings.
- The quick creation flow is: choose template → name → optional model ID/options
  → Save and select. Example: “OpenCode — quick” using a user-entered model ID.
  Duplicate an existing preset to make another variation with minimal effort.
- Expose fields only when the adapter supports them. Validate required values,
  types, and supported option combinations locally before a run. Model IDs may
  be entered directly; do not require a network model-list lookup to save/select.
- Advanced template editing may expose an executable and tokenized argv editor,
  never a shell string. Use a small explicit placeholder system, such as
  `{{model}}` and `{{prompt}}`, not executable expressions or environment expansion.
  Define optional argument groups so an absent model omits both flag and value.
- Validate placeholder names, required prompt transport, and adapter compatibility
  on save. A substitution remains literal within one argv element, even if it
  contains whitespace or quotes. Stdin prompts need no prompt argv placeholder.
- Keep mandatory isolation/no-tool settings enforced by the adapter, outside
  editable template arguments. Reject conflicting overrides rather than allow a
  speed/model variation to enable MCP, tools, hooks, or inherited project state.
- Saved presets appear immediately in the main selector, survive restarts, and
  can be renamed, duplicated, or deleted. Deleting the selected preset falls back
  to the default OpenCode preset. Built-in templates remain available as bases.
- Template changes apply to subsequent runs only. Snapshot resolved arguments,
  parameters, adapter and template versions at build time; changes to the selected
  preset/template must make an older preview out of date even if its name is equal.
- Version template/settings schemas. Migrations must preserve custom values and
  make incompatible changes actionable rather than silently changing commands.

## 6. Persistence and privacy

- Store versioned settings in the platform's per-user application data location,
  not the repository: default style, templates, presets, selected preset, hotkey, window
  bounds, and timeout. Write atomically with migration and corruption recovery.
- MVP drafts, composer text, session style overrides, one-off edit instructions,
  revision inputs, and results live in memory
  only. They survive hiding the window, not quitting or a crash. State this in
  the UI and confirm explicit Quit if nonempty content would be lost.
- No draft history, telemetry, prompt logging, or raw output logging by default.
- Do not store API keys. Use the installed CLIs' existing authentication.
- Diagnostics may show exit code and bounded, sanitized error text. Do not assume
  stderr is safe: redact prompt echoes, credentials, and sensitive paths.
- Copy is user initiated. Do not read clipboard content, auto-paste, or clear the
  clipboard later. Acknowledge that clipboard history tools may retain copies.

## 7. Proposed implementation architecture

Recommendation, not yet an approved dependency commitment: Tauri 2 + React +
TypeScript frontend, with a Rust native backend. This fits a lightweight desktop
window, global shortcuts, clipboard access, and native child-process management.

- Frontend: capture/edit UI, split preview, style editor, run state, accessibility.
- Native backend: settings, single instance, tray/menu bar, window focus, global
  shortcut registration, clipboard, executable discovery, process supervision.
- Pure prompt builder: versioned serialization with deterministic unit tests.
- Harness adapters: argument construction, transport, version checks, output
  parsing, and capability/isolation validation separate from process supervision.
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
- `CommandTemplate`: ID/version, adapter, executable, argv layout, parameter
  schema, prompt transport, parser, enforced minimal-execution requirements.
- `Preset`: ID, name, template reference, parameter overrides.
- `Settings`: schema version, saved style, templates, presets, selected preset, hotkey,
  window bounds, timeout.

Keep run status (`idle`, `running`, `failed`, `cancelled`, `timedOut`) separate
from the last successful result. Compare current inputs against that result's
snapshot to compute whether it is out of date.

## 8. Platform and quality requirements

- The UI must look beautiful: polished, cohesive, and intentionally designed,
  not a generic settings form or bare developer-tool prototype. Visual quality
  is a core product requirement, not optional post-MVP cleanup.
- Aim for a calm, elegant writing surface with excellent typography, generous
  but efficient spacing, clear hierarchy, refined colors, and consistent icons,
  borders, corner radii, and subtle elevation. Keep capture and the final message
  visually dominant; secondary settings should not clutter the main flow.
- Carry the same finish through entry editing, split preview, style/rebuild
  controls, preset selection, empty/loading/error states, and focus/hover states.
  Support cohesive light and dark themes that follow the system by default.
- Use restrained transitions and respect reduced-motion preferences. Beauty must
  not compromise readability, accessibility, keyboard use, or fast interaction.
- Review actual screenshots of the main workflow on macOS and Windows before
  calling the UI complete; functional acceptance alone is not visual acceptance.
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

## 9. Acceptance criteria

1. On both operating systems, a registered hotkey focuses a floating window above
   ordinary windows; hide and reopen preserve source and preview.
2. A user submits at least three entries, including multiline and Unicode text,
   edits an older entry, and deletes/undoes another without losing order.
3. Building includes pending composer text and all latest saved entries exactly
   once, with the session style and correct selected preset.
4. A fake CLI verifies argv/stdin fidelity with quotes, newlines, shell-looking
   text, delimiter-like text, and long input; none is executed as shell syntax.
5. A validated OpenCode preset produces one final message without opening a TUI
   or using a shared session/service; validated Codex and Claude presets can be
   selected without editing configuration or restarting the application.
6. Source remains editable beside the preview. Changes made during a run cannot
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
12. A user creates and selects a named OpenCode model variant through the template
    form without editing JSON/commands or restarting. Template resolution is
    literal and safe on both platforms, and settings survive restart.
13. Harness integration tests verify no MCP startup/connections, tool execution,
    plugin/hook loading, or repository scanning. Compare startup and total times
    across supported minimal invocations with opt-in benchmarks; choose the
    lowest-overhead compliant path, without an unmeasured speed guarantee.

## 10. Suggested implementation sequence

1. Confirm architecture, keyboard defaults, draft persistence policy, supported
   CPU/OS targets, and actual harness isolation capabilities. Verify CLI versions
   and record supported invocations without building the full UI first.
2. Implement the native window/hotkey lifecycle and capture/edit UI with a fake
   harness; include settings and session/default-style semantics.
3. Implement process supervision and adapters with offline fake-process tests;
   integrate OpenCode first, then Codex and Claude Code.
4. Finish split preview, cancellation, stale-result handling, clipboard, errors,
   and keyboard/accessibility details.
5. Perform opt-in real-harness smoke tests on macOS and Windows, then package.

The recommendations and proposed defaults above allow development planning
without implying user approval of unrequested implementation work.
