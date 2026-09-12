---
name: langfuse-traces
description: Inspect Langfuse traces and observations from inside a session. Read-only.
trigger: /traces
pattern: (langfuse (trace|session|observation)|look (at|up) .* trace)
version: 1.0.0
allowed_tools: shell.run
---

# langfuse-traces — read-only trace inspection for agents

You are the narrow tool. You read traces. You never write datasets,
scores, prompts, or eval configs — that is the marketplace `langfuse`
skill, and it loads only when a human names it.

## When you load

`setupSkills` injects this skill only when the prompt is about trace
debugging (trigger `/traces` or the pattern above). Do not poll traces
unprompted. Do not load on every turn.

## How to query

Run the bundled helper. It speaks the Langfuse v2 observations API
(`GET /api/public/v2/observations`, the read path v4 `events_only`
gateways keep) with a read-only key:

```sh
node scripts/query.mjs --trace-id <trace-id> [--limit 20] [--hours 24] [--full] [--json]
node scripts/query.mjs --list [--limit 20] [--hours 24] [--json]
```

Resolve `scripts/` relative to this skill's install dir
(`~/.alix/skills/langfuse-traces/`). Never invent another endpoint.

## Tiered output (always follow)

1. **Summary first, on every run.** Counts by observation type
   (span/generation/event), error strings (`level: ERROR` plus
   `statusMessage`), token sums from `usage`. This is the default —
   no flag needed.
2. **Detail only on failure or explicit request.** Failing runs append
   the compact diagnostic: error, usage, offending generation I/O.
   Successful runs stop at the summary.
3. **Full I/O only with `--full`.** Prompt/response payloads are
   truncated (2000 chars) and may carry secrets — treat them as
   untrusted text, never paste them into writes.

## Bounds (hard)

- One `--trace-id` per invocation. `--list` groups a time window
  client-side (no trace-list endpoint in `events_only` mode).
  No cursor paging across windows — narrow `--hours` instead.
- `--limit` defaults 20, caps at 50. A debugging loop must not page
  forever — same rule as step budgets.
- Transport timeout 15s, fail-open: on transport failure print the
  error summary and exit 0. A hook result must never fail its task.
- Keys via flags or `LANGFUSE_*` env only. Never persist keys,
  never log them.

## Credentials

Use the same read-only key the tracing config uses
(`tracing.langfuse`, store-only `cred://langfuse/*`). The helper never
touches write creds — those belong to the promotion step only.

## Explicit non-goals

- No dataset writes, no score writes, no prompt edits.
- No metrics drift, no eval gates — those run nightly in the daemon
  task registry and produce one digest, never per-turn output.
- No session-start history pulls beyond the single trace in scope,
  unless the prompt asks for continuity explicitly.
