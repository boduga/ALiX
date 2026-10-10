// Back-compat shim - prefer importing from src/agents/agent/ or
// src/execution/run/run-contract.ts directly.
export { shouldAutoDisableStreaming, type StreamHandler } from "./agents/agent/stream.js";
export { buildErrorMessage, buildToolsForProvider, buildContextBundleEventPayload, buildModelUsageEventPayload, renderContextBundleForPrompt } from "./agents/agent/messages.js";
export { extractMutationPaths, validMutationPaths, recordMutationInSessionState, type MutationSessionState } from "./agents/agent/mutations.js";
export {
  EXIT_CODES,
  type SharedSession,
  type RunResult,
  type ContextPressure,
  type RunOpts,
} from "./execution/run/run-contract.js";

// Re-export runTask last to avoid circular import issues
export { runTask } from "./agents/agent/agent-loop.js";
