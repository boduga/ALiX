// src/runtime-state/contracts/agent-lifecycle-port.ts
//
// R1 boundary freeze — AgentLifecyclePort.
// Canonical lifecycle transitions only. Projections consume these
// events; painters must not infer transitions.
//
// Event-type strings for this lifecycle live in
// `src/runtime-state/events/types.ts` (`AGENT_LIFECYCLE_EVENT_TYPES`,
// legacy `SUBAGENT_EVENT_TYPES`) — this port stays type-only and never
// duplicates them. The browser projection (`src/interfaces/ui/projection.js`)
// cannot import TS, so `tests/ui/projection.vitest.ts` pins the TS↔JS
// vocabulary parity instead (renames break loudly there).

export type AgentLifecycleState =
  | "spawned"
  | "ready"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked";

export interface AgentLifecycleTransition {
  agentId: string;
  from: AgentLifecycleState;
  to: AgentLifecycleState;
  taskId?: string;
  runId?: string;
  reason?: string;
  at: string;
}

export interface AgentLifecyclePort {
  record(transition: AgentLifecycleTransition): Promise<{ ok: true } | { ok: false; error: string }>;
}
