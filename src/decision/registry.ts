/**
 * registry.ts — DecisionEngine capability metadata + engine registry.
 *
 * J0a (hand-off §7): narrow typed seam. Transport/provider details stay below
 * the domain API. Remote engines resolve only when explicitly allowed
 * (opt-in); local default works with Jev absent (JEV-7).
 */

import type { DecisionType } from "./contracts.js";
import type { DecisionExecutor } from "./executors.js";
import { LocalBaselineExecutor } from "./engines/local.js";

export type DecisionEngineCapability = "choice" | "score" | "noul";

/** Narrow engine contract. Engines score/select ALiX candidates, never invent actions. */
export type DecisionEngine = {
  id: string;
  version?: string;
  /** True when the engine crosses a remote trust boundary (Jev). */
  remote: boolean;
  capabilities: DecisionEngineCapability[];
  /** Optional per-decision opt-out. Absent = supports all. */
  supportsDecision?: (decision: DecisionType) => boolean;
  /** Bound work unit. Absent = metadata only (registry resolves, execution skips). */
  executor?: DecisionExecutor;
};

export class EngineNotRegisteredError extends Error {
  readonly code = "ENGINE_NOT_REGISTERED";
  constructor(engineId: string) {
    super(`Decision engine not registered: ${engineId}`);
    this.name = "EngineNotRegisteredError";
  }
}

export class RemoteEngineNotAllowedError extends Error {
  readonly code = "REMOTE_ENGINE_NOT_ALLOWED";
  constructor(engineId: string) {
    super(`Remote decision engine not allowed (opt-in disabled): ${engineId}`);
    this.name = "RemoteEngineNotAllowedError";
  }
}

export type ResolveOptions = {
  engineId: string;
  /** Must be true for remote engines. Fail-closed default false. */
  allowRemote?: boolean;
  decision?: DecisionType;
};

const LOCAL_ENGINE: DecisionEngine = {
  id: "local",
  remote: false,
  capabilities: ["choice", "score", "noul"],
};

export class EngineRegistry {
  private readonly engines = new Map<string, DecisionEngine>();

  register(engine: DecisionEngine): void {
    if (!engine || typeof engine.id !== "string" || engine.id.length === 0) {
      throw new Error("Decision engine id must be a non-empty string");
    }
    if (this.engines.has(engine.id)) {
      throw new Error(`Decision engine already registered: ${engine.id}`);
    }
    this.engines.set(engine.id, engine);
  }

  has(engineId: string): boolean {
    return this.engines.has(engineId);
  }

  get(engineId: string): DecisionEngine | undefined {
    return this.engines.get(engineId);
  }

  list(): DecisionEngine[] {
    return [...this.engines.values()];
  }

  /**
   * Resolve an engine by id. Throws when missing, when a remote engine is
   * requested without explicit opt-in, or when the engine opts out of the
   * decision. Callers fall back per decision policy.
   */
  resolve(opts: ResolveOptions): DecisionEngine {
    const engine = this.engines.get(opts.engineId);
    if (!engine) throw new EngineNotRegisteredError(opts.engineId);
    if (engine.remote && opts.allowRemote !== true) {
      throw new RemoteEngineNotAllowedError(opts.engineId);
    }
    if (opts.decision !== undefined && engine.supportsDecision !== undefined) {
      if (!engine.supportsDecision(opts.decision)) {
        throw new EngineNotRegisteredError(`${opts.engineId} for ${opts.decision}`);
      }
    }
    return engine;
  }
}

/** Default registry: local baseline only. Jev registered only when opted in. */
export function createDefaultRegistry(): EngineRegistry {
  const registry = new EngineRegistry();
  registry.register({ ...LOCAL_ENGINE, executor: new LocalBaselineExecutor() });
  return registry;
}
