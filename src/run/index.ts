// Barrel export for run module
// Re-export all public exports from run.ts

export {
  buildErrorMessage,
  buildToolsForProvider,
  buildContextBundleEventPayload,
  buildModelUsageEventPayload,
  renderContextBundleForPrompt,
  EXIT_CODES,
  extractMutationPaths,
  validMutationPaths,
  recordMutationInSessionState,
  shouldAutoDisableStreaming,
  runTask,
} from "../run.js";

// Re-export helpers for internal use
export {
  promptUser,
  saveDecisionsToMemory,
  streamToResponse,
  resolveMcpTool,
  patchFormatDescription,
  patchTextDescription,
  BASE_TOOLS,
  buildStateSummary,
} from "./helpers.js";

export type {
  StreamHandler,
  RunResult,
  RunOpts,
  MutationSessionState,
} from "../run.js";