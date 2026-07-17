// Back-compat shim - prefer importing from src/agent/ directly
export { shouldAutoDisableStreaming, type StreamHandler } from "./agent/stream.js";
export { buildErrorMessage, buildToolsForProvider, buildContextBundleEventPayload, buildModelUsageEventPayload, renderContextBundleForPrompt } from "./agent/messages.js";
export { extractMutationPaths, recordMutationInSessionState, type MutationSessionState } from "./agent/mutations.js";

import type { EventLog } from "./events/event-log.js";
import type { NormalizedMessage } from "./providers/types.js";
export interface SharedSession {
  sessionId: string;
  sessionDir: string;
  eventLog: EventLog;
}

export type RunResult = {
  sessionId: string;
  summary: string;
  streamed?: boolean;
  reason?: "completed" | "max_repairs" | "max_iterations" | "rejected_scope_expansion";
  /** Unique run identifier for diagnostic correlation. */
  runId?: string;
};

export type RunOpts = {
  streaming?: boolean;
  sessionMode?: "auto" | "ask" | "bypass";
  sharedSession?: SharedSession;
  planMode?: boolean;
  resumeSessionId?: string;
  planFilePath?: string;
  readOnly?: boolean;
  messages?: NormalizedMessage[];
  skipContext?: boolean;
  disableSkillFactory?: boolean;
  parentRunId?: string;
  injectedContext?: {
    kind: string;
    content: string;
    metadata?: Record<string, unknown>;
  };
  boundTools?: Array<{
    definition: { name: string; description: string; inputSchema: Record<string, unknown> };
    handler: (args: Record<string, unknown>) => Promise<string>;
  }>;
};

export const EXIT_CODES = {
  REJECTED_SCOPE_EXPANSION: 3,
} as const;

// Re-export runTask last to avoid circular import issues
export { runTask } from "./agent/agent-loop.js";