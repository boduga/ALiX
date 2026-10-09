// src/contracts/runtime-fact-port.ts
//
// R1 boundary freeze — RuntimeFactPort.
// Append-only fact boundary. Reports persistence failure explicitly.
// No atomicity claim: R2 supplies transactional semantics.

export type RuntimeFactActor = "operator" | "agent" | "policy" | "system";

export interface RuntimeFact {
  type: string;
  payload: unknown;
  actor: RuntimeFactActor;
  sessionId?: string;
  runId?: string;
  agentId?: string;
  taskId?: string;
  correlationId?: string;
}

export type RuntimeFactAppendResult =
  | { ok: true; id: string; seq: number }
  | { ok: false; error: string };

export interface RuntimeFactPort {
  append(fact: RuntimeFact): Promise<RuntimeFactAppendResult>;
}
