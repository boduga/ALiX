/**
 * Task loop module — extracted from run.ts
 *
 * Contains the main iteration loop that:
 * - Sends requests to the model provider
 * - Handles tool calls
 * - Runs verification checks
 * - Manages the repair loop
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ModelAdapter, NormalizedMessage, ToolCall, TokenUsage, ToolDef } from "../../../models/providers/types.js";
import type { DeferredToolEntry } from "../../../capabilities/mcp/tool-deferral.js";
import {
  MCP_TOOL_PREFIX,
  builtinCandidateId,
  candidateIdFor,
  freezeToolCandidates,
} from "../../../planning/decision/tool-selection-candidates.js";
import type { SurfaceGap } from "../../../operations/observability/tool-selection-observation.js";
import { selectionTraceEnabled } from "../../../operations/observability/tool-selection-observation.js";
import type { EventLog } from "../../../runtime-state/events/event-log.js";
import type { MemoryStore } from "../../../operations/utils/memory/store.js";
import type { ExecutionContext } from "../../../operations/observability/execution-context.js";
import type { ScopeTracker } from "../../../planning/autonomy/scope-tracker.js";
import type { TaskStateMachine } from "../../../planning/autonomy/state-machine.js";
import { classifyTask } from "../../../task-classifier.js";
import type { MutationSessionState, RunResult } from "../../../run.js";
import { recordMutationInSessionState, extractMutationPaths } from "../../../agents/agent/mutations.js";
import { buildModelUsageEventPayload } from "../../../agents/agent/messages.js";
import { DEFAULT_FACTORY_CONFIG } from "../../../capabilities/skills/dispatcher.js";
import "../../verifier/index.js";
import { EnhancedVerifier } from "../../verifier/enhanced-verifier.js";
import { streamToResponse, continueTruncatedGeneration, TRUNCATION_CONTINUATION_LIMIT } from "../helpers.js";
import "../helpers.js";
import { createContextPressureTracker } from "../context-pressure.js";
import "../../../session/index.js";
import {
  handleToolCall,
  handleMcpToolSearch,
  handleScopeExpansion,
  handleShedToolCall,
  buildScopeDenialMessage,
  buildScopeRejectionSummary,
  type EventHandlerDeps,
} from "../event-handlers.js";
import { ProgressLedger } from "../progress-ledger.js";
import { IntentClassifier, type AgentIntent } from "../intent-classifier.js";
import type { TokenizerName } from "../../../operations/config/context-limits.js";
import type { ContextBudget, TierOrderingConfig } from "../../../operations/config/context-budget.js";
import { assembleContext } from "../../../operations/config/context-assembly.js";
import { MetricsStore } from "../../../operations/observability/metrics-store.js";
import { createMetricRegistry } from "../../../operations/observability/metric-registry.js";
import { StateTelemetry } from "../../../operations/observability/state-telemetry.js";
import { CONTEXT_EVENT_TYPES, TOOL_EVENT_TYPES, type TokenCalibrationPayload, type ToolingScopeFallbackFullPayload, type ToolingScopeReintroducedPayload } from "../../../runtime-state/events/types.js";
import { hashArgs } from "../../../capabilities/tools/hash-args.js";
import { loadCalibration, type ContextRotThreshold } from "../../../operations/config/calibration-store.js";
import { createModelResolver } from "../../../operations/config/model-resolver.js";
import { buildOfferedExecutableTools } from '../../../agents/tool-name-resolver.js';
import type { ModelsConfig } from "../../../operations/config/schema.js";
import {
  DEFAULT_TOOL_EXECUTION_POLICY,
  canParallelize,
  scheduleToolCalls,
  type ToolExecutionPolicy,
} from "../../../runtime-state/runtime/tool-scheduler.js";
import type { CorrelationContext } from "../../../runtime-state/runtime/tool-correlation.js";
import { createCorrelationContext } from "../../../runtime-state/runtime/tool-correlation.js";
import type { CancellationToken } from "../../../runtime-state/runtime/cancellation-token.js";
import { raceWithCancellation } from "../../../runtime-state/runtime/cancellation-token.js";
import { initExecutionStateEmission, buildLiveSendRequest } from "./execution-state-phase.js";
import type { ExecutionStateEmitter } from "../../../runtime-state/runtime/execution-state/execution-state-emitter.js";
import { assembleBudgetedContext, buildEffectiveSystemPrompt, injectProgressLedger } from "./context-phase.js";
import { runIterationVerification } from "./verification-phase.js";
import { runNoToolsCompletion, runDeferredCompletion, coordinationRunIsVerified, type CompletionState, type CompletionContext } from "./completion-phase.js";
import { COORDINATION_RUN_TOOL_NAME, NARRATING_THRESHOLD, SuccessfulToolEvidence, buildRequirementCandidates, buildSelectionObservation, buildShedToolRetryMessage, emitAgent, explicitMutationTargets, isCompletionTool, isContinuationMessage, objectiveEvidenceRequirements, renderSurfaceBlockNotice, resolveToolExecutionName, toolResultBody } from "./predicates.js";
import { buildContextBudgetOverflowSummary, completeSession, isIrreducibleContextBudgetOverflow, maybeEmitRotRisk, persistSessionState } from "./session-lifecycle.js";

// Process-local sequence for frozen candidate surfaces (`scopeId`). One per run
// today; replay joins selectors to scopes on the id, never on the iteration.
let selectionScopeSequence = 0;

/**
 * The frozen surfaces an observation needs, taken from the builder's own
 * parameter type so the two can never drift apart.
 */
type SelectionObservationContext = Pick<
  Parameters<typeof buildSelectionObservation>[0],
  "candidates" | "candidateBindings" | "scoping" | "ranking" | "requirementCandidates" | "surfaceGaps"
>;

/**
 * Every optional key of `SelectionObservationContext`, so the field-by-field
 * forwarding inside `emitSelectionObservation` can be checked at compile time.
 * `emitSelectionObservation` builds its argument by hand, which means a new
 * context field is TYPE-accepted but DROPPED at runtime unless it is also
 * forwarded — that has silently swallowed `invalidSelection` and `surfaceGaps`.
 * `SelectionObservationContextKey` is asserted by a test that drives the real loop.
 */
/**
 * Every key the emitter must forward, listed so a test can assert the
 * hand-built argument inside `emitSelectionObservation` carries all of them.
 * Deriving it from the type is what makes the test meaningful: adding a context
 * field without forwarding it fails `tests/run/selection-context-forwarding`.
 */
export type SelectionObservationContextKey = keyof SelectionObservationContext;

/**
 * Emit one frozen selection scope.
 *
 * Extracted so every path that lets the model choose among the frozen
 * candidates records the same scope shape — including the
 * `alix_mcp_search_tools` short-circuit, which used to `continue` past the
 * observation and leave external turns unscoped (cohort `t3d-2026-09-28-c`:
 * eight external tasks, zero scopes).
 */
async function emitSelectionObservation(
  log: EventLog,
  session: { sessionId: string; actor: "system" },
  input: {
    scopeId: string;
    iteration: number;
    invocationId?: string;
    toolCall: ToolCall;
    /** The same offered surface the loop resolves executor names from. */
    offered: Parameters<typeof resolveToolExecutionName>[1];
    seenSignatures: Map<string, number>;
    toolResult: { error?: unknown; message?: { content?: unknown }; changed?: boolean };
    context: SelectionObservationContext;
  },
): Promise<void> {
  const execName = resolveToolExecutionName(input.toolCall.name, input.offered);
  const body = toolResultBody(
    typeof input.toolResult.message?.content === "string" ? input.toolResult.message.content : undefined,
  );
  const observation = buildSelectionObservation({
    scopeId: input.scopeId,
    iteration: input.iteration,
    ...(input.invocationId ? { invocationId: input.invocationId } : {}),
    candidates: input.context.candidates,
    ...(input.context.candidateBindings ? { candidateBindings: input.context.candidateBindings } : {}),
    chosen: input.toolCall.name,
    chosenCandidateId: candidateIdFor(input.toolCall.name),
    executor: execName,
    argsSignature: `${execName}:${hashArgs(input.toolCall.args)}`,
    seenSignatures: input.seenSignatures,
    executorSuccess: !input.toolResult.error,
    repaired: body.includes("[Tool Repair Hint]"),
    // A create that found identical content is a provable no-op.
    noOp: input.toolResult.changed === false && /identical content/i.test(body),
    hasContent: body.length > 0,
    ...(input.context.requirementCandidates ? { requirementCandidates: input.context.requirementCandidates } : {}),
    // Forwarded explicitly like every other context field: the type permits it,
    // but a field missing here is silently dropped at runtime, which is how
    // `invalidSelection` and then `surfaceGaps` both went missing.
    ...(input.context.surfaceGaps ? { surfaceGaps: input.context.surfaceGaps } : {}),
    ...(input.context.scoping ? { scoping: input.context.scoping } : {}),
    ...(input.context.ranking ? { ranking: input.context.ranking } : {}),
    ...(input.context.candidates.some(candidate => candidate.candidateId === candidateIdFor(input.toolCall.name))
      ? {}
      : { invalidSelection: { toolName: input.toolCall.name, reason: "chosen tool is not in the offered surface" } }),
  });
  // The gate lives on BOTH emit sites, not just the shared emitter. This
  // wrapper appends directly and is the path the runbook's `alix run` batch
  // uses, so gating only `tool-selection-observation.ts` left the hot path
  // writing the very telemetry the gate exists to suppress. Proven by
  // deleting ALIX_TOOL_SELECTION_TRACE and watching
  // `task-loop-mcp-search-selection.vitest.ts` still pass.
  if (!selectionTraceEnabled()) return;
  await log.append({
    ...session,
    actor: "system",
    type: TOOL_EVENT_TYPES.SELECTION_OBSERVED,
    payload: observation,
  });
}

export interface TaskLoopDeps {
  config: {
    // The loop resolves the effective model from the canonical `models`
    // source only (§10) — no `model` projection is forwarded.
    models?: ModelsConfig;
permissions: {
  sessionMode?: "auto" | "ask" | "bypass";
};
skills?: {
  factory?: typeof DEFAULT_FACTORY_CONFIG;
};
context?: {
  budget?: {
    tierOrdering?: TierOrderingConfig;
  };
};
  };
  provider: ModelAdapter;
  providerTools: ToolDef[];
  boundTools?: import("../../../capabilities/tools/collaboration-tools.js").BoundTool[];
  mcpToolIndex: DeferredToolEntry[];
  messages: NormalizedMessage[];
  sessionState: MutationSessionState;
  stateMachine: TaskStateMachine;
  scope: ScopeTracker;
  session: { sessionId: string; actor: "system" };
  log: EventLog;
  executor: import("../../../capabilities/tools/executor.js").ToolExecutor;
  mcpDiscovery: import("../../../capabilities/mcp/tool-discovery.js").ToolDiscovery | null;
  selectedTools: { name: string; execName: string }[];
  hooks: {
pre_task?: { command: string; reason: string }[];
post_task?: { command: string; reason: string }[];
  };
  maxIterations: number;
  contextBudget: ContextBudget;
  tokenizer: TokenizerName;
  task: string;
  taskType: string;
  /**
   * First-turn session objective. When the turn task is a bare continuation
   * (see `isContinuationMessage`), evidence requirements are evaluated
   * against this instead of the turn text — otherwise follow-up turns can
   * `ls + done` their way to `completed` on a build objective. Optional;
   * when unset, evidence is evaluated against the turn task (legacy).
   */
  sessionGoal?: string;
  depth: "quick" | "deep";
  readOnly?: boolean;
  shellTask?: boolean;
  embedderDbPath?: string;
  memoryStore: MemoryStore;
  sessionId: string;
  sessionDir: string;
  /**
   * Workspace root for state lookups the loop performs itself (the
   * coordination completion check). Defaults to `process.cwd()`.
   */
  cwd?: string;
  systemPrompt: string;
  onStream?: (chunk: { type: "text" | "tool_call" | "reasoning"; text?: string; toolCall?: ToolCall }) => void;
  hookRunner?: import("../../../capabilities/extensions/hook-runner.js").HookRunner;
  context?: ExecutionContext;
  /** When true (default), tool outputs are streamed to stdout. */
  verbose?: boolean;
  /** Called each iteration after the progress ledger is rendered. */
  onLedgerUpdate?: (text: string) => void;
  /** Called when agent intent classification changes. */
  onCurrentIntentUpdate?: (intent: AgentIntent) => void;
  /**
   * Progress-based liveness feed — called at discrete execution milestones
   * (model response, tool completion). The turn tracker debounces streamed
   * tokens separately; this hook carries the coarser, description-bearing
   * milestones.
   */
  onProgress?: (kind: import("../../../agents/agent/agent-liveness.js").AgentProgressKind, description?: string) => void;
  /** Invocation-local full successful result evidence; observer failures are isolated. */
  onToolResult?: (toolName: string, content: string) => void;
  currentIntent?: AgentIntent;
  /** T4: harness-side parallel dispatch policy. Defaults to allowParallel:true maxParallel:4. */
  toolExecutionPolicy?: ToolExecutionPolicy;
  /**
   * Operator-cancellation token (Task 6.1). Checked at loop safe points
   * (iteration top) so a cancel is honoured between provider calls / tools.
   * Optional — the CLI/daemon paths that do not surface operator cancel omit it.
   */
  cancellationToken?: CancellationToken;
  /**
   * Abort signal fired when the operator cancels (paired with
   * `cancellationToken`). Raced against the in-flight provider request/stream
   * so a cancel releases a hung provider call the instant it is requested.
   * Optional; omitted when cancellation is not armed.
   */
  cancelSignal?: AbortSignal;
  executionState?: ExecutionStateEmitter | null;
  /** Internal fixed coordination intent; never an arbitrary operator-supplied tool name. */
  coordinationKickoff?: import('../../../agents/agent/session/types.js').CoordinationRunRequest;
}

/**
 * Execute the main task loop.
 * This runs the model, handles tool calls, and manages verification.
 */

export async function runTaskLoop(deps: TaskLoopDeps): Promise<RunResult> {
  const {
config,
provider,
providerTools,
boundTools,
mcpToolIndex,
sessionState,
stateMachine,
scope,
session,
log,
executor,
mcpDiscovery,
selectedTools,
hooks,
maxIterations,
contextBudget,
tokenizer,
  task,
  taskType,
  sessionGoal,
  depth,
memoryStore,
sessionId,
sessionDir,
systemPrompt,
onStream,
onProgress,
  } = deps;

  const allowedMutationPaths = explicitMutationTargets(task);

  // Evidence scope: a bare continuation turn ("continue", "proceed", ...)
  // inherits the session's original objective for verification purposes,
  // so follow-up turns are held to the same bar as the first turn.
  // `task` itself is untouched — prompts and scope stay turn-scoped.
  const evidenceTask = sessionGoal && isContinuationMessage(task) ? sessionGoal : task;
  const evidenceTaskType = evidenceTask === task ? taskType : classifyTask(evidenceTask);

  // §10.1: runtime model resolution reads the canonical `models` object only.
  // deps.config is a partial config projection; the resolver only reads `.models`.
  const model = createModelResolver(config).require();

  // Governed execution-state emission (opt-in flag; fail-soft). Prefers the
  // caller-provided session emitter so post-loop reconcile shares it.
  const executionState = await initExecutionStateEmission({ log, sessionId, objective: evidenceTask, existing: deps.executionState ?? undefined });

  // ── Task 9 (§6): Load calibration once per run for `context.rot_risk` advisory.
  // Independent of Task 4's deferred §1 factor wiring — we only need to read
  // `contextRotThreshold` here. `loadCalibration` returns `{}` on a missing/
  // unreadable file, so `calibration.contextRotThreshold` is `undefined` in
  // the default state → no emission. This is the UNSET-by-default invariant.
  const calibration = await loadCalibration();
  const contextRotThreshold: ContextRotThreshold | undefined = calibration.contextRotThreshold;

  // ── T7: Tool scoping (§2 admission-control) ─────────────────────────
  const { scopeToolsByTask } = await import("../../../operations/config/tool-scoping.js");
  // Full registry — every tool the model COULD name (provider + MCP). Consumed
  // by Task 8's shed-tool handler to re-admit a scoped-out schema on call.
  const fullToolRegistry = [...providerTools, ...mcpToolIndex];
  const {
    core: coreTools,
    extended: extendedTools,
    fallbackFull,
    provenance: scopingProvenance,
  } = scopeToolsByTask(providerTools, mcpToolIndex, task, taskType);
  if (deps.coordinationKickoff && ![...coreTools, ...extendedTools].some(tool => tool.name === 'alix_coordination_run')) {
    throw new Error('Coordination execution is unavailable: its exact tool is not offered on this surface.');
  }
  // Requirement-derived candidates for the shadow observation: what ALiX
  // believed this objective required, distinct from what the scoper offered.
  const requirementCandidatesForTurn = buildRequirementCandidates(
    objectiveEvidenceRequirements(evidenceTask, evidenceTaskType),
  );
  // Which requirement-closing tools the objective needed but the surface could
  // not offer, and why. Computed here, while both the scoper verdict and the
  // pre-scoper surface are still in hand: `scoping.excluded` is debug-gated and
  // explains only scoper drops, so a tool removed upstream (session mode strips
  // `alix_shell_run` in read-only) would otherwise look like a clean surface.
  // This is the signal T3 lacked — see `deriveSurfaceGaps`.
  const surfaceGapsForTurn: SurfaceGap[] = requirementCandidatesForTurn
    .filter(candidate => !fullToolRegistry.some((t) => t.name === candidate.tool))
    .map(candidate => ({
      candidateId: builtinCandidateId(candidate.tool),
      toolName: candidate.tool,
      reasons: [...candidate.reasons],
      absence: "absent-upstream" as const,
    }));
  const scoperExcludedIds = new Set(scopingProvenance.excluded.map(entry => entry.tool));
  for (const candidate of requirementCandidatesForTurn) {
    if (surfaceGapsForTurn.some(gap => gap.candidateId === builtinCandidateId(candidate.tool))) continue;
    if (scoperExcludedIds.has(candidate.tool)) {
      surfaceGapsForTurn.push({
        candidateId: builtinCandidateId(candidate.tool),
        toolName: candidate.tool,
        reasons: [...candidate.reasons],
        absence: "scoper-excluded",
      });
    }
  }
  // Tell the MODEL, not just the operator. `surfaceGapsForTurn` already
  // recorded that the surface could not offer a tool the objective needed;
  // without this the model cannot distinguish "impossible here" from "I
  // should just read the file instead", and answers an execution request from
  // inspection without saying the check never ran. `surfaceBlockNoticeForTurn`
  // is pushed into the message list below, before the first model turn.
  const surfaceBlockNotice = renderSurfaceBlockNotice(surfaceGapsForTurn);
  const selectionDebug = process.env.ALIX_TOOL_SELECTION_DEBUG === "1";
  // Deterministic orderings for the shadow trace, taken from the layers that
  // own them: the scoper's relevance ranking, and the MCP selector's scores.
  const { createToolSelector } = await import("../../../capabilities/mcp/tool-selector.js");
  const mcpSelectorRanking = mcpToolIndex.length > 0 ? createToolSelector(mcpToolIndex).rank(task) : [];
  // The candidate surface is frozen here, once, so the scope id is minted here:
  // replay joins selectors to scopes on this id, not on the iteration number.
  const scopeId = `scope_${++selectionScopeSequence}`;
  // The frozen surface is the surface the model is actually offered: scoped
  // core + extended, which includes the MCP entries this task admitted. It is
  // sanitized once, here — an MCP candidate is recorded as `mcp:<short hash>`
  // plus a readable label, and its opaque handle stays in a local-only binding,
  // so a recorded scope can never carry a handle to the remote boundary.
  const providerByName = new Map(providerTools.map((tool) => [tool.name, tool]));
  const mcpByName = new Map(mcpToolIndex.map((entry) => [entry.name, entry]));
  const wireSurface: Array<ToolDef | DeferredToolEntry> = [...coreTools, ...extendedTools];
  const frozenSurface = freezeToolCandidates({
    builtin: wireSurface
      .filter((tool) => !tool.name.startsWith(MCP_TOOL_PREFIX))
      .map((tool) => ({
        name: tool.name,
        description: providerByName.get(tool.name)?.description ?? tool.description,
      })),
    mcp: wireSurface
      .filter((tool) => tool.name.startsWith(MCP_TOOL_PREFIX))
      .map((tool) => {
        const entry = mcpByName.get(tool.name);
        return entry
          ? {
              name: entry.name,
              description: entry.description,
              ...(entry.searchName !== undefined ? { searchName: entry.searchName } : {}),
              ...(entry.serverName !== undefined ? { serverName: entry.serverName } : {}),
              ...(entry.toolName !== undefined ? { toolName: entry.toolName } : {}),
              ...(entry.execName !== undefined ? { execName: entry.execName } : {}),
            }
          : { name: tool.name, description: tool.description };
      }),
  });
  const frozenRanking = {
    // The scoper's relevance ordering (see SelectionObservation.ranking).
    scoper: scopingProvenance.ranking.map((entry) => ({
      candidateId: candidateIdFor(entry.tool),
      score: entry.score,
    })),
    ...(mcpSelectorRanking.length > 0
      ? {
          mcpSelector: mcpSelectorRanking.map((entry) => ({
            candidateId: candidateIdFor(entry.tool),
            score: entry.score,
          })),
        }
      : {}),
  };
  const frozenScoping = {
    admitted: scopingProvenance.admitted.map((entry) => ({
      candidateId: candidateIdFor(entry.tool),
      reasons: entry.reasons,
    })),
    fallbackFull: scopingProvenance.fallbackFull,
    // Exclusions are debug-only: they answer "why wasn't the
    // requirement-closing tool offered?" and can grow unbounded.
    ...(selectionDebug
      ? {
          excluded: scopingProvenance.excluded.map((entry) => ({
            candidateId: candidateIdFor(entry.tool),
            reasons: entry.reasons,
          })),
        }
      : {}),
  };
  // Scoped-out set = full registry minus (core ∪ extended). These MUST NOT reach
  // the wire; a model call to one is a shed-tool call → Task 8 re-scope.
  const scopedOutNames = new Set(
    fullToolRegistry.map((t) => t.name).filter((n) => !coreTools.some((c) => c.name === n) && !extendedTools.some((e) => e.name === n))
  );
  if (fallbackFull) {
    await log.append({
      sessionId: `${session.sessionId}-agent`, actor: "system",
      type: CONTEXT_EVENT_TYPES.TOOLING_SCOPE_FALLBACK_FULL,
      payload: {
        provider: model.provider,
        model: model.name,
        reason: "no_relevance_signal",
      } satisfies ToolingScopeFallbackFullPayload,
    });
  }

  // ── T8: Shed-tool reintroduce-on-call (§2 retry-once) ────────────────
  // shedToolsRetried: names already retried this run. A second call to the
  // same shed name falls through to the normal invalid-tool path (no infinite
  // loop, no second reintroduced event).
  // reintroducedTools: schemas to append to the wire tools array on subsequent
  // iterations. Additive-only — never re-classifies, never drops core/extended.
  const shedToolsRetried = new Set<string>();
  const reintroducedTools: Array<ToolDef | DeferredToolEntry> = [];

  // Aggregate + peak context pressure across the run (spec §3). Pure
  // observability — records per-iteration assembly drops; consumed only at
  // terminal returns. No admission behavior change.
  const contextPressure = createContextPressureTracker();

  // #641 — Context assembly observability: MetricsStore/TelemetryEnvelope sink for
  // source/selected/evicted/tokens per tier + stateVersion/historyRevision.
  // Non-fatal, fire-and-forget; does not affect assembly/preflight semantics.
  let stateTelemetry: StateTelemetry | null = null;
  try {
    const cwd = process.cwd();
    stateTelemetry = new StateTelemetry({
      registry: createMetricRegistry(),
      metricsStore: new MetricsStore(cwd),
      sessionId: session.sessionId,
    });
  } catch { /* observability sink unavailable — non-fatal */ }

  // Track the latest invocationId so the §6 rot_risk advisory at terminal
  // return can correlate with the most recent model-facing snapshot.
  let lastInvocationId = "";
  // T5 hierarchy: executionId → invocationId → toolCallId. executionId is the
  // run-level correlation root (workflowId/runId/sessionId) fixed for the whole loop.
  const executionId: string = (deps.context?.workflowId as string | undefined)
    ?? (deps.context?.runId as string | undefined)
    ?? session.sessionId;

  // Run identity for hook commands. The shell expands $VAR natively, so a
  // post_task entry like `query.mjs --list --session "$ALIX_SESSION_ID"`
  // targets this run's traces (sessionId rides every Langfuse observation;
  // the OTel trace id is opaque by design and never exposed here).
  // Status is per-site below (running at pre_task, success at the done path).
  const hookRunEnv: Record<string, string> = {
    ALIX_RUN_ID: (deps.context?.runId as string | undefined) ?? "",
    ALIX_SESSION_ID: deps.sessionId ?? session.sessionId ?? "",
  };

  // Initialize EnhancedVerifier for historical failure matching
  const embedderDbPath = deps.embedderDbPath ?? join(homedir(), ".alix", "failures.db");
  let enhancedVerifier: EnhancedVerifier | null = null;

  try {
enhancedVerifier = new EnhancedVerifier({
  cwd: ".",
  embedderDb: embedderDbPath,
});
await enhancedVerifier.init();
await log.append({ ...session, actor: "system", type: "embedder.initialized", payload: { dbPath: embedderDbPath } });
  } catch (err) {
await log.append({ ...session, actor: "system", type: "embedder.init_failed", payload: { error: String(err) } });
  }

  // Last model prose persisted as an agent.message event this run. Declared
  // outside the main try so catch-path returns can carry it too. Returned
  // on RunResult so the TUI can skip re-persisting an identical turn summary
  // as agent.response (write-time dedup of a known double-write).
  let lastAgentProse: string | undefined;

  try {
// Track search calls for research tasks
let searchCalls = 0;

// Use a mutable variable for messages since we need to reassign during truncation
let messages = deps.messages;

let repairCount = 0;
const maxRepairs = 3;

// Track last saved message count for incremental persistence

// Get the McpManager from executor (executor holds a reference)
interface HasMcpManager {
  manager?: import("../../../capabilities/mcp/manager.js").McpManager;
}
const mcpManager = (executor as HasMcpManager).manager ?? null;

// ── Progress checkpoint state ──────────────────────────
let toolCallsSinceCheckpoint = 0;
let lastCheckpointWallClock = Date.now();
const CHECKPOINT_TOOL_CALL_THRESHOLD = 5;
const CHECKPOINT_WALL_CLOCK_MS = 30_000;
const progressLedger = new ProgressLedger();

// ── Intent classification state ─────────────────────────
const intentClassifier = new IntentClassifier();
let currentIntent: AgentIntent = deps.currentIntent ?? "research";
let intentStreak = 0;

// ── Honest completion state ────────────────────────────
// Track which tools have been invoked across iterations. Used by the
// synthesis re-prompt to tell the model what tools it hasn't tried yet,
// and also now used to gate completion (see findUnsubstantiatedClaims).
const usedTools = new Set<string>();
// Per-turn guard against a model looping on the same read-only search call
// (e.g. 20× identical grep.search). Keyed by tool+args signature.
const searchCallGuard = new Map<string, number>();
const successfulToolEvidence: SuccessfulToolEvidence[] = [];
let toolEvidenceOrdinal = 0;
// Shadow selection instrumentation: executor+args signature -> how many times
// this turn has seen it. Feeds `tool.selection.observed`; never a gate.
const selectionSignatures = new Map<string, number>();

// True only when the model has made a genuine structured "done"-style tool
// call (toolResult.completed). Prose that merely contains the word "done"
// does NOT set this — that distinction is the whole point of this fix.
let explicitDoneCalled = false;
// How many times we've refused a prose-only completion claim and asked the
// model to either call `done` explicitly or substantiate its claims. Bounded
// so a persistently non-compliant model still terminates (just labeled
// honestly instead of silently accepted as "completed").
let unconfirmedDoneAttempts = 0;
const MAX_UNCONFIRMED_DONE_ATTEMPTS = 2;

// Verification state of the most recent `coordination.run` this run, cleared by
// a later call that proves verification. True when the call itself failed OR
// the run it started is not verified (execution terminal + aggregate generated
// + outcome known + verification evidence present). Gates every
// completed-status emission (Path A trust, verification-pass Path B,
// trackCompleted, shell-complete, research limits) so neither a failed
// coordination call nor an unverified run can surface task.done /
// graph.completed / workflow.completed / session.ended:completed (durability
// contract). In-process, per-invocation.
let coordinationUnverified = false;

// Truncation continuation: when a provider stops mid-answer at the output
// budget (finish_reason=length), keep generating until the answer completes.
// The budget / continue-prompt / accumulate-and-merge logic is the SHARED
// helper in helpers.ts (continueTruncatedGeneration + TRUNCATION_CONTINUATION_LIMIT),
// so the task loop and processChat enforce ONE continuation contract instead
// of two divergent copies. `truncationContinuations` bounds the total across
// the whole run (a fresh chain after a tool turn must not restart the budget).
let truncationContinuations = 0;

// No-tool prose replies: the loop is a tool-first harness, so a text-only
// reply that does not signal done is nudged ONCE toward invoking a tool (or
// the `done` tool). If the model still answers with plain text and has never
// invoked a tool, that answer is accepted through the normal completion path
// instead of re-prompting with identical context on every iteration until
// max_iterations. `noToolNudges` is never reset mid-run.
const NO_TOOL_NUDGE_LIMIT = 1;
let noToolNudges = 0;
// A completed tool sequence gets at most one dedicated synthesis request.
// Without this latch, a model that answers the request with another `done`
// call can consume the entire iteration budget repeating done/synthesis.
let synthesisRequested = false;
// A model can answer a synthesis request with a bare `done` call. Permit one
// final prose-only retry, but never let that behavior become an unbounded
// done/synthesis cycle.
let emptySynthesisRetryRequested = false;

for (let i = 0; i < maxIterations; i++) {
stateMachine.tick(0);

// ── Operator cancellation (Task 6.1): checked at the loop's safe point ──
// A cancel requested while a tool runs / verification runs / the loop is
// between awaits is honoured here, before any further provider call or tool
// dispatch. Throws ExecutionCancelledError → classified cancelled upstream.
deps.cancellationToken?.throwIfCancelled();

// Track if any mutations occurred in this iteration
const hasMutations = sessionState.created.size > 0 || sessionState.changed.size > 0 || sessionState.deleted.size > 0;

// Truncate messages if token budget exceeded before streaming/completion.
// Detection and truncation share the same tokenizer-based estimator — the
// char/4 detection is gone (E1).
	// ── T6: context.snapshot.created — once per model-facing invocation ──
	// Globally-unique invocation id (C2 #21): a per-call counter is not
	// unique across separate runTaskLoop invocations on the same session
	// (e.g. resume, sub-tasks). A UUID keeps timeline correlation unambiguous
	// across re-entry; the sessionId is already on the event itself.
	const invocationId = `inv-${randomUUID()}`;
	lastInvocationId = invocationId;

  // Build intent-specific system prompt (moved up — budget assembly needs it).
  const { wireTools, effectiveSystemPrompt } = buildEffectiveSystemPrompt({
    systemPrompt,
    currentIntent,
    coreTools,
    extendedTools,
    reintroducedTools,
  });

  // THE resolution surface for telemetry labels (hooks, evidence names, the
  // selection observation). It is the tools ACTUALLY OFFERED, paired with MCP
  // executors — NOT `selectedTools`, which is the relevance-truncated selector
  // list (capped at 20 against a 24-tool registry) and was the reason 102 of
  // 170 resolutions asked for a name the resolver could not find.
  const offeredForResolution = buildOfferedExecutableTools(wireTools, mcpToolIndex);

  // ── I1: Inject progress ledger BEFORE budget admission so it is
  // token-accounted (Tier 3, protected); see injectProgressLedger.
  messages = injectProgressLedger({
    messages,
    progressLedger,
    onLedgerUpdate: deps.onLedgerUpdate,
  });

  // Surface the limitation before the first model turn, so the model reads it
  // rather than inferring it from a rejected call. Placed after the progress
  // ledger so the constraint is the most recent thing in the assembled
  // context, and after budget injection is irrelevant — it goes in ahead of
  // `assembleBudgetedContext` below so it is subject to normal admission.
  if (surfaceBlockNotice) {
    messages = [...messages, { role: "user", content: surfaceBlockNotice }];
  }


	let assembled: ReturnType<typeof assembleContext>;
	let admittedSystemPrompt: string;

	// ── Context Budget admission gate (C0) ─────────────────────────────
	// Extracted to `assembleBudgetedContext` (#717 method decomposition).
	{
	  const assembledContext = await assembleBudgetedContext({
	    effectiveSystemPrompt,
	    messages,
	    tokenizer,
	    coreTools,
	    extendedTools,
	    session,
	    log,
	    invocationId,
	    contextBudget,
	    tierOrdering: config.context?.budget?.tierOrdering,
    contextPressure,
    iteration: i,
    stateTelemetry,
    executionId,
    shadow: executionState ? { emitter: executionState, objective: evidenceTask, tools: wireTools } : undefined,
  });
	  messages = assembledContext.messages;
	  assembled = assembledContext.assembled;
	  admittedSystemPrompt = assembledContext.admittedSystemPrompt;
	}

  const liveSend = buildLiveSendRequest({ emitter: executionState, intent: currentIntent, objective: evidenceTask, tools: wireTools, messages });
  const modelSystemPrompt = liveSend?.systemPrompt ?? admittedSystemPrompt;

// Run pre_task hooks at the start of each iteration
const { runHook } = await import("../../../operations/hooks/runner.js");
for (const hook of hooks.pre_task ?? []) {
  await log.append({ ...session, actor: "system", type: "hook.pre_task", payload: { command: hook.command, reason: hook.reason } });
  const result = await runHook(hook, deps.sessionId, { ...hookRunEnv, ALIX_RUN_STATUS: "running" });
  await log.append({ ...session, actor: "system", type: "hook.pre_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
}

let text = "";
let reasoning = "";
let toolCalls: ToolCall[] = [];
let usage: TokenUsage | undefined;
let resolvedModel: string | undefined;
let finishReason: string | undefined;

// System prompt was built above (before budget assembly). Use the
// assembly-admitted system prompt that survived the budget gate.
//
// ── Model generation ────────────────────────────────────────────
// One generation path (runModelTurn) is shared by the main turn AND every
// truncation continuation below (continueTruncatedGeneration in helpers.ts).
// With an operator-cancel signal armed (Task 6.1) the request/stream is
// raced against it; without a signal behaviour is unchanged. Text chunks are
// written to stdout by streamToResponse; reasoning never is.
const runModelTurn = async (
  msgs: NormalizedMessage[],
): Promise<{
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  usage: TokenUsage | undefined;
  resolvedModel: string | undefined;
  finishReason: string | undefined;
}> => {
  let segment: {
    text: string;
    reasoning: string;
    toolCalls: ToolCall[];
    usage: TokenUsage | undefined;
    resolvedModel: string | undefined;
    finishReason: string | undefined;
  };
  if (model.streaming && provider.stream) {
    const result = await streamToResponse(provider, {
      systemPrompt: modelSystemPrompt,
      messages: msgs,
      tools: wireTools,
      maxOutputTokens: contextBudget.requestedMaxOutputTokens,
      context: deps.context,
    }, deps.cancelSignal
      ? { onStream, signal: deps.cancelSignal, writeToStdout: deps.verbose ?? true }
      : { onStream, writeToStdout: deps.verbose ?? true });
    segment = {
      text: result.text,
      reasoning: result.reasoning ?? "",
      toolCalls: result.toolCalls,
      usage: result.usage,
      resolvedModel: result.resolvedModel,
      finishReason: result.finishReason,
    };
  } else {
    const completeReq = {
      systemPrompt: modelSystemPrompt,
      messages: msgs,
      tools: wireTools,
      maxOutputTokens: contextBudget.requestedMaxOutputTokens,
      context: deps.context,
    };
    // Task 6.1 — the blocking complete() is BOTH raced against the signal
    // (prompt release guarantee) AND constructed with it, so an operator
    // cancel aborts the adapter's in-flight transport request itself (where
    // the adapter forwards the signal) rather than only unwinding the race.
    // A transport abort surfaces as a non-retryable provider error that the
    // race's onRejected swallows — the loop still sees ExecutionCancelledError.
    const resp = await (deps.cancelSignal
      ? raceWithCancellation(
          provider.complete(completeReq, { signal: deps.cancelSignal }),
          deps.cancelSignal,
          "cancelled by operator",
        )
      : provider.complete(completeReq));
    // C1 fix: restore assignments — the non-streaming path MUST populate
    // text/toolCalls/usage from the provider response.
    segment = {
      text: resp.text ?? "",
      reasoning: resp.reasoning ?? "",
      toolCalls: resp.toolCalls ?? [],
      usage: resp.usage,
      resolvedModel: resp.resolvedModel,
      finishReason: resp.finishReason,
    };
  }
  // Progress: the model completed a generation turn (milestone in the
  // liveness feed — tool-completion marks come from handleToolResult).
  onProgress?.("model_response", segment.resolvedModel ?? model.name);
  // Fallback: model emitted XML-style tool calls as raw text instead of
  // using structured tool_calls. Pattern: <alix_tool_name><param>value</param>
  // </alix_tool_name>. Extract and convert to ToolCall objects so the rest of
  // the loop can process them normally.
  let calls = segment.toolCalls;
  if (calls.length === 0 && segment.text.includes("<") && providerTools.length > 0) {
    const toolNames = new Set(providerTools.map((t) => t.name));
    const xmlRegex = new RegExp(
      `<(${Array.from(toolNames).join("|")})\\b[^>]*>([\\s\\S]*?)</\\1>`,
      "g",
    );
    let m: RegExpExecArray | null;
    const extracted: ToolCall[] = [];
    while ((m = xmlRegex.exec(segment.text)) !== null) {
      const toolName = m[1]!;
      const inner = m[2]!;
      const args: Record<string, string> = {};
      const paramRegex = /<([\w_-]+)>([\s\S]*?)<\/\1>/g;
      let pm: RegExpExecArray | null;
      while ((pm = paramRegex.exec(inner)) !== null) {
        args[pm[1]!] = pm[2]!.trim();
      }
      extracted.push({
        id: `xml-${extracted.length}`,
        name: toolName,
        args,
      });
    }
    if (extracted.length > 0) calls = extracted;
  }
  return { ...segment, toolCalls: calls };
};

// A provider/model call begins and no content has arrived yet — surface the
// design's WAITING_FOR_PROVIDER row (closest reachable mapping of "provider
// accepted request, no content"); the first visible chunk moves to STREAMING.
if (!(i === 0 && deps.coordinationKickoff)) onProgress?.("model_requested", model.name);
const generation = i === 0 && deps.coordinationKickoff
  ? { text: '', reasoning: '', toolCalls: [{ id: `coordination-${randomUUID()}`, name: 'alix_coordination_run',
      args: { ...deps.coordinationKickoff, sessionMode: config.permissions.sessionMode ?? 'auto' } }],
      usage: undefined, resolvedModel: undefined, finishReason: 'tool_calls' }
  : await runModelTurn(liveSend?.messages ?? messages);
text = generation.text;
reasoning = generation.reasoning;
toolCalls = generation.toolCalls;
usage = generation.usage;
resolvedModel = generation.resolvedModel;
finishReason = generation.finishReason;

// Truncation: the model hit the output budget mid-answer (finish_reason=length
// on a prose response with no tool calls). Continue generation in follow-up
// turns via the shared helper in helpers.ts so the final answer is never
// silently cut. Only the LAST partial segment is re-fed (never the cumulative
// text), so the continuation context grows linearly with the segment count.
if (
  finishReason === "length" &&
  toolCalls.length === 0 &&
  text.length > 0 &&
  truncationContinuations < TRUNCATION_CONTINUATION_LIMIT
) {
  const continued = await continueTruncatedGeneration({
    initialText: text,
    messages,
    maxContinuations: TRUNCATION_CONTINUATION_LIMIT - truncationContinuations,
    onContinuation: async ({ attempt, chars }) => {
      await log.append({
        ...session, actor: "system", type: "agent.truncated.continuing",
        payload: { iteration: i, chars, continuation: truncationContinuations + attempt },
      });
    },
    generateNext: async (msgs) => {
      const seg = await runModelTurn(msgs);
      return {
        text: seg.text,
        reasoning: seg.reasoning,
        toolCalls: seg.toolCalls,
        usage: seg.usage,
        resolvedModel: seg.resolvedModel,
        finishReason: seg.finishReason,
      };
    },
  });
  truncationContinuations += continued.continuations;
  text = continued.text;
  reasoning = continued.reasoning ?? "";
  finishReason = continued.finishReason;
  toolCalls = [...(continued.toolCalls ?? [])];
  usage = continued.usage;
  resolvedModel = continued.resolvedModel;
}

// A synthesis reply sometimes includes another `done` call even though a
// completion tool already ran (or the runtime explicitly asked for prose).
// `done` has no useful side effect at this point. Treat the non-empty text as
// the terminal synthesis and suppress the redundant dispatch so the event log
// contains one real completion action, not an artificial done loop.
if (
  synthesisRequested &&
  text.trim().length > 0 &&
  toolCalls.length > 0 &&
  toolCalls.every((toolCall) => isCompletionTool(toolCall.name))
) {
  await log.append({
    ...session,
    actor: "system",
    type: "completion.redundant_done_ignored",
    payload: { iteration: i, count: toolCalls.length },
  });
  toolCalls = [];
}

if (text.length > 0) {
  await emitAgent(log, session, "agent.message", { text });
  lastAgentProse = text;
}

// Emit model call metric for every call regardless of usage data
await log.append({
  ...session, actor: "system", type: "observability.metric",
  payload: { name: "model_calls_total", type: "counter", value: 1, labels: { provider: model.provider, ...(resolvedModel ? { resolved_model: resolvedModel } : {}) }, timestamp: new Date().toISOString() },
});

if (usage) {
  await log.append({ ...session, actor: "agent", type: "model.usage", payload: buildModelUsageEventPayload(model.provider, model.name, usage, resolvedModel) });
  // §1 — compare our estimated raw+padded against the provider's actual input
  // tokens. Keyed by the same invocationId as context.snapshot.created.
  await log.append({
    ...session, actor: "system", type: CONTEXT_EVENT_TYPES.TOKEN_CALIBRATION,
    payload: {
      invocationId,
      provider: model.provider,
      model: model.name,
      estimatedRaw: assembled.admittedRawTokens,
      estimatedPadded: assembled.admittedTokens,
      actual: usage.inputTokens,
    } satisfies TokenCalibrationPayload,
  });
}

// Emit reasoning trail — the model's reasoned trace when the provider
// surfaced one (reasoning_content), otherwise the leading text slice.
if (reasoning.length > 0 || (text && text.length > 0)) {
  await emitAgent(log, session, "agent.reasoning", {
    text: (reasoning.length > 0 ? reasoning : text).slice(0, 500),
    toolCalls: toolCalls.map(tc => tc.name),
    iteration: i,
  });
}

// Emit decision for tool selection
if (toolCalls.length > 0) {
  const firstSummary = toolCalls[0]?.summary;
  await emitAgent(log, session, "agent.decision", {
    kind: "tool_selection", iteration: i,
    description: `Called ${toolCalls.map(t => t.name).join(", ")}`,
    summary: firstSummary,
    outcome: "executed",
  });
}

const completionState: CompletionState = { repairCount, unconfirmedDoneAttempts, noToolNudges, synthesisRequested, emptySynthesisRetryRequested };
const completionContext: CompletionContext = { deps, config, hooks, log, session, maxIterations, contextBudget, evidenceTask, evidenceTaskType, successfulToolEvidence, taskType, hasMutations, depth, memoryStore, sessionId, sessionDir, model, contextRotThreshold, contextPressure, lastInvocationId, lastAgentProse, usedTools, messages, text, i, explicitDoneCalled, sessionState, enhancedVerifier, task, coordinationUnverified, searchCalls, hookRunEnv, maxRepairs, runHook, providerTools, NO_TOOL_NUDGE_LIMIT, MAX_UNCONFIRMED_DONE_ATTEMPTS, state: completionState };
if (toolCalls.length === 0) {
  const outcome = await runNoToolsCompletion(completionContext);
  ({ repairCount, unconfirmedDoneAttempts, noToolNudges, synthesisRequested, emptySynthesisRetryRequested } = completionState);
  if (outcome === "continue") continue;
  if (outcome) return outcome;
} else {
  // Track failed tool names per iteration to prevent spinning
  const failedTools: string[] = [];
  const fatalToolErrors: string[] = [];

  // Prepare event handler dependencies (created once per iteration)
  const eventHandlerDeps: EventHandlerDeps = {
    executor,
    mcpManager,
    mcpDiscovery,
    scope,
    session,
    sessionState,
    log,
    selectedTools,
    mcpToolIndex,
    offeredTools: wireTools,
    boundTools,
    config,
    verbose: deps.verbose ?? true, // Stream tool outputs to stdout
    cancelSignal: deps.cancelSignal,
    allowedMutationPaths,
    executionStateEmitter: executionState ?? undefined,
    runId: deps.context?.runId,
    searchCallGuard,
    // Thread the turn's progress sink so the approval wait in
    // handleToolCall can mark approval_pending (activity + liveness).
    ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
  };

  // Track accumulated state across all tool calls so one tool's result
  // doesn't short-circuit the rest (e.g., toolResult.completed from the
  // first tool must not prevent the second tool from executing).
  let trackCompleted = false;
  let trackShellComplete = false;
  let shellOutput = "";

  // T4 — concurrency-aware dispatch: safe+safe → parallel Promise.all, else serial.
  // Harness policy + model capability + authoritative ToolConcurrency (fail-closed unknown→serial).
  const _toolPolicy: ToolExecutionPolicy = deps.toolExecutionPolicy ?? DEFAULT_TOOL_EXECUTION_POLICY;
  const _modelParallelCapable: boolean = (provider as unknown as { capabilities?: { parallelToolCalls?: boolean } })?.capabilities?.parallelToolCalls ?? false;
  const _canParallel = canParallelize(toolCalls, _toolPolicy, _modelParallelCapable);

  // ── Shared post-processing helper (deduped tail for both parallel + serial) ──
  // Handles on_post_tool / on_tool_error hooks, progress ledger, and
  // deferred completion/message bookkeeping. Called for every *executed*
  // tool (gate-handled short-circuits skip it, mirroring serial's `continue`).
  type ToolResultLike = Awaited<ReturnType<typeof handleToolCall>>;
  async function handleToolResult(
    toolCall: ToolCall,
    toolResult: ToolResultLike,
    _correlation: CorrelationContext,
  ): Promise<void> {
    progressLedger.recordToolCall(toolCall.name, toolCall.summary, !toolResult.error);
    if (!toolResult.error) toolCallsSinceCheckpoint++;
    if (toolResult.succeeded === true && typeof toolResult.message?.content === "string") {
      try { deps.onToolResult?.(toolCall.name, toolResultBody(toolResult.message.content)); }
      catch { /* Observers cannot change execution or completion. */ }
    }

    // Progress: a tool finished executing (strongest discrete liveness signal
    // after a model response — the agent is actively doing work).
    onProgress?.("tool_completed", toolCall.name);

    if (deps.hookRunner) {
      const execName = resolveToolExecutionName(toolCall.name, offeredForResolution);
      const hr = await deps.hookRunner.execute("on_post_tool", { type: "tool_result", data: { toolName: execName, args: toolCall.args, result: toolResult } });
      if (hr.handled) await log.append({ ...session, actor: "system", type: "hook.executed", payload: { hookName: "on_post_tool", toolName: execName } });
    }
    if (deps.hookRunner && toolResult.error) {
      const execName = resolveToolExecutionName(toolCall.name, offeredForResolution);
      const hr = await deps.hookRunner.execute("on_tool_error", {
        type: "tool_error",
        data: { toolName: execName, args: toolCall.args, error: toolResult.error.message, retryable: toolResult.error.retryable },
      });
      if (hr.handled) {
        await log.append({ ...session, actor: "system", type: "hook.executed", payload: { hookName: "on_tool_error", toolName: execName, handled: true } });
        if (hr.reason && toolResult.message?.content) {
          const content = toolResult.message.content;
          if (typeof content === "string") {
            toolResult.message.content = content.replace("</tool_result>", `\n<tool_repair_hint>\n${hr.reason}\n</tool_repair_hint>\n</tool_result>`);
          }
        }
      }
    }

    if (resolveToolExecutionName(toolCall.name, offeredForResolution) === COORDINATION_RUN_TOOL_NAME) {
      // A failed invocation is unambiguously not completion. A *successful*
      // invocation is not completion either: the gate needs the run's derived
      // dimensions (execution terminal, aggregate generated, outcome known,
      // verification evidence present), never the tool call's own status.
      coordinationUnverified = toolResult.error
        ? true
        : !(await coordinationRunIsVerified(toolResult, deps.cwd ?? process.cwd(), sessionId));
    }
    usedTools.add(toolCall.name);
    if (!toolResult.error) {
      const execName = resolveToolExecutionName(toolCall.name, offeredForResolution);
      const changedFiles = toolResult.changedFiles ?? [];
      successfulToolEvidence.push({
        name: execName,
        args: toolCall.args,
        ordinal: toolEvidenceOrdinal++,
        // Record what the call actually changed, so a delegated coordination
        // run whose workers wrote files can satisfy the mutation requirement
        // the coordinator itself cannot meet.
        //
        // The EXPLICIT `mutated: false` matters as much as the `true`: a
        // `file.create` that found identical content reports `changed: false`,
        // and that no-op must not pass as mutation evidence. Only an absent
        // flag is left undecided, because `file.delete` never sets one.
        ...(toolResult.changed === true || changedFiles.length > 0
          ? { mutated: true as const }
          : toolResult.changed === false
            ? { mutated: false as const }
            : {}),
      });
      recordMutationInSessionState(sessionState, execName, toolCall.args);
    }
    {
      // Shadow observation (T0-b): what was offered, what was chosen, and how
      // useful the executed choice turned out to be. No behavior depends on it.
      await emitSelectionObservation(log, session, {
        scopeId,
        iteration: i,
        ...(invocationId ? { invocationId } : {}),
        toolCall,
        offered: offeredForResolution,
        seenSignatures: selectionSignatures,
        toolResult,
        context: {
          candidates: frozenSurface.candidates,
          candidateBindings: frozenSurface.bindings,
          requirementCandidates: requirementCandidatesForTurn,
          ...(surfaceGapsForTurn.length > 0 ? { surfaceGaps: surfaceGapsForTurn } : {}),
          scoping: frozenScoping,
          ranking: frozenRanking,
        },
      });
    }
    if (toolResult.completed) {
      trackCompleted = true;
      explicitDoneCalled = true;
    }
    if (toolResult.message) messages.push(toolResult.message);
    if ((deps.shellTask || deps.readOnly) && !toolResult.completed && !toolResult.continue) {
      trackShellComplete = true;
      const raw = typeof toolResult.message?.content === "string" ? toolResult.message.content : "";
      shellOutput = raw.replace(/<[^>]+>/g, "").trim();
    }
    if (taskType === "research") searchCalls++;
  }

  async function runPreToolHook(toolCall: ToolCall): Promise<void> {
    if (deps.hookRunner) {
      const execName = resolveToolExecutionName(toolCall.name, offeredForResolution);
      const hr = await deps.hookRunner.execute("on_pre_tool", { type: "tool_call", data: { toolName: execName, args: toolCall.args } });
      if (hr.handled) await log.append({ ...session, actor: "system", type: "hook.executed", payload: { hookName: "on_pre_tool", toolName: execName } });
    }
  }

  if (_canParallel) {
    // Parallel path — same governance per-call as serial: each call goes
    // through MCP-search / shed / scope-expansion gates, then on_pre_tool,
    // then ToolExecutor (schema→policyGate→ExecutionAuthorization) inside
    // handleToolCall. No bypass: safe+safe batch is parallel-safe because
    // every per-call gate and per-call policy check is still executed.
    // T5 correlation: every parallel result retains executionId → invocationId → toolCallId — typed via CorrelationContext, no Record spread
    const correlation: CorrelationContext = createCorrelationContext(executionId, invocationId);
    type GateSentinel = { __gateHandled: true; __gateMessage?: NormalizedMessage; __gateEarlyReturn?: { summary: string } };
    const _parallelResults = await scheduleToolCalls(toolCalls, _toolPolicy, _modelParallelCapable, async (toolCall): Promise<ToolResultLike | GateSentinel> => {
      // Operator cancellation (Task 6.1): no NEW tool starts after a cancel —
      // checked immediately before dispatch, so a cancel that lands between
      // the provider response and this call prevents launching the tool.
      deps.cancellationToken?.throwIfCancelled();
      const mcpSearchResult = await handleMcpToolSearch(toolCall, eventHandlerDeps);
      if (mcpSearchResult.handled) {
        return { __gateHandled: true, __gateMessage: mcpSearchResult.message } as GateSentinel;
      }
      const shedResult = handleShedToolCall(toolCall, scopedOutNames, fullToolRegistry);
      if (shedResult.handled && shedResult.reintroduce && !shedToolsRetried.has(toolCall.name)) {
        shedToolsRetried.add(toolCall.name);
        reintroducedTools.push(shedResult.reintroduce);
        await log.append({
          ...session, actor: "system",
          type: CONTEXT_EVENT_TYPES.TOOLING_SCOPE_REINTRODUCED,
          payload: { invocationId, toolName: toolCall.name, reason: "shed_tool_called" } satisfies ToolingScopeReintroducedPayload,
        });
        return { __gateHandled: true, __gateMessage: { role: "user", content: buildShedToolRetryMessage(toolCall) } } as GateSentinel;
      }
      const scopeResult = await handleScopeExpansion(toolCall, eventHandlerDeps);
      if (scopeResult.handled) {
        if (scopeResult.continue === false) {
          if (scopeResult.denied) {
            await emitAgent(log, session, "agent.decision", {
              kind: "scope_expansion", iteration: i,
              description: `Scope expansion denied for file changes`,
              outcome: "rejected",
            });
            const execName = resolveToolExecutionName(toolCall.name, offeredForResolution);
            const pathsToCheck = extractMutationPaths(execName, toolCall.args);
            const deniedPaths = pathsToCheck.filter((path) => scope.checkMutation(path) === "denied");
            if (deniedPaths.length > 0) {
              return { __gateHandled: true, __gateMessage: buildScopeDenialMessage(toolCall.id, deniedPaths) } as GateSentinel;
            } else if (process.stdin.isTTY) {
              return { __gateHandled: true, __gateMessage: { role: "user", content: `<tool_result id="${toolCall.id}">\nError: Scope expansion denied. Do NOT attempt to modify these files again.\n</tool_result>` } } as GateSentinel;
            } else {
              const summary = buildScopeRejectionSummary(pathsToCheck);
              return { __gateHandled: true, __gateEarlyReturn: { summary } } as GateSentinel;
            }
          }
          return { __gateHandled: true } as GateSentinel;
        }
      }
      await runPreToolHook(toolCall);
      // Progress: a tool is about to execute (paired with tool_completed in
      // handleToolResult so observers see the start→finish lifecycle).
      onProgress?.("tool_started", toolCall.name);
      return handleToolCall(toolCall, eventHandlerDeps, failedTools, fatalToolErrors, correlation);
    });

    for (let _idx = 0; _idx < toolCalls.length; _idx++) {
      const toolCall = toolCalls[_idx]!;
      const raw = _parallelResults[_idx]! as ToolResultLike | GateSentinel;
      if ((raw as GateSentinel).__gateHandled) {
        const gate = raw as GateSentinel;
        if (gate.__gateEarlyReturn) {
          const summary = gate.__gateEarlyReturn.summary;
          await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "rejected_scope_expansion", summary, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
            return { sessionId, summary, streamed: model.streaming, reason: "rejected_scope_expansion", contextPressure: contextPressure.snapshot(), ...(lastAgentProse !== undefined ? { lastAgentProse } : {}) };
        }
        if (gate.__gateMessage) messages.push(gate.__gateMessage);
        continue;
      }
      await handleToolResult(toolCall, raw as ToolResultLike, correlation);
    }
  } else {
  // Handle each tool call (model names like alix_file_read → executor names like file.read)
  for (const toolCall of toolCalls) {
    // Operator cancellation (Task 6.1): no NEW tool starts after a cancel —
    // checked before each dispatch so a cancel that lands mid-batch (between
    // the provider response and a later tool call) is honoured here instead of
    // launching the remaining tools. Fast/uninterruptible tools that complete
    // after a cancel still land here before the next tool would start.
    deps.cancellationToken?.throwIfCancelled();
    // Handle MCP tool search first
    const mcpSearchResult = await handleMcpToolSearch(toolCall, eventHandlerDeps);
    if (mcpSearchResult.handled && mcpSearchResult.message) {
      // The sentinel is a real member of the frozen candidate set, so this is a
      // real selection — record the scope before short-circuiting. Skipping it
      // is what left every external turn in cohort t3d-2026-09-28-c unscoped.
      await emitSelectionObservation(log, session, {
        scopeId,
        iteration: i,
        ...(invocationId ? { invocationId } : {}),
        toolCall,
        offered: offeredForResolution,
        seenSignatures: selectionSignatures,
        toolResult: { message: mcpSearchResult.message },
        context: {
          candidates: frozenSurface.candidates,
          candidateBindings: frozenSurface.bindings,
          requirementCandidates: requirementCandidatesForTurn,
          ...(surfaceGapsForTurn.length > 0 ? { surfaceGaps: surfaceGapsForTurn } : {}),
          scoping: frozenScoping,
          ranking: frozenRanking,
        },
      });
      messages.push(mcpSearchResult.message);
      continue;
    }

    // §2 shed-tool contract: a tool scoped OUT by T1a/T1b scoping was called.
    // Re-introduce its schema (additive-only), retry once, log — mirroring
    // scope-expansion retry semantics. Guardrail: retried ONCE per shed tool
    // per run (second call falls through to normal tool-error path).
    const shedResult = handleShedToolCall(toolCall, scopedOutNames, fullToolRegistry);
    if (
      shedResult.handled &&
      shedResult.reintroduce &&
      !shedToolsRetried.has(toolCall.name)
    ) {
      shedToolsRetried.add(toolCall.name);
      reintroducedTools.push(shedResult.reintroduce); // appended to the wire tools for the retry
      await log.append({
        ...session, actor: "system",
        type: CONTEXT_EVENT_TYPES.TOOLING_SCOPE_REINTRODUCED,
        payload: {
          invocationId,
          toolName: toolCall.name,
          reason: "shed_tool_called",
        } satisfies ToolingScopeReintroducedPayload,
      });
      messages.push({ role: "user", content: buildShedToolRetryMessage(toolCall) });
      continue; // retry the call with the tool admitted
    }

    // Handle scope expansion check
    const scopeResult = await handleScopeExpansion(toolCall, eventHandlerDeps);
    if (scopeResult.handled) {
      if (scopeResult.continue === false) {
        if (scopeResult.denied) {
          // Emit decision for scope expansion denial
          await emitAgent(log, session, "agent.decision", {
            kind: "scope_expansion", iteration: i,
            description: `Scope expansion denied for file changes`,
            outcome: "rejected",
          });
          const execName = resolveToolExecutionName(toolCall.name, offeredForResolution);
          // Check if we have paths to report denial for
          const pathsToCheck = extractMutationPaths(execName, toolCall.args);
          const deniedPaths = pathsToCheck.filter((path) => scope.checkMutation(path) === "denied");
          if (deniedPaths.length > 0) {
            messages.push(buildScopeDenialMessage(toolCall.id, deniedPaths));
          } else if (process.stdin.isTTY) {
            // Scope was manually denied by user in TTY mode
            messages.push({ role: "user", content: `<tool_result id="${toolCall.id}">\nError: Scope expansion denied. Do NOT attempt to modify these files again.\n</tool_result>` });
          } else {
            // Non-TTY mode - scope was denied, return early
            const summary = buildScopeRejectionSummary(pathsToCheck);
            await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
            await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "rejected_scope_expansion", summary, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
          return { sessionId, summary, streamed: model.streaming, reason: "rejected_scope_expansion", contextPressure: contextPressure.snapshot(), ...(lastAgentProse !== undefined ? { lastAgentProse } : {}) };
          }
        }
        continue;
      }
      // continue: scope was auto-approved or user approved, fall through to execute
    }

    await runPreToolHook(toolCall);
    // Progress: a tool is about to execute (paired with tool_completed in
    // handleToolResult so observers see the start→finish lifecycle).
    onProgress?.("tool_started", toolCall.name);

    // Handle tool execution — T5 correlation wiring via typed CorrelationContext (no Record spread)
    const correlation: CorrelationContext = createCorrelationContext(executionId, invocationId);
    const toolResult = await handleToolCall(toolCall, eventHandlerDeps, failedTools, fatalToolErrors, correlation);

    await handleToolResult(toolCall, toolResult, correlation);
  }
  }

  // ── Intent classification ──────────────────────────────
  const observedIntent = intentClassifier.classify(toolCalls, currentIntent);
  const updateResult = intentClassifier.update(currentIntent, observedIntent, intentStreak);
  const prevIntent = currentIntent;
  currentIntent = updateResult.next;
  intentStreak = updateResult.streak;
  if (currentIntent !== prevIntent) {
    progressLedger.startSection(currentIntent);
  }
  // If the intent just changed (pre-sticky), force a progress checkpoint
  // so the model can report on the new direction. This prevents the loop
  // from silently switching intent categories without the operator seeing
  // an update.
  const intentJustChanged = currentIntent !== observedIntent;
  if (intentJustChanged) {
    toolCallsSinceCheckpoint = CHECKPOINT_TOOL_CALL_THRESHOLD;
  }
  if (deps.onCurrentIntentUpdate) deps.onCurrentIntentUpdate(currentIntent);

  // ── Progress checkpoint ──────────────────────────────────
  const wallClockElapsed = Date.now() - lastCheckpointWallClock;
  const modelText = text.trim();
  const modelAlreadyNarrating = modelText.length >= NARRATING_THRESHOLD;

  if (
	!trackCompleted &&
	!modelAlreadyNarrating &&
	(toolCallsSinceCheckpoint >= CHECKPOINT_TOOL_CALL_THRESHOLD || wallClockElapsed >= CHECKPOINT_WALL_CLOCK_MS)
  ) {
	messages.push({
	  role: "user",
	  content: "[Progress checkpoint — brief status update requested]\nWhat progress have you made since the last checkpoint?\nWhat are you working on next? (1-3 sentences)",
	});
	toolCallsSinceCheckpoint = 0;
	lastCheckpointWallClock = Date.now();
	continue;
  }

  // Successful mutations are recorded by handleToolResult. Failed calls must
  // never become completion evidence merely because their arguments named a file.
  sessionState.fatalErrors.push(...fatalToolErrors);
  for (const failed of failedTools) {
    if (!fatalToolErrors.includes(failed)) {
      sessionState.fatalErrors.push(failed);
    }
  }

  const completionOutcome = await runDeferredCompletion({ ...completionContext, coordinationUnverified, trackCompleted, trackShellComplete, shellOutput });
  ({ repairCount, unconfirmedDoneAttempts, noToolNudges, synthesisRequested, emptySynthesisRetryRequested } = completionState);
  if (completionOutcome === "continue") continue;
  if (completionOutcome) return completionOutcome;

  // After tool calls, run verification every iteration (if policy allows).
  // Extracted to `runIterationVerification` (#717 method decomposition).
  {
    const vr = await runIterationVerification({
      iteration: i,
      sessionState,
      config,
      log,
      session,
      evidenceTask,
      evidenceTaskType,
      successfulToolEvidence,
      taskType,
      hasMutations,
      stateMachine,
      repairCount,
      maxRepairs,
      enhancedVerifier,
      messages,
      sessionId,
      sessionDir,
      streamed: model.streaming,
      contextRotThreshold,
      contextPressure,
      contextBudget,
      lastInvocationId,
      cwd: deps.cwd ?? process.cwd(),
    });
    repairCount = vr.repairCount;
    if (vr.earlyReturn) return vr.earlyReturn;
  }
}

  // Persist session state at the end of each iteration for crash resilience
  await persistSessionState({ sessionDir, messages, scope, stateMachine, session, log });
  }

  // Max iterations reached
  await emitAgent(log, session, "agent.decision", {
    kind: "completion", iteration: maxIterations,
    description: `Reached maximum iterations (${maxIterations})`,
    outcome: "accepted",
  });
  const { skillFactory } = await import("../../../capabilities/skills/dispatcher.js");
  void skillFactory.process({
sessionId,
sessionDir,
summary: "Agent reached maximum iterations",
filesCreated: [...sessionState.created],
filesChanged: [...sessionState.changed],
config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
  });
  return await completeSession(session, log, memoryStore, sessionDir, taskType, sessionId, "Agent reached maximum iterations", model.streaming ?? false, "session.ended", "max_iterations", contextPressure.snapshot(), { threshold: contextRotThreshold, contextBudget, lastInvocationId });
  } catch (err) {
    // C2 #18: irreducible context-budget overflow is a graceful RunResult
    // failure, not a throw. Returning here preserves the structured fields —
    // a re-throw through runTaskCore/processTurn would flatten them via
    // String(err). The kind-literal guard (not instanceof) matches ONLY
    // reducible === false; reducible overflows (programming/validation
    // failures) and all other errors fall through to `throw err`.
    if (isIrreducibleContextBudgetOverflow(err)) {
      const summary = buildContextBudgetOverflowSummary(err);
      await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
      await log.append({
        ...session, actor: "system", type: "session.ended",
        payload: { reason: "context_budget_overflow", summary, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) },
      });
      return {
        sessionId,
        summary,
        streamed: model.streaming,
        reason: "context_budget_overflow" as const,
        contextBudgetOverflow: err,
        contextPressure: contextPressure.snapshot(),
        ...(lastAgentProse !== undefined ? { lastAgentProse } : {}),
      };
    }
    throw err;
  } finally {
// Cleanup EnhancedVerifier
if (enhancedVerifier) {
  try {
    await enhancedVerifier.close();
  } catch (err) {
    await log.append({ ...session, actor: "system", type: "embedder.close_failed", payload: { error: String(err) } });
  }
}
  }
}
