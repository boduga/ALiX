# Master PRD v2.8 — requirement traceability, first pass

**Verdict: partially mapped. No requirement is certified by this document.**
**Source reviewed:** `1151bf5c` (branch `feat/phase0-master-prd`), clean tracked tree.
**Parent:** `docs/ALiX_MASTER_PRD_v2.8.md`; this artifact addresses **GAP-12**
("Product requirements are not yet mapped to verified current-main code and
evidence").

GAP-12 asks for a PRD-R-to-implementation traceability matrix with verified
status. This is the first slice of it: the 41 **P0** requirements only. P1–P3
(76 more) are not mapped here and are not implied to be unstarted.

## What a row means — and what it does not

Each row records **where the requirement's behaviour would live** and **which
test file names the contract**. It does not record that the behaviour is correct,
that the test passes today, or that an independent party accepted it.

Three distinct statuses are kept apart, per §28.3 rule 1:

- **Located** — source anchor and at least one claiming test exist.
- **Partial** — some part of the requirement has no located anchor.
- **Gap** — no source anchor found for a stated requirement.

Every row below is **Located** or **Partial**. None is verified as an acceptance
signoff. Where a row names a suite, the suite result below was executed in this
pass; where no suite is named, no test was run for that row.

## Executed in this pass

| Suites | Tests | Result |
|---|---|---|
| `tests/ownership/path-scope.test.ts`, `tests/security/legacy-approval-single-use.test.ts`, `tests/security/approval-crash-recovery.test.ts`, `tests/security/approval-consumed-propagation.test.ts` | 119 | **119 pass, 0 fail** (35.5s) |
| `tests/storage/runtime-ledger.test.ts`, `tests/recovery/recovery-types.test.ts`, `tests/architecture/layer-boundaries.test.ts`, `tests/architecture/r1-boundary-freeze.test.ts` | 43 | **43 pass, 0 fail** (17.1s) |
| `node scripts/check-dead-modules.mjs` | — | **OK: every src module is imported or allowlisted** |

This is a **regression result on this worktree**, not independent qualification.
It raises no gate and certifies no requirement: the suites are authored by the
same project they test, and PRD-R012/R013/R051 in particular require independent
security acceptance that a passing local suite cannot supply.

## P0 requirements — coverage

### 6.1 Goals, sessions and orchestration

| ID | Anchor | Claiming evidence | Status |
|---|---|---|---|
| PRD-R001 | `src/runtime-state/storage/runtime-ledger.ts` | `tests/storage/runtime-ledger.test.ts` (11), `tests/storage/runtime-ledger-contention.test.ts` | Located |
| PRD-R004 | `src/coordination/kernel/` scheduler | `tests/kernel/` coordination suite; `benchmark/evidence/coordination/four-worker-scripted.json` | Located |
| PRD-R005 | `src/coordination/ownership/path-scope.ts` (`isWithinOwnedScope`) | `tests/ownership/path-scope.test.ts` (28) | Located |
| PRD-R006 | `src/coordination/kernel/coordination-types.ts` (`deriveCoordinationCompletion`) | `tests/run/task-loop-coordination-completion.vitest.ts` | Located |
| PRD-R007 | `deriveCoordinationCompletion`; `src/capabilities/tools/types.ts` (`outcomeUnknown`) | coordination completion + approval-consumed suite | Partial — verified-success semantics are anchored; the full state vocabulary projection is not enumerated in one place |
| PRD-R008 | `src/coordination/kernel/owner-liveness.ts` (`shouldReclaimWorker`) | `tests/security/approval-crash-recovery.test.ts` (6) | Located |
| PRD-R009 | cancellation token `src/runtime-state/runtime/cancellation-token.ts` | cancellation suite; `ExecutionCancelledError` classification | Located |

### 6.2 Governance, security and approvals

| ID | Anchor | Claiming evidence | Status |
|---|---|---|---|
| PRD-R011 | `src/governance/policy/policy-gate.ts`, `src/governance/policy/rule-evaluator.ts` | `tests/policy/` | Located |
| PRD-R012 | `src/governance/approvals/approval-binding.ts` | `tests/security/approval-consumed-propagation.test.ts` (4) | Located |
| PRD-R013 | `ApprovalStore.consumeApproved` (`approval-store.ts:943`) | `tests/security/legacy-approval-single-use.test.ts` | Located |
| PRD-R014 | `executionOutcome: "pending"` claim + executor reporting | `tests/security/approval-crash-recovery.test.ts` | Located |
| PRD-R015 | mode clamping before persistence (`src/coordination/kernel/`) | `tests/plan-phase-approval-mode.vitest.ts` | Located |
| PRD-R016 | `src/governance/approvals/approval-ledger-reconcile.ts` | `tests/security/approval-crash-recovery.test.ts` | Located |
| PRD-R018 | `src/governance/security/inspector/` principal binding | `tests/security/inspector/auth-service.test.ts` | Located |
| PRD-R019 | `src/capabilities/tools/ignore.ts`, `src/governance/security/redaction/` | `tests/security/path-assert.vitest.ts`, redaction suites | Located |
| PRD-R023 | `src/execution/patch/` engine + router | `tests/patch-engine.test.ts`, `tests/patch-tools.test.ts` | Located |

### 6.5 / 6.6 crash resilience

| ID | Anchor | Claiming evidence | Status |
|---|---|---|---|
| PRD-R081 | `src/operations/daemon/daemon-manager.ts` vs terminal-owned run | `tests/daemon/daemon-task-ledger-dualwrite.test.ts` (8) | Partial — daemon/terminal split is anchored; no located disconnect/reconnect E2E naming the continuation contract |
| PRD-R040 | `src/runtime-state/events/event-log.ts` + audit JSONL store | `tests/storage/`, `tests/audit/` | Located |
| PRD-R047 | recovery sequence in `src/recovery/` + ledger | `tests/recovery/recovery-types.test.ts` (24) | Partial — types and state machine anchored; **no kill-point fault-injection corpus** for daemon crash, host reboot or power interruption |
| PRD-R048 | atomic ledger append (ADR-0015) | `tests/storage/runtime-ledger.test.ts` | Partial — persistence anchored per transition; per-transition enumeration against the §8.3.2 list is not recorded |
| PRD-R049 | `src/coordination/kernel/owner-liveness.ts` + lease/epoch | `tests/security/approval-crash-recovery.test.ts` | Located |
| PRD-R050 | effect journal | — | **Gap** — no located effect-journal implementation or unknown-outcome test |
| PRD-R051 | `consumeApproved` atomic claim | `tests/security/legacy-approval-single-use.test.ts` | Located |
| PRD-R052 | approval restore on recovery | `tests/security/approval-crash-recovery.test.ts` | Located |
| PRD-R053 | completed-worker evidence across restart | reclaim path tests | Partial — reclaim is anchored; preservation of *completed* evidence across restart is not named in a single suite |
| PRD-R054 | cancellation/pause persisted across restart | cancellation + ledger suites | Partial — cancellation is anchored; durability of the *intention* across restart is not separately named |
| PRD-R055 | torn/corrupt state detection, checksums, backup/restore | ledger integrity checks | Partial — corruption detection anchored; **backup/restore proof in a fresh environment is missing** (also GAP-06) |
| PRD-R056 | interrupted/recovering/blocked/outcome_unknown projection | `src/recovery/` types; TUI/API projections | Partial — vocabulary anchored in types; CLI/TUI/API parity not demonstrated in one place |
| PRD-R057 | mixed allow/ask/deny worker reconciliation | `tests/governance/` | Located |
| PRD-R084 | zero-loss corpus + RTO thresholds | — | **Gap** — no kill-point durability corpus, no per-platform RTO benchmark, no versioned thresholds (GAP-01/02) |

### 6.7 Legacy elimination (Phase 0)

| ID | Anchor | Claiming evidence | Status |
|---|---|---|---|
| PRD-R059 | `benchmark/evidence/config-consumer-inventory.json`; `docs/audits/2026-10-23-harness-legacy-inventory.md` | compiled census (1,455 files) + literal inventory | Partial — config-domain census only; repo-wide obsolete-code and duplicate-authority matrix not complete (GAP-05) |
| PRD-R060 | — | — | **Gap** — no historical-record migration tooling or signed migration manifest exists |
| PRD-R061 | — | — | **Gap** — no caller migration tooling; legacy readers still reachable |
| PRD-R062 | `tests/architecture/layer-boundaries.test.ts` (4), `tests/architecture/r1-boundary-freeze.test.ts` | static guards | Located |
| PRD-R063 | `pnpm check:dead` → `OK: every src module is imported or allowlisted` | dead-module gate | Partial — dead code clean; dependency/vulnerability exception audit not recorded |
| PRD-R064 | immutable audit store under `src/governance/audit/` | audit suites | Partial — evidence retention anchored; tied to *removal* of legacy paths, which is not started |
| PRD-R065 | — | — | **Gap** — no signed Phase 0 completion matrix exists (this document is not one) |

### 6.8 Operations / governance

| ID | Anchor | Claiming evidence | Status |
|---|---|---|---|
| PRD-R067 | `src/operations/config/schema.ts` versioning + preflight | `tests/config/` | Located |
| PRD-R068 | credential store + scoped redaction | `tests/security/credentials/`, `tests/security/redaction/` | Located |
| PRD-R083 | audit retention + holds | `tests/audit/` | Partial — retention/holds anchored; non-resurrection across backup restore is not demonstrated (GAP-06) |
| PRD-R082 | release gate | `docs/audits/` acceptance records | Partial — requirement is a **process** gate; no automated negative test rejects release on missing clearance/approval/artifact mismatch |

## What this changes

Nothing about Phase 0's exit. It converts GAP-12 from "unmapped" to "P0 mapped,
39 located/partial, 5 gaps". The five **Gap** rows are the honest Phase 0
blocking set:

1. **PRD-R050** — effect journal and unknown-outcome reconciliation (§8.4, GAP-03).
2. **PRD-R060** — historical-record migration + signed manifest (§8.1.1, GAP-05).
3. **PRD-R061** — caller migration and legacy-reader retirement (Q05, GAP-05).
4. **PRD-R065** — signed Phase 0 completion matrix.
5. **PRD-R084** — kill-point durability corpus + measured per-platform RTO (GAP-01/02).

PRD-R065 is gated on the other four; it is the closing artifact, not parallel work.

## Limits

- Anchors are name/location matches confirmed by source read, not call-graph proof.
  GitNexus `impact` over-attributes (428 claimed for `runTaskLoop` against 37 files /
  235 references), so it was not used to establish coverage.
- Eight suites covering 162 tests were executed and passed on this worktree. That
  is regression evidence only — same-author tests, no independent signoff. The
  remaining named suites (`tests/policy/`, `tests/kernel/`, `tests/audit/`,
  `tests/config/`, `tests/governance/`, patch suites) were **not** executed here,
  and their rows stay "claiming evidence", not "passing evidence".
- P1–P3 requirements (76) are unmapped.
- Five gaps are declared from absence of a located anchor. Each was checked by
  targeted source search (no `effectJournal`, no `MigrationManifest`, no RTO
  corpus, no legacy-reader shim, no Phase 0 completion matrix). Absence after a
  targeted search is strong evidence, not proof; re-confirm before scheduling.
