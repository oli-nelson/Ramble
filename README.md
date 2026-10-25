# Ramble

A floating scratch conversation for turning rough thoughts into one message.
Tauri 2 · React · TypeScript · Rust. macOS Apple Silicon and Windows x64 targets.

## Current status

The capture/review interface, in-memory draft state, preset management, native
settings, menu-bar/tray lifecycle, shortcut registration, and clipboard commands
are implemented. Real builds launch saved command templates through a bounded
native process supervisor. OpenCode, Codex, and Claude Code are editable starting
templates; users can create templates for other installed programs.

Commands are **trusted configuration, not a sandbox**. They inherit the app's
environment and normal CLI authentication and may load integrations or send
content to remote providers. Isolation checks are not an execution gate. Default
flags are based on CLI help/docs, with offline parser fixtures—not real model
smoke tests. See [`doc/adapters/VALIDATION.md`](doc/adapters/VALIDATION.md).

## Develop

Prerequisites: Node 22.12+ (tested with 26.12.1), npm, Rust 1.95.0 (pinned), and
the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).
On Windows install the MSVC toolchain and WebView2. On macOS install Xcode
Command Line Tools. No CLI authentication is needed for offline development.

```sh
npm ci
npm run tauri -- dev
```

The desktop app uses the menu bar/tray, is always on top, and hides on close.
Use Settings → Quit Ramble to exit. The default shortcut is
`Control+Shift+Y` on both platforms (the actual Control key on macOS, not Command).
Existing saved shortcuts are preserved; change them in Settings if needed.
Pressing the summon shortcut starts a **fresh draft in Thoughts** and focuses the
empty input, even if Ramble is already open. It discards the prior draft without
confirmation and cancels an active build; you can type while its cleanup finishes.
To resume an existing draft instead, use **Show Ramble** in the tray/menu bar.
A registration failure appears in the UI; the
tray remains available.

On macOS the title bar overlays Ramble's toolbar, with native traffic lights,
rounded corners and shadow. Drag the logo/toolbar space to move the window.
Windows retains its native title bar for now; native Windows validation is deferred.

The compact Thoughts/Message workspace defaults to **640×480** (minimum 560×420).
Existing saved sizes are preserved; resize an older window to try the shorter layout.
Thoughts has no tab row; Build sits beside the composer. Message has Back to thoughts,
status and Copy. View message below the composer reopens your last result without
rebuilding. New thoughts and generated results have a fixed-duration wipe-in,
disabled when your system requests reduced motion.
In Message, **⌘ Enter** (macOS) / **Ctrl+Enter** (Windows) copies the last successful
message then hides Ramble—not quits—and returns focus to the app you opened it
from. This works without enabling placement or Accessibility access; a closed app
is not relaunched, and an intervening app switch is not overridden. OS activation
rules may limit restoration. Copy failure leaves the window open; your
draft and any active rebuild are preserved. The shortcut stays Build in Thoughts.
Both views show the matching shortcut in the existing footer without adding height.
**⌘⇧ Enter / Ctrl+Shift+Enter** in Message also pastes once into the original app
after focus returns and you release the shortcut keys. On macOS, first enable
Accessibility in **Settings → Placement → Enable access**; the shortcut never
opens a permission prompt itself. It cancels rather than pasting if focus/target
changes or keys remain held for two seconds. Apps/OS policy may reject synthetic
input; you can still paste the copied message manually. Ramble never presses Enter.
**Escape** also returns focus to the original app when hiding, without copying or
pasting; Escape in an editor/dialog still cancels that editor/dialog first.

### Focused-window placement

Settings → Placement controls nine-point anchoring and signed logical-point
offsets, with optional rules for applications chosen from a searchable running-app
list or the last focused app. Summon captures focus before activating Ramble and
clamps to the display's usable area. Already-focused summons do not reposition it.
Set default width/height there and override either dimension per application.
Sizes apply on summon before anchoring; blank app dimensions inherit defaults,
blank defaults keep the current size. Width: 560–4096; height: 420–4096 logical
points, clamped to the display. Existing saved sizes become the sizing defaults
during migration; disabled/already-focused placement does not reset your size.

On macOS choose **Enable access** to request Accessibility permission for exact
window geometry. Ramble never prompts automatically or reads window titles/content.
Without access/geometry it uses a display fallback and explains why. Selected app
identities/rules persist; running-app lists and focus metadata do not.

## Configure a command

- Use **Settings → Templates** to create/edit a command template in one textarea,
  e.g. `my-cli --model {{MODEL_ID}} --effort {{REASONING_EFFORT}} {{PROMPT}}`.
- The first word is the executable; quote paths/arguments containing spaces.
  Ramble parses the command before substituting values and never starts a shell.
  Injected quotes, newlines, shell-looking text and further placeholders stay literal.
- Choose stdin transport, or include exactly one `{{PROMPT}}` for argv transport.
- To omit optional flags when a preset field is blank, use
  `[[MODEL_ID --model {{MODEL_ID}} ]]` or
  `[[REASONING_EFFORT --effort {{REASONING_EFFORT}} ]]`. A `!` before the guard
  applies a section when its field is blank. Escape literal opening braces/brackets
  with a backslash; `""` preserves an empty argument. Pipes/redirects are not executed.
- Every command uses one response format. Ramble's prompt requests
  `{"ramble_response":"The finished message"}`. No build ID is required.
  No parser selection or built-in harness output handling is needed. Pass the
  generated prompt unchanged to the model; final-text/print mode is simplest.
- Ramble finds matching JSON amid logs/fences or generic JSON envelopes/encoded
  strings, validates its exact single-key schema, and copies only that value. Missing,
  invalid or conflicting responses fail; identical duplicates are accepted. The key
  is not proof of origin: response-shaped JSON echoed from notes/logs can match.
  A failed exit never becomes success.
- **Settings → Presets** manages creation/duplication/deletion and lets you edit
  Model ID and Reasoning Effort directly on existing presets. Save settings to
  apply changes; the main toolbar only selects presets. A new template becomes
  available there as a preset base; editing a template marks old results stale.
- Use an executable runtime for scripts (e.g. `node.exe` with a script path argument
  on Windows), not `.cmd`/`.bat` wrappers. Authenticate CLIs outside Ramble first.

OpenCode defaults to **openai/gpt-6-luna / medium**; Codex defaults to
**gpt-6-luna / medium**. The OpenCode starting command composes `model#effort`;
Codex uses `-c model_reasoning_effort="medium"`. Exact support depends on the CLI
and model. Existing explicit customizations are preserved.

Saved schema-1/2/3/4/5 settings migrate to schema 6. Legacy argv templates are converted
losslessly to command strings; untouched built-ins gain effort options, while
custom invocations keep their behavior. Empty pristine default presets gain the
Luna defaults. The original file is backed up on the next settings write.
Old parser settings are removed. Pristine Codex/Claude commands use final-text
output; OpenCode keeps JSON transport, decoded by the same generic extractor.
Custom commands remain unchanged, but their output must now satisfy Ramble's JSON
contract rather than returning arbitrary plain text.
Schema 6 adds sizing preferences without changing custom commands, preset values,
placement anchors/offsets or saved bounds.

### Diagnostics

**Settings → Diagnostics** is available in all builds. Enable **Preview generated
command before build** to inspect the resolved command and any stdin prompt before
Build/Rebuild launches a process. **Run build** continues; **Cancel** preserves
your notes without launching. The toggle is off by default, applies immediately,
and resets on restart. Private previews stay in memory and are never logged/saved.
Executable discovery also checks the saved preset locally without starting its CLI.
Replay commands are quoted for zsh/bash on macOS or PowerShell on Windows; supply
any displayed stdin separately. Ramble's own execution never goes through a shell.

After a bad response or failed harness exit, Ramble asks whether to **View harness
output**. It fetches stdout/stderr only after you consent. These may contain notes,
prompts or credentials. Excerpts are limited to 256 KiB per stream, kept in memory,
and discarded after viewing/dismissal, the next build, new draft or quit. They are
never logged or saved, and the last successful message remains available.

For a **browser-only offline UI demo**, explicitly run:

```sh
npm run dev:demo
```

Open `http://127.0.0.1:1420`. The labeled demo joins thoughts without rewriting;
it never calls a model or launches a process. Demo settings are in memory and
reset on page reload. Normal `npm run dev` requires the native desktop host and
does not silently substitute fake model output.

## Validate

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-harness
cargo check --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

The `test-harness` feature builds a synthetic test binary. It is not present in
normal desktop builds. Playwright writes review screenshots under `test-results/`.
Browser tests do not validate native hotkeys, focus, clipboard, or Windows behavior.
They run a separate demo server on port 1421 (`RAMBLE_E2E_PORT` overrides it),
leaving an existing desktop dev server on port 1420 untouched.

```sh
npm run tauri -- build
```

For versioned macOS and Windows packages, use the manually requested
[release workflow](doc/RELEASES.md): `bash scripts/release.sh 0.1.0` from a clean,
committed and pushed branch. It promotes [Unreleased notes](CHANGELOG.md) only
after all release builds/tests pass. Packages remain unsigned and macOS builds
are not notarized. The app identifier `com.ramble.desktop`, minimum OS support,
signing/notarization and native manual checks still need release approval.

## Privacy

Drafts, style overrides, edit instructions, and messages live only in memory.
Hiding preserves them; quitting or a crash loses them. Only versioned settings
are stored in the platform application-data directory under the app identifier.
Unreadable/future settings are preserved and made read-only, with visible recovery
instructions. No prompt/output logging, telemetry, API-key storage, or clipboard
reading is implemented. External providers and clipboard history tools have their
own retention policies.

## Source of truth

- [Product specification](doc/SPEC.md)
- [Technical design](doc/TECH_SPEC.md)
- [Visual identity](doc/brand/README.md)
- [Release validation checklist](doc/VALIDATION.md)
- [Development workflow](AGENTS.md)
