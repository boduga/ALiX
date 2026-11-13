# Decision Replay & Regression

## Overview
Offline evaluation pipeline for engine, model, and threshold changes: store redacted fixtures → dry-run replay → comparison → promotion gate. The harness signature admits only fixtures and executors, so a replay has no journal, approval store, tool surface, or policy gate through which it could mutate runtime state. Fixtures are sealed projections, never raw state.

## Interface
- `ReplayFixture` — `id`, `decision`, sealed projection, optional `candidates`/`expected`, and `exportedAt` `[fixtures.ts:ReplayFixture]`.
- `exportReplayFixture(sealed, input)` — build a fixture and re-verify the seal first `[fixtures.ts:exportReplayFixture]`.
- `saveReplayFixture(path, fixture)` / `loadReplayFixture(path)` / `listReplayFixtures(dir)` — atomic save, validated load, sorted `.json` listing `[fixtures.ts:saveReplayFixture]`.
- `FixtureValidationError` / `isReplayFixture` — validation error code `FIXTURE_VALIDATION` and structural guard `[fixtures.ts:FixtureValidationError]`.
- `DEFAULT_REPLAY_TIMEOUT_MS` — 30 000 ms per replay call `[harness.ts:DEFAULT_REPLAY_TIMEOUT_MS]`.
- `ReplayRun` — `fixtureId`, `engineId`, `outcome`, `latencyMs`, optional provider `usage` `[harness.ts:ReplayRun]`.
- `replayFixture(fixture, executor, opts?)` — one fixture × one executor, time-bounded `[harness.ts:replayFixture]`.
- `replaySuite(fixtures, executors, opts?)` — all fixtures through all executors, keyed by engine id `[harness.ts:replaySuite]`.
- `costFromUsage` / `costForRun` / `estimateFixtureCostUsd` / `estimateSuiteCostUsd` — reported-usage-first cost model with a chars/4 fallback `[cost.ts:costForRun]`.
- `JEV_PRICE_PER_MTOK_USD` — `0.042` USD per million input tokens; local engines cost 0 `[cost.ts:JEV_PRICE_PER_MTOK_USD]`.
- `compareEngineRuns(input)` — agreement, accuracy, mean/p95 latency, and cost matched by fixture id `[compare.ts:compareEngineRuns]`.
- `normalizeOutcome(outcome)` — answer-only projection (`choice`/`score`/`noul`/`failure`) `[compare.ts:normalizeOutcome]`.
- `DEFAULT_CONTINUOUS_TOLERANCE` — `0.1` for probabilistic/score outcomes `[compare.ts:DEFAULT_CONTINUOUS_TOLERANCE]`.
- `evaluatePromotionGate(input)` — fail-closed promotion verdict with reasons `[gates.ts:evaluatePromotionGate]`.
- Barrel re-exports all five modules `[index.ts:index]`.

## Invariants
- Only a projection that passes `verifySealedProjection` can become a fixture; an unsealed or forged payload throws `FixtureValidationError` `[fixtures.ts:exportReplayFixture]`.
- `isReplayFixture` requires a non-empty string `id` and `decision`, a finite `exportedAt`, and a verified seal `[fixtures.ts:isReplayFixture]`.
- `listReplayFixtures` treats a missing directory as an empty corpus but surfaces any other read failure as `FixtureValidationError` `[fixtures.ts:listReplayFixtures]`.
- `replayFixture` converts transport failures, timeouts, unexpected throws, and malformed non-failure outcomes into explicit `failure` outcomes carrying the fixture id and engine id `[harness.ts:replayFixture]`.
- Provider usage is attached only for non-failure outcomes that reported it `[harness.ts:replayFixture]`.
- Agreement compares answers only: Choice compares exactly, while Noul probability and Score compare within `continuousTolerance` (default 0.1); confidence, provenance, and latency are excluded `[compare.ts:sameAnswer]`.
- Fixtures present on only one side are excluded from `paired`, but each side still reports its own run count `[compare.ts:compareEngineRuns]`.
- `malformed` in a side report counts runs whose outcome kind is `failure` `[compare.ts:sideReport]`.
- Cost is exact when the engine reports usage and a chars/4 estimate otherwise; an unknown engine id throws rather than pricing 0 `[cost.ts:costFromUsage]`.
- The promotion gate fails on an empty corpus, agreement below `minAgreement` (default 0.8), accuracy drop beyond `maxAccuracyDrop` (default 0), or any candidate malformed outcome unless `allowMalformed` is true `[gates.ts:evaluatePromotionGate]`.
- Latency and cost are reported in the comparison, never used to gate promotion `[gates.ts:evaluatePromotionGate]`.

## Side Effects
- `saveReplayFixture` writes JSON atomically through `writeJsonFileAtomicSync` (0o600 via the storage primitive) `[fixtures.ts:saveReplayFixture]`.
- Load and list read fixture files from disk; a missing directory yields `[]` `[fixtures.ts:listReplayFixtures]`.
- Replay executes the supplied executors, which may perform network calls for remote engines, but the harness itself writes no journal, approval, or governance state `[harness.ts:replaySuite]`.
- Each replay call is bounded by `timeoutMs` through `executeWithTimeout` `[harness.ts:replayFixture]`.

## Verification
- Run: `pnpm test`
