import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type SessionOutcome = {
  success: boolean;
  reason?: "completed" | "max_iterations" | "error" | "max_repairs" | "rejected_scope_expansion";
  iterations: number;
  totalTokens: number;
  primaryCount: number;
  testCount: number;
  supportingCount: number;
};

type EventType =
  | "session.started"
  | "session.ended"
  | "agent.message"
  | "model.usage"
  | string;

type AlixEvent = {
  type: EventType;
  sessionId: string;
  timestamp: string;
  actor: string;
  seq: number;
  id: string;
  version: number;
  payload: Record<string, unknown>;
};

/**
 * Extracts outcome metrics from a session's events.jsonl file.
 * Parses the event log to determine success, reason, iterations, and token usage.
 */
export async function extractSessionOutcome(sessionDir: string): Promise<SessionOutcome> {
  const eventsPath = join(sessionDir, "events.jsonl");

  // Return default outcome if events file doesn't exist
  if (!existsSync(eventsPath)) {
    return {
      success: false,
      reason: "error",
      iterations: 0,
      totalTokens: 0,
      primaryCount: 0,
      testCount: 0,
      supportingCount: 0,
    };
  }

  const content = await readFile(eventsPath, "utf8");
  const lines = content.split("\n").filter(Boolean);

  let success = false;
  let reason: SessionOutcome["reason"];
  let iterations = 0;
  let totalTokens = 0;
  let primaryCount = 0;
  let testCount = 0;
  let supportingCount = 0;
  // `session.ended` carries the loop's own count. Preferred over any recount,
  // for two reasons.
  //
  // T3 finding 7 recorded the same number arriving three ways with three
  // answers: `agent.decision` (only emitted when the model CALLS TOOLS, so a
  // pure-prose turn contributes zero), `contextPressure.totalIterations`
  // (once per loop turn), and this module's `agent.message` tally. Measured
  // across 68 recorded sessions: mean 3.7 / 4.3 / 1.8, and 52 of 68 sessions
  // disagreed.
  //
  // The recount is not merely a different number — it is structurally incapable
  // of agreeing. `agent.message` is emitted for assistant prose, so it misses
  // tool-only turns entirely and over-counts a turn that streams several
  // messages. The loop already knows the true count; re-deriving it from a
  // proxy event is what created the disagreement in the first place.
  let iterationsAuthoritative = false;

  // Two passes, because `session.ended` is written LAST and the fallback tally
  // keys off it. A single pass would count every `agent.message` and then have
  // to un-count them, which is exactly the kind of order-dependent arithmetic
  // that made the original three numbers disagree.
  const events: AlixEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as AlixEvent);
    } catch {
      continue;
    }
  }

  const ended = events.find((event) => event.type === "session.ended");
  if (ended) {
    const payload = ended.payload as {
      reason?: string;
      primaryCount?: number;
      testCount?: number;
      supportingCount?: number;
      contextPressure?: { totalIterations?: number };
    };
    success = payload.reason === "completed";
    reason = payload.reason as SessionOutcome["reason"];
    primaryCount = payload.primaryCount ?? 0;
    testCount = payload.testCount ?? 0;
    supportingCount = payload.supportingCount ?? 0;
    const reported = payload.contextPressure?.totalIterations;
    // Only trust a POSITIVE integer. A zero or missing value falls back to the
    // recount rather than overwriting it with a confident 0 — absence of
    // evidence is not evidence of absence.
    if (typeof reported === "number" && Number.isInteger(reported) && reported > 0) {
      iterations = reported;
      iterationsAuthoritative = true;
    }
  }

  for (const event of events) {
    if (event.type === "model.usage") {
      const payload = event.payload as { inputTokens?: number; outputTokens?: number };
      totalTokens += (payload.inputTokens ?? 0) + (payload.outputTokens ?? 0);
    }

    // Fallback tally, and only when the session did not report its own count
    // (older traces, or a `session.ended` written without contextPressure).
    if (!iterationsAuthoritative && event.type === "agent.message") {
      iterations++;
    }
  }

  return { success, reason, iterations, totalTokens, primaryCount, testCount, supportingCount };
}