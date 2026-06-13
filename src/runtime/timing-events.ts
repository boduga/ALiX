/**
 * timing-events.ts — Correlated timing events for ALiX operations.
 *
 * measurePhase() wraps any async operation and emits a started/completed
 * pair via EventLog with a shared timingId for correlation.
 *
 * On success: phase.completed includes durationMs and outcome:"success".
 * On failure: phase.completed includes durationMs, outcome:"failure", and error.
 * The original error is rethrown.
 */

import type { EventLog } from "../events/event-log.js";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

export type TimingMetadata = Record<string, string | number | boolean>;

export type TimingEventPayload = {
  timingId: string;
  operation: string;
  durationMs?: number;
  outcome?: "success" | "failure";
  error?: string;
  metadata?: TimingMetadata;
};

/**
 * Wrapper that emits runtime.phase.started, runs work, emits
 * runtime.phase.completed, and rethrows on failure.
 *
 * When log is undefined, runs work without instrumentation.
 */
export async function measurePhase<T>(
  log: EventLog | undefined,
  sessionId: string,
  operation: string,
  work: () => Promise<T>,
  metadata?: TimingMetadata,
): Promise<T> {
  if (!log) return work();

  const timingId = randomUUID();
  await log.append({
    sessionId,
    actor: "system",
    type: "runtime.phase.started",
    payload: { timingId, operation, metadata } as TimingEventPayload,
  });

  const startTime = performance.now();
  try {
    const result = await work();
    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
    await log.append({
      sessionId,
      actor: "system",
      type: "runtime.phase.completed",
      payload: { timingId, operation, durationMs, outcome: "success", metadata } as TimingEventPayload,
    });
    return result;
  } catch (e: any) {
    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
    await log.append({
      sessionId,
      actor: "system",
      type: "runtime.phase.completed",
      payload: { timingId, operation, durationMs, outcome: "failure", error: e.message || String(e), metadata } as TimingEventPayload,
    });
    throw e;
  }
}
