# A5 — Outcome Observation Checkpoint

**Date:** 2026-08-10
**Phase:** A5 — Outcome Observation
**Checkpoint tag:** `alix-a5-outcome-observation-complete`

## Summary

A5 closes the evolution loop: post-execution system observation that produces
`VerificationEvidence { evidenceClass: "observed" }`. The `ObservationEngine`
dispatches `Observation` definitions to registered `ObservationProvider` instances
by the `provider` string routing key. Providers return `ObservationResult` atoms.
A bridge aggregates results into standard `VerificationEvidence` compatible with
A3 governance. Providers are read-only and never throw.

Implemented as part of the A5 plan (`docs/superpowers/plans/2026-07-12-a5-outcome-observation-plan.md`).
CLI: `alix governance evolution observe <evolution-id> [--json]`.

## Implemented

| File | Responsibility |
|------|----------------|
| `src/evolution/observation/contracts/observation-contract.ts` | `Observation`, `ObservationResult`, `ObservationProvider` |
| `src/evolution/observation/observation-engine.ts` | `ObservationEngine` dispatcher |
| `src/evolution/observation/providers/cli-provider.ts` | CLI Provider |
| `src/evolution/observation/providers/filesystem-provider.ts` | Filesystem Provider |
| `src/evolution/observation/providers/git-provider.ts` | Git Provider |
| `src/evolution/observation/providers/ledger-provider.ts` | Ledger Provider |
| `src/evolution/observation/providers/repository-provider.ts` | Repository Provider (A5.2) |
| `src/evolution/observation/providers/test-suite-provider.ts` | Test Suite Provider (A5.2) |
| `src/evolution/observation/observation-evidence-bridge.ts` | `buildObservationEvidence()` |
| `src/evolution/observation/observation-cli.ts` | CLI handler (`runObserve`) |
| `src/evolution/observation/index.ts` | Barrel re-exports |

**Tests:** `tests/evolution/observation/` — observation-contract, observation-engine,
observation-evidence-bridge, observation-cli, and `providers/` (cli, filesystem, git,
ledger, repository, test-suite). 336/336 evolution tests pass.

## Verification Checklist

### Provider safety
- [x] Providers never throw — all exceptions caught, return `{ status: "error" }`
- [x] Providers never mutate the system — read-only operations only
- [x] `Observation.provider` is the only runtime routing key — no capability scanning

### Determinism
- [x] `observeAll()` preserves input ordering in output (deterministic evidence hashing)
- [x] Same observations + same timestamp → same evidence hash

### Evidence compatibility
- [x] Bridge aggregates results into `VerificationEvidence { evidenceClass: "observed" }`
- [x] Evidence compatible with A3 governance consumption
- [x] Evidence stored in ledger (`storeObservationEvidence`)

### No ungoverned action
- [x] Observation is read-only — produces evidence, never applies changes
- [x] No lifecycle transition bypass
- [x] Re-evaluation on observed evidence is reserved (`reevaluate` flag, not yet implemented)
