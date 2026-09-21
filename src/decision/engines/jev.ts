/**
 * engines/jev.ts — Jev remote adapter (J1).
 *
 * JEV-7: disabled by default. Registration is explicit; the adapter never
 * reads ambient environment for credentials (store-only: caller supplies
 * apiKey). Provider wire shape is isolated in `jev-protocol.ts` and the
 * per-decision mapping in `decisions/*\/jev-mapping.ts`; execute() rejects
 * unsupported decisions rather than mis-answering them.
 *
 * Failure classification (fallback-eligible): missing key, transport error,
 * timeout, and malformed/unknown response. Provider schema violations are
 * impossible by construction per the vendor, but we fail closed anyway.
 */

import type { DecisionType } from "../contracts.js";
import type { DecisionEngine, EngineRegistry } from "../registry.js";
import { RemoteEngineNotAllowedError } from "../registry.js";
import {
  EngineUnavailableError,
  type DecisionExecutor,
  type ExecuteInput,
  type ExecutorOutcome,
} from "../executors.js";
import {
  JEV_DEFAULT_MODEL,
  JEV_SYSTEMONE_ENDPOINT,
  type JevSystemOneRequest,
  type JevSystemOneResponse,
  type JevTransport,
} from "./jev-protocol.js";
import {
  fromJevResponse,
  toJevRequest,
} from "../decisions/claim-verification/jev-mapping.js";

export const JEV_ENGINE_ID = "jev";

/** Decisions this adapter can answer today (J1: claim verification only). */
const JEV_SUPPORTED_DECISIONS: readonly DecisionType[] = ["claim-verification"];

type JevDecisionMapping = {
  toRequest(sealed: ExecuteInput["sealed"]): JevSystemOneRequest;
  fromResponse(
    response: JevSystemOneResponse,
    ctx: { projectionHash: string; latencyMs: number },
  ): ExecutorOutcome;
};

const MAPPINGS: Partial<Record<DecisionType, JevDecisionMapping>> = {
  "claim-verification": {
    toRequest: (sealed) => toJevRequest(sealed),
    fromResponse: (response, ctx) => fromJevResponse(response, ctx),
  },
};

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
      const mapping = MAPPINGS[input.decision];
      if (!mapping) {
        throw new EngineUnavailableError(
          JEV_ENGINE_ID,
          `no mapping for decision ${input.decision}`,
        );
      }
      const request = { ...mapping.toRequest(input.sealed), model: opts.model ?? JEV_DEFAULT_MODEL };
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
      });
    },
  };
}

export function jevEngineMeta(executor?: DecisionExecutor): DecisionEngine {
  return {
    id: JEV_ENGINE_ID,
    remote: true,
    capabilities: ["choice"],
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
