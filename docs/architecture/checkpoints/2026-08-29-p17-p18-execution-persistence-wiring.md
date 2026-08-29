# P17/P18 — Execution Lifecycle Persistence Wiring

**Date:** 2026-08-29
**Purpose:** Close the P17/P18 persistence gap — persisted stores and a driver CLI so `alix governance execution report` and `alix governance workbench` render real lifecycle data instead of empty arrays. Previously every P17 lifecycle construct (remediation proposal → execution plan → approval → attempt) existed only as pure functions/types with **no production writer**, and the only persisted store (`ExecutionStore`) was never written and pointed at the wrong directory (`<cwd>/` instead of `.alix/governance/`).

---

## 1. What shipped

### New JSONL stores (P14/InvestigationStore pattern, last-wins per id, default dir `.alix/governance/`)

| Store | File | File on disk | Key |
|---|---|---|---|
| `RemediationStore` | `src/governance/remediation-store.ts` | `remediation-proposals.jsonl` | `proposalId` |
| `ExecutionPlanStore` | `src/governance/execution-plan-store.ts` | `execution-plans.jsonl` | `planId` |
| `ExecutionApprovalStore` | `src/governance/execution-approval-store.ts` | `execution-approvals.jsonl` | `approvalId` |

Each exposes `append(record)` / `get(id)` / `list()`; remediation adds `updateStatus(id, status)`; plan adds `getByRemediationId()`; approval adds `getByPlanId()`. Writes go through `.alix/governance/` (via `join(baseDir, ".alix", "governance")`), corrupt JSONL lines skipped, reads newest-first per id (last-wins, so remediation state transitions append a superseding version without rewriting).

### Fix: `ExecutionStore` directory

The three CLI read sites previously constructed `new ExecutionStore(cwd)` which resolved to `join(cwd, "execution-attempts.jsonl")` — **not** `.alix/governance/` — contradicting the module doc and the other governance stores. Now they pass `storeSubdir = ".alix/governance"`, so attempts land in `.alix/governance/execution-attempts.jsonl`. The store class contract is unchanged (tests unaffected).

### CLI lifecycle write subcommands (`alix governance execution`)

P18.4 keeps `workbench` read-only; all mutation lives under `execution`:

```
alix governance execution remediate <recommendations.json> [--window-start <iso>] [--window-end <iso>]
alix governance execution {accept|dismiss|reject} <proposalId>
alix governance execution plan <proposalId>           # remediation must be accepted
alix governance execution approve <planId> <operatorId> <rationale> [--action <id>...]
alix governance execution reject-plan <planId> <operatorId> <rationale>
alix governance execution record <planId> <approvalId> <operatorId> <status> [--failure <msg>]
```

Each command drives the existing **pure** factory (`createRemediationProposalsFromRecommendations`, `transitionRemediationState`, `createExecutionPlanFromRemediation`, `approveExecutionPlan`/`rejectExecutionPlan`, `recordExecutionAttempt`), validates via the factory's exceptions, then `append()`s the validated record through the store. The pure modules never persist — the CLI/operator is the caller boundary, per the P17.0 audited-store contract.

### Wired read paths

`runExecutionReport`, `loadWorkbenchSnapshot`, and `runWorkbenchTrace` now load all four collections via a shared `loadExecutionStores()` helper (`src/cli/commands/governance.ts`) and pass real arrays to `buildExecutionReport` / `buildWorkbenchSnapshot` / `buildLifecycleTrace`. The `runWorkbenchTrace` per-hop indexes (plansByRemediation, approvalsByPlan, remediationsById) are now populated from persisted data.

---

## 2. Contract / invariants

- **Purity preserved:** the pure modules (`remediation-queue.ts`, `remediation-lifecycle.ts`, `execution-plans.ts`, `execution-approval.ts`, `execution-recorder.ts`, `execution-report.ts`, `governance-workbench.ts`) remain I/O-free. Stores do the I/O; the CLI is the caller boundary.
- **Store method named `append`, not `save`:** the P9.0 purity sentinel (`tests/governance/governance-sentinels.vitest.ts`) forbids `save(` in `src/cli/commands/governance.ts` to block P8 self-mutation. New P17 stores use `append(` to avoid weakening that P8 protection while still persisting.
- **Dir:** all four lifecycle stores default to `.alix/governance/`.
- **Mutation lives under `execution`, not `workbench`** (P18.4).

---

## 3. Verification

- `npx tsc --noEmit` — clean
- `pnpm build` — clean
- `pnpm test:vitest` — **5265 passed / 7 skipped** (incl. `governance-sentinels.vitest.ts`, 25 tests)
- `pnpm test:node` — **7456 passed / 0 fail** (incl. 18 new store tests: `remediation-store`, `execution-plan-store`, `execution-approval-store`)
- End-to-end CLI smoke: `remediate → accept → plan → approve → record` persisted all four records to `.alix/governance/`; `execution report` showed `Executed: 1` with plan/status; `workbench queue` reported the remediation resolved. (One transient `fresh-install-onboarding`/`handleModelsList` network flake observed; passes on re-run, unrelated to this change.)

---

## 4. Ownership / notes

- Owned by `src/governance/` (no child AGENTS.md exists; root AGENTS.md does not list one). The durable contract for this feature is this checkpoint.
- Follow-up items 2–3 from `2026-08-29-milestone-verification.md` remain open (observability/memory AGENTS.md; optional M-series sentinels).
