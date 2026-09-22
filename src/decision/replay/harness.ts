/**
 * harness.ts — Offline dry-run replay (J5 task 34).
 *
 * Runs executors over stored fixtures and returns in-memory results. The
 * signature is the guarantee: it admits ONLY fixtures and an executor — no
 * journal, no approval store, no tools, no PolicyGate. Replay therefore
 * cannot execute tools or mutate governance state; there is no channel by
 * which it could. Every run is time-bounded so a hung engine cannot stall
 * the harness.
 */

import { EngineTimeoutError } from "../fallback.js";
import type {
  DecisionExecutor,
  ExecuteInput,
  ExecutorOutcome,
} from "../executors.js";
import type { ReplayFixture } from "./fixtures.js";

export const DEFAULT_REPLAY_TIMEOUT_MS = 30_000;

export type ReplayRun = {
  fixtureId: string;
  engineId: string;
  outcome: ExecutorOutcome;
  latencyMs: number;
};

async function runWithTimeout(
  executor: DecisionExecutor,
  input: ExecuteInput,
  timeoutMs: number,
): Promise<ExecutorOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      executor.execute(input),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new EngineTimeoutError(executor.engineId, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Replay one fixture through one executor. Transport failure, timeout, and
 * unexpected errors all become explicit failure outcomes with the engine and
 * fixture id — never a throw that could abort a whole suite.
 */
export async function replayFixture(
  fixture: ReplayFixture,
  executor: DecisionExecutor,
  opts?: { timeoutMs?: number },
): Promise<ReplayRun> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS;
  const started = Date.now();
  let outcome: ExecutorOutcome;
  try {
    outcome = await runWithTimeout(
      executor,
      { decision: fixture.decision, sealed: fixture.sealed, candidates: fixture.candidates },
      timeoutMs,
    );
  } catch (cause) {
    outcome = {
      kind: "failure",
      error: `${fixture.id} @ ${executor.engineId}: ${(cause as Error).message}`,
    };
  }
  return {
    fixtureId: fixture.id,
    engineId: executor.engineId,
    outcome,
    latencyMs: Date.now() - started,
  };
}

/** Replay every fixture through every executor; keyed by engine id. */
export async function replaySuite(
  fixtures: readonly ReplayFixture[],
  executors: readonly DecisionExecutor[],
  opts?: { timeoutMs?: number },
): Promise<Record<string, ReplayRun[]>> {
  const results: Record<string, ReplayRun[]> = {};
  for (const executor of executors) {
    const runs: ReplayRun[] = [];
    for (const fixture of fixtures) {
      runs.push(await replayFixture(fixture, executor, opts));
    }
    results[executor.engineId] = runs;
  }
  return results;
}
