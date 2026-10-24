# Harness decision and transition map (P0-B)

**Status:** DRAFT — read-only audit. No production change authorized.
**Baseline:** `4ac6df14`. Branch `docs/pre-2.0-harness-audit`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (root worktree; see `harness-prd-divergence-finding.md`) §5 (PRE-R004), §9 Gate A.
**Resolves:** inventory F-06 (prompt assembly ownership) and A-02 (agent-loop layering).

---

## 1. F-06 resolution — prompt assembly has ONE owner

The P0-A inventory flagged prompt assembly as spread across ≥6 sites with no
ownership map. That is now resolved: it is **composed constants plus one
assembly function**, not multiple authorities.

| Layer | Owner | Role |
|---|---|---|
| Constants | `src/agents/agent/system-prompt.ts` | `SYSTEM_PROMPT_BASE`, `RESEARCH_SUPPLEMENT`, `MUTATION_SUPPLEMENT`, `VALIDATION_SUPPLEMENT`, `SHELL_TASK_PROMPT`, `READ_ONLY_MODE_PROMPT`, `FAILURE_REASONS`, `renderSelfModelSection`, `renderToolManifest` |
| Assembly | `buildEffectiveSystemPrompt` (`task-loop/context-phase.ts:42`) | picks the supplement by intent, appends the turn-boundary clause, appends the tool manifest |
| **Caller** | `task-loop/main.ts:664` | **exactly one** |

Other apparent sites are *not* competing assemblers:

- `operations/prompts/registry.ts` — indexes prompt ids/versions for accounting
  (consumes the same constants), does not build the system prompt.
- `route-prompts.ts` — per-route permission scopes, not prompt text.
- `session/setup.ts` `spliceSkillsSection`/`stripSkillsSection` — post-hoc
  edits to an already-built prompt (skills section only).
- `model-replan-adapter.ts` `buildSystemPrompt()` — a **separate, local** prompt
  for the replan sub-model, not the agent system prompt.
- `session/turn.ts` — imports `FAILURE_REASONS` only.

**Verdict: no duplication.** HC-01's ablation therefore has a single, well-defined
surface to vary (`SYSTEM_PROMPT_BASE` + supplements), which makes a later paired
ablation tractable rather than diffuse.

**Residual (kept as a finding):** `model-replan-adapter.ts` builds its own prompt
string locally. It is a distinct domain (replan proposal), but it is an
unindexed prompt outside the registry. Recorded as **B-01**, Low.

---

## 2. A-02 resolution — agent-loop is a wrapper, not a second loop

```
runTask (agent-loop.ts:611)          trace envelope + evidence emission
  └─> runTaskCoreImpl (agent-loop.ts:106)   planning, resume, outcome mapping
        └─> runTaskLoop (task-loop/main.ts:285)   the iteration loop
```

`agent-loop.ts` owns **lifecycle envelope** concerns only (trace root, outcome
mapping, evidence emission at `:648`). It contains no iteration logic. The
673-line size is the envelope plus resume/plan branching, not duplication.

**Verdict: no duplication; keep the layering.** Do not merge — the envelope is
what guarantees exactly-once terminal evidence.

---

## 3. Four runtime contexts, four vocabularies

| Context | Vocabulary | Owner | Purpose |
|---|---|---|---|
| Task loop | `AgentState`: idle, planning, executing, verifying, repairing, summarizing, waiting_approval, completed, failed, stopped | `planning/autonomy/scope-tracker.ts:7` | one agent's turn lifecycle |
| Coordination run | `CoordinationRunStatus`: planning, replanning, running, blocked, completed, failed, cancelled | `coordination/kernel/coordination-types.ts:21` | multi-worker run lifecycle |
| Worker | `WorkerStatus`: pending, ready, running, blocked, completed, failed, cancelled | same file `:12` | one worker's dispatch lifecycle |
| Subagent result | `SubagentResult.status`: success, failed, rejected, partial | `operations/config/schema.ts:438` | child process outcome |
| Workbench UI | `WorkbenchAgentState`: queued, starting, thinking, tool_running, waiting, waiting_approval, waiting_dependency, verifying, completed, partial, failed, cancelling, cancelled | `interfaces/tui/workbench/model/agent-roster.ts` | presentation projection |

**These are four genuinely distinct domains, not duplicated authority.** Each
answers a different question (turn / run / worker / child / display) and each has
a defined mapping seam:

| Seam | Location | Behaviour |
|---|---|---|
| subagent → worker | `subagent-worker-executor.ts:130-140` | only `success` → success; `partial`/`failed`/`rejected`/crash → failure |
| worker/run → workbench | `agent-roster-projection.ts:29` `stateOf` | normalizes + aliases into the display vocabulary |
| task-loop → run | `recomputeRunStatus` | worker statuses roll up to run status |

**Verified `AgentState` is not duplicated:** `agent-contract.ts:46` imports it
from `scope-tracker.ts` and re-exports as the port type (`:81`). One definition,
one re-export alias — the correct port pattern, not a second authority.

---

## 4. Decision ownership

| Decision | Sole owner | Not owned by |
|---|---|---|
| Is this tool call authorized? | `ExecutionAuthorization` → `PolicyGate` | agent loop, scheduler |
| Has this approval been spent? | `ApprovalStore.consumeApproved` | port, executor, gate (all delegate) |
| Should this worker be reclaimed? | `shouldReclaimWorker` | reconciliation, resume, daemon (all call it) |
| Is this run finished? | `recomputeRunStatus` | scheduler, handler, UI |
| Was this run verified successful? | `deriveCoordinationCompletion` + aggregate event | prose, worker status, aggregate ref alone |
| Which model does this role use? | `createModelResolver` | subagent-cli (delegates) |
| Which tools are offered? | `buildOfferedExecutableTools` / `filterTools` | prompt text |
| Which format for this provider? | `buildEditFormatPolicy` | patch engine callers |
| Should this run continue? | `RunLimiter` | loop inline checks |

No decision has two owners. This is the strongest result of P0-B.

---

## 5. Findings

| # | Finding | Severity | Evidence | Disposition |
|---|---|---|---|---|
| B-01 | `model-replan-adapter.ts:339` builds a local prompt string outside the prompt registry | Low | `model-replan-adapter.ts:339,381` | Index it or document the exception in P0-F |
| B-02 | `stateOf` aliases collapse distinct outcomes: `success→completed`, `rejected→failed`, `executing→tool_running`. The `partial` outcome survives only if the producer emits it directly | **Medium** | `agent-roster-projection.ts:29-41` | UI fidelity question: acceptable for display, but it must never be the source of truth for completion (it is not — `deriveCoordinationCompletion` is) |
| B-03 | `AgentState` has a single definition with one re-export alias; a future reader could mistake the alias for a duplicate and "consolidate" it wrongly | Low | `agent-contract.ts:46,81` | Documented here so it is not "fixed" |
| B-04 | Four vocabularies mean any new status must be mapped at three seams or it silently becomes `failed`/`fallback` | Low | `stateOf` fallback parameter | Add a mapping test when a status is introduced |

---

## 6. Consequence for P0-C/D

- **HC-01 ablation is now tractable:** vary `SYSTEM_PROMPT_BASE` + supplements;
  one assembly function, one caller.
- **HC-05, HC-03 unchanged:** still M1/M2 candidates awaiting P0-D.
- No consolidation is recommended from P0-B. The layering is sound; the findings
  are documentation and UI-fidelity issues, not authority splits.

**Unknowns remaining:** production effectiveness of any prompt guidance (needs
P0-D), and whether the `stateOf` alias table is exercised by any producer that
still emits legacy names (needs a grep of event producers, deferred to P0-F).

Production simplification: **HOLD**. Publication: **HOLD** (Q13).
