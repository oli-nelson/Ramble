# Agent Handover Log

Brief continuation notes for future development sessions. Append dated entries;
keep product requirements in `doc/SPEC.md` and technical design in `doc/TECH_SPEC.md`.

<!-- Future entry format:
## YYYY-MM-DD — Short session topic
- Changed:
- Validated:
- Unfinished/blockers:
- Next:
-->

## 2026-10-25 — Core app implementation and offline validation
- Changed: implemented Tauri/React/Rust app, reference-inspired light/dark UI,
  draft reducer, style/revision/preset flows, atomic settings, native lifecycle,
  literal prompt/argv builders, bounded supervisor, and owned build coordinator.
  Added explicit browser demo, shared defaults/IPC fixtures, lockfiles, developer
  commands, and macOS/Windows CI configuration. No commits made.
  An unrelated concurrent `docs/seedance-2.5-advert-prompt.md` appeared; left untouched.
- Validated on macOS arm64: `npm run build`; `npm test` (20 tests);
  `npm run test:e2e` (5 scenarios, dark/light browser screenshots reviewed);
  `cargo test --no-default-features --features test-harness` (21 tests, including
  synthetic descendants gone after cancellation/normal exit); strict all-target,
  all-feature Clippy; rustfmt; native debug build via
  `npm run tauri -- build --debug --no-bundle --ci`. No real model calls.
- Unfinished/blockers: **not a release-complete MVP**. All three real adapters
  fail closed; installed CLI help/version inspection is not isolation evidence.
  Native desktop interaction, Windows, signing/installers, real protocol parsers,
  capability caching, and real-harness canaries/benchmarks remain unvalidated.
  See `doc/VALIDATION.md` and `doc/adapters/VALIDATION.md`; CI has not run remotely.
- Next: establish a compliant real-adapter invocation (OpenCode first), canary-test
  integration suppression on native platforms, then implement its parser/probe and
  connect an adapter-owned ExecutionPlan to the coordinator. Real-model smoke tests
  require explicit opt-in. The offline demo is `npm run dev:demo`; it only joins
  text and its settings are temporary. Never use `test-harness` in shipped builds.

## 2026-10-25 — Shared Control+Shift+Y default and rebuild
- Changed: set the shared default to explicit `Control+Shift+Y` (not Command on
  macOS); updated Settings guidance, README, and `doc/SPEC.md`. Added regression
  tests for the default and preservation of saved custom shortcuts.
- Validated on macOS arm64: 21 frontend tests, 22 Rust tests, 5 browser workflows,
  rustfmt and diff checks. `npm run tauri -- build --debug --bundles app --no-sign
  --ci` produced `src-tauri/target/debug/bundle/macos/Ramble.app` (unsigned).
- Unfinished/next: existing saved shortcuts are intentionally unchanged; choose
  Control+Shift+Y in Settings if needed. Native hotkey behavior and Windows remain
  unvalidated; other release gates in `doc/VALIDATION.md` are unchanged.

## 2026-10-25 — Fix Tauri dev binary selection
- Changed: added Cargo `default-run = "ramble"` so `tauri dev` selects the desktop
  app instead of failing on the app/test-harness binary ambiguity.
- Validated: Cargo metadata confirms the default binary; `cargo check
  --no-default-features --features desktop` and diff checks pass on macOS arm64.
  Did not launch another app instance or interfere with the user's dev server.
- Next: restart `npm run tauri -- dev` to confirm interactive native startup.

## 2026-10-25 — Compact Thoughts / Message workspace
- Changed: replaced simultaneous split panes with persistent Thoughts / Message
  navigation. Build selects Message; switching preserves mounted views, pending
  edits, scroll, and active runs. Completion respects the user's selected view.
  Default window is 640 × 700, minimum 560 × 560; adjusted native bounds handling
  and compact toolbar spacing. Updated SPEC and TECH_SPEC to match.
- Validated on macOS: production frontend build, 24 frontend tests, 7 browser
  workflows at compact widths, 26 offline Rust tests, native cargo check, rustfmt,
  and diff checks. Reviewed dark Message and light capture browser screenshots;
  browser fixture also checks toolbar bounds with macOS traffic-light spacing.
- Unfinished/next: native desktop visual interaction and Windows remain untested.
  Existing saved window sizes are preserved; resize an existing window to try
  compact mode. No real model calls or packaged app rebuild performed.

## 2026-10-25 — General command templates, enabled execution, floating chrome
- Changed: removed the isolation launch gate per user direction. Added editable
  arbitrary executable/argv templates, stdin/argument transport, model groups,
  plain/OpenCode/Codex/Claude parsers, Settings template management, and schema-2
  migration preserving saved presets/style/hotkey. Commands inherit native CLI
  environment/auth; trusted configuration, not a sandbox. Updated SPEC/docs.
- Changed: macOS platform config overlays native traffic lights/title bar onto
  Ramble's draggable toolbar; added narrow drag permission. Preserved concurrent
  compact Thoughts/Message work and matched 640×700 / minimum 560×560 geometry.
- Validated on macOS arm64: 24 frontend tests, 27 Rust tests, 8 browser workflows,
  production frontend build, strict all-target/all-feature Clippy, rustfmt and
  diff checks. Native tests exercise saved custom templates via both stdin and
  argv using a fake CLI. Reviewed custom-template and compact review screenshots.
  Rebuilt unsigned `src-tauri/target/debug/bundle/macos/Ramble.app` with
  `npm run tauri -- build --debug --bundles app --no-sign --ci`.
- Unfinished/next: no paid/real model calls or isolation canaries performed; CLI
  defaults use installed help/docs plus synthetic protocol fixtures. Native
  macOS chrome interaction review remains; Windows validation is deliberately
  deferred while native Windows containment and fallback chrome are retained.
  Restart native dev/app to pick up window config, then try a user-initiated build.

## 2026-10-25 — Focused-window placement and height-optimized UI
- Changed: capture foreground target before activating Ramble; added native macOS
  AX/AppKit and Windows HWND/work-area placement, nine anchors/signed offsets,
  per-app overrides, searchable running-app picker and last-focused-app shortcut.
  macOS permission requests are explicit only; missing geometry shows a fallback
  notice. Schema 3 preserves custom schema-1/2 settings and saved sizes.
- Changed: followed `doc/concepts/ramble-ui-flow-compact.png`: tabs/status/Copy in
  one row, no repeated visible headings, inline composer/Build, smaller rebuild
  controls. Default 640×480, minimum 560×420; updated SPEC/TECH_SPEC/README.
- Validated on macOS arm64: production frontend build, 29 frontend tests, 33
  offline Rust tests, strict all-target/all-feature Clippy, rustfmt, diff checks;
  10 browser workflows including placement editing/saving at both compact sizes.
  Reviewed dark/light capture/review and placement screenshots under `test-results/`.
- Unfinished: native focused-window/permission, multi-display/scaling, chrome and
  hotkey interaction still need manual review. Windows code remains unvalidated.
  No real model calls, permission prompts or desktop interaction tests performed.
  Rebuilt unsigned `src-tauri/target/debug/bundle/macos/Ramble.app` successfully
  via `npm run tauri -- build --debug --bundles app --no-sign --ci`.
- Next: restart the native app/dev host; Settings → Placement → Enable access,
  then summon from several app windows and check defaults/overrides/clamping.
  Existing saved sizes intentionally remain unchanged; resize to try compact height.

## 2026-10-25 — Settings presets, command strings, and end-user Diagnostics
- Changed: removed preset add/duplicate toolbar buttons. Settings → Presets now
  has an edit picker, direct Model ID/Reasoning Effort fields, template selection,
  creation/duplication/removal, and explicit activation. Editing an inactive preset
  does not silently activate it. New presets inherit their base preset values.
- Changed: schema 4 persists one command string per template with `{{MODEL_ID}}`,
  `{{REASONING_EFFORT}}`, `{{PROMPT}}`; quote-aware parsing precedes injection.
  Optional `[[VARIABLE … ]]` / negated guards preserve flag/value semantics.
  Legacy custom argv migrates losslessly; exact pristine bases gain effort slots.
  OpenCode defaults to `openai/gpt-6-luna` / `medium`, Codex to `gpt-6-luna` /
  `medium`; explicit existing customizations remain intact. Codex's local catalogue
  confirms that identifier/effort; CLI help/docs inspected without model calls.
- Changed: user superseded the dev-only request: **Diagnostics is in all builds**.
  Off-by-default session-only command/stdin preview uses the native build compiler,
  launches only after Run build, and preserves input on Cancel. No raw preview
  logging/persistence. Executable discovery is now in Diagnostics too.
- Validated on macOS arm64: frontend production build, 34 frontend tests, 37 native
  tests in release mode (including preview/IPC contracts), strict all-target/all-
  feature Clippy, rustfmt, and diff checks. Eleven browser workflows pass, with
  dark/light Settings/toolbar/template/preview screenshots reviewed. Test server
  now uses 1421 to leave the user's 1420 dev server untouched.
- Rebuilt unsigned `src-tauri/target/debug/bundle/macos/Ramble.app` successfully.
  No real CLI/model runs or native desktop interactions; Windows remains deferred.
- Next: restart native dev/app to load the new native preview command/schema;
  try Settings → Presets and Diagnostics on a real user-initiated build. See
  `doc/SPEC.md` / `doc/VALIDATION.md` for authoritative behavior and remaining gates.

## 2026-10-25 — OpenCode V2 completion parsing and terminal replay quoting
- Reproduced: a synthetic fixture matching the user's 2.1.4 event shape failed
  the old parser with “no completed message”; it required a step_finish event
  absent from the supplied excerpt. No private source text/raw logs were saved.
- Changed: accept the last started step's completed text parts (time.start/end)
  after clean process exit/pipe drain, while retaining explicit stop-marker support.
  Replace repeated part-ID snapshots, invalidate earlier results on new steps,
  and reject unfinished/tool-only/error/non-stop/malformed output. Fake coordinator
  tests ensure nonzero exit, timeout and cancellation never accept printed text.
- Changed: Diagnostics uses separate terminal replay quoting, not template escaping.
  macOS sh/zsh synthetic replay tests preserve JSON braces/brackets, apostrophes,
  Unicode, newlines, backslashes and expansion-looking data. Production builds still
  spawn directly, without a shell. UI identifies the replay terminal/separate stdin;
  PowerShell rendering exists but Windows remains unvalidated.
- Validated on macOS arm64: frontend build and 34 frontend tests; 42 offline native
  tests in debug/release, including normal saved-template execution of the fake V2
  stream and sh/zsh replay. Eleven browser workflows, strict all-target/all-feature
  Clippy, rustfmt and diff checks pass. Rebuilt unsigned
  `src-tauri/target/debug/bundle/macos/Ramble.app` successfully.
- Next: copy any unsaved notes before restarting Ramble, then retry a user-initiated
  real OpenCode build. No agent-initiated model calls or desktop interaction tests.

## 2026-10-25 — Universal JSON response and consent-based failure diagnostics
- Changed: prompt v2 uses a fresh per-build response ID and exact two-field JSON
  contract. Removed harness-specific output parsers/settings/UI; shared bounded
  extraction supports noise/fences, generic JSON envelopes and encoded strings,
  duplicate deduplication and conflict/schema rejection. Schema 5 preserves custom
  commands/presets; pristine Codex/Claude use final-text output, OpenCode retains
  `--format json` transport without event-specific decoding.
- Changed: unsuccessful exits/invalid responses offer View harness output / Not now.
  Raw stdout/stderr stays private until consent, bounded to 256 KiB per stream
  including UTF-8 replacement expansion/omission markers; memory-only single-read
  cache clears on viewing/dismissal, next build, new draft and quit. Last successful
  message remains available. Updated SPEC/TECH_SPEC/README and validation docs.
- Validated on macOS arm64: production frontend build, 37 frontend tests, 47 offline
  native tests in debug/release (including limits/migration/diagnostics lifecycle), strict
  all-target/all-feature Clippy, rustfmt and diff checks. Reviewed minimum-size
  failure-output browser screenshot: literal text, privacy warning, scrollable dialog.
- Validated: 12 browser workflows; rebuilt unsigned
  `src-tauri/target/debug/bundle/macos/Ramble.app` with
  `npm run tauri -- build --debug --bundles app --no-sign --ci`.
- Unfinished: no real-model calls or native desktop interactions; Windows remains
  unvalidated. See `doc/VALIDATION.md` for release gates. No commits or pushes.
- Next: copy unsaved notes before restarting the native app/dev host, then try a
  user-initiated OpenCode build and inspect the offered output if it fails.

## 2026-10-25 — Simplified response, lean navigation, sizing and quick-copy motion
- Changed: prompt v3/extraction uses only `ramble_response`, no response/build ID.
  Kept bounded generic decoding, strict single-key validation, literal fidelity,
  duplicate/conflict checks and consent-based failure diagnostics. Run IDs remain
  internal. Response-shaped JSON echoed from source/logs can match: accepted
  simplification tradeoff, documented in SPEC/TECH_SPEC.
- Changed: Thoughts has no secondary navigation row. Message has Back/status/Copy;
  View message in the composer footer reopens without rebuilding. Command/Ctrl+Enter
  builds in Thoughts; in Message it copies then hides (never quits/cancels a run).
  Failures/no result do not hide. Both shortcut hints use the existing footer.
- Changed: schema 6 adds default/per-app width/height, independent blank inheritance,
  sizing before anchor/scale/clamp, preserved saved sizes on migration, validation
  and IPC fixtures. Sizes apply on summon, not while Ramble is already focused.
- Changed: mount-only 240 ms Web Animation wipe-ins for new thoughts and successful
  results, independent of text length, disabled for reduced motion; view changes
  and edits do not replay them. No private content is persisted by animations.
- Validated: production frontend build, 50 frontend tests, 50 offline native
  tests in debug/release, strict all-target/all-feature Clippy, rustfmt and diff checks.
  All 15 browser workflows pass, including fixed-duration/reduced-motion animation,
  platform-labeled shortcuts and sizing persistence. Removed the old compact-width
  rule that hid footer hints. Reviewed dark/light capture/review, shortcut and
  minimum-size placement screenshots; browser checks do not prove native behavior.
- Rebuilt unsigned `src-tauri/target/debug/bundle/macos/Ramble.app` successfully
  with `npm run tauri -- build --debug --bundles app --no-sign --ci`.
- Unfinished/next: native placement/clipboard/hide/animation interaction and Windows
  still need manual review. No real-model calls or commits. Copy unsaved notes before
  restarting; use Settings → Placement to test sizes when summoning from other apps.

## 2026-10-25 — Make wipe-ins perceptible
- Reproduced in Chromium and WebKit: the old 240 ms ease-out was already 96.1%
  revealed at its midpoint and swept the full 608-point row, making short text
  appear almost instantly. Earlier tests verified API invocation, not visible paint.
- Changed: a fixed 400 ms linear clip/opacity wipe targets fit-content text spans.
  useLayoutEffect/backwards fill prevents a fully visible initial paint. Inserted
  thoughts scroll into view synchronously; new successful results reset preview
  scroll before paint. Ordinary navigation/edits still do not replay the effect;
  reduced motion remains respected. Updated SPEC/TECH_SPEC/validation notes.
- Validated: frontend production build, 51 frontend tests, 17 Chromium workflows,
  two additional rendered WebKit regressions sampling start/mid/end styles and
  changed pixels, plus offscreen-insertion/rebuild-scroll checks. Reviewed midway
  thought/result and finished-result screenshots, including WebKit. Diff checks pass.
- Rebuilt unsigned `src-tauri/target/debug/bundle/macos/Ramble.app` successfully.
  No Rust source changes or real-model calls; native interaction/Windows untested.
- Next: copy unsaved notes before restarting the native app and try inserting a
  short thought. Browser WebKit evidence does not replace native webview review;
  reduced-motion preferences still intentionally suppress the wipe.

## 2026-10-25 — Shortcut summons a fresh Thoughts draft
- Changed: global shortcut uses a distinct `ramble:summon` intent; tray/startup/
  second-launch/quit still use focus-only resume. Summon dismisses dialogs/previews,
  replaces the draft without confirmation, restores saved style/preset and focuses
  the composer even when Thoughts was already visible. Settings are preserved.
- Changed: `abandon_build(runId)` cancels/forgets old work and rejects a delayed
  abandoned start before spawning. The fresh composer is immediately editable;
  generation waits for the old request/cleanup. Draft/run guards prevent late
  results, diagnostics, previews and copy replies from reviving/hiding the new draft.
- Validated: frontend production build, 57 frontend tests (mocked native events),
  52 offline native tests plus the desktop-intent test (53 with all features),
  strict all-target/all-feature Clippy, rustfmt and diff checks; 17 Chromium workflows.
  No real-model calls or OS shortcut/desktop interaction tests; Windows unvalidated.
- Packaging: rebuilt unsigned `src-tauri/target/debug/bundle/macos/Ramble.app`
  successfully. No commits or pushes.
- Next: copy notes before restarting the native host, then verify the global
  shortcut from Message, Thoughts, dialogs and a running build. Tray Show should
  preserve the current draft; shortcut summon intentionally discards it.

## 2026-10-25 — Return focus after copy-and-hide
- Changed: copy-and-hide uses dedicated `hide_and_restore_focus` IPC after clipboard
  success. Native pre-show capture remembers the exact macOS NSRunningApplication
  instance or Windows HWND/PID, independently of placement/Accessibility. Repeated
  own-app summons preserve the origin; an unavailable external capture clears it.
- Changed: hide first, then request activation only if Ramble was still foreground.
  Skip terminated/invalid targets without relaunching; no auto-paste, synthetic input,
  extra permissions or persisted/serialized native focus tokens. Normal Copy,
  Escape and close retain existing behavior. Documented best-effort OS activation.
- Validated: production frontend build, 58 frontend tests, 55 all-feature native
  tests (including focus-retention/hide-ordering policy), 17 Chromium workflows,
  strict all-target/all-feature Clippy, rustfmt and diff checks. No real-model calls.
- Packaging: rebuilt unsigned `src-tauri/target/debug/bundle/macos/Ramble.app`
  successfully. Native cross-app focus return and Windows remain unvalidated;
  no desktop activation was performed by tests.
- Next: copy notes before restarting, summon from another app, build and use the
  copy-and-hide shortcut. Check placement off/no AX access, repeated summons,
  terminated origin and switching apps during clipboard IPC. No commits or pushes.

## 2026-10-25 — Explicit paste shortcut and Escape focus return
- Changed: Message Shift+Command/Ctrl+Enter copies, hides, returns focus and requests
  one OS paste gesture; its hint shares the existing footer. Normal Command/Ctrl+
  Enter still only copies/hides; Escape now uses return-focus hide without copy or
  paste. Dialog/inline-edit Escape remains local. Overlapping copy actions/repeats
  cannot queue multiple paste gestures; stale-draft replies remain guarded.
- Changed: narrow `hide_restore_and_paste` IPC with existing-permission/live-target
  preflight, two verified target-focus polls, physical key release, two-second bound
  and show/hide/quit epoch cancellation. Pure `paste.rs` gate authorizes once only.
  macOS posts a complete Command-V chord to the captured PID; Windows uses one Ctrl-V
  SendInput batch (only key-release cleanup after partial delivery, never a retry).
  No clipboard reads, Enter/send events, relaunches, automatic permission prompts
  or arbitrary keyboard API. Settings → Placement → Enable access covers macOS AX.
- Validated: frontend production build, 64 frontend tests, 58 all-feature native
  tests, strict all-target/all-feature Clippy, rustfmt, diff checks and 17 Chromium
  workflows. Reviewed compact footer hints. CGEvent signatures checked against the
  installed SDK and SendInput bindings inspected. All input/focus checks use mocks
  or pure observations; no real OS paste gesture or model request was executed.
- Packaging: rebuilt unsigned `src-tauri/target/debug/bundle/macos/Ramble.app`
  successfully; the offline-only native rerun also passed (55 tests). Real paste/
  focus, non-default layouts and Windows require opt-in manual checks.
- Next: copy notes before restarting; enable AX explicitly if needed, test the Shift
  shortcut in a disposable target field, release the keys, verify one paste/no send.
  Also check Escape focus return, denied access, app switching, held keys, re-summon
  cancellation and protected/elevated targets. No commits or pushes.

## 2026-10-25 — Changelog and gated release automation
- Changed: added Unreleased maintenance guidance in AGENTS.md, seeded
  CHANGELOG.md, and added a manual Release workflow plus a dispatch-only local
  helper. macOS Intel/Apple Silicon and Windows x64 jobs run offline checks before
  packaging unsigned DMG/NSIS installers; build-only version stamping aligns npm,
  Cargo and Tauri without committing manifest bumps.
- Changed: finalization promotes only the changelog after all jobs pass, atomically
  pushes its commit/tag with an exact source lease, and publishes notes/packages/
  checksums via an owned draft. Same-run retries guard run/source/changelog identity;
  published assets are immutable. See doc/RELEASES.md for setup and recovery.
- Validated: hermetic release-script tests (disposable remotes/fake gh/installers),
  Bash syntax checks, actionlint v1.7.12 for both workflows, and diff checks. Tests
  include branch advance/races, rejected pushes, failed upload/retry, prerelease
  flags, changelog preservation and missing/ambiguous packages. No real GitHub
  release, app installer build, native input or model call was performed.
- Next: review/commit/push, ensure repository rules permit the publish job's
  changelog/tag push, then opt in to a first hosted release run. Signing/notarization,
  hosted cross-platform execution and manual installation remain unvalidated.

## 2026-10-25 — Keyboard editing, compact thoughts and text-size preferences
- Changed: Escape in Message returns to Thoughts without hiding/cancelling work;
  Thoughts retains return-focus hide and local editor/dialog cancellation wins.
  Shared `ui/actionEnter.ts` makes plain Enter submit/save/rebuild, Shift+Enter
  multiline, and ignores repeat/IME/keyCode-229 confirmation. Forms retain HTML
  validation and busy/read-only gates; app search focuses its picker instead of saving.
- Changed: reduced thought-row padding to 10 px and added independent saved 12–28 px
  thought/message sizes in General (15/17 defaults). Schema 7 preserves older saved
  configuration. Composer/inline text shares thought size; large text grows composer
  height. Typography never changes prompts, clipboard content or result freshness.
- Verified: revision requests already include the latest successful message in
  `revision.previousText`. Added successive-edit/failure-retry/native-JSON regression
  coverage rather than altering the working prompt contract or resuming sessions.
- Validated: frontend production build, 72 frontend tests, 60 all-feature and 57
  offline-only native tests, strict Clippy, rustfmt and diff checks; 18 Chromium
  workflows including actual Shift-newlines, Enter actions and rendered sizes.
  Reviewed completed compact/large-text screenshots at 560×420. Final browser rerun
  passed and unsigned `src-tauri/target/debug/bundle/macos/Ramble.app` was rebuilt.
  No real models, OS paste or native UI validation.
- Next: save/copy unsaved notes before restarting the native host for schema 7;
  manually check keyboard flow and sizes on macOS. Windows remains unvalidated.
  No commits or pushes.

## 2026-10-25 — Persistent Compact Mode
- Changed: added a saved, off-by-default Compact Mode toolbar switch (schema 8),
  scoped minimal layout in `src/app/compact.css`, and a 360×280 native minimum.
  Keeps capture/edit/build/cancel/revise/copy/settings and recovery; hides secondary
  controls/hints, puts View message and active Cancel in toolbars, preserves font sizes.
- Changed: native settings saves/minimum updates run on the main thread and capture
  current bounds. Entry does not auto-shrink; exit grows undersized windows to the
  normal 560×420 minimum. Compact summons retain size by stripping dimensions only
  from cloned placement rules. Saved rules, draft state and active work stay intact.
- Changed: bind global keys in a layout effect so immediate post-build shortcuts
  see the committed result/view. Never stage/replace the user's existing index.
- Validated: 75 frontend tests, 62 all-feature and 59 offline-only native tests,
  strict Clippy, rustfmt, diff checks, and 21 Chromium workflows. Reviewed light/dark
  360×280 screenshots, large fonts, recovery controls and simulated macOS gutter.
  A concurrent package build invalidated rustdoc artifacts; a sequential native
  rerun passed. Keep packaging sequential after Cargo checks in the shared target.
- Packaging: rebuilt unsigned `src-tauri/target/debug/bundle/macos/Ramble.app` and
  final 21-workflow browser rerun passed. No real model calls, OS input, native
  resizing interaction, or Windows validation. No commits or pushes.
- Next: copy unsaved notes before restarting the native host; toggle the toolbar
  switch, resize compact to 360×280, reopen/summon, then exit compact and verify the
   normal minimum. Check placement/monitor clamping natively and Windows separately.

## 2026-10-25 — Windows process creation compilation fix
- Changed: pass the typed `CREATE_NO_WINDOW` constant to process-wrap 10's
  `CreationFlags`; add matching Windows-only `windows` dependency for both desktop
  and offline builds. Keep Job Object containment unchanged; update Unreleased.
- Validated on macOS arm64: 59 offline native tests, strict all-target/all-feature
  Clippy, rustfmt and diff checks. No Windows target installed; Windows compilation
  and execution are not locally validated.
- Next: rerun hosted Windows validation/release gates. No commits or pushes.

## 2026-10-25 — Replace deprecated GitHub action runtimes
- Changed: both workflows use checkout/setup-node v5, upload-artifact v6 and
  download-artifact v7; verified upstream action manifests declare Node 24.
  Keep the application build on Node 22 and existing workflow inputs unchanged.
- Validated: hermetic release-script tests and diff checks pass. Actionlint is
  unavailable on PATH; hosted workflow execution remains unvalidated.
- Next: run hosted validation to confirm deprecation warnings are gone. No commits
  or pushes in this session.

## 2026-10-25 — Hide macOS Dock presence with the window
- Changed: all window-dismiss paths share a main-thread hide helper that switches
  macOS to Accessory activation policy after hiding. Show restores Regular policy
  after external focus capture, before showing/focusing. Menu-bar/hotkey access,
  draft retention and existing focus/paste gates remain intact. Updated SPEC/changelog.
- Validated on macOS arm64: frontend production build, 62 all-feature native tests,
  strict all-target/all-feature Clippy, rustfmt and diff checks. No OS activation,
  paste, real-model calls or packaging performed.
- Next: restart the native dev host (or rebuild the installed app), then manually
  check Dock removal on close/Escape/copy/paste, rapid show/hide and reopening via
  hotkey/menu bar. Native Dock/focus behavior and Windows remain unvalidated.
- Follow-up: built the unsigned release app with `npm run tauri -- build --bundles
  app --no-sign --ci`, replaced `/Applications/Ramble.app`, and verified bundle
  contents match with `diff -qr`. Left the running debug bundle untouched; did not
   launch the installed app or discard any in-memory drafts.

## 2026-10-25 — Illustrated end-user documentation
- Changed: rewrote README around installation and the writing workflow; added
  GETTING_STARTED, USER_GUIDE, CONFIGURATION, TROUBLESHOOTING, and PRIVACY guides
  using the supplied screenshots. Moved source setup/testing into DEVELOPMENT.
  Kept engineering specs, release operations, and validation records authoritative.
- Validation: reviewed against SPEC and release artifact naming; checked local
  Markdown links/image targets. No application code, model calls, or native tests.
- Next: review rendered documentation and update installation/support claims when
  published packages and native manual validation are available. Staged user images
  were left untouched; no commits or staging performed.

## 2026-10-25 — Windows running-app enumeration compilation fix
- Changed: explicitly type the application vector as `Vec<Application>` before
  passing it through EnumWindows' opaque callback data; fixes E0282 at sorting.
  Consolidated the Windows compilation fixes in Unreleased.
- Validated on macOS arm64: 59 offline native tests, rustfmt and diff checks pass.
  Only the macOS target is installed; Windows compilation remains unvalidated locally.
- Next: rerun hosted Windows validation. No commits or pushes.
