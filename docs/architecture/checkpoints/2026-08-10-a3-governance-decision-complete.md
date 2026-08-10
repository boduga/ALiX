# A3 — Governance Decision Checkpoint

**Date:** 2026-08-10
**Phase:** A3 — Governance Decision
**Checkpoint tag:** `alix-a3-governance-decision-complete`

## Summary

A3 bridges A2 verification evidence (and advisory A2.5 recommendations) into a
structured `GovernanceDecision` against a governance policy config, then maps
that decision to `EvolutionStateMachine` transitions through a lifecycle bridge
and emits audit evidence. A3 is policy-dependent — the same evidence with a
different policy yields a different decision.

Implemented as part of the A3 plan (`docs/superpowers/plans/2026-07-12-a3-governance-decision.md`).
CLI: `alix governance evolution decide <evolution-id> [--policy <name>] [--json]`.

## Implemented

| File | Responsibility |
|------|----------------|
| `src/evolution/governance/contracts/decision-contract.ts` | A3.0: `GovernanceDecision`, `GovernanceDecisionKind`, `GovernancePolicyConfig` |
| `src/evolution/governance/contracts/decision-store-contract.ts` | A3.1: `GovernanceDecisionStore` interface |
| `src/evolution/governance/decision-engine.ts` | A3.2: Pure decision function |
| `src/evolution/governance/decision-store.ts` | A3.5: `InMemoryGovernanceDecisionStore` |
| `src/evolution/governance/governance-decision-bridge.ts` | A3.3: Lifecycle bridge (decision → state machine) |
| `src/evolution/governance/governance-decision-cli.ts` | A3.4: CLI handler |
| `src/evolution/governance/index.ts` | Barrel re-exports |

**Tests:** `tests/evolution/governance/` — decision-contract, decision-engine,
decision-store, governance-decision-bridge, governance-decision-cli, and
`integration/a3-integration.test.ts`. 336/336 evolution tests pass.

## Verification Checklist

### Evidence freshness
- [x] A3 does not consume expired `VerificationEvidence` (fail-closed by default)
- [x] A2.5 recommendations are advisory — A3 owns the final decision

### Decision engine purity
- [x] Decision engine is pure — no side effects, no store access, no I/O
- [x] Same (evidence, recommendation, config) inputs produce identical decision (deterministic)

### Lifecycle integrity
- [x] `EvolutionStateMachine.transition()` is the single mutation point for lifecycle changes
- [x] Decision persisted before lifecycle transition (append-first)
- [x] A3 integration follows the A1 `GovernanceIntakeAdapter` pattern

### No bypass
- [x] No lifecycle transition bypass
- [x] No silent mutation of governed state — decisions are explicit and persisted
