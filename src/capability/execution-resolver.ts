import { CapabilityNotFoundError } from "./errors.js";
import type { Capability, CapabilityContext, Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityHooks } from "./hook-registry.js";

export type HookName = keyof CapabilityHooks;

export interface ExecutionPlanStep {
  /** The capability this step invokes (a dependency, or the plan's own
   *  capability for the final step). Phase 3 composition (#308). */
  capabilityId: string;
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
    const steps = this.buildSteps(cap, [], new Set());
    return [{ capabilityId, steps }];
  }

  /**
   * Build the ordered execution steps for a capability: its dependencies
   * first (depth-first, each dependency before the capability that needs it),
   * then the capability's own step.
   *
   * @param cap - The capability to build steps for.
   * @param chain - Ancestors in the current dependency path (cycle detection).
   * @param visited - Fully-expanded capabilities (avoids re-expanding a shared
   *   dependency; does not itself detect cycles — that's `chain`'s job).
   * @throws {Error} on a cyclic dependency graph.
   */
  private buildSteps(
    cap: Capability,
    chain: string[],
    visited: Set<string>,
  ): ExecutionPlanStep[] {
    if (chain.includes(cap.id)) {
      throw new Error(`Circular capability dependency: ${[...chain, cap.id].join(' → ')}`);
    }

    const steps: ExecutionPlanStep[] = [];
    const nextChain = [...chain, cap.id];

    for (const depId of cap.dependencies ?? []) {
      // A shared dependency appears once (its first position wins).
      if (visited.has(depId)) continue;
      const dep = this.registry.find(depId);
      if (!dep) throw new CapabilityNotFoundError(depId);
      steps.push(...this.buildSteps(dep, nextChain, visited));
      visited.add(depId);
    }

    // The capability's own step.
    steps.push(this.stepFor(cap));
    return steps;
  }

  private stepFor(cap: Capability): ExecutionPlanStep {
    return {
      capabilityId: cap.id,
      executor: cap.execution.strategy,
      timeout: cap.execution.timeout ?? DEFAULT_TIMEOUT,
      hooks: [],                     // hooks live in HookRegistry, not the plan
      permissions: [...cap.requiredPermissions],
    };
  }
}
