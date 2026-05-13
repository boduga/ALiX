export type EventActor = "user" | "agent" | "system" | "tool" | "policy" | "verifier";

export type AlixEvent<TType extends string = string, TPayload = unknown> = {
  id: string;
  seq: number;
  version: 1;
  sessionId: string;
  runId?: string;
  parentEventId?: string;
  timestamp: string;
  type: TType;
  actor: EventActor;
  payload: TPayload;
};

export type NewEvent<TType extends string = string, TPayload = unknown> = Omit<
  AlixEvent<TType, TPayload>,
  "id" | "seq" | "version" | "timestamp"
>;

export type SessionProjection = {
  sessionId: string;
  eventCount: number;
  approvals: Record<string, unknown>;
  changedFiles: string[];
  summary?: string;
};

// Additional event type unions for full event coverage
export type ToolEventPayload =
  | { toolCallId: string; toolName: string; argsPreview: Record<string, unknown>; capability: string }
  | { toolCallId: string; toolName: string; status: "success" | "error" | "denied"; outputSize?: number; outputPreview?: string; error?: string }
  | { toolCallId: string; toolName: string };

export type VerificationEventPayload =
  | { command: string; reason: string }
  | { command: string; status: "passed" | "failed"; output?: string }
  | { status: string; results: unknown[] };
