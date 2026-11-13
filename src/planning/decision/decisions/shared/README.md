# Decision Shared Helpers

## Overview
Shared, pure helpers used by every decision shadow runner so attempt interpretation, journal construction, and baseline tokenization cannot drift between decisions. `attempts.ts` reads `executeWithFallback` attempt lists, `journaling.ts` is the single "attempt becomes journal record" shape, and `text.ts` is the shared deterministic tokenizer for the claim-verification and context-relevance baselines.

## Interface
- `observedEngineId(attempts, fallbackId)` returns the engine of the last successful attempt, or `fallbackId` when none succeeded `[attempts.ts:observedEngineId]`.
- `totalLatency(attempts)` sums `latencyMs` across every attempt, including failed ones `[attempts.ts:totalLatency]`.
- `JournalContext` bundles the decision type, engine id, sealed projection, remote/redaction flag, and optional execution id, risk context, threshold profile, and candidates `[journaling.ts:JournalContext]`.
- `toDecisionOutcome(outcome, candidates?)` maps the closed `ExecutorOutcome` kinds `choice`, `score`, `noul`, and `failure` into `DecisionOutcome` `[journaling.ts:toDecisionOutcome]`.
- `journalizeOutcome(ctx, outcome, latencyMs)` builds a success journal record `[journaling.ts:journalizeOutcome]`.
- `journalizeFailure(ctx, error, latencyMs)` builds a failure journal record `[journaling.ts:journalizeFailure]`.
- `journalAttempts(attempts, outcome, contextFor, emptyEngineId)` builds one record per attempt `[journaling.ts:journalAttempts]`.
- `STOPWORDS` is the shared stopword set `[text.ts:STOPWORDS]`.
- `contentWords(text)` returns lowercased alphanumeric tokens of length ≥ 3 minus stopwords `[text.ts:contentWords]`.
- `numbers(text)` returns numeric literals as written, including decimals `[text.ts:numbers]`.
- No child contract directories exist.

## Invariants
- `observedEngineId` scans attempts backwards and returns the first `ok` attempt's `engineId`, so it never reports an engine that did not succeed `[attempts.ts:observedEngineId]`.
- `totalLatency` never filters by success, so failed-attempt latency stays in the total `[attempts.ts:totalLatency]`.
- `toDecisionOutcome` is exhaustive over the four `ExecutorOutcome` kinds and copies `confidence` only when the source defines it `[journaling.ts:toDecisionOutcome]`.
- Journal base fields always include `projectionHash` and `projectorVersion` from the sealed projection, and set `redactionApplied` equal to `remote` `[journaling.ts:baseFields]`.
- Optional journal fields (`thresholdProfile`, `risk`, `executionId`, `engineVersion`, `candidates`, `confidence`) are omitted rather than written as `undefined` `[journaling.ts:baseFields]` `[journaling.ts:journalizeOutcome]` `[journaling.ts:toDecisionOutcome]`.
- `journalAttempts` with an empty attempt list still produces exactly one record, journalized against `emptyEngineId` at latency 0 `[journaling.ts:journalAttempts]`.
- A failed attempt without an error message is journaled with the literal `unknown failure` `[journaling.ts:journalAttempts]`.
- `contentWords` lowercases before matching, requires length ≥ 3, and applies `STOPWORDS` after matching `[text.ts:contentWords]`.
- `numbers` preserves written form and does not normalize or deduplicate `[text.ts:numbers]`.
- All three modules are pure: no I/O, no clocks, no global mutation `[attempts.ts:totalLatency]` `[journaling.ts:journalizeOutcome]` `[text.ts:contentWords]`.

## Side Effects
- ["None"]

## Verification
- Run: `pnpm test`
