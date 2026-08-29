# Milestone Verification — M / P / A / CAP / X Series vs. Actual Codebase

**Date:** 2026-08-29
**Purpose:** Independent, read-only verification that every claimed-complete milestone (M0–M8, P4–P30, A0–A9, CAP-1…12/N/O/P, X1–X4) has real backing code in the current source, not just a git tag or doc claim. No source files modified.

Method: freshly rebuilt GitNexus index (34,173 nodes / 77,207 edges / 1218 clusters / 300 flows) + filesystem/glob/grep against the live source, cross-checked against the official roadmaps (`docs/roadmap/*`, `docs/architecture/ALiX_MASTER_ROADMAP.md`, ADR-0013/0014).

Baseline health (from the self-healing free-route run, `6bac0fd4`): `pnpm build` clean, vitest **5265 pass / 7 skipped**, node:test **7438 pass / 0 fail**.

---

## 1. Executive summary

- **No claimed-complete milestone lacks backing code.** All of P4–P30, A0–A9, CAP-1…12/N/O/P, and X1–X4 are present, compile, and pass tests.
- **M-series code is fully present**; the *roadmap's documented folder locations* were stale for **M1, M2, M8** (code had moved). These roadmap paths were corrected (see §4).
- **M9 Distributed is correctly unimplemented** — verified absent (no federation/clustering/remote-worker platform).
- **DOX chain is consistent:** root Child DOX Index matches the 9 existing child AGENTS.md files; no stale entries.

---

## 2. M-Series — Platform (`docs/roadmap/m-series-platform.md` → `src/`)

| M | Roadmap claim | Verdict | Notes |
|---|---|---|---|
| M0 Foundation | 🟡 Substantial | ✅ VERIFIED | `src/kernel/`: event-envelope, workflow-run, task-graph, policy-decision, minimal-metrics; migration `0001_m09_kernel.sql` |
| M1 Agent Runtime | 🟡 | ✅ code (path corrected) | Agent runtime `src/agent/`; workers `src/kernel/worker-executor.ts`; scheduling `src/kernel/coordination-scheduler.ts` |
| M2 Memory Platform | 🟡 | ✅ code (path corrected) | Stores `src/utils/memory/` (store/recall/consolidate); failure memory `src/governance/failure-memory.ts`; context assembly/budget `src/config/context-assembly.ts`, `context-budget.ts` |
| M3 Tool Platform | 🟡 | ✅ VERIFIED | `src/tools/` (registry, capability-map, safe-shell, executor, tool-router) + `src/mcp/` |
| M4 Planning | 🟢 Partial | ✅ PARTIAL (matches claim) | `src/kernel/graph-planner.ts`, replan set (9 files), `src/planning/` |
| M5 Orchestration | 🟢 Partial | ✅ PARTIAL (matches claim) | `src/daemon/`, `src/kernel/coordination-scheduler.ts`, `src/runtime/runtime-index.ts`; no true event bus (log-based) |
| M6 Intelligence | 🟡 | ✅ VERIFIED | `src/providers/` (many), circuit-breaker, catalog, routing-adapter |
| M7 Governance | 🟡 | ✅ VERIFIED | `src/policy/` (PolicyGate), `src/audit/` (AuditStore), `src/approvals/` (ApprovalStore), `src/tools/safe-shell.ts` |
| M8 Observability | 🟡 | ✅ code (path corrected) | `src/observability/` (metric-registry, metrics-store, telemetry-envelope, diagnostic) + `src/kernel/minimal-metrics.ts`; replay `src/runtime/replay-*` |
| M9 Distributed | 🔴 Not started | ✅ VERIFIED ABSENT (correct) | No federation/clustering/remote-worker platform. `failure-clustering.ts` = failure-pattern grouping, not cross-machine clustering |

**M-series takeaway:** All M0–M8 capability code exists. Roadmap paths were stale for M1/M2/M8; corrected in §4.

---

## 3. P-Series / A-Series / CAP / X-Series

### 3.1 P-Series — Product Intelligence (P4–P30)

**27/27 ✅ VERIFIED — no missing code.** Every milestone maps to real modules and `src/cli.ts:2148–2207` CLI wiring (`alix adaptation`, `alix executive`, `alix governance`, `alix decision`, `alix learning`, `alix workflow`, `alix evidence`). P10 slices P10.0–P10.10 verified.

Caveats (non-blocking):
- **P1–P3 do not exist** — roadmap correctly starts at P4 (no tags, no docs).
- **P17/P18 display slices** read from not-yet-landed stores (execution-report + workbench CLI pass empty arrays for remediation/plan/approval); pure-function layers exist (`execution-plans.ts`, `execution-approval.ts`, `execution-state-store.ts`).
- **P8 wiring is end-to-end partial** — `learning.ts` renders whatever is in `LearningStore`; engine code real, live aggregation into calibration inputs deferred.

### 3.2 A-Series — Autonomous Evolution (A0–A9)

**10/10 ✅ VERIFIED.** `src/evolution/` uses domain dirs per ADR-0014 (no `a9`/`a8`/`a5`/`a2` milestone folders — renamed to `forecast/`, `learning/`, `observation/`, `verification/`).

### 3.3 CAP — Capability greenfield (CAP-1…12, CAP-N/O/P)

**✅ VERIFIED.** `src/capability/` (registry, canonical, measurement, evolution, governance) + CAP-12 single-registry sentinel test. Note: canonical card-role type is `CapabilityDefinition` / `CapabilityCatalog` / `RegisteredCapability` — no `CapabilityCard` symbol exists (naming expectation, not a doc lie).

### 3.4 X-Series — Controlled Execution (X1–X4)

**✅ VERIFIED.** `src/runtime/` + `src/evolution/execution/`: `ExecutionStateMachine`, `RetryController`, `cancellation-token`, `execution-rollback`, `execution-evidence-store` (checksummed), `execution-persistence` (wired at `src/agent/session.ts:1095`).

Git tags corroborate every series: `alix-a0…a9-*-complete`, `alix-capability-greenfield-complete`, `alix-cap-6…11-*-complete`, `alix-x1-x2-controlled-execution-complete`, `alix-x3a/x3b-*-complete`, `alix-x4-…-complete`, `alix-p4…p30-*-complete`.

---

## 4. Docs corrected (path fixes only, no code)

`docs/roadmap/m-series-platform.md` — M-series rows updated to match real locations:

- **M1** Agent Runtime: `runtime/` → `src/agent/` + kernel worker/scheduler
- **M2** Memory Platform: `src/context/` (Context Manager/calibration/tiering) → `src/utils/memory/` + `governance/failure-memory.ts` + `config/context-assembly.ts` / `context-budget.ts`. (`src/context/` contains only pattern-registry, semantic-search, session-outcome.)
- **M8** Observability: `src/metrics/` (does not exist) → `src/observability/` + `kernel/minimal-metrics.ts`

Corrections align with locations already documented in `docs/architecture/` (runtime-spine, M1 contract-standardization, observability decisions).

**No root AGENTS.md or child AGENTS.md change was needed** — root Child DOX Index was verified accurate (all 9 indexed child AGENTS.md files exist; no stale `src/context/` entry).

---

## 5. Non-blocking follow-ups

1. ~~**P17/P18 dead-store reads**~~ — **DONE 2026-08-29** (see `docs/architecture/checkpoints/2026-08-29-p17-p18-execution-persistence-wiring.md`): added `RemediationStore`, `ExecutionPlanStore`, `ExecutionApprovalStore`, wired `alix governance execution` lifecycle write subcommands, corrected the `ExecutionStore` dir (`.alix/governance/`), and pointed the report/workbench reads at the stores.
2. **Missing child AGENTS.md** for `src/observability/` and `src/utils/memory/` — both durable subsystem boundaries (M8/M2 homes) with no child doc yet.
3. (Optional) Sentinels for key M-series milestones — the M-series currently relies on general test coverage, not milestone-specific sentinels.
