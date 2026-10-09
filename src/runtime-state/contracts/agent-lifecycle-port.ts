// src/runtime-state/contracts/agent-lifecycle-port.ts
//
// R1 boundary freeze — AgentLifecyclePort.
// Canonical lifecycle transitions only. Projections consume these
// events; painters must not infer transitions.

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
