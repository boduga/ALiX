# Observation Engine

## Overview
Implements the A5 observation surface: provider registration and bounded dispatch, conversion of observation results into observed verification evidence, a capability measurement adapter that records measurement outcomes and publishes evolution signals, and the `alix evolution observe` CLI handler. This package observes system state; it does not decide governance outcomes.

## Interface
- `ObservationEngine` and `ObservationEngineConfig`: register named providers, observe one result, or run `observeAll` with bounded concurrency [observation-engine.ts:ObservationEngine] [observation-engine.ts:ObservationEngineConfig].
- `ObservationBuildInput` and `buildObservationEvidence`: aggregate results into `VerificationEvidence` with `evidenceClass: "observed"` [observation-evidence-bridge.ts:ObservationBuildInput] [observation-evidence-bridge.ts:buildObservationEvidence].
- `OutcomeDecider`, `CapabilityMeasurementOptions`, and `CapabilityMeasurement`: implement the capability `Measurement` seam using post/baseline observations and an injected decider [capability-measurement.ts:OutcomeDecider] [capability-measurement.ts:CapabilityMeasurement].
- `ObserveDeps`, `ObserveFlags`, and `runObserve`: build the v1 observation set, dispatch it, persist evidence, and render or JSON-print the result [observation-cli.ts:runObserve].
- `index.ts` re-exports the contract, engine, evidence bridge, and CLI modules ([./index.ts](./index.ts)).
- Observation contract: [./contracts/README.md](./contracts/README.md).
- Providers: [./providers/README.md](./providers/README.md).

## Invariants
- Provider names are unique; registering a duplicate name throws [observation-engine.ts:register].
- `observe` never throws. An unregistered provider returns an `error` result with `errorType: "unknown_provider"`, and a provider exception returns an `error` result with `errorType: "provider_exception"` [observation-engine.ts:observe].
- `observeAll` preserves input ordering in its result array and uses `maxConcurrency` (default 4) workers [observation-engine.ts:observeAll] [observation-engine.ts:DEFAULT_CONFIG].
- Evidence aggregation counts pass/fail/error/inconclusive and reports rates, while behavioral changes faithfully describe observations without governance conclusions [observation-evidence-bridge.ts:buildObservationEvidence].
- Evidence identity is derived from proposal, evolution, environment, observation count, and observation IDs; the integrity hash excludes `integrityHash` and prefixes the canonical payload with `alix-evolution-observed-v1:` [observation-evidence-bridge.ts:buildObservationEvidence].
- Capability measurement treats the `measured` event append as the commit point, then publishes signals best-effort; a sink failure records `signals_unpublished` and does not fail the measurement [capability-measurement.ts:measureCapability] [capability-measurement.ts:publishSignals].
- The default decider maps `pass` to `effective`, `fail` to `ineffective` with one underperformer signal when a target exists, and other statuses to `inconclusive` [capability-measurement.ts:DEFAULT_OUTCOME_DECIDER].
- The measurement adapter may read the capability catalog but must not import catalog mutators or modify `outcome.signals` after the decider returns [capability-measurement.ts:CapabilityMeasurement].
- `runObserve` uses the fixed provider set `cli`, `filesystem`, `git`, and `ledger`, assigns `environmentHash: "observation-v1"`, and treats error/fail/inconclusive counts as `PARTIAL` storage outcomes [observation-cli.ts:buildObservationSet] [observation-cli.ts:storeObservationEvidence].

## Side Effects
- `ObservationEngine.observe` records the current ISO timestamp when producing unknown-provider or provider-exception results [observation-engine.ts:unknownProviderResult] [observation-engine.ts:exceptionResult].
- Capability measurement appends `capability.governance.measurement.measured` and may append `capability.governance.measurement.signals_unpublished` through the injected `EventLog` [capability-measurement.ts:recordMeasured] [capability-measurement.ts:publishSignals].
- Capability measurement publishes each outcome signal through the injected `ProposalSignalSink` [capability-measurement.ts:publishSignals].
- `runObserve` appends observation evidence through `ExecutionEvidenceStore.append` [observation-cli.ts:storeObservationEvidence].
- `runObserve` writes either JSON evidence or a human-readable observation summary to stdout [observation-cli.ts:runObserve] [observation-cli.ts:renderObservationResult].

## Verification
- Run: `pnpm test`
