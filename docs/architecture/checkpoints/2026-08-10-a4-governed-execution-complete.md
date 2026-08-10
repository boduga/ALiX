# A4 — Governed Evolution Execution Checkpoint

**Date:** 2026-08-10
**Phase:** A4 — Governed Evolution Execution
**Checkpoint tag:** `alix-a4-governed-execution-complete`

## Summary

A4 converts approved evolution intent (an `APPROVE` `GovernanceDecision`) into
controlled execution. It authorizes the request, generates a deterministic
`ExecutionPlan`, executes steps sequentially through the `GovernedExecutionRuntime`
with checkpointing and rollback, and produces complete execution evidence with
immutable lineage. A4 is the first **mutation-capable** evolution phase — mutation
is permitted only under explicit governance approval and deterministic control.

Implemented as part of the A4 plan (`docs/superpowers/plans/2026-07-13-a4-governed-execution-plan.md`).
CLI: `alix governance evolution execute <evolution-id> [--dry-run] [--json]`.

## Implemented

| File | Responsibility |
|------|----------------|
| `src/evolution/execution/contracts/execution-contract.ts` | A4.0: `ExecutionRequest`, `ExecutionAuthorization`, `ExecutionPlan` types |
| `src/evolution/execution/execution-authorization.ts` | A4.0: 7-check pre-flight authorization gate |
| `src/evolution/execution/execution-planner.ts` | A4.1: Deterministic plan generation, `RollbackResolver` |
| `src/evolution/execution/execution-runtime.ts` | A4.2: Sequential execution, checkpointing, rollback |
| `src/evolution/execution/execution-evidence-bridge.ts` | A4.3: Report → evidence construction, integrity hashing, lineage |
| `src/evolution/execution/execution-rollback.ts` | A4.4: Rollback & recovery |
| `src/evolution/execution/execution-cli.ts` | A4.5: CLI handler (`runExecute`) |
| `src/evolution/execution/index.ts` | Barrel re-exports |

**Tests:** `tests/evolution/execution/` — execution-contract, execution-authorization,
execution-planner, execution-runtime, execution-evidence-bridge, execution-rollback,
and `integration/execution-integration.test.ts`. 336/336 evolution tests pass.

## Verification Checklist

### Authorization
- [x] Execution only proceeds from `APPROVED` evolution state
- [x] `APPROVE` `GovernanceDecision` required — most recent approve decision used
- [x] 7-check pre-flight authorization gate (`authorizeExecution`)
- [x] Integrity hash check on proposal/decision before execution

### Deterministic control
- [x] Same decision + same plan → same execution trace
- [x] Sequential execution with per-step integrity checkpoints
- [x] `RollbackResolver` reverses steps in reverse order
- [x] `--dry-run` generates the plan without executing (plan-only path)

### Evidence & lineage
- [x] Execution evidence produced with integrity hashing (SHA-256)
- [x] Evidence carries lineage back through proposal → decision → execution
- [x] Evidence persisted through the evidence bridge

### Governance gating
- [x] No execution without governance approval — authorization is mandatory
- [x] No lifecycle transition bypass
- [x] Mutation is bounded to the approved plan — no unplanned side effects
