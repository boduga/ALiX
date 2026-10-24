/**
 * eval-execution-metrics.ts — capture tool/retry/approval counts from an eval
 * case's session log before the runner deletes the case cwd.
 *
 * WHY THIS EXISTS
 *
 * Gate B requires per-task tool calls, repeated calls, retries and operator
 * interventions (`ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` §7). The eval runner gives
 * every case its own temp cwd and removes it in a `finally`, so the only
 * authoritative record — `<cwd>/.alix/sessions/<id>/events.jsonl` — is gone by
 * the time a sweep could read it. This module reads it while it still exists.
 *
 * NULLS ARE FIRST-CLASS
 *
 * A metric that cannot be derived is `null` with a reason, never `0`. A case
 * that made no tool call is a measured zero (the log was read and contained
 * none). A case whose log is missing or unreadable is unknown. Provider-level
 * retries are not emitted anywhere in the event vocabulary, so they stay null.
 *
 * This module measures only. It never appends, approves, retries or repairs.
 *
 * @module
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Byte bounds per log and across the case, so a corrupt log cannot exhaust memory. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

/** Counts derived from one case's durable tool/approval events. */
export type EvalExecutionMetrics = {
  /**
   * True when at least one session log was read. False means nothing was
   * observed, so every count below is `null` rather than zero.
   */
  observed: boolean;
  /** `tool.requested` count. */
  toolCalls: number | null;
  /** `tool.completed` count. */
  toolCallsCompleted: number | null;
  /** `tool.failed` count. */
  toolCallsFailed: number | null;
  /**
   * Requests whose exact identity (tool name + argument preview) repeats an
   * earlier request in the same session.
   */
  repeatedCalls: number | null;
  /**
   * Repeats whose immediately preceding attempt of the same identity failed.
   * This is a tool-level retry, not a provider retry.
   */
  toolRetries: number | null;
  /** `approval.resolved` count — operator decisions touching the run. */
  operatorInterventions: number | null;
  /** Explicit absence reasons. Empty when every count above is measured. */
  unobserved: string[];
};

const EMPTY = (reason: string): EvalExecutionMetrics => ({
  observed: false,
  toolCalls: null,
  toolCallsCompleted: null,
  toolCallsFailed: null,
  repeatedCalls: null,
  toolRetries: null,
  operatorInterventions: null,
  unobserved: [reason, "provider retries are not emitted by the event vocabulary"],
});

/** Key-sorted serialization so argument order never fabricates a distinct call. */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`);
  return `{${entries.join(",")}}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read tool and approval events from every session log under
 * `<cwd>/.alix/sessions`.
 *
 * Tolerant by design: a malformed line is skipped rather than thrown, because a
 * case whose behaviour was already evaluated must not fail on an unreadable
 * log. But an unreadable or oversized *file* yields unknown counts, not a
 * partial total presented as complete.
 */
export function captureEvalExecutionMetrics(cwd: string): EvalExecutionMetrics {
  const sessionsRoot = join(cwd, ".alix", "sessions");
  if (!existsSync(sessionsRoot)) {
    return EMPTY("no session log was present when the case cwd was read");
  }

  let sessionDirs: string[];
  try {
    sessionDirs = readdirSync(sessionsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return EMPTY("session directory could not be listed");
  }
  if (sessionDirs.length === 0) {
    return EMPTY("no session directory was present");
  }

  let toolCalls = 0;
  let toolCallsCompleted = 0;
  let toolCallsFailed = 0;
  let repeatedCalls = 0;
  let toolRetries = 0;
  let operatorInterventions = 0;
  let readAny = false;
  let totalBytes = 0;
  let truncated = false;

  for (const sessionId of sessionDirs) {
    const path = join(sessionsRoot, sessionId, "events.jsonl");
    if (!existsSync(path)) continue;
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        truncated = true;
        continue;
      }
      if (stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES) {
        truncated = true;
        continue;
      }
      totalBytes += stat.size;
      readAny = true;
      const raw = readFileSync(path, "utf-8");
      /** identity → outcome of the most recent COMPLETED attempt, per session. */
      const lastOutcome = new Map<string, "success" | "failed">();
      /** toolCallId → identity, so a terminal event can close the right attempt. */
      const pending = new Map<string, string>();
      const seen = new Set<string>();

      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let event: unknown;
        try {
          event = JSON.parse(trimmed);
        } catch {
          continue; // a torn trailing line must not discard the rest
        }
        if (!isObject(event) || typeof event.type !== "string") continue;

        if (event.type === "approval.resolved") {
          operatorInterventions += 1;
          continue;
        }

        const payload = isObject(event.payload) ? event.payload : {};
        const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : null;

        if (event.type === "tool.completed" || event.type === "tool.failed") {
          if (event.type === "tool.completed") toolCallsCompleted += 1;
          else toolCallsFailed += 1;
          const identity = toolCallId ? pending.get(toolCallId) : undefined;
          if (identity !== undefined) {
            // A completed call can still carry `status: "cancelled"`. It is a
            // terminal, but not a success, so a later identical request is a
            // retry rather than a plain repeat.
            const failedOutcome = event.type === "tool.failed" || payload.status === "cancelled";
            lastOutcome.set(identity, failedOutcome ? "failed" : "success");
            pending.delete(toolCallId!);
          }
          continue;
        }
        if (event.type !== "tool.requested") continue;

        toolCalls += 1;
        const toolName = typeof payload.toolName === "string" ? payload.toolName : "";
        const args = isObject(payload.argsPreview) ? payload.argsPreview : {};
        const identity = `${toolName}\u0000${stable(args)}`;

        if (seen.has(identity)) {
          repeatedCalls += 1;
          if (lastOutcome.get(identity) === "failed") toolRetries += 1;
        }
        seen.add(identity);
        if (toolCallId) pending.set(toolCallId, identity);
      }
    } catch {
      truncated = true;
    }
  }

  if (!readAny) {
    return EMPTY("session log was unreadable or oversized");
  }
  if (truncated) {
    // A partial scan must not be reported as a complete measurement.
    return {
      ...EMPTY("at least one session log was unreadable or oversized"),
      observed: true,
    };
  }

  return {
    observed: true,
    toolCalls,
    toolCallsCompleted,
    toolCallsFailed,
    repeatedCalls,
    toolRetries,
    operatorInterventions,
    unobserved: ["provider retries are not emitted by the event vocabulary"],
  };
}
