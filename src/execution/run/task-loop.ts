/**
 * Task loop module — extracted from run.ts
 *
 * Contains the main iteration loop that:
 * - Sends requests to the model provider
 * - Handles tool calls
 * - Runs verification checks
 * - Manages the repair loop
 *
 * #717 — the implementation lives in `./task-loop/*.ts`; this barrel preserves
 * the original public import surface.
 */

export { runTaskLoop } from "./task-loop/main.js";
export type { TaskLoopDeps } from "./task-loop/main.js";
export {
  emitAgent,
  buildShedToolRetryMessage,
  explicitMutationTargets,
  isContinuationMessage,
  objectiveEvidenceRequirements,
  lastToolResultShowsClientError,
  latestToolFailure,
  durableCompletionSummary,
  claimsArtifactWritten,
} from "./task-loop/predicates.js";
