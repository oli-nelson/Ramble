# Agent Development Guide

## Source of truth

- Read `doc/SPEC.md` before working. Keep product requirements, architecture proposals,
  acceptance criteria, and unresolved product decisions there—not in this file.
- Keep this file limited to actionable development workflow and repository
  knowledge that helps future sessions. Do not duplicate the specification or
  maintain a chronological session log here.

## Development setup

- Tauri 2 + React + TypeScript + Rust. Use `npm ci`; Node 22.12+ is required
  (tested with Node 26.12.1). Rust 1.95.0 is pinned in `rust-toolchain.toml`.
- `npm run tauri -- dev` runs the desktop app. `npm run dev:demo` explicitly
  runs an offline browser demo with temporary settings and no rewriting/model calls.
  Normal browser development does not silently replace native APIs with a mock.
- Frontend: `npm run build` (typecheck + production build), `npm test`.
- Browser workflows/screenshots: `npx playwright install chromium`, then
  `npm run test:e2e`. Screenshots go under ignored `test-results/`.
- Native offline tests: `cargo test --manifest-path src-tauri/Cargo.toml
  --no-default-features --features test-harness`.
- Native checks: `cargo check --manifest-path src-tauri/Cargo.toml` and
  `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features
  -- -D warnings`. Format with `cargo fmt --manifest-path src-tauri/Cargo.toml`.
- Native checks need built frontend assets (`npm run build`) and Tauri platform
  prerequisites. See `README.md` for setup and `doc/VALIDATION.md` for release gates.
- CLI templates are trusted, editable executable/argv configuration. Isolation
  validation is intentionally deferred, not a gate. Keep defaults tied to CLI help
  and official docs, and never claim offline fixtures prove real CLI isolation.
- Settings schema 2 migrates the old schema-1 blocked templates while preserving
  presets, styles and hotkeys. Test migrations when changing template schemas.
- Settings schema 3 adds placement defaults to schemas 1/2, preserving custom
  templates and bounds. Focus capture/placement lives in `placement.rs` and
  `desktop_platform/`; never prompt for Accessibility outside the explicit action.
- Settings schema 4 uses a single `command` string and preset `reasoningEffort`.
  Tokenize before injection; never evaluate injected values as shell/template code.
  Keep migration coverage for empty/literal args and custom optional groups;
  `src-tauri/src/legacy-templates-v3.json` identifies pristine older invocations.
- Settings schema 5 removes parser choices; `response.rs` validates the shared
  JSON response. Prompt v3 uses only `ramble_response` (no response/build ID).
  Keep extraction harness-independent and bounded.
  `legacy-templates-v4.json` identifies only pristine commands for quiet-output
  migration. Preserve custom command strings and add migration/contract tests.
- Settings schema 6 adds optional width/height to default/per-app placement rules.
  Preserve saved bounds during migration; inherit app dimensions independently,
  then scale/size before anchoring/clamping. Disabled/already-focused summons keep size.
- Failed-run stdout/stderr is private: only explicit-consent IPC may return bounded
  excerpts. Test consumption/discard/next-build/quit lifecycle; never log output.
- Keep shortcut `ramble:summon` (fresh draft) distinct from `ramble:focus` (resume).
  Join abandoned-run cleanup before enabling generation, guard late IPC by draft/run
  identity, and do not reset drafts from tray/settings/quit or second-launch paths.
- Copy-and-hide uses `hide_and_restore_focus`, not normal hide. Keep return targets
  native-only/transient, capture before activation even with placement disabled,
  preserve the origin on own-app summons, and do not prompt for Accessibility,
  relaunch targets or steal focus after the user has switched apps.
- Escape also uses return-focus hide. Only explicit Message Shift+Command/Ctrl+Enter
  may call `hide_restore_and_paste`; test `paste.rs` gates with fake observations.
  Wait for verified target focus/key release, cancel on epoch/focus/timeout changes,
  and never retry a potentially delivered chord or run real input injection in tests.
- Diagnostics and invocation preview are end-user tools available in all builds.
  Keep preview state/toggle in memory only; never log commands, stdin or prompts.
- Playwright uses its own demo server on port 1421 (`RAMBLE_E2E_PORT` override),
  so it does not stop or reuse the user's native dev server on 1420.
- macOS overlays native window controls in the app toolbar; its window config is
  in `src-tauri/tauri.macos.conf.json`. Keep shared dimensions in sync with the base
  config. Windows retains native decorations; native Windows validation is deferred.
- `src/domain/builtins.json` is the shared Rust/frontend defaults resource. IPC
  fixtures live in `tests/fixtures/contracts.json`; preserve contract tests when
  changing Rust/TypeScript command types. No draft data belongs in settings.
- The `test-harness` feature enables the fake CLI and a native-only fixture path;
  it must not be included in production packaging or exposed through IPC.
- Keep Cargo's `package.default-run = "ramble"`: Tauri dev invokes `cargo run`
  without `--bin`, and the package also declares the fake-harness binary.

## Working practices

- Read `AGENT_HANDOVER.md` at the start of each session. Before ending a session
  with meaningful development progress, append brief dated notes: what changed,
  validation performed, unfinished work/blockers, and the next useful action.
  Keep notes concise and actionable; link to authoritative documents instead of
  repeating specifications. Do not include secrets, private prompts, or raw logs.
- Preserve unfamiliar user changes and keep work within the requested scope.
- Verify external CLI behavior against the installed version and official docs;
  do not guess flags. Record supported versions and tested invocations alongside
  the adapters so they stay tied to the implementation.
- Use offline fixtures and fake subprocesses for routine tests. Real model runs
  require opt-in because they can transmit data and incur cost.
- Report what was actually validated. Distinguish documentation review, automated
  tests, and platform-specific manual checks; never infer Windows validation from
  a macOS run.
