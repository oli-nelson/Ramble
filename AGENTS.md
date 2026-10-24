# Agent Development Guide

## Source of truth

- Read `SPEC.md` before working. Keep product requirements, architecture proposals,
  acceptance criteria, and unresolved product decisions there—not in this file.
- Keep this file limited to actionable development workflow and repository
  knowledge that helps future sessions. Do not duplicate the specification or
  maintain a chronological session log here.

## Current development state

- Planning only. Do not scaffold, install dependencies, or implement until asked.
- No toolchain or build/lint/test commands have been established. Once they
  exist, document the verified commands and any non-obvious setup here.

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
