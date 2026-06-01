// Back-compat shim - prefer importing from src/agent/ directly
export { shouldAutoDisableStreaming, type StreamHandler } from "./agent/stream.js";
export { buildErrorMessage, buildToolsForProvider, buildContextBundleEventPayload, buildModelUsageEventPayload, renderContextBundleForPrompt } from "./agent/messages.js";
export { extractMutationPaths, recordMutationInSessionState, type MutationSessionState } from "./agent/mutations.js";

import type { EventLog } from "./events/event-log.js";
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
};

export type RunOpts = {
  streaming?: boolean;
  sessionMode?: "auto" | "ask" | "bypass";
  sharedSession?: SharedSession;
};

export const EXIT_CODES = {
  REJECTED_SCOPE_EXPANSION: 3,
} as const;

// Re-export runTask last to avoid circular import issues
export { runTask } from "./agent/agent-loop.js";