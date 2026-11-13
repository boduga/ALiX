# Decision Engines

## Overview
Concrete `DecisionExecutor` implementations for the decision layer. `local.ts` is the deterministic, fail-closed baseline used at runtime; `jev.ts` is the opt-in TypeSafe System One remote adapter with an explicit registration path and a store-supplied API key; `jev-protocol.ts` defines the verified wire types and answer guards. The engines share the executor contract from `../executors.ts` and register through `../registry.ts`.

## Interface
- `LOCAL_ENGINE_ID` — engine id `"local"` `[local.ts:LOCAL_ENGINE_ID]`.
- `createLocalBaselineExecutor(opts?)` — exhaustive per-`DecisionType` baseline dispatch; returns a `DecisionExecutor` `[local.ts:createLocalBaselineExecutor]`.
- `LocalBaselineExecutorOptions` — optional `claimThreshold` support-overlap threshold `[local.ts:LocalBaselineExecutorOptions]`.
- `localEngineMeta(executor?)` — `DecisionEngine` descriptor with `remote: false` and capabilities `choice`/`noul` `[local.ts:localEngineMeta]`.
- `JEV_ENGINE_ID` / `JEV_KEY_PROVIDER_ID` — `"jev"` and the store-only key provider `"typesafe"` `[jev.ts:JEV_ENGINE_ID]`.
- `JevDecisionMapping` — `toRequest`/`fromResponse` pair per decision `[jev.ts:JevDecisionMapping]`.
- `defaultJevTransport` — fetch-based transport with bounded retries `[jev.ts:defaultJevTransport]`.
- `createJevExecutor(opts)` — build the remote executor, rejecting disabled construction `[jev.ts:createJevExecutor]`.
- `jevEngineMeta(executor?)` — `DecisionEngine` descriptor with `remote: true` and `supportsDecision` over claim, relevance, tier, and risk `[jev.ts:jevEngineMeta]`.
- `registerJevEngine(registry, opts)` — explicit opt-in registration; returns `false` unless `enabled` `[jev.ts:registerJevEngine]`.
- `JEV_SYSTEMONE_ENDPOINT`, `JEV_DEFAULT_MODEL`, `JEV_MAX_CHOICE_OPTIONS` — `https://api.typesafe.ai/v1/systemone`, `jev-latest`, and 255 `[jev-protocol.ts:JEV_SYSTEMONE_ENDPOINT]`.
- `isJevChoiceAnswer` / `isJevNoulAnswer` — decoded-answer narrowing guards `[jev-protocol.ts:isJevChoiceAnswer]`.

## Invariants
- The local engine is fail-closed: a claim verdict or risk tier outside an explicit candidate set returns a `failure`, not a fabricated choice `[local.ts:claimChoice]`.
- `model-tier` local execution requires at least one enabled candidate tier and fails with `no enabled tier satisfies the request` otherwise `[local.ts:modelTierChoice]`.
- Any decision type without a local handler (including `experiment:<id>` subjects) returns a `failure` rather than borrowing another decision's handler `[local.ts:createLocalBaselineExecutor]`.
- Local provenance records `remote: false`, measured `latencyMs`, and the sealed `projectionHash`; local rules emit no confidence `[local.ts:claimChoice]`.
- `createJevExecutor` throws `RemoteEngineNotAllowedError` unless `opts.enabled === true` `[jev.ts:createJevExecutor]`.
- JEV never reads ambient environment for credentials; a missing caller-supplied `apiKey` throws `EngineUnavailableError("api key missing")` `[jev.ts:createJevExecutor]`.
- The sealed projection is re-verified before any remote transport; a failed verification throws `ProjectionRejectedError` `[jev.ts:createJevExecutor]`.
- Only HTTP 429 and 529 are retried, with `MAX_TRANSPORT_ATTEMPTS = 3` and backoff `250 * 2^(attempt-1)` ms; every other failure is an `EngineUnavailableError` `[jev.ts:defaultJevTransport]`.
- Experiment subjects resolve only through `experimentMappings`; an unregistered `experiment:<id>` fails closed and never borrows a runtime mapping `[jev.ts:experimentMappingFor]`.
- `registerJevEngine` is a no-op returning `false` unless enabled and never consults `process.env` `[jev.ts:registerJevEngine]`.

## Side Effects
- `defaultJevTransport` issues `POST` requests to `JEV_SYSTEMONE_ENDPOINT` with a bearer `authorization` header and sleeps between retryable attempts `[jev.ts:defaultJevTransport]`.
- The default transport aborts on `signal` or an `AbortSignal.timeout(timeoutMs)`; the executor default timeout is 30 000 ms `[jev.ts:createJevExecutor]`.
- `registerJevEngine` mutates the supplied registry by registering the JEV engine `[jev.ts:registerJevEngine]`.
- Local execution is in-process only and performs no network or disk I/O `[local.ts:createLocalBaselineExecutor]`.

## Verification
- Run: `pnpm test`
