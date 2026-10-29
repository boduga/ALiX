# Supervision authority map (deliverable 12a, PRE-R027)

**Status:** INVENTORY ONLY. **No new component proposed or built.**
**Artifact:** branch `main`, commit `63532d7594f8f806c04571a4ac49d5fe8258c9ce`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §14.1 (PRE-R027), §14.2.
**Publication / simplification:** HOLD (Q13).

PRE-R027 requires inventorying existing governance, approval, calibration, outcome,
trace and coordination contracts for supervision modes **before** proposing anything.
This document maps what exists and names the gaps. It proposes no new authority.

---

## 1. Existing autonomy/verification-relevant contracts

| Concern | Owner | Contract | Supervision relevance |
|---|---|---|---|
| **Session permission mode** | `permissions.sessionMode` (`"auto" \| "ask" \| "bypass"`, default `ask`) | `src/operations/config/schema.ts:277` | Permission input only. It is **not** a review/supervision mode and cannot substitute for autonomous verification qualification |
| **Authorization decision** | `ExecutionAuthorization` → `PolicyGate` | S0-4 (R1.5 containment) | Every action is decided at one boundary; supervision does not add a second |
| **Approval binding & consumption** | `ApprovalStore.consumeApproved` | S0-1, single-use, cross-process lock | An AFK/high-risk action needs a valid, specifically bound approval; consumed/expired/stale never authorize |
| **Child self-approval prevention** | `WorkerApprovalPort` | S0-2 | A supervised worker cannot grant itself capability |
| **Ownership scope** | `OwnershipRegistry` + `path-scope` matcher | S0-5 | Bounds what an unsupervised worker may touch |
| **Run ceilings** | `RunLimiter` (`src/planning/autonomy/run-limiter.ts`) | S0-7; `RunLimits`/`RunCounters`/`LimitCheckResult`/`RemainingCapacity` | Budget exhaustion is the existing stop mechanism (Q07) |
| **Worker liveness / reclamation** | `shouldReclaimWorker` (`src/coordination/kernel/owner-liveness.ts:89`) | S0 recovery | Health-based recovery: dead owner or stale heartbeat reclaims; never a live owner |
| **Resume after restart** | `coordination-resume.ts` | Owner: coordination kernel | Restart reconciliation revalidates before resuming |
| **Coordination completion truth** | `deriveCoordinationCompletion` + aggregate event | S0-6 | A non-terminal run is never success — supervision must honour the same verdict |
| **Calibration** | `src/planning/decision/calibration/` (`profiles`, `reliability`, `labels`, `label-store`, `accuracy-sweep`, `dataset`) | Owner: `src/planning/decision/AGENTS.md` | Reliability is measurable in principle; **no supervision-mode calibration exists** |
| **Trace / projection** | `EventLog` + TUI runtime projections | S0 session truth | Supervision surfaces read projections; they never become authority |
| **Q08 AFK authority** | Master PRD v2.8 §8.3.4 (APPROVED) | Bounded pre-authorized actions; high-risk needs approval; durable pause when unavailable | The governing behavioural contract for unattended work |

**Key structural fact:** ALiX already has **one** authorization boundary, **one**
approval authority, **one** ownership matcher and **one** completion verdict. An autonomous-verification feature is therefore a *qualification/eligibility layer over existing decisions*, never a new execution or authority path. Anything that adds a decision authority is
a duplicate and is out of scope.

---

## 2. Verification modes versus permission modes

The 2026-10-28 agent-driven contract replaces human-supervision stages with verification modes:

| Verification mode | Meaning | Implemented today? |
|---|---|---|
| `full-verification` | Every decision-bearing result is independently checked by verifier/critic agents and deterministic oracles where available | **Contract target; not yet end-to-end qualified** |
| `sampled-verification` | A policy-selected sample receives full independent verification; promotion requires pre-versioned thresholds and evidence | **No** — no qualified sampling machinery exists |
| `exception-based` | Deterministic/agent monitors route defined anomalies to full verification or durable `BLOCKED` | **No** — no qualified exception router exists |

**Critical distinction:** `auto` / `ask` / `bypass` remain **permission modes**. They do not indicate how much independent verification occurs. No permission mode may be relabelled as an autonomy qualification.

---

## 3. Gaps before any eligibility proposal

| # | Gap | Blocks |
|---|---|---|
| S-1 | **No qualified sampling mechanism** — no way to select and verify a policy-defined subset with measured safety | `sampled-verification` |
| S-2 | **No qualified exception routing** — no router that sends anomalies to full verification or durable `BLOCKED` while others proceed | `exception-based` verification |
| S-3 | **No verification-mode calibration** — reliability exists per decision domain, not per verification mode | Any eligibility threshold |
| S-4 | **No measured verifier/critic accuracy baseline** — missed-risk rate unknown (see `harness-operator-attention-metrics.md`, all M-1..M-5 `not measured`) | Promoting to sampled/exception requires knowing what autonomous review catches |
| S-5 | **No eligibility schema** — proposed in the companion document; not implemented | Any per-node qualification |
| S-6 | **No downgrade trigger implementation** — policy/model/tool change detection for qualification does not exist as a contract | Safe automatic demotion |
| S-7 | **Trace completeness for verification modes not assessed** | Auditing an autonomously reviewed decision after the fact |

---

## 4. Non-negotiables carried into any future design

These come from existing contracts and may not be relaxed by an autonomous-verification feature:

1. **Verification never bypasses authorization.** Q08: "AFK status is not an
   authorization mode and must never relax normal tool, approval, sandbox,
   model-provider, or data-classification controls." (PRE-R032)
2. **High-risk actions always need a valid bound approval**, and pause durably when
   one is unavailable — no self-approval, no scope broadening, no tool substitution
   to evade a gate.
3. **Denials stay denials**, even under a broader task authorization.
4. **No implicit renewal** after crash, timeout, or disconnect.
5. **Turn-level continuations keep the exact authorization** of their original turn.
6. **A non-terminal run is never a success receipt** (S0-6).

---

## 5. Verdict

**PRE-R027: MET (inventory).** Existing contracts mapped, gaps named, duplicate
authority avoided by construction.

**Progressive autonomous verification: NOT IMPLEMENTED, NOT MEASURED, NOT QUALIFIED.** No qualified sampling engine, exception router, eligibility evaluation, or downgrade trigger exists. Nothing in this document authorizes building one — §14.2 confines this work
to read-only research and design.

**Crucially:** `sessionMode` provides permission semantics only. None of `ask`, `auto`, or `bypass` is a verification qualification, and none may be used as evidence that agent-driven review is safe.
