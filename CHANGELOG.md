# Changelog

Noteworthy changes to Ramble are recorded here. Add entries under Unreleased;
the validated release workflow moves them into a dated version section and creates
a fresh Unreleased section. Released versions are listed newest first.

## [Unreleased]

- Add an animated README demo showing the notes-to-message-to-paste workflow.

## [0.1.0] - 2026-10-25

- Add a user-focused README with an illustrated usage guide, plus getting-started,
  configuration, privacy, and troubleshooting guides and separate development instructions.
- Hide the macOS Dock icon when Ramble's window is dismissed; restore it when
  reopened, keeping menu-bar and hotkey access available in the background.
- Add a compact desktop workspace for capturing thoughts, generating messages
  through configurable agent CLIs, and refining the latest generated message while
  keeping drafts in memory. Include denser thought rows and separate saved font sizes
  for thoughts and generated messages.
- Support reusable model presets, editable command templates, and opt-in diagnostics.
- Add global fresh-draft summons, per-app window placement and sizing, and shortcuts
  to copy, return focus, or explicitly paste once into the original app.
- Make Escape go back from Message to Thoughts, hiding only from Thoughts. Use Enter
  for text-field actions and Shift+Enter for newlines, including inline/message edits
  and settings, without submitting during text composition or key repeats.
- Add a persistent Compact Mode toolbar switch with a minimal writing/revision UI
  and a 360×280 window minimum. Keep drafts, running builds, chosen text sizes and
  error recovery intact; restore secondary controls when switched off.
- Add tested, manually requested macOS and Windows release packaging, with changelog
  promotion and release notes only after all automated release checks pass. Use
  Node 24-based GitHub actions to avoid deprecated action runtimes.
- Fix Windows compilation errors in running-app enumeration and CLI process
  creation, preserving hidden console windows and process-tree containment.
