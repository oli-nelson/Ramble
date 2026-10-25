# CLI invocation and response-contract evidence

Last inspection: 2026-10-25, macOS arm64. **Execution enabled; isolation validation
deferred.** Agent checks use installed help/version output and offline fixtures,
not real model calls, integration canaries or latency benchmarks.

| Starting command | Installed version inspected | Local help inspected |
| --- | --- | --- |
| OpenCode | v2.1.4 | `opencode run --help` |
| Codex | codex-cli 0.164.0 | `codex exec --help` |
| Claude Code | 2.1.286 | `claude --help` |

## One result contract, no harness-specific parsers

The current prompt (v3) requests exactly one string field:

```json
{"ramble_response":"The finished message."}
```

No build ID is sent or expected; internal run IDs still own each subprocess and
diagnostic cache. `response.rs` scans JSON among text/fences and decodes generic
JSON/JSONL objects, arrays and JSON-encoded strings. It knows no CLI event names or
envelope paths. Only the exact single-key schema/nonblank string qualifies; duplicate
keys/extra fields/conflicting answers fail, identical copies deduplicate. The key
is not proof of origin: echoed source/logs containing valid responses can match.
No complete valid example is included in the prompt. Native execution must exit successfully and
complete cleanup before extraction. Stderr never supplies a successful response.

Offline tests exercise unknown nested envelopes, logs, fences, escaped strings,
wrong keys, duplicates/conflicts, malformed/schema-invalid responses, ordinary prompt echoes,
complexity limits and exact message fidelity. Fake subprocess/coordinator tests
cover stdin/argv transports, unsuccessful exits despite matching stdout, timeouts,
cancellation and opt-in diagnostics cache lifecycle. No real-model compatibility
or integration isolation is inferred from these fixtures.

## Editable starting invocations

Exact command strings live in `src/domain/builtins.json`. Schematically, without
optional model/effort groups:

```text
opencode run --standalone --format json PROMPT
codex exec --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check --sandbox read-only -
claude --print --output-format text --safe-mode --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disable-slash-commands --no-session-persistence --permission-prompts none
```

OpenCode uses one prompt argv element. Codex/Claude use stdin. Commands are parsed
before `{{MODEL_ID}}`, `{{REASONING_EFFORT}}` and `{{PROMPT}}` injection and launched
directly, not through a shell. Codex/Claude use final-text modes; OpenCode retains
JSON transport to avoid terminal presentation assumptions. The model is instructed
to emit Ramble JSON, independently of CLI output envelopes. Generic nested decoding
does not depend on event names or envelope paths. Schema 5 drops old parser
properties and updates only exact pristine invocations, preserving custom commands.

Help confirms OpenCode's `json` output format and `provider/model#variant`,
Codex's optional JSON-event flag, stdin (`-`) and `-c` config override, and Claude's
print/text output plus `--effort`. Codex's local model catalogue lists `gpt-6-luna`
with `medium` supported/default, and official config docs specify
`model_reasoning_effort`. OpenCode defaults to `openai/gpt-6-luna` / `medium`, Codex
to `gpt-6-luna` / `medium`; combined real-model runs still require user opt-in.

## Trust and validation limits

- Templates can run any trusted executable/argv. CLI auth/config/provider discovery
  is inherited; managed settings and integrations may still apply. No auto-login,
  paid preflight or per-build version probe occurs.
- A private server/neutral cwd is not integration isolation. Do not use OpenCode's
  `--auto` or permission-bypass flags. Codex's read-only sandbox is not tool denial.
- Claude safe mode preserves ordinary auth; managed policy can still apply. Bare
  mode changes auth discovery and is not substituted silently.
- Failed-response/exit diagnostics ask before exposing bounded stdout/stderr
  excerpts. They may contain secrets; normal errors contain no raw output. Viewing,
  dismissal, next build, new draft or quitting discards the retained excerpts.
- Terminal replay strings use shell-specific quoting only for display. Synthetic
  sh/zsh tests run the fake harness and preserve literal JSON/apostrophes/newlines/
  backslashes/expansion-looking text. PowerShell rendering is unvalidated on Windows.
- The earlier user-supplied OpenCode 2.1.4 completed-text/no-step_finish excerpt
  exposed a parser mismatch. Those event parsers have now been removed, not widened
  into a compatibility promise. Retry the new JSON response contract explicitly.

Before release, opt-in native tests must still establish actual CLI model output,
auth behavior, latency, provider retention, owned helper cleanup, and integration
inheritance. Inert canaries/process observations are needed for isolation claims;
absence of tool events in stdout is not proof. Windows validation remains deferred.

## References

- https://opencode.ai/v2/docs/cli
- https://opencode.ai/v2/docs/config
- https://code.claude.com/docs/en/cli-reference
- https://developers.openai.com/codex/config-file/config-reference
- https://docs.rs/process-wrap/10.0.1/process_wrap/
