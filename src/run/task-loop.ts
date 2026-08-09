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
import type { ModelAdapter, NormalizedMessage, NormalizedRequest, ToolCall, TokenUsage, ToolDef } from "../providers/types.js";
import type { DeferredToolEntry } from "../mcp/tool-deferral.js";
import type { EventLog } from "../events/event-log.js";
import type { MemoryStore } from "../utils/memory/store.js";
import type { ExecutionContext } from "../observability/execution-context.js";
import type { ScopeTracker } from "../autonomy/scope-tracker.js";
import type { TaskStateMachine } from "../autonomy/state-machine.js";
import type { TaskType } from "../task-classifier.js";
import type { MutationSessionState, RunResult, ContextPressure } from "../run.js";
import { recordMutationInSessionState, extractMutationPaths } from "../run.js";
import { buildModelUsageEventPayload } from "../run.js";
import { DEFAULT_FACTORY_CONFIG } from "../skills/dispatcher.js";
import { buildRiskReport, mapFilesToTests } from "../verifier/index.js";
import { shouldRunVerification, discoverVerification, runVerification, type VerificationCheck, type VerificationResult } from "../verifier/verifier.js";
import { EnhancedVerifier } from "../verifier/enhanced-verifier.js";
import { streamToResponse } from "./helpers.js";
import { saveDecisionsToMemory } from "./helpers.js";
import { createContextPressureTracker } from "./context-pressure.js";
import { renderToolManifest } from "../agent/system-prompt.js";
import { saveSessionState } from "../session/index.js";
import { buildRefinePrompt, selectStrategy } from "../orchestrator/refine-strategies.js";
import {
  handleToolCall,
  handleMcpToolSearch,
  handleScopeExpansion,
  handleShedToolCall,
  buildScopeDenialMessage,
  buildScopeRejectionSummary,
  type EventHandlerDeps,
} from "./event-handlers.js";
import { ProgressLedger } from "./progress-ledger.js";
import { IntentClassifier, type AgentIntent } from "./intent-classifier.js";
import { RESEARCH_SUPPLEMENT, MUTATION_SUPPLEMENT, VALIDATION_SUPPLEMENT } from "../agent/system-prompt.js";
import { estimateMessageBudgetTokens, estimateBudgetTokens, ensureEncoder } from "../utils/tokens.js";
import type { TokenizerName } from "../config/context-limits.js";
import type { ContextBudget, ContextCategory, TierOrderingConfig } from "../config/context-budget.js";
import { ContextBudgetOverflowError, preflight } from "../config/context-budget.js";
import {
  assembleContext,
  type CandidateContextItem,
  type ContextItemProvenance,
} from "../config/context-assembly.js";
import { CONTEXT_EVENT_TYPES, type TokenCalibrationPayload, type ToolingScopeFallbackFullPayload, type ToolingScopeReintroducedPayload, type ContextRotRiskPayload } from "../events/types.js";
import { loadCalibration, type ContextRotThreshold } from "../config/calibration-store.js";

/**
 * Complete a session: log the terminal event, persist decisions,
 * evaluate patterns, and return the RunResult. Shared by all
 * completion points in runTaskLoop to eliminate duplicated
 * completion chains.
 */
async function completeSession(
  session: { sessionId: string; actor: "system" },
  log: EventLog,
  memoryStore: MemoryStore,
  sessionDir: string,
  taskType: string,
  sessionId: string,
  summary: string,
  streamed: boolean,
  eventType: string = "session.ended",
  reason?: string,
  contextPressure?: ContextPressure,
  rotOpts?: {
    threshold: ContextRotThreshold | undefined;
    contextBudget: ContextBudget;
    lastInvocationId: string;
  },
): Promise<RunResult> {
  // Task 9 (§6): Evaluate `context.rot_risk` advisory BEFORE the terminal
  // `session.ended` event so a single readAll() sees both. UNSET threshold →
  // no emission (default state silent).
  if (rotOpts) {
    await maybeEmitRotRisk({
      log, session, threshold: rotOpts.threshold, contextPressure, contextBudget: rotOpts.contextBudget, lastInvocationId: rotOpts.lastInvocationId,
    });
  }
  await log.append({ ...session, actor: "system", type: eventType, payload: { reason, summary, ...(contextPressure ? { contextPressure } : {}) } });
  const sessionEvents = await log.readAll();
  await saveDecisionsToMemory(sessionEvents, memoryStore);
  await evaluatePattern(log, session, sessionDir, taskType);
  return {
    sessionId, summary, streamed,
    ...(reason ? { reason: reason as RunResult["reason"] } : {}),
    ...(contextPressure ? { contextPressure } : {}),
  };
}

/**
 * Task 9 (§6): emit `context.rot_risk` advisory when configured threshold
 * is crossed. Threshold UNSET this cycle → no emission by default. Advisory
 * only, never a hard gate (spec §6).
 *
 * Side effect: appends one `context.rot_risk` event when fired. No-op when:
 *   - `threshold` is undefined (default), OR
 *   - `contextPressure` is undefined (legacy/non-terminal return path).
 *
 * `tier5Dropped` measured >= threshold.value (count, ascending).
 * `remainingTokensPct` measured <= threshold.value (percent, descending —
 *   "below X% of available input tokens remaining").
 */
async function maybeEmitRotRisk(opts: {
  log: EventLog;
  session: { sessionId: string; actor: "system" };
  threshold: ContextRotThreshold | undefined;
  contextPressure: ContextPressure | undefined;
  contextBudget: ContextBudget;
  lastInvocationId: string;
}): Promise<void> {
  const { log, session, threshold, contextPressure, contextBudget, lastInvocationId } = opts;
  if (!threshold || !contextPressure) return;
  const aggregate = contextPressure.aggregate;
  const measured =
    threshold.metric === "tier5Dropped"
      ? aggregate.tier5Dropped
      : contextBudget.availableInputTokens === 0
        ? 0
        : (aggregate.minRemainingTokens / contextBudget.availableInputTokens) * 100;
  const crossed =
    threshold.metric === "tier5Dropped"
      ? measured >= threshold.value
      : measured <= threshold.value;
  if (!crossed) return;
  const payload: ContextRotRiskPayload = {
    invocationId: lastInvocationId,
    metric: threshold.metric,
    measured,
    threshold: threshold.value,
    contextPressure,
  };
  await log.append({
    ...session,
    actor: "system",
    type: CONTEXT_EVENT_TYPES.ROT_RISK,
    payload,
  });
}

/**
 * True when `err` is an IRREDUCIBLE context-budget overflow. Discriminates
 * on the class's `kind` literal rather than `instanceof`, so no consumer
 * coupling to the error class leaks past the producer boundary (guardrail:
 * `contextBudgetOverflow` is diagnostic data; consumers use typed fields
 * only). Reducible overflows (kind matches but reducible === true) return
 * false — they are programming/validation failures that still throw.
 */
function isIrreducibleContextBudgetOverflow(err: unknown): err is ContextBudgetOverflowError {
  return (
    typeof err === "object" &&
    err !== null &&
    "kind" in err &&
    (err as { kind?: unknown }).kind === "context_budget_overflow" &&
    "reducible" in err &&
    (err as { reducible?: unknown }).reducible === false
  );
}

/**
 * Human-readable summary for an irreducible context-budget overflow.
 * Used as the RunResult.summary so every surface (CLI, REPL, TUI, daemon,
 * route-executor) degrades to a meaningful diagnostic instead of a raw
 * error string.
 */
function buildContextBudgetOverflowSummary(err: ContextBudgetOverflowError): string {
  return `Context budget overflow: needs ${err.overageTokens} more input tokens ` +
    `(${err.availableInputTokens} available, mandatory core ${err.mandatoryTokens})`;
}

/**
 * §2 — Classify an irreducible overflow as `tooling` (dominated by T1a/T1b
 * tool-schema tokens under `mandatory_system_governance`) or `content`
 * (anything else). Tool-schema bloat is actionable — shed-tool re-scope may
 * free enough room on retry. Pure-content overflow is not.
 */
function classifyIrreducibleKind(byCategory: Record<string, number>): "tooling" | "content" {
  let maxKey: string | null = null;
  let maxVal = -Infinity;
  for (const [k, v] of Object.entries(byCategory)) {
    if (typeof v === "number" && Number.isFinite(v) && v > maxVal) {
      maxVal = v;
      maxKey = k;
    }
  }
  return maxKey === "mandatory_system_governance" ? "tooling" : "content";
}

/**
 * Emit an agent-conversation event (agent.message / agent.reasoning /
 * agent.decision). The task-loop runs in the OUTER runtime but emits ON BEHALF
 * of the agent conversation — its events belong in the `${sessionId}-agent`
 * projection domain (Phase 6 rule: an event's sessionId identifies its
 * projection domain, not the runtime that emitted it). The agent tab's
 * collector projects `${sessionId}-agent`, so this stamp is what routes these
 * events onto the agent tab. `model.usage` is deliberately NOT routed here — it
 * is a cost metric read by outer-session consumers, not a timeline event.
 *
 * `session` carries ONLY `sessionId`: these events always stamp `actor:
 * "agent"` (they speak for the agent conversation), so accepting the caller's
 * actor would be a misleading constraint.
 */
export function emitAgent(
  log: EventLog,
  session: { sessionId: string },
  type: string,
  payload: object,
) {
  return log.append({ ...session, sessionId: `${session.sessionId}-agent`, actor: "agent", type, payload });
}

/**
 * §2 shed-tool contract: tell the model that the previously-shaded tool
 * is now admitted (additive-only re-scope). Mirrors buildScopeDenialMessage's
 * tone — short, factual, no instruction leakage.
 */
export function buildShedToolRetryMessage(toolCall: ToolCall): string {
  return `The tool "${toolCall.name}" was previously outside the active scope but has now been re-admitted for this call. Retry your invocation of "${toolCall.name}".`;
}

// Maps keywords that commonly appear in a model's self-reported summary to
// the tool-name prefix that would have to have been invoked for the claim
// to be real. This is intentionally conservative (few, high-confidence
// keyword -> tool mappings) — false positives here just cost a re-prompt,
// but false negatives let a hallucinated "I did X" claim slip through
// uncontested, which is the failure mode we're closing.
const CLAIM_TOOL_MAP: Array<{ keywords: RegExp; toolPrefix: string; label: string }> = [
  { keywords: /\bschedul(ed|ing)\b.*\bcron\b|\bcron\b.*\bschedul/i, toolPrefix: "cron.", label: "scheduling a cron job" },
  { keywords: /\bsent?\b.*\bnotification\b|\bnotifi(ed|cation)\b/i, toolPrefix: "notification.", label: "sending a notification" },
  { keywords: /\bsent?\b.*\bfile\b/i, toolPrefix: "user.send_file", label: "sending a file to the user" },
  { keywords: /\badded\b.*\bregistrat|\bregister(ed|ing)\b/i, toolPrefix: "file.edit", label: "editing/registering files" },
  { keywords: /\bverified\b.*\bcompil|\bcompil(ed|ation)\b.*\bpass/i, toolPrefix: "shell.run", label: "verifying compilation" },
  { keywords: /\bset\s?up\b.*\bmonitor|\bmonitor(ing)?\b/i, toolPrefix: "monitor", label: "setting up monitoring" },
];

/** Tool-name override map derived from CLAIM_TOOL_MAP for claim-detection re-prompts. */
const CLAIM_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  CLAIM_TOOL_MAP.map(item => [item.label, `alix_${item.toolPrefix.replace('.', '_')}`])
);

const NO_TOOL_MIN_TEXT = 10;
const NARRATING_THRESHOLD = 80;
const SHORT_SYNTHESIS_THRESHOLD = 200;

/**
 * Compares a model's free-text completion summary against the tools it
 * actually invoked this session. Returns a human-readable list of claims
 * that have no corresponding tool call — i.e. things the model says it did
 * but the event log shows it never actually did.
 */
function findUnsubstantiatedClaims(text: string, usedTools: Set<string>): string[] {
  const unsubstantiated: string[] = [];
  for (const { keywords, toolPrefix, label } of CLAIM_TOOL_MAP) {
    if (keywords.test(text)) {
      const wasCalled = [...usedTools].some((t) => t.startsWith(toolPrefix));
      if (!wasCalled) {
        unsubstantiated.push(label);
      }
    }
  }
  return unsubstantiated;
}

function extractErrors(output: string): string[] {
  const errors: string[] = [];
  const patterns = [
/TypeError:\s*(.+)/gi,
/Error:\s*(.+)/gi,
/SyntaxError:\s*(.+)/gi,
/ReferenceError:\s*(.+)/gi,
/AssertionError:\s*(.+)/gi,
/(?:FAIL|FAILURE|ERROR):\s*(.+)/gi,
/Failed:\s*(.+)/gi,
  ];

  for (const pattern of patterns) {
let match;
while ((match = pattern.exec(output)) !== null) {
  errors.push(match[1]?.trim() ?? match[0]);
}
  }

  return [...new Set(errors)];
}

async function getHistoricalSuggestions(
  enhancedVerifier: EnhancedVerifier,
  failures: Array<{ result: { output?: string } }>,
  sessionState: { changed: Set<string> },
  session: { actor: string; sessionId: string },
  log: EventLog
): Promise<string[]> {
  const failedErrors = failures.flatMap(f => extractErrors(f.result.output ?? ""));
  const failedFiles = [...sessionState.changed];

  const suggestions = await enhancedVerifier.suggestFixes({
errors: failedErrors,
files: failedFiles,
  });

  if (suggestions.length > 0) {
await log.append({ ...session, actor: "system", type: "embedder.suggestions_found", payload: { count: suggestions.length } });
return suggestions.map(s => `  - [${(s.confidence * 100).toFixed(0)}%] ${s.resolution}`);
  }

  return [];
}

const RESEARCH_LIMITS = {
  quick: { maxIterations: 3, maxSearchCalls: 3 },
  deep: { maxIterations: 15, maxSearchCalls: 10 },
} as const;

export interface TaskLoopDeps {
  config: {
model: {
  provider: string;
  name: string;
  streaming: boolean;
};
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
  executor: import("../tools/executor.js").ToolExecutor;
  mcpDiscovery: import("../mcp/tool-discovery.js").ToolDiscovery | null;
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
  depth: "quick" | "deep";
  readOnly?: boolean;
  shellTask?: boolean;
  embedderDbPath?: string;
  memoryStore: MemoryStore;
  sessionId: string;
  sessionDir: string;
  systemPrompt: string;
  onStream?: (chunk: { type: "text" | "tool_call"; text?: string; toolCall?: ToolCall }) => void;
  hookRunner?: import("../extensions/hook-runner.js").HookRunner;
  context?: ExecutionContext;
  /** When true (default), tool outputs are streamed to stdout. */
  verbose?: boolean;
  /** Called each iteration after the progress ledger is rendered. */
  onLedgerUpdate?: (text: string) => void;
  /** Called when agent intent classification changes. */
  onCurrentIntentUpdate?: (intent: AgentIntent) => void;
  currentIntent?: AgentIntent;
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
depth,
memoryStore,
sessionId,
sessionDir,
systemPrompt,
onStream,
  } = deps;

  // ── Task 9 (§6): Load calibration once per run for `context.rot_risk` advisory.
  // Independent of Task 4's deferred §1 factor wiring — we only need to read
  // `contextRotThreshold` here. `loadCalibration` returns `{}` on a missing/
  // unreadable file, so `calibration.contextRotThreshold` is `undefined` in
  // the default state → no emission. This is the UNSET-by-default invariant.
  const calibration = await loadCalibration();
  const contextRotThreshold: ContextRotThreshold | undefined = calibration.contextRotThreshold;

  // ── T7: Tool scoping (§2 admission-control) ─────────────────────────
  const { scopeToolsByTask } = await import("../config/tool-scoping.js");
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
        provider: config.model.provider,
        model: config.model.name,
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

  // Track the latest invocationId so the §6 rot_risk advisory at terminal
  // return can correlate with the most recent model-facing snapshot.
  let lastInvocationId = "";

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
let lastSavedMessages = 0;

// Get the McpManager from executor (executor holds a reference)
interface HasMcpManager {
  manager?: import("../mcp/manager.js").McpManager;
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

for (let i = 0; i < maxIterations; i++) {
stateMachine.tick(0);

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
	const toolManifest = providerTools.length > 0 ? `\n\n${renderToolManifest(providerTools)}` : "";
	const effectiveSystemPrompt = `${systemPrompt}\n\n${supplement}${toolManifest}`;

	// ── I1: Inject progress ledger BEFORE budget admission so it is
	// token-accounted (Tier 3, protected). The ledger is rendered and
	// pushed into messages so classifyCandidateContext picks it up.
	const ledgerText = progressLedger.render(10);
	if (ledgerText) {
	  messages.push({
	    role: "user",
	    content: `[Progress Ledger]\n${ledgerText}`,
	  });
	}
	// Expose rendered ledger text to the AgentSession for TUI consumption
	if (deps.onLedgerUpdate && ledgerText) deps.onLedgerUpdate(ledgerText);

	// ── Context Budget admission gate (C0) ─────────────────────────────
	// Replace the dead half-window truncation + digest re-injection with the
	// authoritative budget → assembly → preflight path (T5). No oversized
	// request ever reaches a provider.
	await ensureEncoder(tokenizer);
	const { candidateItems, contentMap } = await classifyCandidateContext(
	  effectiveSystemPrompt, messages, tokenizer
	);

		// ── T7: Reserve scoped tool schemas inside the assembly budget ────
		// Only coreTools + extendedTools (the scoped set) reach the wire.
		// Reserving the scoped set — not all providerTools + mcpToolIndex — is
		// the whole point: scoped-out tools are not sent, so they must not
		// consume budget. The combined scoped array is the exact wire payload.

		const wireTools = [...coreTools, ...extendedTools];
		if (wireTools.length > 0) {
		  const wireToolSchemaMeta = await estimateBudgetTokens(JSON.stringify(wireTools), tokenizer);
		  candidateItems.unshift({
		    id: "tool-schema",
		    kind: "tool_schema",
		    category: "mandatory_system_governance" as ContextCategory,
		    tokens: wireToolSchemaMeta.budgetEstimate,
		    rawTokens: wireToolSchemaMeta.rawEstimate,
		    provenance: { category: "mandatory_system_governance" as ContextCategory, kind: "tool_schema", createdAt: Date.now(), source: "runTaskLoop" },
		  });
		}

	// ── T6: emit context.snapshot.created (once per model-facing invocation) ─
	// Stamped on the `${sessionId}-agent` domain so the agent timeline
	// (TimelineBuilder) admits it — context events describe the agent's
	// model-loop behavior, matching the emitAgent routing pattern. Emitted
	// AFTER the tool-schema reservations so candidateTokens is truthful
	// (includes both provider and MCP structured `tools` payloads).
	await log.append({
	  sessionId: `${session.sessionId}-agent`, actor: "system", type: CONTEXT_EVENT_TYPES.SNAPSHOT_CREATED,
	  payload: {
	    invocationId,
	    candidateTokens: candidateItems.reduce((sum, item) => sum + item.tokens, 0),
	  },
	});

	// ── T6: emit context.budget.computed ───────────────────────────────
	await log.append({
	  sessionId: `${session.sessionId}-agent`, actor: "system", type: CONTEXT_EVENT_TYPES.BUDGET_COMPUTED,
	  payload: {
	    invocationId,
	    contextWindowTokens: contextBudget.contextWindowTokens,
	    availableInputTokens: contextBudget.availableInputTokens,
	    budgetReservation: contextBudget.budgetReservation,
	    requestedMaxOutputTokens: contextBudget.requestedMaxOutputTokens,
	    policyReservation: contextBudget.policyReservation,
	  },
	});

	// One deterministic assembly pass over the candidate.
	// Throws ContextBudgetOverflowError (irreducible) when mandatory core
	// alone exceeds available input (including MCP tool schemas if any).
	// ── T6: catch -> emit context.irreducible -> re-throw ────────────
	let assembled: ReturnType<typeof assembleContext>;
	try {
	  assembled = assembleContext(candidateItems, contextBudget, config.context?.budget?.tierOrdering);
	  // Pure observability (spec §3): feed this iteration's assembly result
	  // into the run-level contextPressure tracker.
	  contextPressure.record(i, assembled);
	} catch (err) {
	  if (err instanceof ContextBudgetOverflowError) {
	    await log.append({
	      sessionId: `${session.sessionId}-agent`, actor: "system", type: CONTEXT_EVENT_TYPES.IRREDUCIBLE,
	      payload: {
	        invocationId,
	        overageTokens: err.overageTokens,
	        byCategory: err.byCategory,
	        availableInputTokens: err.availableInputTokens,
	        mandatoryTokens: err.mandatoryTokens,
	        contextWindowTokens: err.contextWindowTokens,
	        kind: classifyIrreducibleKind(err.byCategory),
	      },
	    });
	  }
	  throw err;
	}

	// ── T6: emit context.assembled with category breakdown + drop reasons ──
	{
	  const admittedByCategory: Record<string, number> = {};
	  for (const item of assembled.admitted) {
	    admittedByCategory[item.category] = (admittedByCategory[item.category] ?? 0) + item.tokens;
	  }
	  const droppedReasons = assembled.dropped.map((d) => ({
	    kind: d.item.kind,
	    reason: d.reason,
	  }));
	  await log.append({
	    sessionId: `${session.sessionId}-agent`, actor: "system", type: CONTEXT_EVENT_TYPES.ASSEMBLED,
	    payload: {
	      invocationId,
	      admittedItems: assembled.admitted.length,
	      droppedItems: assembled.dropped.length,
	      admittedTokens: assembled.admittedTokens,
	      droppedTokens: assembled.droppedTokens,
	      admittedByCategory,
	      droppedReasons,
	    },
	  });
	}

	// Reconstruct the provider request from admitted items.
	// MCP tool-schema items (not in contentMap) are silently skipped.
	const { admittedSystemPrompt, admittedMessages } = reconstructRequest(
	  assembled.admitted, contentMap
	);

	// ── Final safety gate (backstop only) ───────────────────────────────
	// Tool schema tokens (both provider and MCP) were reserved as Tier-1
	// mandatory items above. This gate catches genuine assembly bugs — it
	// must NOT fire on reducible cases because the selector already properly
	// reduced.
	const pfResult = preflight(contextBudget, toBudgetedItems(assembled.admitted));
	if (!pfResult.fits) {
	  // ── T6: emit context.preflight.failed BEFORE throwing irreducible ─
	  await log.append({
	    sessionId: `${session.sessionId}-agent`, actor: "system", type: CONTEXT_EVENT_TYPES.PREFLIGHT_FAILED,
	    payload: {
	      invocationId,
	      overageTokens: pfResult.overflow.overageTokens,
	      byCategory: pfResult.overflow.byCategory,
	    },
	  });
	  // Genuinely irreducible (or an assembly bug): the mandatory core
	  // exceeds available input.
	  const overflowErr = new ContextBudgetOverflowError({
	    reducible: false,
	    overageTokens: pfResult.overflow.overageTokens,
	    byCategory: pfResult.overflow.byCategory,
	    availableInputTokens: contextBudget.availableInputTokens,
	    mandatoryTokens: assembled.mandatoryTokens,
	    contextWindowTokens: contextBudget.contextWindowTokens,
	  });
	  // ── T6: emit context.irreducible ──────────────────────────────
	  await log.append({
	    sessionId: `${session.sessionId}-agent`, actor: "system", type: CONTEXT_EVENT_TYPES.IRREDUCIBLE,
	    payload: {
	      invocationId,
	      overageTokens: overflowErr.overageTokens,
	      byCategory: overflowErr.byCategory,
	      availableInputTokens: overflowErr.availableInputTokens,
	      mandatoryTokens: overflowErr.mandatoryTokens,
	      contextWindowTokens: overflowErr.contextWindowTokens,
	      kind: classifyIrreducibleKind(overflowErr.byCategory),
	    },
	  });
	  throw overflowErr;
	}

	// Replace the loop's mutable messages with the assembled subset.
	messages = admittedMessages;


// Run pre_task hooks at the start of each iteration
const { runHook } = await import("../hooks/runner.js");
for (const hook of hooks.pre_task ?? []) {
  await log.append({ ...session, actor: "system", type: "hook.pre_task", payload: { command: hook.command, reason: hook.reason } });
  const result = await runHook(hook, deps.sessionId);
  await log.append({ ...session, actor: "system", type: "hook.pre_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
}

let text = "";
let toolCalls: ToolCall[] = [];
let usage: TokenUsage | undefined;

	// System prompt was built above (before budget assembly). Use the
	// assembly-admitted system prompt that survived the budget gate.
	if (config.model.streaming && provider.stream) {
	  const result = await streamToResponse(provider, {
	    systemPrompt: admittedSystemPrompt,
	    messages,
	    tools: [...coreTools, ...extendedTools, ...reintroducedTools],
	    maxOutputTokens: contextBudget.requestedMaxOutputTokens,
	    context: deps.context,
	  }, { onStream });
	  text = result.text;
	  toolCalls = result.toolCalls;
	  usage = result.usage;
	} else {
	  const resp = await provider.complete({
	    systemPrompt: admittedSystemPrompt,
	    messages,
	    tools: [...coreTools, ...extendedTools, ...reintroducedTools],
	    maxOutputTokens: contextBudget.requestedMaxOutputTokens,
	    context: deps.context,
	  });
	  // C1 fix: restore assignments — the non-streaming path MUST
	  // populate text/toolCalls/usage from the provider response.
	  text = resp.text ?? "";
	  toolCalls = resp.toolCalls ?? [];
	  usage = resp.usage;
}

  // Fallback: model emitted XML-style tool calls as raw text instead of
  // using structured tool_calls. Pattern: <alix_tool_name><param>value</param>
  // </alix_tool_name>. Extract them and convert to ToolCall objects so the
  // rest of the loop can process them normally.
  if (toolCalls.length === 0 && text.includes("<") && providerTools.length > 0) {
    const toolNames = new Set(providerTools.map((t) => t.name));
    const xmlRegex = new RegExp(
      `<(${Array.from(toolNames).join("|")})\\b[^>]*>([\\s\\S]*?)</\\1>`,
      "g",
    );
    let m: RegExpExecArray | null;
    const extracted: ToolCall[] = [];
    while ((m = xmlRegex.exec(text)) !== null) {
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
    if (extracted.length > 0) {
      toolCalls = extracted;
    }
  }

if (text.length > 0) {
  await emitAgent(log, session, "agent.message", { text });
}

// Emit model call metric for every call regardless of usage data
await log.append({
  ...session, actor: "system", type: "m09.metric",
  payload: { name: "model_calls_total", type: "counter", value: 1, labels: { provider: config.model.provider }, timestamp: new Date().toISOString() },
});

if (usage) {
  await log.append({ ...session, actor: "agent", type: "model.usage", payload: buildModelUsageEventPayload(config.model.provider, config.model.name, usage) });
  // §1 — compare our estimated raw+padded against the provider's actual input
  // tokens. Keyed by the same invocationId as context.snapshot.created.
  await log.append({
    ...session, actor: "system", type: CONTEXT_EVENT_TYPES.TOKEN_CALIBRATION,
    payload: {
      invocationId,
      provider: config.model.provider,
      model: config.model.name,
      estimatedRaw: assembled.admittedRawTokens,
      estimatedPadded: assembled.admittedTokens,
      actual: usage.inputTokens,
    } satisfies TokenCalibrationPayload,
  });
}

// Emit reasoning trail
if (text && text.length > 0) {
  await emitAgent(log, session, "agent.reasoning", {
    text: text.slice(0, 500),
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
  // No tools called — check if model signals completion
  const modelSaysDone = /done|complete|finished|resolved/i.test(text);

  // If the model emitted text but no tool calls and didn't signal done,
  // re-prompt once to nudge it into taking action. This handles the
  // common case where the model produces a verbal plan in its first
  // turn instead of immediately invoking tools, or where the tool call
  // JSON was truncated/invalid.
  if (!modelSaysDone && i < maxIterations - 1 && text.length > NO_TOOL_MIN_TEXT) {
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
    continue;
  }

  // Run post_task hooks
  for (const hook of hooks.post_task ?? []) {
    await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, reason: hook.reason } });
    const result = await runHook(hook, deps.sessionId);
    await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
  }

  // Policy check: skip verification in ask mode unless scope is approved
  const scopeApprovedNoTools = !sessionState.pendingScopeExpansion;
  const { skipReason: skipReasonNoTools } = shouldRunVerification(config.permissions.sessionMode ?? "ask", scopeApprovedNoTools);

  if (skipReasonNoTools) {
    await log.append({ ...session, actor: "verifier", type: "verification.skipped", payload: { reason: skipReasonNoTools } });
  }

  // Get verification checks
  const checks = await discoverVerification(".");

  // For docs and research tasks, skip verification
  // Also skip if no file mutations occurred (nothing to verify)
  if (taskType === "docs" || taskType === "research" || !hasMutations || checks.length === 0) {
    // Check research-specific limits
    if (taskType === "research") {
      const limits = RESEARCH_LIMITS[depth];
      if (searchCalls >= limits.maxSearchCalls) {
        await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_search_calls", summary: `Research reached limit of ${searchCalls} search calls`, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
        await evaluatePattern(log, session, sessionDir, taskType);
        return { sessionId, summary: text || "Research completed (max search calls)", streamed: config.model.streaming, contextPressure: contextPressure.snapshot() };
      }
      if (i >= limits.maxIterations) {
        await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_iterations", summary: `Research reached limit of ${limits.maxIterations} iterations`, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
        await evaluatePattern(log, session, sessionDir, taskType);
        return { sessionId, summary: text || "Research completed (max iterations)", streamed: config.model.streaming, contextPressure: contextPressure.snapshot() };
      }
    }
    if (modelSaysDone) {
      // If the agent ran tool calls but never produced a final synthesis
      // (i.e. text is just the opening intro and toolCalls were issued
      // earlier), force one more iteration to get a real final answer.
      // Without this, the user sees the agent's first line of text
      // labeled as the "summary" even though no work was finalized.
      const ranToolCalls = usedTools.size > 0;
      if (ranToolCalls && i < maxIterations - 1) {
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
      const trustworthy = !ranToolCalls || explicitDoneCalled || unsubstantiated.length === 0;

      if (!trustworthy && unconfirmedDoneAttempts < MAX_UNCONFIRMED_DONE_ATTEMPTS && i < maxIterations - 1) {
        unconfirmedDoneAttempts++;
        await log.append({
          ...session, actor: "system", type: "completion.claim_rejected",
          payload: { unsubstantiatedClaims: unsubstantiated, attempt: unconfirmedDoneAttempts },
        });

        // Build a targeted re-prompt: list the missing tool calls with their
        // exact alix_ names so the model has no ambiguity about what to invoke.
        const missingToolLines = unsubstantiated
          .map((c) => `  - ${CLAIM_TOOL_NAMES[c] ?? c}`)
          .join("\n");

        let content: string;
        if (unconfirmedDoneAttempts >= 2) {
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
      await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason, summary: text, unsubstantiatedClaims: unsubstantiated, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
      await evaluatePattern(log, session, sessionDir, taskType);
      return { sessionId, summary: text, streamed: config.model.streaming, reason, contextPressure: contextPressure.snapshot() };
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
      return { sessionId, summary: text, streamed: config.model.streaming, contextPressure: contextPressure.snapshot() };
    }

    // Repair loop — verification failed or model didn't signal done
    const failures = verResults.filter((vr) => vr.result.status === "failed");
    const failureText = failures.length > 0
      ? failures.map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`).join("\n\n")
      : "No tool calls and model did not signal completion.";

    repairCount++;
    if (repairCount > maxRepairs) {
      const { skillFactory } = await import("../skills/dispatcher.js");
      void skillFactory.process({
        sessionId,
        sessionDir,
        summary: `Repair limit reached: ${failureText}`,
        filesCreated: [...sessionState.created],
        filesChanged: [...sessionState.changed],
        config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
      });
      return await completeSession(session, log, memoryStore, sessionDir, taskType, sessionId, `Repair limit reached: ${failureText}`, config.model.streaming, "session.ended", "max_repairs", contextPressure.snapshot(), { threshold: contextRotThreshold, contextBudget, lastInvocationId });
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
  };

  // Track accumulated state across all tool calls so one tool's result
  // doesn't short-circuit the rest (e.g., toolResult.completed from the
  // first tool must not prevent the second tool from executing).
  let trackCompleted = false;
  let trackCompletedWithToolCalls = false;
  let trackShellComplete = false;
  let shellOutput = "";

  // Handle each tool call (model names like alix_file_read → executor names like file.read)
  for (const toolCall of toolCalls) {
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
          const execName = selectedTools.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
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
            return { sessionId, summary, streamed: config.model.streaming, reason: "rejected_scope_expansion", contextPressure: contextPressure.snapshot() };
          }
        }
        continue;
      }
      // continue: scope was auto-approved or user approved, fall through to execute
    }

    // Run registered hooks before tool execution
    if (deps.hookRunner) {
      const execName = selectedTools.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
      const hr = await deps.hookRunner.execute("on_pre_tool", { type: "tool_call", data: { toolName: execName, args: toolCall.args } });
      if (hr.handled) await log.append({ ...session, actor: "system", type: "hook.executed", payload: { hookName: "on_pre_tool", toolName: execName } });
    }

    // Handle tool execution
    const toolResult = await handleToolCall(toolCall, eventHandlerDeps, failedTools, fatalToolErrors);

    // Record in progress ledger
    progressLedger.recordToolCall(
      toolCall.name,
      toolCall.summary,
      !toolResult.error,
    );
    if (!toolResult.error) {
      toolCallsSinceCheckpoint++;
    }

    // Run registered hooks after tool execution
    if (deps.hookRunner) {
      const execName = selectedTools.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
      const hr = await deps.hookRunner.execute("on_post_tool", { type: "tool_result", data: { toolName: execName, args: toolCall.args, result: toolResult } });
      if (hr.handled) await log.append({ ...session, actor: "system", type: "hook.executed", payload: { hookName: "on_post_tool", toolName: execName } });
    }

    // Fire on_tool_error hook when tool fails
    if (deps.hookRunner && toolResult.error) {
      const execName = selectedTools.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
      const hr = await deps.hookRunner.execute("on_tool_error", {
        type: "tool_error",
        data: {
          toolName: execName,
          args: toolCall.args,
          error: toolResult.error.message,
          retryable: toolResult.error.retryable,
        },
      });
      if (hr.handled) {
        await log.append({
          ...session,
          actor: "system",
          type: "hook.executed",
          payload: { hookName: "on_tool_error", toolName: execName, handled: true },
        });
        // Inject repair hint into the message the model will see
        if (hr.reason && toolResult.message?.content) {
          const content = toolResult.message.content;
          if (typeof content === "string") {
            toolResult.message.content = content.replace(
              "</tool_result>",
              `\n<tool_repair_hint>\n${hr.reason}\n</tool_repair_hint>\n</tool_result>`
            );
          }
        }
      }
    }

    usedTools.add(toolCall.name);

    // Defer completed and auto-complete checks — all tool calls in the
    // batch must execute before we decide to end the session. The first
    // tool's result can't short-circuit the second tool's dispatch.
    if (toolResult.completed) {
      trackCompleted = true;
      explicitDoneCalled = true;
      trackCompletedWithToolCalls = trackCompletedWithToolCalls || usedTools.size > 0;
    }

    if (toolResult.message) {
      messages.push(toolResult.message);
    }

    // Auto-complete for shell tasks and read-only mode after a successful tool call
    if ((deps.shellTask || deps.readOnly) && !toolResult.completed && !toolResult.continue) {
      trackShellComplete = true;
      const raw = typeof toolResult.message?.content === "string" ? toolResult.message.content : "";
      shellOutput = raw.replace(/<[^>]+>/g, "").trim();
    }

    // Track search calls for research tasks (any tool call counts as research activity)
    if (taskType === "research") {
      searchCalls++;
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

  // Track all file mutations in sessionState
  for (const toolCall of toolCalls) {
    const execName = selectedTools.find(t => t.name === toolCall.name)?.execName ?? toolCall.name;
    recordMutationInSessionState(sessionState, execName, toolCall.args);
  }
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
    if (trackCompletedWithToolCalls && text.length < SHORT_SYNTHESIS_THRESHOLD && i < maxIterations - 1) {
      messages.push({
        role: "user",
        content:
          "Tools completed. Write a concise summary of what you did and what you found.",
      });
      continue;
    }

    // Claim check: even when the real `done` tool was called, the model
    // may still have described actions it never executed in its text.
    // Same escalation as the no-tool-call branch (see findUnsubstantiatedClaims).
    const unsubstantiated = findUnsubstantiatedClaims(text, usedTools);
    if (unsubstantiated.length > 0 && unconfirmedDoneAttempts < MAX_UNCONFIRMED_DONE_ATTEMPTS && i < maxIterations - 1) {
      unconfirmedDoneAttempts++;
      await log.append({
        ...session, actor: "system", type: "completion.claim_rejected",
        payload: { unsubstantiatedClaims: unsubstantiated, attempt: unconfirmedDoneAttempts, source: "trackCompleted" },
      });
      const missingToolLines = unsubstantiated
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

    const reason: RunResult["reason"] = unsubstantiated.length === 0 ? "completed" : "completed_unverified";
    return await completeSession(
      session, log, memoryStore, sessionDir,
      taskType, sessionId, text,
      config.model.streaming,
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
    continue;
  }

  if (trackShellComplete) {
    return await completeSession(
      session, log, memoryStore, sessionDir,
      taskType, sessionId, shellOutput || text,
      config.model.streaming,
      "session.ended", "completed",
      contextPressure.snapshot(),
      { threshold: contextRotThreshold, contextBudget, lastInvocationId },
    );
  }

  // After tool calls, run verification every iteration (if policy allows)
  const scopeApproved = !sessionState.pendingScopeExpansion;
  const { skipReason } = shouldRunVerification(config.permissions.sessionMode ?? "ask", scopeApproved);

  if (skipReason) {
    await log.append({ ...session, actor: "verifier", type: "verification.skipped", payload: { reason: skipReason } });
  } else {
    const changedFiles = [...sessionState.created, ...sessionState.changed];
    if (changedFiles.length > 0 && taskType !== "docs" && taskType !== "research" && hasMutations) {
      // Use TestPlanner for smart verification selection
      const { createTestPlan } = await import("../verifier/test-planner.js");

      const plan = await createTestPlan(".", changedFiles);

      await log.append({ ...session, actor: "verifier", type: "verification.plan_created", payload: {
        strategy: plan.strategy,
        totalCost: plan.totalCost,
        checkCount: plan.checks.length,
        verifiedFiles: plan.verifiedFiles,
        unverifiedFiles: plan.unverifiedFiles,
      }});

      const endResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];

      // Run checks in cost order
      for (const endCheck of plan.checks) {
        await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: endCheck.command, reason: endCheck.reason } });
        const verResult = await runVerification(".", endCheck);
        await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: endCheck.command, status: verResult.status } });
        endResults.push({ check: endCheck, result: verResult });
      }

      const riskReport = buildRiskReport(plan.checks, endResults);

      const failedChecks = endResults.filter((r) => r.result.status === "failed");
      if (failedChecks.length > 0) {
        repairCount++;
        // Emit decision for repair
        await emitAgent(log, session, "agent.decision", {
          kind: "repair", iteration: i,
          description: `Entering repair loop (attempt ${repairCount}/${maxRepairs})`,
          outcome: "executed",
        });
        stateMachine.recordRepair();
        if (repairCount > maxRepairs) {
          await maybeEmitRotRisk({ log, session, threshold: contextRotThreshold, contextPressure: contextPressure.snapshot(), contextBudget, lastInvocationId });
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_repairs", summary: `Repair limit reached after ${maxRepairs} attempts`, ...(contextPressure ? { contextPressure: contextPressure.snapshot() } : {}) } });
          const { skillFactory } = await import("../skills/dispatcher.js");
          void skillFactory.process({
            sessionId,
            sessionDir,
            summary: "Repair limit reached",
            filesCreated: [...sessionState.created],
            filesChanged: [...sessionState.changed],
            config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
          });
          await evaluatePattern(log, session, sessionDir, taskType);
          return { sessionId, summary: "Repair limit reached", streamed: config.model.streaming, contextPressure: contextPressure.snapshot() };
        }
        const failureText = failedChecks
          .map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`)
          .join("\n\n");

        const fullPrompt = riskReport
          ? `${failureText}\n\nResidual risk (not verified):\n${riskReport}`
          : failureText;

        // Get historical suggestions for similar failures
        const historicalSuggestions = enhancedVerifier
          ? await getHistoricalSuggestions(enhancedVerifier, failedChecks, sessionState, session, log)
          : [];

        let repairPrompt = `\n\n[Verification Failed] ${fullPrompt}\n\nFix the issues and try again.`;
        if (historicalSuggestions.length > 0) {
          repairPrompt += "\n\n**Similar failures that were resolved:**\n" + historicalSuggestions.join("\n");
        }
        messages.push({ role: "user", content: repairPrompt });
      }
    }
  }
}

  // Persist session state at the end of each iteration for crash resilience
  try {
    await saveSessionState(
      sessionDir,
      {
        messages,
        scope: scope.toJSON(),
        stateMachine: stateMachine.toJSON(),
      }
    );
    lastSavedMessages = messages.length;
  } catch (saveErr) {
    // Non-fatal — session state is best-effort
    await log.append({ ...session, actor: "system", type: "session.state_persist_failed", payload: { error: String(saveErr) } });
  }
  }

  // Max iterations reached
  await emitAgent(log, session, "agent.decision", {
    kind: "completion", iteration: maxIterations,
    description: `Reached maximum iterations (${maxIterations})`,
    outcome: "accepted",
  });
  const { skillFactory } = await import("../skills/dispatcher.js");
  void skillFactory.process({
sessionId,
sessionDir,
summary: "Agent reached maximum iterations",
filesCreated: [...sessionState.created],
filesChanged: [...sessionState.changed],
config: config.skills?.factory ?? DEFAULT_FACTORY_CONFIG,
  });
  return await completeSession(session, log, memoryStore, sessionDir, taskType, sessionId, "Agent reached maximum iterations", config.model.streaming, "session.ended", "max_iterations", contextPressure.snapshot(), { threshold: contextRotThreshold, contextBudget, lastInvocationId });
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
        streamed: config.model.streaming,
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

// Helper functions used by the task loop

/**
 * Builds a session digest from the event log directory.
 * Returns null if digest generation fails.
 */
// ── T5: Context Budget helper functions ────────────────────────────────────

/**
 * Classify a single message into a ContextCategory for the budget assembly.
 */
function classifyMessageToCategory(
  msg: NormalizedMessage,
  index: number,
  isLastUserMessage: boolean,
): ContextCategory {
  const content = typeof msg.content === "string" ? msg.content : "";
  // Ledger/digest content checks MUST come BEFORE the last-user check.
  // The I1 fix injects the ledger as a user-role message at the end;
  // without this ordering, the ledger claims the "last user" slot and
  // the real current instruction gets demoted to Tier-4 (droppable).
  if (content.startsWith("[Progress Ledger]")) return "current_execution_state";
  if (content.startsWith("[Session Digest]")) return "current_execution_state";
  // Tool results MUST be excluded from the "last user" slot BEFORE the
  // last-user check. A tool result is a `user`-role message on the wire, but
  // it is execution evidence, NOT a user instruction — letting it claim
  // current_task would demote the real current instruction to Tier-4
  // (droppable), which under budget pressure gets dropped.
  if (content.startsWith("<tool_result")) return "recent_tool_results";
  // I3 fix: the LAST user-role message is the actual current instruction
  // and MUST be classified as current_task (Tier 2, mandatory) so it is
  // never droppable. The first user message (index 0) is also mandatory.
  if (msg.role === "user" && (index === 0 || isLastUserMessage)) return "current_task";
  return "recent_conversation";
}

/** Builds CandidateContextItem[] from the system prompt and messages. */
async function classifyCandidateContext(
  systemPrompt: string,
  messages: NormalizedMessage[],
  tokenizer: TokenizerName
): Promise<{ candidateItems: CandidateContextItem[]; contentMap: Map<string, NormalizedMessage | { type: "system_prompt"; text: string }> }> {
  const candidateItems: CandidateContextItem[] = [];
  const contentMap = new Map<string, NormalizedMessage | { type: "system_prompt"; text: string }>();

  const sysMeta = await estimateBudgetTokens(systemPrompt, tokenizer);
  candidateItems.push({
    id: "system-prompt",
    kind: "system_prompt",
    category: "mandatory_system_governance",
    tokens: sysMeta.budgetEstimate,
    rawTokens: sysMeta.rawEstimate,
    provenance: { category: "mandatory_system_governance", kind: "system_prompt", createdAt: Date.now(), source: "runTaskLoop" },
  });
  contentMap.set("system-prompt", { type: "system_prompt", text: systemPrompt });

  // I3: find the index of the LAST user-role message so it can be
  // classified as mandatory current_task (never droppable).
  // CRITICAL: exclude ledger/digest-injected messages AND tool results so the
  // REAL last user instruction is never displaced. Without this filter, the
  // I1 ledger injection (or a trailing <tool_result>) claims the slot and
  // the genuine current instruction becomes droppable Tier-4.
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    const c = typeof m.content === "string" ? m.content : "";
    if (c.startsWith("[Progress Ledger]") || c.startsWith("[Session Digest]")) continue;
    if (c.startsWith("<tool_result")) continue;
    lastUserIndex = i;
    break;
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const category = classifyMessageToCategory(msg, i, i === lastUserIndex);
    const msgId = `msg-${i}`;
    const meta = await estimateMessageBudgetTokens(
      { role: msg.role, content: msg.content },
      tokenizer
    );
    const kind = category === "current_task" ? "task"
      : category === "current_execution_state" ? (typeof msg.content === "string" && msg.content.startsWith("[Progress Ledger]") ? "ledger" : "digest")
      : category === "recent_tool_results" ? "tool_result"
      : msg.role === "user" ? "user_turn" : "assistant_turn";
    candidateItems.push({
      id: msgId, kind, category, tokens: meta.budgetEstimate, rawTokens: meta.rawEstimate,
      provenance: { category, kind, createdAt: Date.now(), source: "runTaskLoop" },
    });
    contentMap.set(msgId, msg);
  }

  return { candidateItems, contentMap };
}

/**
 * Converts admitted CandidateContextItems back into system prompt + messages.
 *
 * Invariant: ADMISSION ORDER ≠ CONVERSATION ORDER. The tier selector may
 * reorder items by *priority* during admission, but it must never reorder the
 * resulting conversation. Reconstruction therefore sorts admitted messages by
 * their SOURCE position (`msg-<index>`) so the provider sees the conversation
 * in the exact chronological order it was built — the tier structure must
 * never leak into conversational chronology on the wire. The ledger (injected
 * last) keeps its source position at the end of the conversation.
 */
function reconstructRequest(
  admitted: readonly CandidateContextItem[],
  contentMap: Map<string, NormalizedMessage | { type: "system_prompt"; text: string }>
): { admittedSystemPrompt: string; admittedMessages: NormalizedMessage[] } {
  let admittedSystemPrompt = "";
  const admittedMessages: NormalizedMessage[] = [];
  // Sort by source index: `msg-<i>` items by i; non-message items (system
  // prompt, tool schemas — not in contentMap) sink to the end harmlessly.
  const ordered = [...admitted].sort((a, b) => {
    const ia = sourceIndexOf(a.id);
    const ib = sourceIndexOf(b.id);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  for (const item of ordered) {
    const content = contentMap.get(item.id);
    if (!content) continue;
    if ("type" in content && content.type === "system_prompt") {
      admittedSystemPrompt = content.text;
    } else {
      admittedMessages.push(content as NormalizedMessage);
    }
  }
  return { admittedSystemPrompt, admittedMessages };
}

/** Source position of a candidate item id (`msg-<i>`), or -1 for
 * non-message items (system-prompt, tool schemas). */
function sourceIndexOf(id: string): number {
  const m = /^msg-(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

/** Converts CandidateContextItem[] to preflight-compatible BudgetedContextItem[]. */
function toBudgetedItems(
  items: readonly CandidateContextItem[]
): Array<{ category: ContextCategory; tokens: number }> {
  return items.map(i => ({ category: i.category, tokens: i.tokens }));
}

/**
 * Evaluates the pattern for the completed task and records the outcome.
 * Uses the pattern registry to track which context selection strategies work best.
 */
async function evaluatePattern(
  log: EventLog,
  session: { sessionId: string; actor: "system" },
  sessionDir: string,
  taskType: string
): Promise<void> {
  try {
const { extractSessionOutcome } = await import("../context/session-outcome.js");
const { PatternRegistry } = await import("../context/pattern-registry.js");

const patternsDir = join(sessionDir, "..", ".alix", "patterns");
const registry = new PatternRegistry(patternsDir);

const outcome = await extractSessionOutcome(sessionDir);
await registry.recordOutcome(taskType as TaskType, {
  success: outcome.success,
  iterations: outcome.iterations,
  totalTokens: outcome.totalTokens,
});

await log.append({
  sessionId: session.sessionId,
  actor: "system",
  type: "context.pattern_evaluated",
  payload: {
    taskType,
    success: outcome.success,
    iterations: outcome.iterations,
    tokenUsage: outcome.totalTokens,
  },
});
  } catch {
// Pattern evaluation is best-effort - don't fail the task loop
  }
}