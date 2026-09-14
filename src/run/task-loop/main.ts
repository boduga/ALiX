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
import type { ModelAdapter, NormalizedMessage, ToolCall, TokenUsage, ToolDef } from "../../providers/types.js";
import type { DeferredToolEntry } from "../../mcp/tool-deferral.js";
import type { EventLog } from "../../events/event-log.js";
import type { MemoryStore } from "../../utils/memory/store.js";
import type { ExecutionContext } from "../../observability/execution-context.js";
import type { ScopeTracker } from "../../autonomy/scope-tracker.js";
import type { TaskStateMachine } from "../../autonomy/state-machine.js";
import { classifyTask } from "../../task-classifier.js";
import type { MutationSessionState, RunResult } from "../../run.js";
import { recordMutationInSessionState, extractMutationPaths } from "../../run.js";
import { buildModelUsageEventPayload } from "../../run.js";
import { DEFAULT_FACTORY_CONFIG } from "../../skills/dispatcher.js";
import "../../verifier/index.js";
import { shouldRunVerification, discoverVerification, requiresRepositoryVerification, runVerification, type VerificationCheck, type VerificationResult } from "../../verifier/verifier.js";
import { EnhancedVerifier } from "../../verifier/enhanced-verifier.js";
import { streamToResponse, continueTruncatedGeneration, TRUNCATION_CONTINUATION_LIMIT } from "../helpers.js";
import "../helpers.js";
import { createContextPressureTracker } from "../context-pressure.js";
import { renderToolManifest } from "../../agent/system-prompt.js";
import "../../session/index.js";
import { buildRefinePrompt, selectStrategy } from "../../orchestrator/refine-strategies.js";
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
import { RESEARCH_SUPPLEMENT, MUTATION_SUPPLEMENT, VALIDATION_SUPPLEMENT } from "../../agent/system-prompt.js";
import type { TokenizerName } from "../../config/context-limits.js";
import type { ContextBudget, TierOrderingConfig } from "../../config/context-budget.js";
import { assembleContext } from "../../config/context-assembly.js";
import { MetricsStore } from "../../observability/metrics-store.js";
import { createMetricRegistry } from "../../observability/metric-registry.js";
import { StateTelemetry } from "../../observability/state-telemetry.js";
import { CONTEXT_EVENT_TYPES, type TokenCalibrationPayload, type ToolingScopeFallbackFullPayload, type ToolingScopeReintroducedPayload } from "../../events/types.js";
import { loadCalibration, type ContextRotThreshold } from "../../config/calibration-store.js";
import { resolveModelConfig } from "../../config/model-resolver.js";
import type { ModelsConfig } from "../../config/schema.js";
import {
  DEFAULT_TOOL_EXECUTION_POLICY,
  canParallelize,
  scheduleToolCalls,
  type ToolExecutionPolicy,
} from "../../runtime/tool-scheduler.js";
import type { CorrelationContext } from "../../runtime/tool-correlation.js";
import { createCorrelationContext } from "../../runtime/tool-correlation.js";
import type { CancellationToken } from "../../runtime/cancellation-token.js";
import { raceWithCancellation } from "../../runtime/cancellation-token.js";
import "../../agents/tool-name-map.js";
import { evaluatePattern } from "./context-helpers.js";
import { assembleBudgetedContext } from "./context-phase.js";
import { runIterationVerification } from "./verification-phase.js";
import { CLAIM_TOOL_NAMES, NARRATING_THRESHOLD, SHORT_SYNTHESIS_THRESHOLD, SuccessfulToolEvidence, VERIFICATION_EVIDENCE_GAP, buildShedToolRetryMessage, claimsArtifactWritten, durableCompletionSummary, emitAgent, explicitMutationTargets, findUnsubstantiatedClaims, hasExecutedActionTool, isCompletionTool, isContinuationMessage, lastToolResultShowsClientError, latestToolFailure, missingEvidenceSummary, objectiveEvidenceGaps, objectiveEvidenceRequirements, resolveToolExecutionName } from "./predicates.js";
import { RESEARCH_LIMITS, buildContextBudgetOverflowSummary, completeSession, getHistoricalSuggestions, isIrreducibleContextBudgetOverflow, maybeEmitRotRisk, persistSessionState } from "./session-lifecycle.js";

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
  mcpToolIndex: DeferredToolEntry[];
  messages: NormalizedMessage[];
  sessionState: MutationSessionState;
  stateMachine: TaskStateMachine;
  scope: ScopeTracker;
  session: { sessionId: string; actor: "system" };
  log: EventLog;
  executor: import("../../tools/executor.js").ToolExecutor;
  mcpDiscovery: import("../../mcp/tool-discovery.js").ToolDiscovery | null;
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
  systemPrompt: string;
  onStream?: (chunk: { type: "text" | "tool_call" | "reasoning"; text?: string; toolCall?: ToolCall }) => void;
  hookRunner?: import("../../extensions/hook-runner.js").HookRunner;
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
  onProgress?: (kind: import("../../agent/agent-liveness.js").AgentProgressKind, description?: string) => void;
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
  const model = resolveModelConfig(config);

  // ── Task 9 (§6): Load calibration once per run for `context.rot_risk` advisory.
  // Independent of Task 4's deferred §1 factor wiring — we only need to read
  // `contextRotThreshold` here. `loadCalibration` returns `{}` on a missing/
  // unreadable file, so `calibration.contextRotThreshold` is `undefined` in
  // the default state → no emission. This is the UNSET-by-default invariant.
  const calibration = await loadCalibration();
  const contextRotThreshold: ContextRotThreshold | undefined = calibration.contextRotThreshold;

  // ── T7: Tool scoping (§2 admission-control) ─────────────────────────
  const { scopeToolsByTask } = await import("../../config/tool-scoping.js");
  // Full registry — every tool the model COULD name (provider + MCP). Consumed
  // by Task 8's shed-tool handler to re-admit a scoped-out schema on call.
  const fullToolRegistry = [...providerTools, ...mcpToolIndex];
  const { core: coreTools, extended: extendedTools, fallbackFull } = scopeToolsByTask(providerTools, mcpToolIndex, task, taskType);
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
  manager?: import("../../mcp/manager.js").McpManager;
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
	const supplement = currentIntent === "research" ? RESEARCH_SUPPLEMENT
	  : currentIntent === "mutation" ? MUTATION_SUPPLEMENT
	  : VALIDATION_SUPPLEMENT;
	// Hoist the wire-tool set so the prompt manifest and the wire payload agree.
	// Pre-§2 both used the unconstrained `providerTools`; post-§2 the wire is
	// scoped ([...coreTools, ...extendedTools, ...reintroducedTools]) but the
	// manifest was still rendered from the full registry — the model saw "you
	// may call these N tools" in the prompt while the wire admitted only the
	// scoped subset. Reusing `wireTools` makes the invariant structural.
	const wireTools = [...coreTools, ...extendedTools, ...reintroducedTools];
	const toolManifest = wireTools.length > 0 ? `\n\n${renderToolManifest(wireTools)}` : "";
	const effectiveSystemPrompt = `${systemPrompt}\n\n${supplement}\n\n` +
	  `CURRENT TURN BOUNDARY: The current task is the latest user request. ` +
	  `Earlier completed turns are context only. Do not describe them as work performed in this turn, ` +
	  `and do not include their results in the final summary unless the user explicitly asks for a recap.` +
	  toolManifest;

	// ── I1: Inject progress ledger BEFORE budget admission so it is
	// token-accounted (Tier 3, protected). The ledger is rendered and
	// pushed into messages so classifyCandidateContext picks it up.
	const ledgerText = progressLedger.render(10);
	if (ledgerText) {
	  // The ledger is a replaceable snapshot, not conversational history.
	  // Keep only the latest copy so each iteration does not compound the
	  // same progress state in the model context.
	  messages = messages.filter((message) =>
	    !(message.role === "user" && typeof message.content === "string" && message.content.startsWith("[Progress Ledger]"))
	  );
	  messages.push({
	    role: "user",
	    content: `[Progress Ledger]\n${ledgerText}`,
	  });
	}
	// Expose rendered ledger text to the AgentSession for TUI consumption
	if (deps.onLedgerUpdate && ledgerText) deps.onLedgerUpdate(ledgerText);

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
	  });
	  messages = assembledContext.messages;
	  assembled = assembledContext.assembled;
	  admittedSystemPrompt = assembledContext.admittedSystemPrompt;
	}


// Run pre_task hooks at the start of each iteration
const { runHook } = await import("../../hooks/runner.js");
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
      systemPrompt: admittedSystemPrompt,
      messages: msgs,
      tools: wireTools,
      maxOutputTokens: contextBudget.requestedMaxOutputTokens,
      context: deps.context,
    }, deps.cancelSignal ? { onStream, signal: deps.cancelSignal } : { onStream });
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
      systemPrompt: admittedSystemPrompt,
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
onProgress?.("model_requested", model.name);
const generation = await runModelTurn(messages);
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

if (toolCalls.length === 0) {
  // No tools called — check if model signals completion. A model that has
  // never invoked a tool and has already been nudged once is treated as done
  // on a text-only reply: forcing tool use on a model that keeps refusing
  // just spins identical context until max_iterations.
  const nudgedOut = noToolNudges >= NO_TOOL_NUDGE_LIMIT && usedTools.size === 0;
  const modelSaysDone =
    explicitDoneCalled ||
    nudgedOut ||
    (synthesisRequested && text.trim().length > 0) ||
    /done|complete|finished|resolved/i.test(text);

  // If the model emitted text but no tool calls and didn't signal done,
  // re-prompt once to nudge it into taking action. This handles the
  // common case where the model produces a verbal plan in its first
  // turn instead of immediately invoking tools, or where the tool call
  // JSON was truncated/invalid. Nudging is bounded to one attempt — a
  // subsequent text-only reply is accepted (see `nudgedOut` above).
  if (!modelSaysDone && noToolNudges < NO_TOOL_NUDGE_LIMIT && i < maxIterations - 1) {
    // If the text looks like a tool-call attempt but nothing parsed, the model
    // likely invented a foreign tool name (e.g. exec_command). List the real
    // names + format so it self-corrects instead of silently dropping the call.
    const sawToolMarkers = /<\s*(tool_calls?|invoke|function_calls)\b|<\s*invoke\s+name=/i.test(text);
    const validNames = providerTools.map((t) => t.name).join(", ");
    messages.push({
      role: "user",
      content: sawToolMarkers
        ? `No valid tool call was parsed from your last response. The only tools available are: ${validNames}. ` +
          `Invoke exactly one by name — e.g. <alix_shell_run><command>ls -la</command></alix_shell_run> — ` +
          `and wait for the result before continuing. Do not invent tool names.`
        : "No tool calls were detected in your last response. To proceed, you must invoke a tool using the proper tool-use format. " +
          "For multi-step tasks, invoke ONE tool at a time and wait for the result before continuing. " +
          "Use the `done` tool when the task is complete.",
    });
    noToolNudges++;
    continue;
  }

  // Run post_task hooks
  for (const hook of hooks.post_task ?? []) {
    await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, reason: hook.reason } });
    const result = await runHook(hook, deps.sessionId, { ...hookRunEnv, ALIX_RUN_STATUS: "success" });
    await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
  }

  // Policy check: skip verification in ask mode unless scope is approved
  const scopeApprovedNoTools = !sessionState.pendingScopeExpansion;
  const { skipReason: skipReasonNoTools } = shouldRunVerification(config.permissions.sessionMode ?? "ask", scopeApprovedNoTools);

  if (skipReasonNoTools) {
    await log.append({ ...session, actor: "verifier", type: "verification.skipped", payload: { reason: skipReasonNoTools } });
  }

  const changedFilesForVerification = [...sessionState.created, ...sessionState.changed];
  const explicitVerificationRequired = objectiveEvidenceRequirements(evidenceTask, evidenceTaskType).verification;
  const explicitVerificationMissing = objectiveEvidenceGaps(evidenceTask, evidenceTaskType, successfulToolEvidence)
    .includes(VERIFICATION_EVIDENCE_GAP);
  const checks = requiresRepositoryVerification(
    changedFilesForVerification,
    explicitVerificationRequired && explicitVerificationMissing,
  )
    ? await discoverVerification(".")
    : [];

  // For docs and research tasks, skip verification
  // Also skip if no file mutations occurred (nothing to verify)
  if ((taskType === "docs" && !explicitVerificationRequired) || taskType === "research" || !hasMutations || checks.length === 0) {
    // Check research-specific limits
    if (taskType === "research") {
      const limits = RESEARCH_LIMITS[depth];
      if (searchCalls >= limits.maxSearchCalls) {
        await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_search_calls", summary: `Research reached limit of ${searchCalls} search calls`, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
        await evaluatePattern(log, session, sessionDir, taskType);
        return { sessionId, summary: text || "Research completed (max search calls)", streamed: model.streaming, contextPressure: contextPressure.snapshot() };
      }
      if (i >= limits.maxIterations) {
        await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_iterations", summary: `Research reached limit of ${limits.maxIterations} iterations`, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
        await evaluatePattern(log, session, sessionDir, taskType);
        return { sessionId, summary: text || "Research completed (max iterations)", streamed: model.streaming, contextPressure: contextPressure.snapshot() };
      }
    }
    if (modelSaysDone) {
      // If the agent ran tool calls but never produced a final synthesis
      // (i.e. text is just the opening intro and toolCalls were issued
      // earlier), force one more iteration to get a real final answer.
      // Without this, the user sees the agent's first line of text
      // labeled as the "summary" even though no work was finalized.
      const ranToolCalls = hasExecutedActionTool(usedTools);
      if (ranToolCalls && text.trim().length === 0 && !synthesisRequested && i < maxIterations - 1) {
        synthesisRequested = true;
        messages.push({
          role: "user",
          content:
            "You called tools but didn't produce a final synthesis. " +
            "Write a concise summary of what you did, what you found, and the outcome.",
        });
        continue;
      }

      // Prose containing "done"/"complete" is NOT a trustworthy completion
      // signal by itself — it's exactly what a model emits when it narrates
      // finishing steps it never actually executed. It's only safe to trust
      // outright when no tools were ever invoked this session (nothing to
      // hallucinate about, since ranToolCalls is false here). Otherwise,
      // require either a real `done` tool call or that every claim the
      // summary makes is backed by an actual tool call — bounded, so a
      // persistently non-compliant model still terminates, just labeled
      // honestly instead of silently accepted as "completed".
      const unsubstantiated = findUnsubstantiatedClaims(text, usedTools);
      // A "done" right after a tool result that looks like an HTTP/client
      // error, when nothing was written and the reply doesn't claim an
      // artifact, is the model ending on an error echo — not a completed
      // outcome. Treat it as untrustworthy so the model is pushed (bounded)
      // to retry/verify instead of silently accepting the error as the result.
      const errorEchoDone =
        ranToolCalls &&
        !explicitDoneCalled &&
        !claimsArtifactWritten(text, sessionState.changed) &&
        lastToolResultShowsClientError(messages);
      const evidenceGaps = objectiveEvidenceGaps(evidenceTask, evidenceTaskType, successfulToolEvidence);
      const trustworthy =
        (!ranToolCalls || explicitDoneCalled || (unsubstantiated.length === 0 && !errorEchoDone)) &&
        evidenceGaps.length === 0;

      if (!trustworthy && unconfirmedDoneAttempts < MAX_UNCONFIRMED_DONE_ATTEMPTS && i < maxIterations - 1) {
        unconfirmedDoneAttempts++;
        await log.append({
          ...session, actor: "system", type: "completion.claim_rejected",
          payload: { unsubstantiatedClaims: unsubstantiated, objectiveEvidenceGaps: evidenceGaps, attempt: unconfirmedDoneAttempts, ...(errorEchoDone ? { reason: "client_error_echo" } : {}) },
        });

        // Build a targeted re-prompt: list the missing tool calls with their
        // exact alix_ names so the model has no ambiguity about what to invoke.
        const missingToolLines = [...unsubstantiated, ...evidenceGaps]
          .map((c) => `  - ${CLAIM_TOOL_NAMES[c] ?? c}`)
          .join("\n");

        let content: string;
        if (evidenceGaps.length > 0) {
          content =
            `The current task is not complete because the event log lacks: ${evidenceGaps.join(" and ")}. ` +
            `Perform those actions now. Do not call done or describe the task as complete until the tools succeed.`;
        } else if (errorEchoDone && unsubstantiated.length === 0) {
          // The last tool call failed (HTTP/client error) and no deliverable
          // was produced. There are no invented claims to list — the problem
          // is ending on the error itself.
          content =
            `Your last tool call returned an HTTP/client error, and you declared the task done without writing or verifying the deliverable. ` +
            `A tool error is not a completed outcome. Retry with corrected parameters/headers, complete the actual work, ` +
            `and confirm the deliverable exists before saying done.`;
        } else if (unconfirmedDoneAttempts >= 2) {
          // Third attempt: no more done-escape. Force the model to actually
          // make these tool calls or the session labels itself unverified.
          content =
            `You keep saying you are done without having actually called the required tools. ` +
            `Call these tools now:\n${missingToolLines}\n\n` +
            `Do NOT call done until every one of these tools has returned a result.`;
        } else if (unconfirmedDoneAttempts >= 1) {
          // Second attempt: hint, but leave done open as last resort.
          content =
            `Your summary claims you completed the following, but no matching tool call was made:\n${missingToolLines}\n\n` +
            `Call these tools now using their \`alix_\` names, or call \`done\` only if you genuinely cannot proceed.`;
        } else {
          // First attempt: soft nudge.
          content =
            `Your summary claims you did the following, but no matching tool call was made: ${unsubstantiated.join(", ")}. ` +
            `Do not describe an action as complete unless you actually invoked the corresponding tool. ` +
            `Either call the remaining tools now, or call the \`done\` tool explicitly once everything is genuinely finished.`;
        }

        messages.push({ role: "user", content });
        continue;
      }

      const reason: RunResult["reason"] = trustworthy ? "completed" : "completed_unverified";
      await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
      const failure = latestToolFailure(messages);
      const completionSummary = evidenceGaps.length > 0
        ? missingEvidenceSummary(evidenceGaps, text)
        : text.trim().length > 0
          ? durableCompletionSummary(text, sessionState.changed, failure)
        : failure
          ? `Task could not complete: ${failure}`
          : "Task completed, but the model provided no final synthesis.";
      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: text.trim().length > 0 ? reason : "completed_unverified", summary: completionSummary, unsubstantiatedClaims: unsubstantiated, objectiveEvidenceGaps: evidenceGaps, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
      await evaluatePattern(log, session, sessionDir, taskType);
      return { sessionId, summary: completionSummary, streamed: model.streaming, reason: text.trim().length > 0 ? reason : "completed_unverified", contextPressure: contextPressure.snapshot() };
    }
    // Model didn't signal done, continue
  } else if (!skipReasonNoTools) {
    // Run verification
    const verResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];
    for (const check of checks) {
      await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: check.command, reason: check.reason } });
      const verResult = await runVerification(".", check);
      await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: check.command, status: verResult.status } });
      verResults.push({ check, result: verResult });
    }

    const allPassed = verResults.every((vr) => vr.result.status === "passed");

    if (allPassed && modelSaysDone) {
      // Success — verification passed and model signals done
      await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });

      // Record successful resolution if we have files that were changed
      if (enhancedVerifier && sessionState.changed.size > 0) {
        try {
          await enhancedVerifier.recordFailure({
            task: task,
            errorSummary: "Verification passed",
            fileChanges: [...sessionState.changed],
            resolution: "Applied fix successfully",
          });
          await log.append({ ...session, actor: "system", type: "embedder.resolution_recorded", payload: { fileCount: sessionState.changed.size } });
        } catch (err) {
          await log.append({ ...session, actor: "system", type: "embedder.record_failed", payload: { error: String(err) } });
        }
      }

      await evaluatePattern(log, session, sessionDir, taskType);
      return { sessionId, summary: text, streamed: model.streaming, contextPressure: contextPressure.snapshot() };
    }

    // Repair loop — verification failed or model didn't signal done
    const failures = verResults.filter((vr) => vr.result.status === "failed");
    const failureText = failures.length > 0
      ? failures.map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`).join("\n\n")
      : "No tool calls and model did not signal completion.";

    repairCount++;
    if (repairCount > maxRepairs) {
      const { skillFactory } = await import("../../skills/dispatcher.js");
      void skillFactory.process({
        sessionId,
        sessionDir,
        summary: `Repair limit reached: ${failureText}`,
        filesCreated: [...sessionState.created],
        filesChanged: [...sessionState.changed],
        config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
      });
      return await completeSession(session, log, memoryStore, sessionDir, taskType, sessionId, `Repair limit reached: ${failureText}`, model.streaming ?? false, "session.ended", "max_repairs", contextPressure.snapshot(), { threshold: contextRotThreshold, contextBudget, lastInvocationId });
    }

    // Use Fabric-style refine strategy
    const { prompt: refinedPrompt, strategy: usedStrategy } = await buildRefinePrompt(failureText, taskType, repairCount);
    await log.append({ ...session, actor: "system", type: "refine.strategy_applied", payload: { strategy: usedStrategy, repairCount, failureType: selectStrategy(failureText, taskType) } });

    // Get historical suggestions for similar failures
    const historicalSuggestions = enhancedVerifier
      ? await getHistoricalSuggestions(enhancedVerifier, failures, sessionState, session, log)
      : [];

    // Append historical suggestions if available
    let finalPrompt = refinedPrompt;
    if (historicalSuggestions.length > 0) {
      finalPrompt += "\n\n**Similar failures that were resolved:**\n" + historicalSuggestions.join("\n");
    }

    // Update the message with enhanced prompt
    messages.push({ role: "user", content: finalPrompt });
  }
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
    config,
    verbose: deps.verbose ?? true, // Stream tool outputs to stdout
    cancelSignal: deps.cancelSignal,
    allowedMutationPaths,
    runId: deps.context?.runId,
    searchCallGuard,
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

    // Progress: a tool finished executing (strongest discrete liveness signal
    // after a model response — the agent is actively doing work).
    onProgress?.("tool_completed", toolCall.name);

    if (deps.hookRunner) {
      const execName = resolveToolExecutionName(toolCall.name, selectedTools);
      const hr = await deps.hookRunner.execute("on_post_tool", { type: "tool_result", data: { toolName: execName, args: toolCall.args, result: toolResult } });
      if (hr.handled) await log.append({ ...session, actor: "system", type: "hook.executed", payload: { hookName: "on_post_tool", toolName: execName } });
    }
    if (deps.hookRunner && toolResult.error) {
      const execName = resolveToolExecutionName(toolCall.name, selectedTools);
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

    usedTools.add(toolCall.name);
    if (!toolResult.error) {
      const execName = resolveToolExecutionName(toolCall.name, selectedTools);
      successfulToolEvidence.push({ name: execName, args: toolCall.args, ordinal: toolEvidenceOrdinal++ });
      recordMutationInSessionState(sessionState, execName, toolCall.args);
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
      const execName = resolveToolExecutionName(toolCall.name, selectedTools);
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
            const execName = resolveToolExecutionName(toolCall.name, selectedTools);
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
          return { sessionId, summary, streamed: model.streaming, reason: "rejected_scope_expansion", contextPressure: contextPressure.snapshot() };
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
          const execName = resolveToolExecutionName(toolCall.name, selectedTools);
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
            return { sessionId, summary, streamed: model.streaming, reason: "rejected_scope_expansion", contextPressure: contextPressure.snapshot() };
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

  // ── Deferred completion/auto-complete checks ──────────────────
  // All tool calls in the batch have now executed. Process results
  // that were accumulated during the loop without early returns.
  if (trackCompleted) {
    // Model explicitly requested completion via a "done" tool or similar.
    // If tools were called but the model's text is short, re-prompt once
    // for a synthesis before closing the session.
    const completedAfterAction = hasExecutedActionTool(usedTools);
    const priorToolFailure = latestToolFailure(messages);
    if (
      completedAfterAction &&
      text.trim().length === 0 &&
      !priorToolFailure &&
      (!synthesisRequested || !emptySynthesisRetryRequested) &&
      i < maxIterations - 1
    ) {
      if (synthesisRequested) emptySynthesisRetryRequested = true;
      synthesisRequested = true;
      messages.push({
        role: "user",
        content:
          "Tools completed. Write a concise summary of what you did and what you found. Return prose only; do not call done again.",
      });
      continue;
    }

    // Claim check: even when the real `done` tool was called, the model
    // may still have described actions it never executed in its text.
    // Same escalation as the no-tool-call branch (see findUnsubstantiatedClaims).
    const unsubstantiated = findUnsubstantiatedClaims(text, usedTools);
    const evidenceGaps = objectiveEvidenceGaps(evidenceTask, evidenceTaskType, successfulToolEvidence);
    if ((unsubstantiated.length > 0 || evidenceGaps.length > 0) && unconfirmedDoneAttempts < MAX_UNCONFIRMED_DONE_ATTEMPTS && i < maxIterations - 1) {
      unconfirmedDoneAttempts++;
      await log.append({
        ...session, actor: "system", type: "completion.claim_rejected",
        payload: { unsubstantiatedClaims: unsubstantiated, objectiveEvidenceGaps: evidenceGaps, attempt: unconfirmedDoneAttempts, source: "trackCompleted" },
      });
      const missingToolLines = [...unsubstantiated, ...evidenceGaps]
        .map((c) => `  - ${CLAIM_TOOL_NAMES[c] ?? c}`)
        .join("\n");
      const content = unconfirmedDoneAttempts >= 2
        ? `You called the \`done\` tool but your summary still claims work that was never executed:\n${missingToolLines}\n\n` +
          `Do NOT call \`done\` until every one of these tools has returned a result.`
        : `You called \`done\` but your summary claims work that was never done:\n${missingToolLines}\n\n` +
          `Call these tools now using their \`alix_\` names, or call \`done\` again only once you have genuinely finished.`;
      messages.push({ role: "user", content });
      continue;
    }

    const missingSynthesis = completedAfterAction && text.trim().length === 0;
    const reason: RunResult["reason"] =
      unsubstantiated.length === 0 && evidenceGaps.length === 0 && !missingSynthesis ? "completed" : "completed_unverified";
    const failure = priorToolFailure;
    const completionSummary = evidenceGaps.length > 0
      ? missingEvidenceSummary(evidenceGaps, text)
      : text.trim().length > 0
        ? durableCompletionSummary(text, sessionState.changed, failure)
      : missingSynthesis
        ? failure
          ? `Task could not complete: ${failure}`
          : "Task completed, but the model provided no final synthesis."
        : "Task complete.";
    return await completeSession(
      session, log, memoryStore, sessionDir,
      taskType, sessionId, completionSummary,
      model.streaming ?? false,
      "session.ended", reason,
      contextPressure.snapshot(),
      { threshold: contextRotThreshold, contextBudget, lastInvocationId },
    );
  }

  // If tools were called but the model never produced a real summary
  // (text is just the opening intro / tool calls), force one more
  // iteration so the model synthesizes the tool results into a
  // coherent response before returning. This check must come BEFORE
  // trackShellComplete so read-only tasks also get a synthesis pass.
  const hasToolMessages = messages.some((m: any) =>
    m.role === "user" && typeof m.content === "string" && m.content.startsWith("<tool_result"),
  );
  if (hasToolMessages && text.length < SHORT_SYNTHESIS_THRESHOLD && i < maxIterations - 1) {
    // Check if the model has been repeating the same tools and suggest
    // alternatives when appropriate.
    const usedList = [...usedTools];
    const stuckOn = usedList.filter(t => t.startsWith("file."));
    let rePrompt: string;
    if (stuckOn.length === usedList.length && usedList.length > 0 && usedList.length < 5) {
      // Only file.* tools used — suggest broadening
      rePrompt =
        "You have only used file search tools so far (" + usedList.join(", ") + "). " +
        "The user's request may require other tools. Available tool categories include: " +
        "shell.run, cron.schedule, notification.send, user.send_file, monitor, findings.report, ask_user. " +
        "Try using a different tool to make progress. If you truly have nothing left to do, " +
        "write a final summary and signal that the task is done.";
    } else {
      rePrompt =
        "All tasks are complete. Write a concise final summary of what you did and what you found, then signal that the task is done.";
    }
    messages.push({
      role: "user",
      content: rePrompt,
    });
    synthesisRequested = true;
    continue;
  }

  if (trackShellComplete) {
    return await completeSession(
      session, log, memoryStore, sessionDir,
      taskType, sessionId, shellOutput || text,
      model.streaming ?? false,
      "session.ended", "completed",
      contextPressure.snapshot(),
      { threshold: contextRotThreshold, contextBudget, lastInvocationId },
    );
  }

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
  const { skillFactory } = await import("../../skills/dispatcher.js");
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
