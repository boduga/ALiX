# PRE-R004 — state producer / Workbench projection census (2026-10-28)

**Status:** source-confirmed census; independent agent review completed; PRE-R004 remains PARTIAL.
**Source:** `fix/d9-phase-f-remediation-v2` at the commit immediately preceding this record.
**Scope:** producer values that feed `AgentRosterProjection.stateOf`; this is not a claim that every ALiX state consumer was exhaustively proven.

## Source-confirmed producers

- `src/planning/autonomy/scope-tracker.ts` defines canonical `AgentState`: `idle`, `planning`, `executing`, `verifying`, `repairing`, `summarizing`, `waiting_approval`, `completed`, `failed`, `stopped`.
- `src/agents/agent/agent-loop.ts` emits `agent.state_changed` with the `TaskStateMachine` target state.
- `src/coordination/kernel/coordination-scheduler.ts` emits `agent.state_changed` with `blocked`, `completed`, or `failed`.
- `src/agents/subagent-manager.ts` emits `thinking`; `subagent.result` emits `success|failed|rejected|partial`; terminal lifecycle emits corresponding completed/partial/failure values.

## Workbench mapping

`src/interfaces/tui/workbench/projections/agent-roster-projection.ts` directly accepts:

`queued`, `starting`, `thinking`, `tool_running`, `waiting`, `waiting_approval`, `waiting_dependency`, `verifying`, `completed`, `partial`, `failed`, `cancelling`, `cancelled`.

Aliases are:

- `pending -> queued`
- `running -> thinking`
- `executing -> tool_running`
- `done|success -> completed`
- `error|rejected -> failed`

Unknown values return the previous/fallback Workbench state.

## Confirmed projection-fidelity gap

The following emitted/canonical values have no direct mapping or alias and therefore fall back:

- `idle`
- `planning`
- `repairing`
- `summarizing`
- `stopped`
- `blocked`

This can leave Workbench displaying a stale prior state. This is a presentation/projection issue; the source evidence does not show Workbench becoming runtime completion authority.

## Independent agent review

A read-only isolated Codex verifier (`gpt-6.1-sol`, Codex CLI 0.164.0, `/tmp`, no repository inspection) reviewed the source-census facts. It agreed that the supplied evidence supports `deriveRunCompletion` remaining the runtime completion authority and identifies an incomplete Workbench mapping. It also required three caveats:

1. say **no competing completion authority was found in the inspected path**, not that all possible duplicate authority is globally disproved;
2. producer reachability does not establish observed frequency in real sessions;
3. the census proves fallback behavior, not the correct future UI mapping for each state.

The reviewer additionally identified `blocked` as an unmapped producer value, which is included above.

## Disposition

PRE-R004 has materially advanced: producer-to-projection mapping is now explicit and the prior unknown about legacy/state aliases is replaced by a concrete fidelity finding. It remains **PARTIAL** until either:

- the remaining state-consumer surfaces are exhaustively inventoried, or
- the PRD acceptance is explicitly scoped to the mapped ownership seams and the projection gap is separately tracked.

No production behavior change is authorized or implied by this record.
