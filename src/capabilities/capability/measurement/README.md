# Capability Measurement

## Overview
The CAP-10 measurement boundary for capability governance. `CapabilityMeasurementEngine` resolves an `id@version` target through the capability catalog, delegates outcome computation to the injected A5 `Measurement` implementation, records a post-measurement observation, and returns a frozen `CapabilityMeasureResult`. Outcome and event vocabulary live here as types; A5 owns the `measured` / `signals_unpublished` commit point.

## Interface
- `MeasurementTarget`, `Measurement.measureCapability(target, baselineObservationId?)` — the injected A5 seam; this module only declares the type [measurement-contract.ts:Measurement]
- `CapabilityMeasurementEngine` with constructor options `{catalog, measurement, observationEngine}` and `measure(input)` [capability-measurement-engine.ts:CapabilityMeasurementEngine]
- `CapabilityMeasurementEngineOptions` [capability-measurement-engine.ts:CapabilityMeasurementEngineOptions]
- `CapabilityMeasurementOutcome`, `CapabilityMeasurementOutcomeKind`, `CAPABILITY_MEASUREMENT_OUTCOMES` — the effective / ineffective / inconclusive union [outcome-discriminated-union.ts:CapabilityMeasurementOutcome]
- `isCapabilityMeasurementOutcome`, `isEffectiveOutcome`, `isIneffectiveOutcome`, `isInconclusiveOutcome` type guards [outcome-discriminated-union.ts:isCapabilityMeasurementOutcome]
- `CapabilityMeasurementEventType`, `CAPABILITY_MEASUREMENT_EVENT_TYPES`, `MEASUREMENT_EVENT_PREFIX`, `MEASUREMENT_GOVERNANCE_PREFIX`, `isMeasurementEventType` [measurement-event-types.ts:CAPABILITY_MEASUREMENT_EVENT_TYPES]
- Event payload types: `CapabilityMeasurementPayload`, `CapabilityMeasurementPayloadTarget`, `CapabilityMeasurementPayloadBaseline`, `CapabilityMeasurementPayloadPost`, `CapabilityMeasurementPayloadOutcome`, `MeasurementSignalsUnpublishedFailure` [measurement-event-types.ts:CapabilityMeasurementPayload]
- Event envelopes: `CapabilityMeasurementMeasuredEvent`, `MeasurementSignalsUnpublishedEvent`, `CapabilityMeasurementEvent` [measurement-event-types.ts:CapabilityMeasurementEvent]
- No subdirectories.

## Invariants
- `measure` throws `CapabilityMeasureInvalidTargetError` when the catalog has no entry for the id or its version differs [capability-measurement-engine.ts:CapabilityMeasurementEngine]
- Any A5 failure is wrapped in `CapabilityMeasureFailedError`; the original error is retained, never swallowed [capability-measurement-engine.ts:CapabilityMeasurementEngine]
- The engine never computes an outcome itself; `outcome` is exactly what A5 returned [capability-measurement-engine.ts:CapabilityMeasurementEngine]
- The engine emits no events: `eventIds` is always the empty array and A5 owns `measured` emission [capability-measurement-engine.ts:CapabilityMeasurementEngine]
- `baseline` is present only when a `baselineObservationId` was supplied [capability-measurement-engine.ts:CapabilityMeasurementEngine]
- Re-measurement is append-only with no idempotency check [capability-measurement-engine.ts:CapabilityMeasurementEngine]
- Measurement outcomes have exactly three kinds, enumerated in `CAPABILITY_MEASUREMENT_OUTCOMES` [outcome-discriminated-union.ts:CAPABILITY_MEASUREMENT_OUTCOMES]
- Every outcome carries `evidenceRefs`, `confidence`, `summary`, and `signals` regardless of kind [outcome-discriminated-union.ts:CapabilityMeasurementOutcome]
- `signals_unpublished` requires `payload.signalCount === payload.signalIds.length` [measurement-event-types.ts:MeasurementSignalsUnpublishedEvent]
- `signals_unpublished` classification is `sink_threw` today; `sink_timeout` is reserved [measurement-event-types.ts:MeasurementSignalsUnpublishedFailure]
- Measurement event types share the `capability.governance.` parent prefix with proposal events [measurement-event-types.ts:MEASUREMENT_GOVERNANCE_PREFIX]

## Side Effects
- Calls the injected `Measurement.measureCapability` and `ObservationEngine.observe` — remote or engine work happens behind those ports [capability-measurement-engine.ts:CapabilityMeasurementEngine]
- Reads the clock twice: `Date.now()` in the generated post-observation id and the returned observation's `observedAt` [capability-measurement-engine.ts:CapabilityMeasurementEngine]
- The returned result object is frozen with `Object.freeze` [capability-measurement-engine.ts:CapabilityMeasurementEngine]
- No direct disk, network, or EventLog writes from this module [capability-measurement-engine.ts:CapabilityMeasurementEngine]

## Verification
- Run: `pnpm test`
