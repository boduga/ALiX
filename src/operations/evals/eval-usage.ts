/**
 * eval-usage.ts — capture metered model usage from an eval case's session log
 * before the runner deletes the case cwd.
 *
 * WHY THIS EXISTS
 *
 * The eval runner gives every case its own temp cwd and removes it in a
 * `finally`. `runTask` writes its event log to
 * `<cwd>/.alix/sessions/<sessionId>/events.jsonl`, so the `model.usage` events —
 * the only authoritative token record — were deleted before anything could read
 * them.
 *
 * The consequence was measured, not theorised: a real gpt-4o run of the two
 * main-loop cases passed 2/2 and produced no cost evidence at all, because the
 * usage had already been removed with the cwd. A deterministic (scripted) case
 * makes no billable call, so it is unaffected and reports `null`.
 *
 * This module reads the usage records while the log still exists. It does not
 * compute money: that stays in `cost-attribution`, which owns pricing. Capturing
 * tokens here and pricing there keeps one pricing authority.
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One provider-reported usage record, taken verbatim from a `model.usage` event. */
export type EvalUsageRecord = {
  /** Authoritative run identity, when the emitting loop had one. */
  runId?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
};

export type EvalUsageCapture = {
  /** Every usage record observed for the case, in log order. */
  records: EvalUsageRecord[];
  /** Sum of reported input tokens, or `null` when nothing was observed. */
  inputTokens: number | null;
  /** Sum of reported output tokens, or `null` when nothing was observed. */
  outputTokens: number | null;
  /**
   * True only when at least one usage record was observed. A deterministic case
   * legitimately has none; that is `unknown`, not a measured zero.
   */
  observed: boolean;
};

/**
 * Read `model.usage` events from every session log under `<cwd>/.alix/sessions`.
 *
 * Tolerant by design: a malformed line or an unreadable file is skipped rather
 * than thrown, because losing one record must not fail the case whose behaviour
 * has already been evaluated. Returns `observed: false` when nothing is found —
 * callers must treat that as unknown, never as zero cost.
 */
export function captureEvalUsage(cwd: string): EvalUsageCapture {
  const sessionsRoot = join(cwd, ".alix", "sessions");
  const records: EvalUsageRecord[] = [];
  if (!existsSync(sessionsRoot)) {
    return { records, inputTokens: null, outputTokens: null, observed: false };
  }

  let sessionDirs: string[];
  try {
    sessionDirs = readdirSync(sessionsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return { records, inputTokens: null, outputTokens: null, observed: false };
  }

  for (const dir of sessionDirs) {
    const path = join(sessionsRoot, dir, "events.jsonl");
    if (!existsSync(path)) continue;
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: { type?: string; runId?: string; payload?: Record<string, unknown> };
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue; // a torn trailing line must not discard the rest
      }
      if (event.type !== "model.usage") continue;
      const payload = event.payload ?? {};
      records.push({
        ...(typeof event.runId === "string" ? { runId: event.runId } : {}),
        ...(typeof payload.provider === "string" ? { provider: payload.provider } : {}),
        ...(typeof payload.model === "string" ? { model: payload.model } : {}),
        ...(typeof payload.inputTokens === "number" ? { inputTokens: payload.inputTokens } : {}),
        ...(typeof payload.outputTokens === "number" ? { outputTokens: payload.outputTokens } : {}),
      });
    }
  }

  if (records.length === 0) {
    return { records, inputTokens: null, outputTokens: null, observed: false };
  }
  return {
    records,
    inputTokens: records.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0),
    outputTokens: records.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0),
    observed: true,
  };
}
