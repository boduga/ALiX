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

  for (const line of lines) {
    let event: AlixEvent;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === "session.ended") {
      const payload = event.payload as { reason?: string; primaryCount?: number; testCount?: number; supportingCount?: number };
      success = payload.reason === "completed";
      reason = payload.reason as SessionOutcome["reason"];
      primaryCount = payload.primaryCount ?? 0;
      testCount = payload.testCount ?? 0;
      supportingCount = payload.supportingCount ?? 0;
    }

    if (event.type === "agent.message") {
      iterations++;
    }

    if (event.type === "model.usage") {
      const payload = event.payload as { inputTokens?: number; outputTokens?: number };
      totalTokens += (payload.inputTokens ?? 0) + (payload.outputTokens ?? 0);
    }
  }

  return { success, reason, iterations, totalTokens, primaryCount, testCount, supportingCount };
}