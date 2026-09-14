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
import { join } from "node:path";
import "node:crypto";
import type { NormalizedMessage } from "../../providers/types.js";
import type { EventLog } from "../../events/event-log.js";
import type { TaskType } from "../../task-classifier.js";
import "../../task-classifier.js";
import "../../run.js";
import "../../skills/dispatcher.js";
import "../../verifier/index.js";
import "../../verifier/enhanced-verifier.js";
import "../helpers.js";
import "../context-pressure.js";
import "../../agent/system-prompt.js";
import "../../session/index.js";
import "../progress-ledger.js";
import { estimateMessageBudgetTokens, estimateBudgetTokens } from "../../utils/tokens.js";
import type { TokenizerName } from "../../config/context-limits.js";
import type { ContextCategory } from "../../config/context-budget.js";
import { type CandidateContextItem } from "../../config/context-assembly.js";
import "../../observability/metrics-store.js";
import "../../observability/metric-registry.js";
import "../../observability/state-telemetry.js";
import "../../config/model-resolver.js";
import "../../runtime/tool-correlation.js";
import "../../runtime/cancellation-token.js";
import "../../agents/tool-name-map.js";


// Helper functions used by the task loop

/**
 * Builds a session digest from the event log directory.
 * Returns null if digest generation fails.
 */
// ── T5: Context Budget helper functions ────────────────────────────────────

/**
 * Classify a single message into a ContextCategory for the budget assembly.
 */
export function classifyMessageToCategory(
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
export async function classifyCandidateContext(
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

export function reconstructRequest(
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

export function sourceIndexOf(id: string): number {
  const m = /^msg-(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

/** Converts CandidateContextItem[] to preflight-compatible BudgetedContextItem[]. */
export function toBudgetedItems(
  items: readonly CandidateContextItem[]
): Array<{ category: ContextCategory; tokens: number }> {
  return items.map(i => ({ category: i.category, tokens: i.tokens }));
}

/**
 * Evaluates the pattern for the completed task and records the outcome.
 * Uses the pattern registry to track which context selection strategies work best.
 */
export async function evaluatePattern(
  log: EventLog,
  session: { sessionId: string; actor: "system" },
  sessionDir: string,
  taskType: string
): Promise<void> {
  try {
const { extractSessionOutcome } = await import("../../context/session-outcome.js");
const { PatternRegistry } = await import("../../context/pattern-registry.js");

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
