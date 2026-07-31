import { CapabilityNotFoundError } from "./errors.js";
import type { Capability, CapabilityContext, Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityHooks } from "./hook-registry.js";

export type HookName = keyof CapabilityHooks;

export interface ExecutionPlanStep {
  executor: string;
  timeout: number;
  hooks: HookName[];
  permissions: Permission[];
}

export interface ExecutionPlan {
  capabilityId: string;
  steps: ExecutionPlanStep[];
  retryPolicy?: { attempts: number; backoffMs: number };
  scheduling?: unknown;             // reserved for future batching/scheduling
}

const DEFAULT_TIMEOUT = 30_000;

export class ExecutionResolver {
  constructor(private readonly registry: CapabilityRegistry) {}

  /**
   * Resolve a capability into execution plans. Returns an array to leave
   * room for composition (a capability resolving to multiple plans) without
   * changing this API. Phase 1 produces single-step plans; the multi-step
   * structure with capabilityId is the forward-compatible shape.
   */
  resolve(capabilityId: string, _ctx: CapabilityContext): ExecutionPlan[] {
    const cap = this.registry.find(capabilityId);
    if (!cap) throw new CapabilityNotFoundError(capabilityId);
    const step: ExecutionPlanStep = {
      executor: cap.execution.strategy,
      timeout: cap.execution.timeout ?? DEFAULT_TIMEOUT,
      hooks: [],                     // hooks live in HookRegistry, not the plan
      permissions: [...cap.requiredPermissions],
    };
    return [{ capabilityId, steps: [step] }];
  }
}
