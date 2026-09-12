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
| `mine.mjs` | read-only (+ local `--factory-out` file) | P3 candidates from high-score tool sequences; `--factory-out` feeds `alix skills distill-from-traces` |
| `corpus.mjs` | **write** | P3 incidents → datasets (nightly/operator only); mirror-backed exact-duplicate rejection |
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

## Fresh installation (new machine, end to end)

1. **Prereqs:** Node 22+, `alix` on PATH (`alix --version`).
2. **Creds (store-only, never env files):**
   ```sh
   alix credential set langfuse publicKey <key>
   alix credential set langfuse secretKey <key>
   ```
   Use a read-only Langfuse key for the loop; mint a write key as
   `langfuse-write publicKey/secretKey` and point only the nightly jobs
   at it (cred split — writers run nightly-gated, hot loop stays read-only).
   Set `tracing.langfuse.baseUrl` in `~/.config/alix/config.json`.
   The nightly distill/eval jobs need a provider — enable the factory
   (same file, `skills.factory`: `{enabled:true, provider, model,
   maxStore:50, maxCandidates:200, autoPromote:false}`) and pin
   `--provider/--model` on the `run-dataset` cron line (no certified
   default; empty model fails at provider creation).
   **Headless cron wall:** cron has no Secret Service bus, so the
   OS-keychain backend is unreachable from scheduled jobs — `alix
   credential get` fails there while working in your login session.
   Nightly jobs therefore source an owner-only env file (canonical store
   stays the keychain; never migrate the global backend for this):
   ```sh
   printf 'export LANGFUSE_PUBLIC_KEY="%s"\nexport LANGFUSE_SECRET_KEY="%s"\n' \
     "$(alix credential get langfuse publicKey)" \
     "$(alix credential get langfuse secretKey)" > ~/.alix/nightly-env
   chmod 600 ~/.alix/nightly-env
   ```
   Every cron line starts with `. ~/.alix/nightly-env;` (`export` is
   required — sourced-but-unexported vars never reach child processes).
   Re-run the `printf` after rotating keys.
3. **Skill:** the Install block above. Hooks-snippet merge is optional —
   hot-loop tiered capture only; the nightly chain doesn't need it.
4. **Verify gateway:**
   ```sh
   node ~/.alix/skills/langfuse-traces/scripts/query.mjs --list --limit 5
   node ~/.alix/skills/langfuse-traces/scripts/probe-writes.mjs --trace-id t --base-url <url>
   ```
   Probes write namespaced `alix-probe-*` artifacts only.
5. **Seed:** create the dataset once (Langfuse UI); write the baseline
   prompt file (`~/.alix/prompts/<name>.txt`); run `alix evals
   run-dataset` once *without* `--baseline-scores`, review `cand.jsonl`,
   and promote it to `base.jsonl` when champion-quality.
6. **Schedule:** install the Nightly crontab below with local paths/keys.
7. **Operate:** mornings = logs + verdicts; on `promote` the eval log
   prints the exact paste-ready `prompt.mjs --create` command — run it by
   hand. Promotions are always manual (operator-gated).

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
- Rows carry no `traceName`: `--list` names a trace from its enclosing
  root span (earliest start + latest end — `scripts/lib/spans.mjs`, shared
  with corpus/mine so "root" means one thing everywhere).
- Rows carry no `usage` and often no I/O payloads: token sums read 0
  and `statusMessage` is the diagnostic. Cost/latency governance needs
  the metrics path, not v2 rows.

## Hook wiring (tiered post_task)

Merge `hooks.json.snippet` into the project's `.alix/hooks.json`
(`discoverHooks` reads `<cwd>/.alix/hooks.json`; output is log-capped
at 500 chars). Tiering: summary always, full diagnostic on failure or
`--full`.

## Known runner gap (landed)

`hooks/runner.ts` `runHook` now interpolates env and passes run identity
(`ALIX_RUN_ID`/`ALIX_SESSION_ID`/`ALIX_RUN_STATUS`); `query.mjs --session`
targets the just-finished run's traces. Section kept so the next gap has
a home.

## Nightly, not per-turn

Scores/drift/eval gates belong in system cron (the daemon is an
on-demand queue, not a scheduler) producing one digest — never in the
hot loop. Same pattern as the digest.mjs crontab for the P3→P4 chain:

```crontab
# P3: mine candidates → distill into candidate skills
15 3 * * * LANGFUSE_BASE_URL=... LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \
  node ~/.alix/skills/langfuse-traces/scripts/mine.mjs --scores ~/.alix/scores.jsonl \
  --factory-out /tmp/candidates.json >> ~/.alix/mine.log 2>&1 && \
  alix skills distill-from-traces --candidates /tmp/candidates.json >> ~/.alix/mine.log 2>&1
# P4: nightly eval over the corpus mirror, gate decides
30 3 * * * alix evals run-dataset --mirror ~/.alix/corpus/<ds>.jsonl --prompt-name <n> \
  --prompt-file <f> --scores-out ~/.alix/scores/cand.jsonl \
  --baseline-scores ~/.alix/scores/base.jsonl >> ~/.alix/dataset-eval.log 2>&1
```
