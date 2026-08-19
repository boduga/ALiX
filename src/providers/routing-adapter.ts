// src/providers/routing-adapter.ts
//
// Capability-aware routing adapter. Tries candidates in user-configured order
// (primary → openrouter/free fallback → explicit fallbacks), skipping
// capability-incompatible candidates and candidates whose circuit breaker is
// open. Retryable statuses (429/500/502/503/504) fall back; anything else
// propagates immediately without tripping the breaker (INV-6, INV-7).

import { ApiError } from "./base.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { supportsRequest, deriveRequestRequirements } from "./free-model-resolver.js";
import { createProvider } from "./registry.js";
import type { ModelConfig } from "../config/schema.js";
import type { ModelAdapter, ModelCapabilities, NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type RoutingCandidate = {
  key: string;
  label: string;
  adapter: ModelAdapter;
};

/**
 * Derive the ordered fallback `ModelConfig` list for a model config.
 *
 * Shared by `buildRoutingAdapter` (composition) and `describeRoutingChain`
 * (CLI) so the fallback-chain shape is defined in exactly one place:
 *
 *   1. OpenRouter free fallback, if enabled and the primary is OpenRouter
 *   2. explicit configured fallbacks
 */
export function buildFallbackChain(model: ModelConfig): ModelConfig[] {
  const routing = model.routing;
  const fallbackModels: ModelConfig[] = [];
  if (routing?.freeFallback && model.provider === "openrouter") {
    fallbackModels.push({ provider: "openrouter", name: "openrouter/free" });
  }
  if (routing?.fallbacks) fallbackModels.push(...routing.fallbacks);
  return fallbackModels;
}

export async function buildRoutingAdapter(
  model: ModelConfig,
  apiKeyFor: (providerId: string) => string,
): Promise<ModelAdapter> {
  const fallbackModels = buildFallbackChain(model);

  if (fallbackModels.length === 0) {
    return createProvider({ provider: model.provider, model: model.name }, apiKeyFor(model.provider));
  }

  const candidates: RoutingCandidate[] = [
    {
      key: `${model.provider}/${model.name}`,
      label: `${model.provider}/${model.name}`,
      adapter: await createProvider({ provider: model.provider, model: model.name }, apiKeyFor(model.provider)),
    },
  ];
  for (const fb of fallbackModels) {
    candidates.push({
      key: `${fb.provider}/${fb.name}`,
      label: `${fb.provider}/${fb.name}`,
      adapter: await createProvider({ provider: fb.provider, model: fb.name }, apiKeyFor(fb.provider)),
    });
  }
  return new RoutingModelAdapter(candidates);
}

export type RoutingOptions = {
  breakerFailureThreshold?: number;
  breakerCooldownMs?: number;
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_BREAKER = { failureThreshold: 2, cooldownMs: 60_000 };

function isRetryable(err: unknown): boolean {
  return err instanceof ApiError && RETRYABLE_STATUS.has(err.status);
}

export class RoutingModelAdapter implements ModelAdapter {
  /** Marker consumed by streamToResponse to suppress its fail-soft re-run for routed providers. */
  readonly isRoutingAdapter = true;

  id: string;
  editFormatPreference: ModelAdapter["editFormatPreference"];
  longContextStrategy: ModelAdapter["longContextStrategy"];

  private candidates: RoutingCandidate[];
  private breakers = new Map<string, CircuitBreaker>();
  private breakerOpts: Required<RoutingOptions>;

  constructor(candidates: RoutingCandidate[], opts: RoutingOptions = {}) {
    if (candidates.length === 0) throw new Error("RoutingModelAdapter requires at least one candidate");
    this.candidates = candidates;
    this.breakerOpts = {
      breakerFailureThreshold: opts.breakerFailureThreshold ?? DEFAULT_BREAKER.failureThreshold,
      breakerCooldownMs: opts.breakerCooldownMs ?? DEFAULT_BREAKER.cooldownMs,
    };
    const primary = candidates[0]!.adapter;
    this.id = primary.id;
    this.editFormatPreference = primary.editFormatPreference;
    this.longContextStrategy = primary.longContextStrategy;
  }

  get capabilities(): ModelCapabilities {
    return this.candidates[0]!.adapter.capabilities;
  }

  private breaker(key: string): CircuitBreaker {
    let b = this.breakers.get(key);
    if (!b) {
      b = new CircuitBreaker({ failureThreshold: this.breakerOpts.breakerFailureThreshold, cooldownMs: this.breakerOpts.breakerCooldownMs });
      this.breakers.set(key, b);
    }
    return b;
  }

  private isEligible(candidate: RoutingCandidate, request: NormalizedRequest): boolean {
    // For `openrouter/*` candidates, provider-static capabilities are
    // optimistic (all true) — the real per-request filter is the free-route
    // resolution inside OpenRouterProvider. supportsRequest therefore never
    // over-rejects an openrouter candidate; it filters concrete-model
    // candidates (anthropic, local-llama, ...) whose capabilities are real.
    return supportsRequest(candidate.adapter.capabilities, deriveRequestRequirements(request));
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    let lastErr: unknown;
    for (const candidate of this.candidates) {
      if (!this.isEligible(candidate, request)) continue;
      const breaker = this.breaker(candidate.key);
      if (!breaker.shouldAttempt()) { lastErr = new Error("Circuit breaker is open — provider unavailable"); continue; }
      try {
        const response = await candidate.adapter.complete(request);
        breaker.onSuccess();
        if (!response.resolvedModel) response.resolvedModel = candidate.label;
        return response;
      } catch (err) {
        lastErr = err;
        if (isRetryable(err)) { breaker.onFailure(); continue; }
        // Non-retryable errors never accumulate toward opening the circuit (INV-6).
        breaker.reset();
        throw err;
      }
    }
    throw lastErr instanceof ApiError && isRetryable(lastErr)
      ? new Error("All routing candidates failed", { cause: lastErr })
      : (lastErr ?? new Error("All routing candidates failed"));
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    let lastErr: unknown;
    for (const candidate of this.candidates) {
      if (!this.isEligible(candidate, request)) continue;
      if (!candidate.adapter.stream) { lastErr = new Error(`Candidate ${candidate.key} does not support streaming`); continue; }
      const breaker = this.breaker(candidate.key);
      if (!breaker.shouldAttempt()) { lastErr = new Error("Circuit breaker is open — provider unavailable"); continue; }
      let committed = false;
      try {
        const generator = candidate.adapter.stream(request);
        for await (const chunk of generator) {
          if (!committed) {
            if (chunk.type === "error") throw new Error(chunk.error);
            if (chunk.type === "text_delta" || chunk.type === "tool_call") committed = true;
          }
          if (chunk.type === "done" && !chunk.resolvedModel) {
            yield { type: "done", resolvedModel: candidate.label };
            continue;
          }
          yield chunk;
        }
        breaker.onSuccess();
        return;
      } catch (err) {
        lastErr = err;
        // Pre-commit: a retryable error may fall back. Post-commit: committed
        // chunks are already forwarded (INV-5) — the error propagates, never
        // continues, so the caller never concatenates candidate output.
        if (!committed && isRetryable(err)) { breaker.onFailure(); continue; }
        if (!committed) breaker.reset();
        throw err;
      }
    }
    if (lastErr) throw lastErr;
  }
}
