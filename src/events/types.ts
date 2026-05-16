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

export type InspectorContextItem = {
  path: string;
  kind: string;
  symbolName?: string;
  lineStart?: number;
  lineEnd?: number;
  score?: number;
  tokenEstimate?: number;
  reason?: string;
};

export type InspectorSnapshot = {
  sessionId: string;
  summary: {
    eventCount: number;
    status: "running" | "completed" | "failed" | "unknown";
    reason?: string;
    latestSeq?: number;
    startedAt?: string;
    endedAt?: string;
  };
  timeline: AlixEvent[];
  context?: {
    taskType?: string;
    budget?: { maxTokens: number; usedTokens: number };
    primaryFiles: InspectorContextItem[];
    tests: InspectorContextItem[];
    supportingFiles: InspectorContextItem[];
    pinned: InspectorContextItem[];
  };
  diffs: Array<{
    toolCallId?: string;
    changedFiles: string[];
    checkpointFiles: string[];
    rolledBack: boolean;
    status: "applied" | "failed" | "rolled_back" | "checkpointed";
  }>;
  terminal: Array<{
    toolCallId?: string;
    command: string;
    status?: string;
    outputPreview?: string;
    error?: string;
  }>;
  approvals: Array<{
    toolCallId?: string;
    toolName?: string;
    paths: string[];
    status: "pending" | "approved" | "denied" | "auto_approved" | "skipped";
  }>;
  verification: Array<{
    command: string;
    reason?: string;
    status?: "passed" | "failed" | "skipped" | string;
    output?: string;
  }>;
  tokens: {
    totalInputTokens: number;
    totalOutputTokens: number;
    entries: Array<{ provider?: string; model?: string; inputTokens: number; outputTokens: number }>;
  };
};

export type InspectorComparison = {
  leftSessionId: string;
  rightSessionId: string;
  changedFilesOnlyLeft: string[];
  changedFilesOnlyRight: string[];
  changedFilesBoth: string[];
  verificationStatus: { left: string; right: string };
  tokenDelta: { inputTokens: number; outputTokens: number };
};
