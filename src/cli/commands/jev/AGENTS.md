# DOX — `alix jev` (Decision Subsystem Operator Surface)

**Purpose:** Operator surface for the decision subsystem (J4/J5). Read-only inspection, outcome labelling, calibration, threshold-profile lifecycle, and offline replay. This is the only way to operate the subsystem today — nothing is wired into the agent runtime.

**Ownership:**
- `main.ts` — `dispatchJevCommand` (throws `JevOperatorError` on usage errors, testable) and `handleJevCommand` (prints one line and exits 1 on operator errors).
- `ops.ts` — status, labels, dataset/reliability, threshold-profile list/derive/promote/rollback; `JevOperatorError`; `loadAlixConfig`/`loadDecisionConfig`.
- `replay-ops.ts` — corpus → fixtures, `makeExecutor` (local | jev), `runReplay` (with optional compare + gate).
- `render.ts` — pure formatters (status, dataset, reliability bins, profiles, replay).
- `../../../cli/commands/jev.ts` — barrel re-exporting `handleJevCommand`.

**Commands:**
- `status` — routes, enabled flags, remote opt-in, key presence, journal/label counts, profiles, shipped defaults.
- `label --decision-id <id> --decision <d> --label correct|incorrect|unknown [--error-type false_positive|false_negative|other] [--note <text>]`
- `dataset [--decision <d>] [--engine <e>] [--out <file>] [--json]`
- `reliability --decision <d> --engine <e> [--bins N] [--json]`
- `profile list | derive --decision <d> --engine <e> --target-accuracy <0..1> --id <id> --dataset-id <id> | promote <id> --approve [--approved-by <who>] | rollback --decision <d> --engine <e> [--risk <r>]`
- `fixture list | build --decision <d>`
- `replay --engine local|jev [--compare <engine>] [--gate] [--decision <d>] [--timeout-ms N] [--json]` — reports cost from provider-reported tokens when available, else the estimate.

**Local Contracts:**
- State lives under `.alix/decisions/`: `decisions.jsonl` (journal), `labels.jsonl`, `profiles.json`, `fixtures/*.json`.
- Everything is read-only except `profile derive` (writes a shadow profile) and `profile promote` / `rollback`. **Promotion requires `--approve`** and records `--approved-by`: it changes which items get selected, so it is a governance action (arch §10), not a config edit.
- The shipped threshold defaults live in code as `shadow` and are shown for orientation only — they are never applied and cannot be promoted (no provenance). Rollback therefore has nothing to restore until two calibrated profiles exist; that is correct, not a gap.
- Subsystem validation errors (calibration/profile) are presented as single-line operator errors via `asOperatorError`; anything else is a bug and propagates.
- Fixtures are built from each decision's built-in corpus, so baseline and Jev are compared on identical deterministic inputs. Corpus labels make baseline accuracy high by construction — this is a regression harness, not an unbiased eval set.
- Accuracy is reported only when a fixture's `expected` is one of its offered candidates (Choice decisions). A Noul decision carries a judgement label, so comparing it to a probability would print a meaningless 0%; accuracy is omitted and agreement/`mean|delta|` carry the signal instead.
- `model-tier` fixture build fails closed below two enabled tiers: a one-option Choice proves nothing.
- `replay` on `jev` requires `decision.remote.jev.enabled=true` AND a store-only key at `apiKeys.typesafe`; both are refused with actionable messages.
- Replay is the J5 dry-run harness: no tools, no governance, no journal writes.
- Namespace: `alix jev`, never `alix decision` (that is the governance-lens CLI — see `../decision/AGENTS.md`).

**Work Guidance:**
- Add a decision: extend `parseDecisionType`, the `status` route list, and `buildFixtures`'s switch (the corpus is the fixture source).
- Keep the ops layer free of stdout so it stays testable; format in `render.ts`.
- Never make a command mutate runtime behavior beyond the approved profile lifecycle.

**Verification:**
- `tests/cli/jev-ops.test.ts` — status, labels, dataset skip accounting, reliability (+ no-samples refusal), profile derive/promote/rollback and the approval gate, fixture building for all four decisions, replay accuracy/compare/gate, engine key+opt-in refusal, dispatcher usage errors.
- CLI smoke: `node dist/src/cli.js jev status`, `... jev fixture build --decision claim-verification`, `... jev replay --engine local --compare local --gate`.

**Child DOX Index:** none.
