# Implementation and release validation

This file tracks evidence, not product requirements. `SPEC.md` is authoritative.

## Implemented

- Tauri host with single instance, tray/menu, hide-on-close, explicit quit,
  shortcut registration/replacement, and clipboard write-only IPC.
- Global shortcut summons a fresh Thoughts draft and focuses input; tray/second
  launch preserve the draft/view. Mocked native-event tests cover already-visible
  views, dialogs/previews, active-run cleanup and late output/copy replies. Native
  fake-process tests cover abandonment before launch, cancellation and discarded
  diagnostics; actual OS shortcut/focus behavior still needs manual verification.
- Capture, literal multiline/Unicode entries, IME-aware submission, inline editing,
  delete/undo, composer commit on build, confirmation before New draft.
- Immutable frontend snapshots, one active run, preservation of last good result,
  semantic out-of-date detection, and revision-aware one-off instruction consumption.
- Header-free Thoughts/Message Back navigation with preserved views, session/default style separation,
  quick model preset creation/duplication/renaming/deletion, light/dark themes.
- Validated settings schema, optimistic revisions, atomic replacement and backup,
  corrupt/future-file protection; no draft persistence.
- Versioned JSON prompt serialization, literal argv AST, bounded native supervisor
  with macOS process groups and Windows Job Object wrapper.
- Explicit, in-memory browser demo; production builds launch saved trusted commands.
- Arbitrary executable/argument template editor, model groups, stdin/argument
  transport and versioned settings migrations.
- macOS overlay title bar integrates native controls into the draggable app toolbar.
- Focus-before-activation placement, default/per-app nine-point rules and signed
  offsets, running-app picker, macOS opt-in Accessibility control and fallback
  notice; native work-area calculations for macOS/Windows. Schema-3 migration.
- Height-optimized 640×480 / minimum 560×420 layout with inline capture/Build and
  Back/status/Copy only in Message, tested in browser workflows at both sizes.
- Schema-6 default/per-app width/height, independent inheritance, scale-aware
  sizing before anchoring/clamping and preservation of saved sizes on migration.
- Settings-only preset management with direct model/effort editing; schema-4
  single-string commands with literal variable injection and lossless legacy
  conversion. Pristine defaults use Luna/medium; custom values remain intact.
- End-user Diagnostics tab and opt-in pre-launch command/stdin preview, using the
  native build compiler without launching. Preview cancellation preserves input;
  the toggle and private preview are session-only in all builds.
- Shared prompt-v3 single-key `ramble_response` JSON contract with bounded, harness-independent
  extraction, nested JSON-string support, strict schema and conflict rejection.
  Schema 5 removes parser settings; pristine Codex/Claude commands use final-text
  output while OpenCode retains JSON transport.
- Explicit-consent failure-output viewer with one-run, bounded native stdout/stderr
  excerpts. Tests cover no automatic fetching, safe literal rendering, single-read
  consumption and discard on dismissal/new build/new draft/quit.
- Fake-process tests reject failed exits, cancellation, timeouts and truncated
  responses; terminal replay quoting preserves literal text in macOS sh/zsh.
- Contextual Command/Ctrl+Enter: Build in Thoughts; copy the last successful message
  then hide (never quit) in Message. Existing-footer hints add no height. Tests
  cover clipboard/hide failures, no result, dialogs, key repeats and active rebuilds.
- Copy-and-hide explicitly returns focus to the pre-show native application/window.
  Tests cover copy-before-hide/restore ordering, repeated-summon origin retention,
  missing capture, hide failure and intervening app-switch suppression. macOS AppKit
  activation compiles; actual cross-app focus behavior and Windows remain unvalidated.
- Message-only Shift+Command/Ctrl+Enter explicitly requests one guarded paste after
  copying; Escape goes back from Message and hides/returns focus only from Thoughts.
  Editor/dialog cancellation takes precedence. Pure paste-gate tests
  cover delayed/changed focus, released keys, timeout, epoch cancellation and one-shot
  authorization. Browser/UI tests mock input: no automated test sends real OS keys.
- Plain Enter submits/saves/builds in text fields; Shift+Enter remains multiline.
  UI/form tests cover repeat, IME/keyCode-229, read-only and HTML validation gates;
  browser tests exercise actual newlines and Enter in inline/message edits/settings.
  Consecutive revisions include the latest successful message; failed revisions
  retain the previous successful target. Native prompt tests verify revision JSON.
- Schema 7 migrates schemas 1–6 without changing custom configuration and persists
  independent 12–28 px thought/message sizes. Native tests cover bounds/roundtrip;
  browser tests verify computed sizes for entries/composer/inline editing/output,
  compact row padding, and unchanged message freshness at 560×420.
- Schema 8 adds off-by-default persisted Compact Mode. Tests cover migration and
  restart persistence, draft/result/pending-edit retention, active builds, save failure,
  read-only settings, native minimum/bounds policy and nonmutating placement sizing.
  Light/dark Chromium workflows exercise the core flow, Settings, errors/diagnostic
  actions and 28 px text at 360×280, including a simulated macOS toolbar gutter.
  Actual native resizing/control placement and Windows still need manual checks.
- Mount-only 400 ms text-bound wipe-ins for inserted thoughts and successful messages, with
  identical duration for short/long text, no replay on edits/navigation and reduced
  motion respected. Web Animation resources are cancelled on unmount.
  Synchronous reveal/scroll prevents missed animations from first-paint flashes
  or offscreen smooth scrolling. Regression tests sample actual midway rendering
  and screenshots rather than only checking animation API calls.

## Still required before calling the MVP complete

- Opt-in real CLI/model smoke tests. Default flags have local help/docs evidence;
  the universal response contract currently uses synthetic fixtures, not fresh
  real-model runs through each starting command.
  See [adapter notes](adapters/VALIDATION.md). Isolation canaries and Windows
  validation are deferred by user decision, not blockers on executing templates.
- Native macOS screenshot review of the unified title bar against the reference.
- Native hotkey conflict/replacement/focus, tray, hide/quit, clipboard failure,
  multi-display work-area/scaling, macOS Spaces/full-screen, Windows focus limits.
- Manually verify copy-and-return-focus with placement off, Accessibility denied,
  repeated summons while Ramble is focused, terminated target apps/windows, and
  switching apps during a pending clipboard write. No focus-return platform guarantee
  should be inferred from mocked browser/unit-policy checks.
- Manually validate explicit paste to a disposable test field, with permission
  allowed/denied, slow activation, held keys, re-summon, closed targets, app switching
  and protected/elevated apps. Verify exactly one paste and no Enter/send action.
  CoreGraphics signatures were checked against the installed SDK; Windows SendInput
  bindings were inspected, not validated on Windows. Never run automated input into
  the user's existing app windows as a substitute for these opt-in checks.
- Manually verify focused-window placement with/without macOS Accessibility,
  multiple windows per app, already-focused summons, all anchors, signed offsets,
  per-app overrides, mixed-DPI/negative-origin monitors and Dock/menu-bar avoidance.
  AX calls and AppKit compile on macOS; offline geometry/UI tests are not proof
  of native focus/permission behavior. Windows implementation remains unvalidated.
- Compact geometry is shared by Thoughts/Message views; constrained-display and
  saved-bounds behavior still need native platform review.
- Settings backup replacement and corrupt/future recovery manual tests on Windows.
- Verify process-tree teardown on Windows, nested jobs, escaping/daemonizing helpers,
  cancellation/exit races, and app exit. Fake tests are not real-adapter evidence.
- Frontend/native contract fixture coverage for the remaining IPC shapes. Shared
  defaults and build request/outcome fixtures are tested; types are hand-maintained.
- Packaging metadata approval, minimum supported OS versions, signing/notarization,
  and actual Apple Silicon/Windows x64 installation tests.

Windows entries above are follow-up work, not part of the current macOS-focused
validation pass. Continue using portable APIs and the Windows containment path.

## Validation performed in this session

See `../AGENT_HANDOVER.md` for final executed commands and outcomes. Automated
browser checks must never be described as Windows or native desktop validation.

## Release automation

The manual release workflow and recovery procedure are in [RELEASES.md](RELEASES.md).
Local hermetic script tests cover version/changelog validation, aligned manifest
versions, fake native-installer archives, dispatch-only helpers, branch races,
atomic-push rejection, same-run draft recovery, immutable published assets and
prerelease flags. Workflow definitions pass actionlint v1.7.12; Bash scripts pass
syntax checks. These checks do not build real installers or run GitHub Actions.
The first hosted run must still validate macOS Intel/Apple Silicon and Windows
builds/installers; unsigned packages do not satisfy signing/notarization or the
manual release gates above. No workflow has been dispatched as part of this change.
