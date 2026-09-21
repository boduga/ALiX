/**
 * fallback.ts — Fallback/error policy (J0).
 *
 * Remote unavailable/timeout/malformed → decision-configured fallback or
 * explicit safe failure. Projection validation failure never reaches here
 * (boundary rejects first — retrying an identical sealed input is pointless).
 * Unexpected engine bugs propagate; only known engine errors engage fallback.
 */

import type { DecisionType } from "./contracts.js";
import type { EngineRegistry } from "./registry.js";
import { EngineNotRegisteredError, RemoteEngineNotAllowedError } from "./registry.js";
import {
  EngineUnavailableError,
  ExecutorMissingError,
  MalformedResultError,
  assertValidOutcome,
  type DecisionExecutor,
  type ExecuteInput,
  type ExecutorOutcome,
} from "./executors.js";
import {
  isRemoteEngineAllowed,
  routePolicyFor,
  type DecisionConfig,
} from "./config.js";
import { JEV_ENGINE_ID } from "./engines/jev.js";

export const DEFAULT_FALLBACK_TIMEOUT_MS = 10_000;
export const EXTERNAL_ROUTING_FALLBACK = "existing-routing";

export class EngineTimeoutError extends Error {
  readonly code = "ENGINE_TIMEOUT";
  constructor(engineId: string, timeoutMs: number) {
    super(`Decision engine timed out (${engineId} after ${timeoutMs}ms)`);
    this.name = "EngineTimeoutError";
  }
}

export type AttemptRecord = {
  engineId: string;
  ok: boolean;
  error?: string;
  latencyMs: number;
};

export type ExecutionPlan = {
  primary: DecisionExecutor | null;
  primaryId: string;
  fallback: DecisionExecutor | null;
  fallbackId: string | null;
  externalFallback?: string;
  primarySkipped?: string;
};

export type FallbackResult = {
  outcome: ExecutorOutcome;
  attempts: AttemptRecord[];
  usedFallback: boolean;
  primarySkipped?: string;
};

export type ExecuteWithFallbackOptions = {
  timeoutMs?: number;
  onAttempt?: (attempt: AttemptRecord) => void;
};

function requireExecutor(
  registry: EngineRegistry,
  engineId: string,
  config: DecisionConfig,
): DecisionExecutor {
  const engine = registry.get(engineId);
  if (!engine) throw new EngineNotRegisteredError(engineId);
  if (engine.remote && !isRemoteEngineAllowed(engineId, config)) {
    throw new RemoteEngineNotAllowedError(engineId);
  }
  if (!engine.executor) throw new ExecutorMissingError(engineId);
  return engine.executor;
}

function externalPlan(primarySkipped: string | undefined): ExecutionPlan {
  return {
    primary: null,
    primaryId: EXTERNAL_ROUTING_FALLBACK,
    fallback: null,
    fallbackId: null,
    externalFallback: EXTERNAL_ROUTING_FALLBACK,
    ...(primarySkipped !== undefined ? { primarySkipped } : {}),
  };
}

/**
 * Pure plan builder. Known-remote-disabled degrades to fallback (JEV-7);
 * unknown engine ids fail closed (config error, explicit throw).
 */
export function buildPlan(
  decision: DecisionType,
  config: DecisionConfig,
  registry: EngineRegistry,
): ExecutionPlan {
  const route = routePolicyFor(config, decision);
  let primaryId = route.engine;
  let primarySkipped: string | undefined;
  const primaryMeta = registry.get(primaryId);
  if (primaryMeta) {
    if (primaryMeta.remote && !isRemoteEngineAllowed(primaryId, config)) {
      primarySkipped = `remote-not-allowed:${primaryId}`;
      primaryId = route.fallback;
    }
  } else if (primaryId === JEV_ENGINE_ID) {
    primarySkipped = `remote-not-allowed:${primaryId}`;
    primaryId = route.fallback;
  } else if (primaryId !== EXTERNAL_ROUTING_FALLBACK) {
    throw new EngineNotRegisteredError(primaryId);
  }
  if (primaryId === EXTERNAL_ROUTING_FALLBACK) return externalPlan(primarySkipped);
  const primary = requireExecutor(registry, primaryId, config);
  let fallback: DecisionExecutor | null = null;
  let fallbackId: string | null = null;
  let externalFallback: string | undefined;
  if (primarySkipped === undefined && route.fallback !== route.engine) {
    if (route.fallback === EXTERNAL_ROUTING_FALLBACK) {
      externalFallback = EXTERNAL_ROUTING_FALLBACK;
    } else {
      const fallbackMeta = registry.get(route.fallback);
      if (!fallbackMeta) throw new EngineNotRegisteredError(route.fallback);
      if (!fallbackMeta.remote || isRemoteEngineAllowed(route.fallback, config)) {
        fallback = requireExecutor(registry, route.fallback, config);
        fallbackId = route.fallback;
      }
    }
  }
  return {
    primary,
    primaryId,
    fallback,
    fallbackId,
    ...(externalFallback !== undefined ? { externalFallback } : {}),
    ...(primarySkipped !== undefined ? { primarySkipped } : {}),
  };
}

function isFallbackEligible(error: unknown): boolean {
  return (
    error instanceof EngineUnavailableError ||
    error instanceof EngineTimeoutError ||
    error instanceof MalformedResultError
  );
}

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
        timer = setTimeout(() => reject(new EngineTimeoutError(executor.engineId, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function failureOutcome(error: string): ExecutorOutcome {
  return { kind: "failure", error };
}

/**
 * Execute primary, fall back on known engine errors or malformed results.
 * Unknown errors (engine bugs) propagate. External-only plans return an
 * explicit failure outcome for the J3 runtime to handle.
 */
export async function executeWithFallback(
  plan: ExecutionPlan,
  input: ExecuteInput,
  opts?: ExecuteWithFallbackOptions,
): Promise<FallbackResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_FALLBACK_TIMEOUT_MS;
  const attempts: AttemptRecord[] = [];
  const note = (attempt: AttemptRecord): void => {
    attempts.push(attempt);
    opts?.onAttempt?.(attempt);
  };
  if (!plan.primary) {
    return {
      outcome: failureOutcome(`external fallback: ${plan.externalFallback} (no in-process executor)`),
      attempts,
      usedFallback: false,
      ...(plan.primarySkipped !== undefined ? { primarySkipped: plan.primarySkipped } : {}),
    };
  }
  const started = Date.now();
  try {
    const outcome = await runWithTimeout(plan.primary, input, timeoutMs);
    assertValidOutcome(outcome, input.candidates);
    note({ engineId: plan.primaryId, ok: true, latencyMs: Date.now() - started });
    return { outcome, attempts, usedFallback: false };
  } catch (primaryError) {
    if (!isFallbackEligible(primaryError)) throw primaryError;
    const primaryMessage = (primaryError as Error).message;
    note({ engineId: plan.primaryId, ok: false, error: primaryMessage, latencyMs: Date.now() - started });
    if (!plan.fallback) {
      return {
        outcome: failureOutcome(`primary failed: ${primaryMessage} (no fallback)`),
        attempts,
        usedFallback: false,
        ...(plan.primarySkipped !== undefined ? { primarySkipped: plan.primarySkipped } : {}),
      };
    }
    const fallbackStarted = Date.now();
    try {
      const outcome = await runWithTimeout(plan.fallback, input, timeoutMs);
      assertValidOutcome(outcome, input.candidates);
      note({ engineId: plan.fallbackId as string, ok: true, latencyMs: Date.now() - fallbackStarted });
      return {
        outcome,
        attempts,
        usedFallback: true,
        ...(plan.primarySkipped !== undefined ? { primarySkipped: plan.primarySkipped } : {}),
      };
    } catch (fallbackError) {
      if (!isFallbackEligible(fallbackError)) throw fallbackError;
      const fallbackMessage = (fallbackError as Error).message;
      note({
        engineId: plan.fallbackId as string,
        ok: false,
        error: fallbackMessage,
        latencyMs: Date.now() - fallbackStarted,
      });
      return {
        outcome: failureOutcome(`primary failed: ${primaryMessage}; fallback failed: ${fallbackMessage}`),
        attempts,
        usedFallback: true,
        ...(plan.primarySkipped !== undefined ? { primarySkipped: plan.primarySkipped } : {}),
      };
    }
  }
}
