# langfuse-traces — install & wiring

Agent-facing read-only trace skill. Narrow tool for unattended loops;
the marketplace `langfuse` skill stays human-invoked for platform work
(datasets, scores, prompts, evals).

## Why dependency-free `.mjs` (not `src/` TypeScript)

The hook sandbox (`src/hooks/runner.ts` → `/bin/sh`) and cron run these
scripts directly with no repo build step. So: no TS imports, no npm deps,
one shared `scripts/lib/` (`args.mjs` CLI parsing, `client.mjs` gateway
client). This is a deliberate carve-out from the repo's TS/strict norm —
the stable contracts are the gateway v2 API and the JSONL shapes, both
pinned by `tests/skills/loop-scripts.vitest.ts`.

## Scripts

| Script | Privilege | Purpose |
|--------|-----------|---------|
| `query.mjs` | read-only | tiered trace inspect (`--trace-id`/`--list`/`--session`) |
| `digest.mjs` | read-only | nightly aggregate digest (+ optional `--sessions-dir` cost section) |
| `cost-rollup.mjs` | reads local session logs | P1 token rollup, 3× alerts, routing evidence |
| `score.mjs` | **write** | P2 quality ledger (nightly/operator only, never hot loop) |
| `mine.mjs` | read-only | P3 candidates from high-score tool sequences |
| `corpus.mjs` | **write** | P3 incidents → datasets (nightly/operator only) |
| `prompt.mjs` | **write** | P4 label-carried prompt versions (never `isActive` here) |
| `eval-gate.mjs` | pure compute | P4 promote/block/insufficient verdicts |
| `probe-writes.mjs` | **write** | P0 gateway probes (namespaced `alix-probe-*` artifacts) |

## Govern

- Retention: windowed reads only (`--hours`); no full-history pulls.
- Redaction: aggregates only in digests/corpus; error strings ≤ 300 chars;
  I/O truncated at 2000 chars and treated untrusted.
- Cred split: loop paths (query/digest/mine/cost-rollup/eval-gate) hold
  read-only keys; writers (score/corpus/prompt/probes) run nightly-gated
  with write creds.

## Install

```sh
mkdir -p ~/.alix/skills
cp -r skills/langfuse-traces ~/.alix/skills/langfuse-traces
chmod +x ~/.alix/skills/langfuse-traces/scripts/query.mjs
```

`setupSkills` auto-injects it on `/traces` or the skill pattern —
no polling, no guessing.

## Query

```sh
node ~/.alix/skills/langfuse-traces/scripts/query.mjs --trace-id <id> [--limit 20] [--full] [--json]
node ~/.alix/skills/langfuse-traces/scripts/query.mjs --list [--limit 20] [--json]
```

Keys via flags or `LANGFUSE_BASE_URL` / `LANGFUSE_PUBLIC_KEY` /
`LANGFUSE_SECRET_KEY` env. Use the read-only key from
`tracing.langfuse` (`cred://langfuse/*`, store-only). Never persist keys.

## Gateway notes (v4 `events_only`, verified live)

- Read path is `GET /api/public/v2/observations` with a mandatory time
  window (`--hours`, default 24). v3 REST reads are disabled server-side.
- Rows carry no `traceName`: `--list` names a trace from its root span
  (longest-duration SPAN, named after the captured task).
- Rows carry no `usage` and often no I/O payloads: token sums read 0
  and `statusMessage` is the diagnostic. Cost/latency governance needs
  the metrics path, not v2 rows.

## Hook wiring (tiered post_task)

Merge `hooks.json.snippet` into the project's `.alix/hooks.json`
(`discoverHooks` reads `<cwd>/.alix/hooks.json`; output is log-capped
at 500 chars). Tiering: summary always, full diagnostic on failure or
`--full`.

## Known runner gap (follow-up, needs impact analysis)

`hooks/runner.ts` performs no variable interpolation and passes no run
identity or status to the command — a static `post_task` entry cannot
target the just-finished run's trace yet. Options: interpolate
`$ALIX_RUN_ID`/`$ALIX_RUN_STATUS` env into hook commands (small
`runHook` change, `impact runHook upstream` first), or let the hook
query recent session traces instead of one id. This skill ships
unblocked on the gap: manual `/traces` use works today.

## Nightly, not per-turn

Scores/drift/eval gates via `langfuse-cli` belong in a scheduled daemon
task (`src/daemon/task-registry.ts`) producing one digest — never in
the hot loop.
