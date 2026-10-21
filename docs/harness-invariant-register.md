# Harness authority and invariant register (P0-A)

**Status:** DRAFT — read-only audit. No production change authorized.
**Baseline:** `4ac6df14` (tree `8bf5ac2b`), branch `docs/pre-2.0-harness-audit`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (root worktree; see `harness-prd-divergence-finding.md`) §5 (PRE-R003, PRE-R012), §9 Gate A/B.

Purpose: name the single owner for each authority, and attach the evidence that
would catch a regression. A control with no negative test is listed as a gap, not
as covered.

---

## 1. Authority map

| Authority | Single owner | Enforced by | Verified |
|---|---|---|---|
| Scheduling / dispatch | `CoordinationScheduler` (`coordination-scheduler.ts`) | `GraphExecutor` documented as *not* a scheduling authority | **Yes** — AGENTS contract + code |
| Authorization decisions | `ExecutionAuthorization` → `PolicyGate` | one boundary; R1.5 containment test | **Yes** |
| Approval consumption | `ApprovalStore.consumeApproved` | cross-process lock + reload-inside-lock + revalidation | **Yes** — `mutate()` at `approval-store.ts:323` |
| Approval *decisions* (approve/deny) | `ApprovalStore.resolve` / `resolveWithEvidence` | absent from `WorkerApprovalPort`; self-check throws | **Yes** — 14 tests |
| Child-process approval surface | `WorkerApprovalPort` | only production caller `subagent-cli.ts:627` | **Yes** |
| Durable execution state | R2 runtime ledger | append-is-commit; JSON is projection | **Yes** — store docs + reconciliation |
| Session/event truth | `EventLog` | single append authority, R1 rule `eventlog-append-producers` | **Yes** |
| Ownership / path scope | `OwnershipRegistry` + `path-scope` matcher | shared by `PolicyGate` and `FileToolRouter` | **Yes** — parity table |
| Recovery / liveness | `shouldReclaimWorker` (one verdict) | `coordination-resume.ts`, `owner-liveness.ts` | **Yes** |
| Verification / completion truth | `deriveCoordinationCompletion` + aggregate event | F3 negative (non-terminal ⇒ no success receipt) | **Yes** |
| Model resolution | `createModelResolver` | R1 rule `model-resolver-impls` | **Partial** — see F-01 |
| Config projections | `normalizeModelConfig` (single writer) | §5.2–§5.4 documented | **Yes** |
| Iteration/repair/runtime ceilings | `RunLimiter` (`state-machine.ts`) | S0; 41 importers | **Yes** |

---

## 2. Protected controls (must never be removed)

### S0-1 — Single-use approval consumption
- **Authority:** `ApprovalStore.consumeApproved` only.
- **Callers:** `executor.ts:935`, `policy-gate.ts:574`,
  `replan-approval-gate.ts:176`. All delegate to the one method; none reimplement.
- **Guarantee:** atomic claim under a cross-process lock, re-validated inside it.
- **Tests:** `legacy-approval-single-use.test.ts`,
  `approval-crash-recovery.test.ts`, `approval-consumed-propagation.test.ts`,
  `worker-approval-port.vitest.ts` (cross-process race).
- **Removal risk:** any second claim path allows double execution.

### S0-2 — Child self-approval prevention (`WorkerApprovalPort`)
- **Authority:** the facade in `worker-approval-port.ts`.
- **Guarantee:** no `resolve`/`revoke`/`invalidate`/`mutate` reachable; throws at
  construction if one appears; `recordExecutionOutcome` scoped to the bound
  `workerId`.
- **Tests:** `worker-approval-port.vitest.ts` — 14 tests, red-checked both ways.
- **Removal risk:** handing the child a real `ApprovalStore` lets a compromised
  worker grant itself any capability.

### S0-3 — R1 boundary freeze
- **Authority:** `r1-boundary-freeze.test.ts` + `r1-allowlist.json`.
- **Guarantee:** 8 rules; shrink-only allowlist (76 entries: 53 status-store,
  13 eventlog, 8 ownership, 2 UI; phases R2 62 / R6 12 / R4 2).
- **Demonstrated value:** rejected the F8b direct store import and forced a
  single seam.
- **Removal risk:** unprotected direct store/dispatch/event access from UI or new
  modules.

### S0-4 — Authorization containment (R1.5)
- **Authority:** `ExecutionAuthorization` boundary.
- **Tests:** `r15-authorization.test.ts` (real `ApprovalStore` fixture);
  bound-tool governance; rotation/graph paths.
- **Removal risk:** ungoverned tool dispatch.

### S0-5 — Ownership scope parity
- **Authority:** `path-scope` matcher shared by gate and router.
- **Tests:** `path-scope.test.ts` parity table; `ownership-gate.test.ts`;
  `mutation-targets.test.ts`.
- **Removal risk:** writes outside declared scope.

### S0-6 — Truthful completion (no false success receipt)
- **Authority:** `deriveCoordinationCompletion` + aggregate event match.
- **Tests:** F3 suite (`coordination-tools.test.ts`, real `ToolExecutor`), plus
  the positive control.
- **Removal risk:** non-terminal run reported as success.

### S0-7 — Run ceilings
- **Authority:** `RunLimiter`.
- **Tests:** autonomy/state-machine coverage.
- **Removal risk:** unbounded execution.

---

## 3. Coverage gaps (named, not waived)

| # | Gap | Why it matters | Owner phase |
|---|---|---|---|
| F-01 | `model-resolver-impls` R1 rule watches `createModelResolver` only; `resolveEffectiveModel` (`subagent-cli.ts:24`) sits outside it | A second model authority could be added there without tripping the freeze | P0-B (widen rule) — needs review |
| F-02 | No explicit wrong-workspace test for the worker port | The failure mode cannot be constructed via the port (no user-supplied workspace path), but the *test* does not exist | F8b limitation, accepted |
| F-03 | Tool-level operator denial not exercised through the full TUI scenario | Denial proven at port and dispatch level only | F8b limitation, accepted |
| F-04 | Ownership **hard-conflict rejection** not demonstrated | Prior evidence shows dependency *serialization*, not rejection of an unsynchronized conflict | Core release (GAP-09) |
| F-05 | `config.model` / `config.subagents` projection readers not inventoried | Blocks safe retirement of the projections | P0-F (PRE-R010) |
| F-06 | ~~Prompt assembly spans ≥6 sites with no ownership map~~ **CLOSED by P0-B** — assembly has ONE owner (`buildEffectiveSystemPrompt`, one caller at `task-loop/main.ts:664`) | Was believed to block HC-01 classification; disproven, HC-01 is safe to classify | P0-B — closed |
| F-07 | Transient clamp-reload test observation unresolved | Possible timing fragility in an approval test | P0-D (recurrence check) |
| F-08 | Delegate failure result was written to stderr and never parsed by the parent (fixed: D8-01) | Every structured subagent failure surfaced to the parent as a bare crash, losing `status`/`findings`/`error`. Found by running a case, not by reading code | F1/strata — **fixed + regression test** |
| F-09 | Stratum 9 (local CPU-only) **suite not yet run to completion** | Ollama IS installed and serving, and a real task completed on local CPU inference (`run-379d9b20`). The earlier "no local provider" note was wrong — never checked. What remains is the full suite, at minutes per case on a 4-core box | Gate B — open, cost of local inference |
| F-10 | Only 1 of 10 strata has a measured cost | F1-E proved the mechanism on one 3-invocation run; the rest are deterministic runs with no billable call, so their cost is `null`, not zero | Gate B — open, needs real-model runs |
| F-11 | D4-04 delegate transport flake **bounded, not fixed** | 42 consecutive passes, zero reproduction. Synthetic causality and cross-case lease leakage excluded by construction (pinned by test). Standing hypothesis (child-process scheduling) explicitly unproven. A delegate case may not be the sole evidence for a baseline until it reproduces or the transport is hardened with a failing-first test | separately tracked — open |
| F-12 | Provider cache key omitted `timeoutMs`/`streamIdleTimeoutMs`/`localModelPath` (fixed) | A configured timeout was silently unenforceable: an ollama run aborted at exactly 300000ms with `timeoutMs: 1800000` set. Widening the key can only add distinct entries, never cause a wrong reuse | **fixed + regression test** |

---

## 4. Invariant → test matrix

| Invariant | Test | Negative case present |
|---|---|---|
| One approval authorizes one execution | `legacy-approval-single-use.test.ts` | **Yes** (replay, changed args, concurrent) |
| Crash leaves `pending`; replay denies | `approval-crash-recovery.test.ts` | **Yes** |
| `approvalConsumed` propagates | `approval-consumed-propagation.test.ts` | **Yes** |
| Cross-process claim is exclusive | `worker-approval-port.vitest.ts` | **Yes** (rival store loses) |
| Child cannot self-approve | same | **Yes** (no decision method; consumption of pending refused) |
| Outcome report is worker-scoped | same | **Yes** (cross-worker refused) |
| Boundary rules hold | `r1-boundary-freeze.test.ts` | **Yes** (shrink-only, stale fails) |
| Layer direction holds | `layer-boundaries.test.ts` | **Yes** |
| Authorization containment | `r15-authorization.test.ts` | **Yes** |
| Ownership parity | `path-scope.test.ts` | **Yes** (parity table) |
| Non-terminal ⇒ no success | F3 suite | **Yes** |
| Denied worker fails + dependents attributed | F7 suite | **Yes** |

---

## 5. Consequence for later simplification

Any P0-E/P0-F proposal that touches an S0 row above must ship with:

1. the same or a stronger negative test,
2. a passing run of the matrix in §4,
3. an explicit statement of which invariant would break if the change is wrong.

**No S0 control may be reclassified to M2 on the grounds that a better model
might behave correctly without it.**

Production simplification: **HOLD**. Publication: **HOLD** (Q13).
