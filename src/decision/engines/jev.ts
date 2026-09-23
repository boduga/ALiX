/**
 * engines/jev.ts — TypeSafe System One adapter.
 *
 * JEV-7: disabled by default. Registration is explicit; the adapter never
 * reads ambient environment for credentials (store-only: caller supplies
 * apiKey). The wire shape is verified against the official API reference and
 * SDK types (see `jev-protocol.ts`), and the per-decision mappings live in
 * `decisions/*\/jev-mapping.ts`.
 *
 * The remote boundary is re-validated here (architecture §6): a caller that
 * bypasses `projectForRemote` cannot cross to Jev with an unsealed or forged
 * projection.
 *
 * Retry follows the documented guidance (429 Too Many Requests / 529
 * Overloaded -> exponential backoff), bounded and abort-aware. Everything
 * else fails closed as an EngineUnavailableError, which is fallback-eligible.
 */

import type { DecisionType } from "../contracts.js";
import type { DecisionEngine, EngineRegistry } from "../registry.js";
import { RemoteEngineNotAllowedError } from "../registry.js";
import { ProjectionRejectedError, verifySealedProjection } from "../boundary.js";
import {
  EngineUnavailableError,
  type DecisionExecutor,
  type ExecuteInput,
  type ExecutorOutcome,
} from "../executors.js";
import {
  JEV_DEFAULT_MODEL,
  JEV_SYSTEMONE_ENDPOINT,
  type JevResponseContext,
  type JevSystemOneRequest,
  type JevSystemOneResponse,
  type JevTransport,
} from "./jev-protocol.js";
import {
  fromJevResponse,
  toJevRequest,
} from "../decisions/claim-verification/jev-mapping.js";
import {
  fromJevRelevanceResponse,
  toJevRelevanceRequest,
} from "../decisions/context-relevance/jev-mapping.js";
import {
  fromJevModelTierResponse,
  toJevModelTierRequest,
} from "../decisions/model-tier/jev-mapping.js";
import {
  fromJevRiskResponse,
  toJevRiskRequest,
} from "../decisions/risk-escalation/jev-mapping.js";
import { filterTierCandidates } from "../decisions/model-tier/tiers.js";

export const JEV_ENGINE_ID = "jev";

/** Provider id under which the TypeSafe/Jev key is stored (store-only). */
export const JEV_KEY_PROVIDER_ID = "typesafe";

/** Decisions this adapter can answer (claim, relevance, tier, risk). */
const JEV_SUPPORTED_DECISIONS: readonly DecisionType[] = [
  "claim-verification",
  "context-relevance",
  "model-tier",
  "risk-escalation",
];

type JevDecisionMapping = {
  toRequest(
    sealed: ExecuteInput["sealed"],
    candidates?: readonly unknown[],
  ): JevSystemOneRequest;
  fromResponse(
    response: JevSystemOneResponse,
    ctx: JevResponseContext,
    candidates?: readonly unknown[],
  ): ExecutorOutcome;
};

const MAPPINGS: Partial<Record<DecisionType, JevDecisionMapping>> = {
  "claim-verification": {
    toRequest: (sealed) => toJevRequest(sealed),
    fromResponse: (response, ctx) => fromJevResponse(response, ctx),
  },
  "context-relevance": {
    toRequest: (sealed) => toJevRelevanceRequest(sealed),
    fromResponse: (response, ctx) => fromJevRelevanceResponse(response, ctx),
  },
  "model-tier": {
    toRequest: (sealed, candidates) => toJevModelTierRequest(sealed, filterTierCandidates(candidates)),
    fromResponse: (response, ctx, candidates) =>
      fromJevModelTierResponse(response, ctx, filterTierCandidates(candidates)),
  },
  "risk-escalation": {
    toRequest: (sealed) => toJevRiskRequest(sealed),
    fromResponse: (response, ctx) => fromJevRiskResponse(response, ctx),
  },
};

/** Statuses the API documents as retryable (429 rate limit, 529 overloaded). */
const RETRYABLE_STATUSES = new Set([429, 529]);
const MAX_TRANSPORT_ATTEMPTS = 3;

function backoffMs(attempt: number): number {
  return 250 * 2 ** (attempt - 1);
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text.length === 0) return `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
      const detail = parsed.error?.message ?? parsed.message;
      return detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}: ${text.slice(0, 200)}`;
    } catch {
      return `HTTP ${response.status}: ${text.slice(0, 200)}`;
    }
  } catch {
    return `HTTP ${response.status}`;
  }
}

export const defaultJevTransport: JevTransport = async (request, { apiKey, timeoutMs, signal }) => {
  const effectiveSignal = signal ?? AbortSignal.timeout(timeoutMs);
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(JEV_SYSTEMONE_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(request),
        signal: effectiveSignal,
      });
    } catch (cause) {
      throw new EngineUnavailableError(JEV_ENGINE_ID, (cause as Error).message);
    }

    if (response.ok) {
      return (await response.json()) as JevSystemOneResponse;
    }

    const detail = await readErrorDetail(response);
    lastError = new EngineUnavailableError(JEV_ENGINE_ID, detail);
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_TRANSPORT_ATTEMPTS) {
      throw lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
  }
  throw lastError ?? new EngineUnavailableError(JEV_ENGINE_ID, "transport exhausted");
};

export type JevAdapterOptions = {
  enabled: boolean;
  apiKey?: string;
  timeoutMs?: number;
  /** Injected transport (tests). Defaults to the fetch-based transport. */
  transport?: JevTransport;
  model?: string;
};

export function createJevExecutor(
  opts: JevAdapterOptions,
): DecisionExecutor & { readonly timeoutMs: number } {
  if (opts.enabled !== true) throw new RemoteEngineNotAllowedError(JEV_ENGINE_ID);
  const apiKey = opts.apiKey;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const transport = opts.transport ?? defaultJevTransport;
  return {
    engineId: JEV_ENGINE_ID,
    timeoutMs,
    async execute(input: ExecuteInput): Promise<ExecutorOutcome> {
      if (!apiKey) throw new EngineUnavailableError(JEV_ENGINE_ID, "api key missing");
      // Re-validate the sealed projection before any remote transport (§6).
      if (!verifySealedProjection(input.sealed)) {
        throw new ProjectionRejectedError("sealed projection failed verification");
      }
      const mapping = MAPPINGS[input.decision];
      if (!mapping) {
        throw new EngineUnavailableError(
          JEV_ENGINE_ID,
          `no mapping for decision ${input.decision}`,
        );
      }
      const request = { ...mapping.toRequest(input.sealed, input.candidates), model: opts.model ?? JEV_DEFAULT_MODEL };
      const started = Date.now();
      let response: JevSystemOneResponse;
      try {
        response = await transport(request, { apiKey, timeoutMs });
      } catch (cause) {
        if (cause instanceof EngineUnavailableError) throw cause;
        throw new EngineUnavailableError(JEV_ENGINE_ID, (cause as Error).message);
      }
      return mapping.fromResponse(response, {
        projectionHash: input.sealed.hash,
        latencyMs: Date.now() - started,
      }, input.candidates);
    },
  };
}

export function jevEngineMeta(executor?: DecisionExecutor): DecisionEngine {
  return {
    id: JEV_ENGINE_ID,
    remote: true,
    capabilities: ["choice", "noul"],
    supportsDecision: (decision) => JEV_SUPPORTED_DECISIONS.includes(decision),
    ...(executor !== undefined ? { executor } : {}),
  };
}

/**
 * Explicit opt-in registration. No-op (false) unless opts.enabled.
 * Never consults process.env — key arrives caller-supplied or not at all.
 */
export function registerJevEngine(
  registry: Pick<EngineRegistry, "register">,
  opts: JevAdapterOptions,
): boolean {
  if (opts.enabled !== true) return false;
  registry.register(jevEngineMeta(createJevExecutor(opts)));
  return true;
}
