/**
 * Task loop module — extracted from run.ts
 *
 * Contains the main iteration loop that:
 * - Sends requests to the model provider
 * - Handles tool calls
 * - Runs verification checks
 * - Manages the repair loop
 */

import "node:os";
import "node:path";
import "node:crypto";
import type { EventLog } from "../../events/event-log.js";
import type { MemoryStore } from "../../utils/memory/store.js";
import "../../task-classifier.js";
import type { RunResult, ContextPressure } from "../../run.js";
import "../../run.js";
import "../../skills/dispatcher.js";
import "../../verifier/index.js";
import { EnhancedVerifier } from "../../verifier/enhanced-verifier.js";
import { saveDecisionsToMemory } from "../helpers.js";
import type { NormalizedMessage } from "../../providers/types.js";
import type { ScopeTracker } from "../../autonomy/scope-tracker.js";
import type { TaskStateMachine } from "../../autonomy/state-machine.js";
import { saveSessionState } from "../../session/index.js";

import "../context-pressure.js";
import "../../agent/system-prompt.js";
import "../../session/index.js";
import "../progress-ledger.js";
import type { ContextBudget } from "../../config/context-budget.js";
import { ContextBudgetOverflowError } from "../../config/context-budget.js";
import "../../observability/metrics-store.js";
import "../../observability/metric-registry.js";
import "../../observability/state-telemetry.js";
import { CONTEXT_EVENT_TYPES, type ContextRotRiskPayload } from "../../events/types.js";
import { type ContextRotThreshold } from "../../config/calibration-store.js";
import "../../config/model-resolver.js";
import "../../runtime/tool-correlation.js";
import "../../runtime/cancellation-token.js";
import "../../agents/tool-name-map.js";
import { evaluatePattern } from "./context-helpers.js";
import { extractErrors } from "./predicates.js";

/**
 * Complete a session: log the terminal event, persist decisions,
 * evaluate patterns, and return the RunResult. Shared by all
 * completion points in runTaskLoop to eliminate duplicated
 * completion chains.
 */
export async function completeSession(
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

export async function maybeEmitRotRisk(opts: {
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

export function isIrreducibleContextBudgetOverflow(err: unknown): err is ContextBudgetOverflowError {
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

export function buildContextBudgetOverflowSummary(err: ContextBudgetOverflowError): string {
  return `Context budget overflow: needs ${err.overageTokens} more input tokens ` +
    `(${err.availableInputTokens} available, mandatory core ${err.mandatoryTokens})`;
}

/**
 * §2 — Classify an irreducible overflow as `tooling` (dominated by T1a/T1b
 * tool-schema tokens under `mandatory_system_governance`) or `content`
 * (anything else). Tool-schema bloat is actionable — shed-tool re-scope may
 * free enough room on retry. Pure-content overflow is not.
 */

export function classifyIrreducibleKind(byCategory: Record<string, number>): "tooling" | "content" {
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

export async function getHistoricalSuggestions(
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

export const RESEARCH_LIMITS = {
  quick: { maxIterations: 3, maxSearchCalls: 3 },
  deep: { maxIterations: 15, maxSearchCalls: 10 },
} as const;

/**
 * Persist session state at the end of each iteration for crash resilience
 * (#717 method decomposition; non-fatal — session state is best-effort).
 */
export async function persistSessionState(opts: {
  sessionDir: string;
  messages: NormalizedMessage[];
  scope: ScopeTracker;
  stateMachine: TaskStateMachine;
  session: { sessionId: string; actor: "system" };
  log: EventLog;
}): Promise<void> {
  try {
    await saveSessionState(opts.sessionDir, {
      messages: opts.messages,
      scope: opts.scope.toJSON(),
      stateMachine: opts.stateMachine.toJSON(),
    });
  } catch (saveErr) {
    await opts.log.append({ ...opts.session, actor: "system", type: "session.state_persist_failed", payload: { error: String(saveErr) } });
  }
}
