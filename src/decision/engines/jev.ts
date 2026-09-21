/**
 * engines/jev.ts — Jev remote adapter seam behind disabled config (J0).
 *
 * JEV-7: absent/disabled by default. Registration is explicit; the adapter
 * never reads ambient environment for credentials (store-only: caller
 * supplies apiKey). Provider SDK mapping lands in J1 — execute() fails with
 * EngineUnavailableError until then, which is fallback-eligible.
 */

import type { DecisionEngine } from "../registry.js";
import { RemoteEngineNotAllowedError } from "../registry.js";
import {
  EngineUnavailableError,
  type DecisionExecutor,
  type ExecuteInput,
  type ExecutorOutcome,
} from "../executors.js";

export const JEV_ENGINE_ID = "jev";

export type JevAdapterOptions = {
  enabled: boolean;
  apiKey?: string;
  timeoutMs?: number;
};

export class JevExecutor implements DecisionExecutor {
  readonly engineId = JEV_ENGINE_ID;
  readonly timeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(opts: JevAdapterOptions) {
    if (opts.enabled !== true) throw new RemoteEngineNotAllowedError(JEV_ENGINE_ID);
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async execute(_input: ExecuteInput): Promise<ExecutorOutcome> {
    if (!this.apiKey) throw new EngineUnavailableError(JEV_ENGINE_ID, "api key missing");
    throw new EngineUnavailableError(JEV_ENGINE_ID, "provider SDK mapping lands in J1");
  }
}

export function jevEngineMeta(executor?: DecisionExecutor): DecisionEngine {
  return {
    id: JEV_ENGINE_ID,
    remote: true,
    capabilities: ["choice", "score", "noul"],
    ...(executor !== undefined ? { executor } : {}),
  };
}

export type EngineRegistryLike = {
  register(engine: DecisionEngine): void;
};

/**
 * Explicit opt-in registration. No-op (false) unless opts.enabled.
 * Never consults process.env — key arrives caller-supplied or not at all.
 */
export function registerJevEngine(
  registry: EngineRegistryLike,
  opts: JevAdapterOptions,
): boolean {
  if (opts.enabled !== true) return false;
  registry.register(jevEngineMeta(new JevExecutor(opts)));
  return true;
}
