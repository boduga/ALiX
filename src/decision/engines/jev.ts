/**
 * engines/jev.ts — Jev remote adapter (J1).
 *
 * JEV-7: disabled by default. Registration is explicit; the adapter never
 * reads ambient environment for credentials (store-only: caller supplies
 * apiKey). Provider wire shape is isolated in `jev-protocol.ts` and the
 * per-decision mapping in `decisions/*\/jev-mapping.ts`; execute() rejects
 * unsupported decisions rather than mis-answering them.
 *
 * The remote boundary is re-validated here (architecture §6): a caller that
 * bypasses `projectForRemote` cannot cross to Jev with an unsealed or forged
 * projection. Transport failure/malformed response are fallback-eligible.
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

/** Decisions this adapter can answer today (J1 claim, J2 relevance, J3 tier, J6 risk). */
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

export class JevWireFormatUnacknowledgedError extends Error {
  readonly code = "JEV_WIRE_FORMAT_UNACKNOWLEDGED";
  constructor() {
    super(
      "Jev wire format is documented but not verified against the official SDK; " +
        "pass acknowledgeUnverifiedWireFormat: true to enable remote",
    );
    this.name = "JevWireFormatUnacknowledgedError";
  }
}

export const defaultJevTransport: JevTransport = async (request, { apiKey, timeoutMs, signal }) => {
  const response = await fetch(JEV_SYSTEMONE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(request),
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new EngineUnavailableError(JEV_ENGINE_ID, `HTTP ${response.status}`);
  }
  return (await response.json()) as JevSystemOneResponse;
};

export type JevAdapterOptions = {
  enabled: boolean;
  apiKey?: string;
  timeoutMs?: number;
  /** Injected transport (tests). Defaults to the fetch-based transport. */
  transport?: JevTransport;
  model?: string;
  /**
   * The wire shape in `jev-protocol.ts` is documented, not SDK-verified.
   * Enabling remote requires this explicit acknowledgement so an unverified
   * boundary can never be switched on silently.
   */
  acknowledgeUnverifiedWireFormat?: boolean;
};

export function createJevExecutor(
  opts: JevAdapterOptions,
): DecisionExecutor & { readonly timeoutMs: number } {
  if (opts.enabled !== true) throw new RemoteEngineNotAllowedError(JEV_ENGINE_ID);
  if (opts.acknowledgeUnverifiedWireFormat !== true) {
    throw new JevWireFormatUnacknowledgedError();
  }
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
