# Developing Ramble

For installation and everyday use, start with the [README](../README.md).
This guide covers source builds and contributor workflows.

## Prerequisites

- Node **22.12+** and npm (also tested with Node 26.12.1).
- Rust **1.95.0**, pinned by `rust-toolchain.toml`.
- [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/):
  Xcode Command Line Tools on macOS; MSVC and WebView2 on Windows.

No CLI authentication is needed for offline development/tests. Real model runs
require explicit opt-in because they may send data and incur charges.

## Run the desktop app

From the repository root:

```sh
npm ci
npm run tauri -- dev
```

The app uses the menu bar/tray and hides on close. Use **Settings → Quit Ramble**
to exit. Copy unsaved drafts before restarting the native host.

### Offline browser demo

```sh
npm run dev:demo
```

Open `http://127.0.0.1:1420`. The explicitly labeled demo joins thoughts without
rewriting and never launches a CLI or calls a model. Settings reset on reload.
Normal `npm run dev` requires the native desktop host; it does not silently use
fake output. Browser behavior is not evidence of native desktop behavior.

## Validate

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-harness
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Native checks need built frontend assets and Tauri prerequisites. The
`test-harness` feature builds a synthetic CLI and must not ship in production.
Use offline fixtures/fake subprocesses for routine testing; they do not prove
real CLI isolation or model compatibility.

Playwright uses a separate demo server on port **1421** (`RAMBLE_E2E_PORT` can
override it), leaving a native dev server on 1420 untouched. Screenshots go to
ignored `test-results/`. Browser tests do not validate native hotkeys, focus,
clipboard, paste, or Windows behavior.

## Build and release

After native checks have completed, build packages sequentially in the shared
target directory:

```sh
npm run tauri -- build
```

Versioned release operations are documented in [RELEASES.md](RELEASES.md).
From clean, committed, pushed source, the local helper dispatches the workflow:

```sh
bash scripts/release.sh 0.1.0
```

Only after all release gates pass does CI promote Unreleased notes and publish
packages. Packages are unsigned and macOS packages are not notarized. Signing,
minimum OS support, the app identifier, and native manual checks remain release
approval work; automated packaging does not certify platform support.

## Engineering references

- [Product specification](SPEC.md): requirements and acceptance criteria
- [Technical design](TECH_SPEC.md): architecture and implementation details
- [Validation record](VALIDATION.md): evidence and remaining release gates
- [CLI adapter validation](adapters/VALIDATION.md): supported invocations and limits
- [Visual identity](brand/README.md): brand assets and usage
- [Agent development workflow](../AGENTS.md) and [handover notes](../AGENT_HANDOVER.md)

Keep user instructions in the user guides, requirements in SPEC, and test evidence
in the validation records. Maintain concise user-facing changes under
[CHANGELOG.md → Unreleased](../CHANGELOG.md); leave released sections unchanged.
