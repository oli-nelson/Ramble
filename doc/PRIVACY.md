# Privacy and your data

[Back to README](../README.md)

## What Ramble keeps

**Drafts stay in memory, not a saved history.** Thoughts, generated messages,
session-style overrides, and revision instructions survive hiding the window,
but are lost when you quit or the app crashes. The fresh-draft shortcut discards
the previous draft. Copy anything you need to keep.

Ramble saves preferences in your platform’s application-data directory under
`com.ramble.desktop`: styles, templates, presets, shortcut, appearance, text sizes,
Compact Mode, window bounds, and placement rules. Saved app overrides include app
identities; the running-app list and captured focus target are transient.

Ramble does not implement telemetry, default prompt/output logging, API-key
storage, or clipboard reading. Copying places the message on your system
clipboard, where other apps and clipboard-history tools may retain it.

## What leaves the app

When you build, Ramble passes your thoughts and style to the configured CLI.
An instructed revision also includes the latest successful message and your
additional edit. **The CLI may send this content to remote providers.** Their
retention, account settings, and charges apply separately from Ramble.

Commands run with your permissions and inherit the app’s environment, normal CLI
authentication, and potentially CLI configuration and integrations. Templates are
trusted executable configuration, **not a sandbox or a guarantee of isolation**.
Prompts passed as arguments may be visible in OS process listings; stdin avoids
that particular exposure when supported by your CLI.

## Permissions and other applications

Placement uses app identity and window geometry, not window titles or contents.
On macOS, exact geometry requires explicitly enabled Accessibility access.
Normal Copy and copy-and-hide do not need that permission.

Only the explicit Message **Command+Shift+Enter / Ctrl+Shift+Enter** shortcut
requests a paste gesture into the original app. Ramble never presses Enter or
Send. Focus return and paste are guarded but still subject to OS/app restrictions.

## Diagnostics are opt-in

Command previews may contain your complete prompt. They stay in memory and are
not logged or saved. The preview toggle resets on restart.

Failed-run output is private unless you choose **View harness output**. It may
include prompts or credentials. Excerpts are bounded, session-only, and discarded
after viewing/dismissal, the next build, a new draft, or quitting. Review and
redact anything you decide to share. See [troubleshooting](TROUBLESHOOTING.md).
