/**
 * Context-budget admission phase — extracted from `runTaskLoop` (#717).
 *
 * Assembles the candidate context, reserves scoped tool schemas, emits the
 * T6 context observability events, runs the authoritative assembly + preflight
 * gate, and returns the budgeted messages / assembled result / admitted system
 * prompt. Behavior is unchanged from the inline block it replaces.
 */

import type { NormalizedMessage, ToolDef } from "../../providers/types.js";
import type { DeferredToolEntry } from "../../mcp/tool-deferral.js";
import type { EventLog } from "../../events/event-log.js";
import type { TokenizerName } from "../../config/context-limits.js";
import type { ContextBudget, ContextCategory, TierOrderingConfig } from "../../config/context-budget.js";
import { ContextBudgetOverflowError, preflight } from "../../config/context-budget.js";
import { assembleContext } from "../../config/context-assembly.js";
import type { ExecutionStateEmitter } from "../../runtime/execution-state/execution-state-emitter.js";
import { emitTurnShadow } from "./execution-state-phase.js";
import { estimateBudgetTokens, ensureEncoder } from "../../utils/tokens.js";
import { CONTEXT_EVENT_TYPES } from "../../events/types.js";
import type { StateTelemetry } from "../../observability/state-telemetry.js";
import { createContextPressureTracker } from "../context-pressure.js";
import { classifyIrreducibleKind } from "./session-lifecycle.js";
import { reconstructRequest, toBudgetedItems, classifyCandidateContext } from "./context-helpers.js";
import {
  RESEARCH_SUPPLEMENT,
  MUTATION_SUPPLEMENT,
  VALIDATION_SUPPLEMENT,
  renderToolManifest,
} from "../../agent/system-prompt.js";
import type { AgentIntent } from "../intent-classifier.js";
import type { ProgressLedger } from "../progress-ledger.js";

/**
 * Intent-specific system prompt + wire-tool manifest (#717 extraction).
 *
 * The wire-tool set is hoisted so the prompt manifest and the wire payload
 * agree: pre-§2 the manifest was rendered from the full registry while the
 * wire admitted only the scoped subset. Reusing `wireTools` makes the
 * invariant structural. Pure — same output as the inline block.
 */
export function buildEffectiveSystemPrompt(args: {
  systemPrompt: string;
  currentIntent: AgentIntent | undefined;
  coreTools: ToolDef[];
  extendedTools: ToolDef[];
  reintroducedTools: Array<ToolDef | DeferredToolEntry>;
}): { wireTools: Array<ToolDef | DeferredToolEntry>; effectiveSystemPrompt: string } {
  const { systemPrompt, currentIntent, coreTools, extendedTools, reintroducedTools } = args;
  const supplement = currentIntent === "research" ? RESEARCH_SUPPLEMENT
    : currentIntent === "mutation" ? MUTATION_SUPPLEMENT
    : VALIDATION_SUPPLEMENT;
  const wireTools = [...coreTools, ...extendedTools, ...reintroducedTools];
  const toolManifest = wireTools.length > 0 ? `\n\n${renderToolManifest(wireTools)}` : "";
  const effectiveSystemPrompt = `${systemPrompt}\n\n${supplement}\n\n` +
    `CURRENT TURN BOUNDARY: The current task is the latest user request. ` +
    `Earlier completed turns are context only. Do not describe them as work performed in this turn, ` +
    `and do not include their results in the final summary unless the user explicitly asks for a recap.` +
    toolManifest;
  return { wireTools, effectiveSystemPrompt };
}

/**
 * Progress-ledger injection (I1 extraction). Renders the ledger and pushes
 * it into messages BEFORE budget admission so it is token-accounted (Tier 3,
 * protected). The ledger is a replaceable snapshot — only the latest copy is
 * kept so iterations do not compound the same progress state. Pure — same
 * output as the inline block.
 */
export function injectProgressLedger(args: {
  messages: NormalizedMessage[];
  progressLedger: ProgressLedger;
  onLedgerUpdate?: (text: string) => void;
}): NormalizedMessage[] {
  let messages = args.messages;
  const ledgerText = args.progressLedger.render(10);
  if (ledgerText) {
    messages = messages.filter((message) =>
      !(message.role === "user" && typeof message.content === "string" && message.content.startsWith("[Progress Ledger]"))
    );
    messages.push({
      role: "user",
      content: `[Progress Ledger]\n${ledgerText}`,
    });
  }
  if (args.onLedgerUpdate && ledgerText) args.onLedgerUpdate(ledgerText);
  return messages;
}

export interface AssembleContextParams {
  effectiveSystemPrompt: string;
  messages: NormalizedMessage[];
  tokenizer: TokenizerName;
  coreTools: ToolDef[];
  extendedTools: ToolDef[];
  session: { sessionId: string; actor: "system" };
  log: EventLog;
  invocationId: string;
  contextBudget: ContextBudget;
  tierOrdering: TierOrderingConfig | undefined;
  contextPressure: ReturnType<typeof createContextPressureTracker>;
  iteration: number;
  stateTelemetry: StateTelemetry | null;
  executionId: string;
  /**
   * Opt-in shadow state-aware prompt (execution-state emission). When present
   * and the emitter holds a state, the bounded P+Σ+O+E+Tools prompt is built
   * alongside the live request and a `context.shadow.assembled` event records
   * the token delta. The shadow prompt is never sent to the provider.
   */
  shadow?: {
    emitter: ExecutionStateEmitter | null;
    objective: string;
    tools: ReadonlyArray<{ name: string; description?: string }>;
  } | null;
}

export async function assembleBudgetedContext(p: AssembleContextParams): Promise<{
  messages: NormalizedMessage[];
  assembled: ReturnType<typeof assembleContext>;
  admittedSystemPrompt: string;
}> {
  const {
    effectiveSystemPrompt, tokenizer, coreTools, extendedTools, session, log,
    invocationId, contextBudget, tierOrdering, contextPressure, stateTelemetry, executionId,
  } = p;
  let messages = p.messages;
  const i = p.iteration;

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

		const scopedTools = [...coreTools, ...extendedTools];
		if (scopedTools.length > 0) {
		  const wireToolSchemaMeta = await estimateBudgetTokens(JSON.stringify(scopedTools), tokenizer);
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
	  assembled = assembleContext(candidateItems, contextBudget, tierOrdering);
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
    // #641 — Wire assembled context metadata to observability via StateTelemetry
    // (MetricsStore + TelemetryEnvelope). Emits source/selected/evicted/tokens
    // per tier plus admitted/dropped totals. Non-blocking, non-fatal.
    if (stateTelemetry) {
      try {
        stateTelemetry.recordAssembledContext(executionId, assembled, { invocationId });
      } catch { /* swallow telemetry errors */ }
    }

    // ── Opt-in shadow state-aware prompt (execution-state emission) ───
    // Builds the bounded P+Σ+O+E+Tools prompt alongside the live request and
    // records the token delta. Never sent to the provider; fail-soft.
    if (p.shadow?.emitter) {
      await emitTurnShadow({
        emitter: p.shadow.emitter,
        log,
        sessionId: `${session.sessionId}-agent`,
        invocationId,
        objective: p.shadow.objective,
        tools: p.shadow.tools,
        liveAdmittedTokens: assembled.admittedTokens,
      });
    }
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


  // Replace the loop's mutable messages with the assembled subset.
  messages = admittedMessages;

  return { messages, assembled, admittedSystemPrompt };
}
