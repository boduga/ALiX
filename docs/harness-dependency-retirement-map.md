# Harness dependency and preliminary retirement map (P0-A)

**Status:** DRAFT — read-only. No retirement approved.
**Baseline:** `4ac6df14`. Branch `docs/pre-2.0-harness-audit`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (root worktree; see `harness-prd-divergence-finding.md`) §5 (PRE-R010/PRE-R011), §8–9.

Nothing here authorizes removal. A disposition is a *proposal* with prerequisites,
tests and rollback; the only decision recorded is "do not touch without evidence".

---

## 1. Runtime dependency shape (verified)

```
cli / tui / daemon / inspector
        |
        v
  runTask (agent-loop.ts)          <- trace + evidence envelope
        |
        v
  runTaskCoreImpl                  <- planning, resume, outcome mapping
        |
        v
  runTaskLoop (task-loop/main.ts)  <- the actual iteration loop
     |            |            |
     v            v            v
 ToolExecutor  RunLimiter   EventLog
     |                          ^
     v                          |
 ExecutionAuthorization         |
  -> PolicyGate                 |
  -> ApprovalStore  ------------+
     ^
     |
 WorkerApprovalPort (child process only)
        ^
        |
   subagent-cli  <- spawned by SubagentWorkerExecutor

CoordinationScheduler (only scheduling authority)
   -> authorizeWorker -> owns  -> CoordinationWorkerExecutor
                                    |-- DefaultWorkerExecutor (in-process)
                                    '-- SubagentWorkerExecutor (child)
```

Confirms: **one loop chain**, **one scheduler**, **one authorization boundary**,
**two worker adapters behind one contract**.

---

## 2. Candidate dispositions

| ID | Class | Disposition | Prerequisites | Tests required | Rollback |
|---|---|---|---|---|---|
| HC-01 prompt scaffolding | M2 candidate | **Benchmark** — paired ablation, no removal on suspicion | P0-D corpus; prompt-assembly ownership map (F-06) | Ablation A/B on the fixed corpus; S0 suite green | Flag-gated; keep original prompt string |
| HC-02 tool naming | S1 | **Preserve** | — | existing tool-name tests | — |
| HC-03 provider format map | M2 candidate | **Benchmark** per model | P0-D; per-provider task strata | Format A/B per model; S0 suite green | Per-provider fallback retained |
| HC-04 rewrite denial | S0 | **Preserve** | — | patch-safety tests | — |
| HC-05 context compilation | M1 | **Benchmark** light vs ranked vs deep | P0-D; token accounting | Context-quality + cost comparison | Cache/TTL unchanged; toggle only |
| HC-06 ceilings | S0 | **Preserve** | — | autonomy tests | — |
| HC-07 orchestration layers | S1 | **Map** (P0-B), no consolidation yet | decision-ownership map | transition map review | — |
| HC-08 subagent CLI | S1/M1 | **Consolidate later** — 922 lines, many jobs | P0-B mapping; F-01 resolution | adapter parity tests | Keep process boundary |
| HC-09 scheduler | S0/S1 | **Preserve authority** | — | scheduler suite | — |
| HC-10 worker adapters | S1 | **Preserve contract**; parity-test | — | both-adapter parity | — |
| HC-11 config projections | L0 partial | **Migrate then retire** | reader inventory (F-05) | reader migration + restart tests | Keep projection writers until readers gone |
| HC-12 kernel contracts | S0 | **Preserve** | — | invariant suite | — |

---

## 3. Retirement register (nothing eligible yet)

| Candidate | Eligible for retirement today? | Blocking prerequisite |
|---|---|---|
| HC-01 prompt guidance | **No** | No benchmark exists; ablating on intuition is exactly what the PRD forbids |
| HC-03 provider format map | **No** | Same |
| HC-11 config projections | **No** | Concrete consumers now listed in `audits/2026-10-23-harness-legacy-inventory.md`; graph/dynamic/external completeness and interface policy remain unresolved (F-05) |
| HC-05 context compiler | **No** | M1, benchmark-first |
| Anything S0 | **Never by simplification** | Only via an equivalent control with security review |

**Explicit statement:** the retirement register is currently **empty**. That is
the honest outcome of P0-A, not an omission.

---

## 4. Consolidation opportunities (design-only, not authorized)

| # | Opportunity | Why it might help | Risk | Gate |
|---|---|---|---|---|
| C-01 | Move `resolveEffectiveModel` beside `createModelResolver` | Removes a second model-resolution site outside the R1 rule's reach | Low; needs rule widening (F-01) | P0-B |
| C-02 | Decompose `subagent-cli.ts` | 922 lines owning six concerns; hardest file to audit | Medium — touches the child boundary that S0-2 protects | P0-F, after P0-B |
| C-03 | Reduce the 76-entry R1 allowlist | Tracks real boundary debt; phases already assigned (R2/R6/R4) | Medium — each entry has an R0 reference | P0-F |
| C-04 | Inventory `config.model`/`subagents` readers | Enables projection retirement | Low | P0-F |

None of C-01…C-04 may be bundled with a security change. Each needs its own
package, tests and rollback.

---

## 5. Ordered prerequisites

```
P0-A (this) ──> P0-B map (decisions, transitions, prompt ownership)
                     |
                     +--> widen R1 model-resolver rule (C-01)  [review]
                     |
                     v
                 P0-C benchmark spec
                     |
                     v
                 P0-D baselines ──> P0-E ablations (HC-01, HC-03, HC-05)
                     |
                     v
                 P0-F migration + consolidation design (C-02, C-03, C-04)
                     |
                     v
                 P0-H approved cutover  [separate authorization]
```

P0-B is the next workstream: it is the only stage that can turn §4 into safe
changes, and it needs no benchmark.

---

## 6. Stop conditions carried forward

Stop and report rather than proceed if any proposal:

- removes or weakens an S0 control without an equivalent replacement and security review,
- retires an M2 candidate without P0-D evidence,
- adds an R1 allowlist entry (that is boundary debt growth, not progress),
- changes child-process isolation or the `WorkerApprovalPort` surface without
  re-running the port's 14 tests,
- publishes, pushes or deploys (Q13 HOLD remains active).
