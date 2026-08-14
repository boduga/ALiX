# CAP-10 — A5 Measurement Integration Design

**Status:** Decision-complete (locked rulings #1-#23, 2026-08-13)
**Date:** 2026-08-13
**Branch:** `cap-10-a5-measurement-integration`
**Base:** `origin/main` (CAP-9 merged, `1d85ee44`)
**Ticket:** #494
**Locked rulings:** `memory/cap-10-rulings-locked.md`

> **This document is the architectural specification for CAP-10. ADR-0013 and the greenfield architecture design remain architectural authorities; the greenfield reconciled program spec identifies CAP-10 as A5 Measurement Integration. CAP-10 introduces an A5 capability-level measurement seam and wires it through `CapabilityService.measure()`, closing the governed evolution loop.**

---

## 1. Document hierarchy

```text
ADR-0013
   │
   │ architectural authority
   ▼
Greenfield Architecture Design (§70/§72/§82)
   │
   │ architectural specification
   ▼
CAP-9 Spec (proposal intelligence)
   │
   │ architectural precedent
   ▼
CAP-10 Spec (this document)
   │
   │ implementation authority
   ▼
CAP-10 Implementation Plan (10 tasks)
   │
   ▼
Task briefs
```

CAP-10 inherits the architectural conventions established by CAP-8 (Capability Service Surface) and CAP-9 (A7 Proposal Integration): composition-root boundary, optional ctor deps with graceful degradation, four-axis sentinel (now five-axis), event-type discriminated unions, governance purity.

---

## 2. Core invariants

1. **A5 owns measurement semantics.** Baseline/post observation, outcome determination, evolution signal emission — all in A5. CAP-10 owns only the service boundary, event recording, governance projection integration.
2. **Event namespace ≠ authority.** The EventLog records measurement facts under `capability.governance.measurement.*`; A5 remains the outcome authority. P5.5/P5.6 consume signals but do not become measurement authorities.
3. **Append-only ledger.** measure() is append-only. Re-measuring the same id@version creates a new event with a new eventId. The latest outcome is authoritative; prior measurements remain visible through governance()/history().
4. **One event per measure() call.** Exactly one `capability.governance.measurement.measured` event per successful invocation; zero events on failure. Atomic — produced and durably recorded.
5. **Explicit id@version target.** measure() never infers the measured version from current catalog state. Caller identifies `capabilityId + version`; baseline observation may be supplied or resolved by A5.
6. **CAP-11 owns legacy deletion.** `CapabilityLifecycleMeasurer` and A7.1 legacy lifecycle are forbidden to CAP-10; CAP-11 deletes both.

---

## 3. Locked decisions index

23 rulings locked via grilling on 2026-08-13. Full text in `memory/cap-10-rulings-locked.md`.

| # | Ruling | Gist |
|---|--------|------|
| 1 | Event prefix | `capability.governance.measurement.*` |
| 2 | measure() signature | `measure({ capabilityId, version })` |
| 3 | Optional baseline | `baselineObservationId?` |
| 4 | Atomic return shape | `CapabilityMeasureResult` (status, measurement, baseline, post, outcome, eventIds) |
| 5 | One event per call | Exactly one `measured` event per successful invocation |
| 6 | governance() widens | Includes both proposal and measurement events |
| 7 | A5 is dependency | Not a component; seam via interface |
| 8 | A5 `measureCapability()` | New A5 surface; CAP-10 imports type only |
| 9 | Legacy measurer forbidden | `CapabilityLifecycleMeasurer` is CAP-11 deletion debt |
| 10 | Five-axis sentinel | Axis 5 NEW = measurement purity |
| 11 | One CLI command | `alix capability measure <id@version>` |
| 12 | P5.5/P5.6 signal flow | A5 → `ProposalSignalSource` → P5.5/P5.6 |
| 13 | Append-only | Re-measure creates new event + new signal |
| 14 | Event payload | Mirrors full `CapabilityMeasureResult` |
| 15 | Outcome shape | Discriminated union (`effective`/`ineffective`/`inconclusive`) |
| 16 | A5 failure | `CapabilityMeasureFailedError`, no event recorded |
| 17 | A5 interface location | `src/capability/measurement/a5.ts` |
| 18 | Composition-root | Optional `measurementEngine?` ctor dep |
| 19 | A7.1 lifecycle | Untouched (CAP-11 owns both) |
| 20 | Models | Sonnet implementers, haiku pure-fn, sonnet reviewers, opus final |
| 21 | Tag | `alix-cap-10-a5-measurement-integration-complete` |
| 22 | Supersession test | `cap-10-supersession.test.ts` extends CAP-9 forbidden list |
| 23 | Plan size | 10-task SDD plan structure |

---

## 4. Architecture

### 4.1 Component diagram

```text
alix capability measure <id@version> [--baseline <observation-id>]
                       │
                       ▼
       src/cli/commands/capability-measure.ts
                       │
                       ▼
   CapabilityService.measure({capabilityId, version, baselineObservationId?})
                       │
                       ▼
   CapabilityMeasurementEngine (capability/measurement/)
                       │
                       ▼
   A5CapabilityMeasurement.measureCapability(target, baseline?)
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  baselineObs     postObs       outcome
                       │
                       ├──► capability.governance.measurement.measured (event)
                       │
                       └──► ProposalSignalSource (evolution signal)
                                       │
                                       ▼
                                 P5.5 / P5.6
                                       │
                                       ▼
                                 next A7 round
```

### 4.2 File structure

| Path | Purpose | Owner |
|------|---------|-------|
| `src/capability/measurement/a5.ts` | A5 measurement interface (type-only) | CAP-10 |
| `src/capability/measurement/measurement-event-types.ts` | Event-type discriminated union + payloads | CAP-10 |
| `src/capability/measurement/outcome-discriminated-union.ts` | `CapabilityMeasurementOutcome` shape | CAP-10 |
| `src/capability/measurement/capability-measurement-engine.ts` | CAP-10 orchestrator (resolve target, call A5, record event) | CAP-10 |
| `src/capability/capability-service.ts` | measure() impl + governance() widening | CAP-10 (modify) |
| `src/capability/platform.ts` | Composition root wiring | CAP-10 (modify) |
| `src/cli/commands/capability-measure.ts` | CLI command | CAP-10 |
| `src/evolution/observation/a5-capability-measurement.ts` | A5 implementation | CAP-10 |
| `tests/capability/five-axis-sentinel.vitest.ts` | Axes 1-4 preserved + axis 5 NEW | CAP-10 |
| `tests/capability/cap-10-supersession.test.ts` | Node:test forbidden-file guard | CAP-10 |

### 4.3 A5 surface (new method)

```typescript
interface A5CapabilityMeasurement {
  measureCapability(
    target: { capabilityId: string; version: string },
    baselineObservationId?: string,
  ): Promise<CapabilityMeasurementOutcome>;
}
```

`CapabilityMeasurementOutcome` is a discriminated union:

```typescript
type CapabilityMeasurementOutcome =
  | { kind: 'effective'; evidenceRefs; confidence; summary; signals }
  | { kind: 'ineffective'; evidenceRefs; confidence; summary; signals }
  | { kind: 'inconclusive'; evidenceRefs; confidence; summary; signals };
```

### 4.4 CapabilityMeasurementEngine

The CAP-10 orchestrator (lives in `capability/measurement/`, NOT in `evolution/`). Owns:

- Resolving the id@version target via catalog
- Calling `A5CapabilityMeasurement.measureCapability(target, baseline?)`
- Recording exactly one `capability.governance.measurement.measured` event
- Returning `CapabilityMeasureResult`

It does NOT compute outcomes. It does NOT emit evolution signals.

### 4.5 CapabilityService.measure() body

```typescript
async measure(input: { capabilityId: string; version: string; baselineObservationId?: string }): Promise<CapabilityMeasureResult> {
  if (!this.measurementEngine) {
    throw new CapabilityServiceNotImplementedError("measure() requires measurementEngine");
  }
  // Orchestrator handles target resolution, A5 call, event recording.
  return this.measurementEngine.measure(input);
}
```

### 4.6 governance() widening

The existing `service.governance(capabilityId?)` projection filters on `capability.governance.*`. With CAP-10, this includes both:

- `capability.governance.proposal.*` (5 event types: submitted, approved, rejected, executed, execution_failed)
- `capability.governance.measurement.*` (1 event type: measured)

Projection remains pure read-only — never calculates, reinterprets, or overrides events.

---

## 5. Data flow — measure()

### 5.1 Happy path

1. CLI parses `alix capability measure foo@1.2.0 --baseline obs-abc`
2. CLI calls `service.measure({ capabilityId: "foo", version: "1.2.0", baselineObservationId: "obs-abc" })`
3. Service delegates to `CapabilityMeasurementEngine.measure(input)`
4. Engine resolves target id@version via catalog (validates existence)
5. Engine calls `A5CapabilityMeasurement.measureCapability(target, "obs-abc")`
6. A5 resolves baseline (or uses supplied), performs post observation, computes outcome
7. A5 emits evolution signal via injected `ProposalSignalSource`
8. Engine records `capability.governance.measurement.measured` event with full payload
9. Engine returns `CapabilityMeasureResult` with `eventIds`
10. CLI renders readable summary

### 5.2 Failure path

- A5 throws (provider error, observation failed) → caught by engine → rethrown as `CapabilityMeasureFailedError`
- NO measurement event recorded
- NO evolution signal emitted
- CLI exits non-zero with error message

### 5.3 Append-only semantics

Two successive `alix capability measure foo@1.2.0` invocations produce two `measured` events with distinct eventIds. governance() returns both. Latest is authoritative; both remain observable.

---

## 6. Composition root

`CapabilityPlatform` constructs:

```typescript
new CapabilityService({
  catalog, resolver, mutationExecutor, eventLog,
  proposalGenerator: a7ProposalGenerator,        // CAP-9
  measurementEngine: a5CapabilityMeasurement,     // CAP-10 NEW (optional)
});
```

`A5CapabilityMeasurement` is the concrete A5 implementation (constructs ObservationEngine, baseline resolution, post observation). It's optional — absent → `service.measure()` throws `CapabilityServiceNotImplementedError`.

---

## 7. Migration boundary

### 7.1 CAP-10 owns

- New A5 capability-level surface (`measureCapability`)
- `service.measure()` operational
- `service.governance()` widens to include measurement events
- `alix capability measure <id@version>` CLI
- Five-axis sentinel (axis 5 NEW)
- CAP-10 supersession test

### 7.2 CAP-10 forbids

- `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts` (must not import, modify, delete, deprecate, or refactor)
- `src/evolution/capability-lifecycle/*` (A7.1 legacy lifecycle untouched)
- `src/capability/initial-capabilities.ts` (CAP-8 forbidden)
- `src/tools/tool-registry.ts` (CAP-8 forbidden)
- `src/policy/capability-registry.ts` (CAP-8 forbidden)
- `src/capability/canonical/*` (CAP-8 forbidden)
- `src/tui/capabilities/capability-service.ts` (CAP-7/9 forbidden TUI façade)

### 7.3 CAP-11 owns

- Deletion of `CapabilityLifecycleMeasurer`
- Deletion of A7.1 legacy lifecycle (`src/evolution/capability-lifecycle/*`)
- Migration of any remaining A7.1 callers

---

## 8. Error handling

### 8.1 `CapabilityMeasureFailedError`

Thrown when A5 `measureCapability` throws or returns an error. Carries:
- `capabilityId`, `version`
- `baselineObservationId?`
- `cause: Error` (original A5 error)
- `code: 'measure_failed'`

NO measurement event recorded. NO signal emitted.

### 8.2 `CapabilityMeasureInvalidTargetError`

Thrown when the id@version target does not exist in the catalog. Distinct from `CapabilityMeasureFailedError` (target resolution is CAP-10's responsibility, not A5's).

---

## 9. Testing strategy

### 9.1 Unit tests (vitest)

| Suite | Coverage |
|-------|----------|
| `measurement-event-types.vitest.ts` | Event-type discriminated union + payload validation |
| `outcome-discriminated-union.vitest.ts` | `CapabilityMeasurementOutcome` variants |
| `capability-measurement-engine.vitest.ts` | Orchestrator: target resolution, A5 delegation, event recording |
| `five-axis-sentinel.vitest.ts` | Axes 1-4 preserved + axis 5 NEW |

### 9.2 Integration tests (node:test)

| Suite | Coverage |
|-------|----------|
| `cap-10-supersession.test.ts` | CAP-9 forbidden files preserved + CAP-10 forbidden list + A5 type-only import |
| `measurement-cli.test.ts` | CLI command routing through service |

### 9.3 Test invariants

- `pnpm exec vitest run tests/capability/` → all green
- `node scripts/run-node-tests.mjs` → all green
- `pnpm exec tsc --noEmit` → 0 errors

---

## 10. Forward compatibility

### 10.1 CAP-11 (Remove Legacy Capability Surfaces)

- CAP-10 leaves `CapabilityLifecycleMeasurer` and A7.1 legacy lifecycle untouched
- CAP-11 deletes both, plus any remaining A7.1 callers
- CAP-10 may need to provide a CAP-11 migration guide for any code that still references `CapabilityLifecycleMeasurer`

### 10.2 CAP-12 (End-to-End Capability Evolution)

- CAP-12 closes the loop A7 → A4 → A5 → A7
- CAP-10's `measure()` body is the A5 anchor for CAP-12's e2e test
- The append-only ledger supports CAP-12's "proposal → apply → measure → re-propose" narrative

### 10.3 Future extensions

- Multiple `capability.governance.measurement.*` event types (e.g. `measurement.failed` for observability of failures) — currently deferred
- Per-capability observation profile customization — currently deferred
- Measurement aggregation across multiple id@versions — currently deferred

---

## 11. Out of scope

- Deletion of `CapabilityLifecycleMeasurer` (CAP-11)
- Modification of A7.1 legacy lifecycle (CAP-11)
- Web UI for measurement (CAP-11 / CAP-12)
- TUI display of measurement history (CAP-11 / CAP-12)
- Multi-capability measurement (CAP-12+)
- Measurement scheduling / background workers (deferred)

---

## 12. References

- ADR-0013 — Capability System and Provider Architecture
- Greenfield Architecture Design — `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md`
- Greenfield Reconciled Program — `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-reconciled-program.md`
- CAP-8 Spec — locked rulings in `memory/cap-8-rulings-locked.md`
- CAP-9 Spec — locked rulings in `memory/cap-9-rulings-locked.md`
- A5 Observation Contract — `src/evolution/observation/contracts/observation-contract.ts`
- A5 Observation Engine — `src/evolution/observation/observation-engine.ts`
- Ad-hoc Measurer (CAP-11 deletion) — `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts`
