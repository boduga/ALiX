# A7.1 — Capability Lifecycle Application Checkpoint

**Date:** 2026-08-10
**Phase:** A7.1 — Capability Lifecycle Application
**Checkpoint tag:** `alix-a7-1-capability-application-complete`

## Summary

A7.1 closes the Capability Marketplace lifecycle loop. Where A7.0 implemented the
governed **DECISION boundary** (Propose → Decide → Record, explicitly making
nothing true), A7.1 implements the **APPLICATION boundary** A7.0 deferred: A4
governed execution of approved capability transitions (registry mutation) and
A5 post-application outcome measurement. The loop is now
Observe → Govern (A7.0) → **Apply** → **Measure** (A7.1).

The A4 binding rehydrates the latest DECIDED record from the append-only ledger
(with the full persisted `GovernanceDecision`, never a reduced synthesis),
authorizes it through the A4 `authorizeExecution` 7-check gate, plans and
executes a single governed `capability.transition` step via an injected step
executor, and appends an `applied` record to the ledger as the **commit point**.
If the ledger append fails after the runtime completed, `rollbackApplied()`
performs an idempotent compensating rollback and the applier throws (spec §11
exit 1). The registry lifecycle overlay
(`applyLifecycleTransition` / `getLifecycleState` / `clearLifecycleState` /
`unregister`) is a **runtime projection** rehydrated from the ledger after
restart; the ledger remains the authoritative lifecycle history + governed
transition state, while the M-series registry remains the current runtime
capability state. Measurement appends a `measured` record carrying the baseline
and post-observation evidence refs; A7.1 produces the inputs, the A5 contract
judges effectiveness — A7.1 never re-analyzes capability health.

register/modify are **NOT executable in A7.1** (deferred — blocked, exit 1, no
mutation, no write). A single physical executor op
`capability.transition {capabilityId, to}` covers promote/deprecate
(single-step); consolidate emits N deprecation steps preserving the primary;
register/modify throw `CapabilityNotExecutableError`.

Implemented as part of the A7.1 plan (`docs/superpowers/plans/2026-08-10-a7-1-capability-application.md`).
CLI: `alix capabilities apply <id>` / `measure <id>` (fatal paths exit 1 in both
human and json mode).

## Implemented

| File | Responsibility |
|------|----------------|
| `src/capability/registry.ts` | Lifecycle overlay — `applyLifecycleTransition` (throws on unknown id), `getLifecycleState`, `clearLifecycleState` (idempotent), `unregister` maintains map |
| `src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts` | Event types widened to `intent\|proposed\|decided\|applied\|measured`; record gains `decision?: GovernanceDecision`, `baselineEvidenceRefs?`, `postObservationRefs?`; per-phase validator rules (applied requires executionId+decisionId, measured requires measurementId + both refs); `CapabilityProjectionState` adds APPLIED/MEASURED |
| `src/evolution/capability-lifecycle/capability-governance-bridge.ts` | `toLedgerRecord` decided branch persists full A3 `GovernanceDecision` |
| `src/evolution/capability-lifecycle/capability-execution-projection.ts` | `toExecutionProposal` — decided record → `CapabilityExecutionProposal` (`EvolutionProposal & { changes: CapabilityChangeStep[] }`); promote/deprecate single `capability.transition` step, consolidate = N deprecation steps, register/modify throw `CapabilityNotExecutableError` |
| `src/evolution/capability-lifecycle/capability-lifecycle-step-executor.ts` | `CapabilityLifecycleStepExecutor implements StepExecutor` — forward `capability.transition` (lazy pre-state capture), `capability.restore_transition` (compensating restore), unknown op → `{success:false}`; `rollbackApplied()` idempotent drain |
| `src/evolution/execution/execution-planner.ts` | `createDefaultRollbackResolver` registers `capability.transition` → `capability.restore_transition` (automatic, safe) |
| `src/evolution/capability-lifecycle/capability-lifecycle-applier.ts` | A4 binding: latest-DECIDED rehydration → `authorizeExecution` 7-check gate → `createExecutionPlan` → `GovernedExecutionRuntime.execute` with injected executor → append `applied` (COMMIT POINT) → on append failure `rollbackApplied()` then THROWS (spec §11 exit 1). register/modify blocked `CapabilityNotExecutableError`. |
| `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts` | A5 post-application observation vs baseline: `measure(id)` appends `measured` record with `measurementId` (a7-meas- hash), `baselineEvidenceRefs`, `postObservationRefs` (A5 `buildObservationEvidence`) |
| `src/evolution/capability-lifecycle/errors.ts` | `CapabilityNotExecutableError` |
| `src/evolution/capability-lifecycle/capability-lifecycle-cli.ts` | `alix capabilities apply <id>` / `measure <id>`; fatal paths exit 1 in BOTH human and json mode |
| `src/evolution/capability-lifecycle/index.ts` | Barrel re-exports |
| `tests/evolution/capability-lifecycle/integration/a7-1-capability-application-integration.test.ts` | End-to-end walk + invariant tests (atomicity, rehydration, register-not-executable) |

**Tests:** `tests/evolution/capability-lifecycle/` (unit suites) +
`tests/capability/registry-lifecycle-overlay.test.ts` (registry overlay 6/6) +
`integration/a7-1-capability-application-integration.test.ts` (end-to-end + invariants 4/4).
A7 globstar suite **91/91 across 14 files / 16 suites**; A0 core contracts
**105/105 across 22 suites**. Per-suite highlights: registry overlay 6/6, A7.1
contract extension 12/12, execution projection 5/5, step executor 5/5, applier
6/6, measurer 2/2, CLI 8/8, A7.1 integration 4/4.

## Verification Checklist

### Governed APPLICATION boundary only (A7.1 invariant)
- [x] One physical executor op `capability.transition {capabilityId, to}` covers promote/deprecate (single-step) and consolidate (N deprecation steps, primary preserved); register/modify are NOT executable in A7.1 (deferred — blocked, exit 1, no mutation, no write, `CapabilityNotExecutableError`)
- [x] A4 binding does NOT mutate the registry directly — authorize → plan → execute with injected executor; the registry overlay only changes inside the executor step
- [x] Rehydration is authoritative — full persisted `GovernanceDecision` (decided branch) + full `CapabilityExecutionProposal` projection (`toExecutionProposal`); no reduced synthesis for authorization

### Atomicity + compensating rollback
- [x] `applied` ledger append is the COMMIT POINT — a successful runtime step only becomes true when the applied record lands in the ledger
- [x] Ledger append failure after runtime completed → `executor.rollbackApplied()` idempotent compensating rollback, then applier THROWS (spec §11 exit 1) — registry byte-identical after failed apply (integration-asserted)
- [x] Pre-state snapshot captured immediately before execution, NEVER recalculated during rollback (unit-asserted: rollback restores the PRE-execution value)
- [x] `rollbackApplied()` idempotent drain; in-plan A4 rollback (`capability.restore_transition`) handles mid-plan failure — the two never fight

### Authority model
- [x] A7 ledger = lifecycle history + governed transition state; M-series registry = current runtime capability state
- [x] Registry overlay is a runtime projection rehydrated from the ledger after restart (integration rehydration test: overlay rebuilt after simulated restart)
- [x] `clearLifecycleState` idempotent — no-op on absent id, safe for compensating rollback

### Measurement
- [x] `measure(id)` produces the inputs (baseline + post observation evidence refs) on a `measured` record with a deterministic `a7-meas-` measurementId
- [x] A5 contract judges effectiveness from those refs; A7.1 never re-analyzes capability health

### Error handling
- [x] register/modify application blocked at every layer — projection throws `CapabilityNotExecutableError`, applier rejects, CLI exits 1
- [x] Fatal CLI paths exit 1 in BOTH human and json mode

### Live CLI + rehydration (post-review fixes)
- [x] `src/cli.ts` wires real deps (ledger, store, registry) into the `capabilities` command; `apply`/`measure`/`list` operate on persisted state
- [x] `rehydrateLifecycleOverlay(registry, ledger)` is a production function (spec §8) — rebuilds the overlay from `applied` records, skips unregistered capabilities, last-applied-wins
- [x] Applier reports "Capability `<id>` is not registered" (truthful blocked reason) instead of a confusing execution failure when the registry lacks the capability
- [x] Measurer A5 evidence carries `reproducibilityLevel 2` (direct observation) and `baselineEvidenceRefs` reference the decided record's pre-application evidence (spec §9)
- [x] Atomicity integration assertion stringifies the overlay too (`listLifecycleStates`) — byte-identity no longer passes trivially on a definitions-only snapshot
