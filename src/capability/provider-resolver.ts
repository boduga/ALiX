// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { CapabilityNotFoundError } from "./errors.js";
import type { CapabilityContext, Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityHooks } from "./hook-registry.js";
import type { ProviderExecutorRegistry, ProviderCandidate } from "./provider-registry.js";
import type { CapabilityProviderBinding } from "./canonical/provider.js";
import type { CapabilityDefinition } from "./canonical/definition.js";

export type HookName = keyof CapabilityHooks;

export interface ProviderPlanStep {
  /** The capability this step invokes (a dependency, or the plan's own
   *  capability for the final step). Identity is provider-independent (#476). */
  capabilityId: string;
  /** Ordered, eligibility-filtered provider candidates — the bounded
   *  single-pass fallback list. Empty = missing_binding or provider_unavailable. */
  candidates: ProviderCandidate[];
  /** Original binding count (pre-filter): distinguishes missing_binding (0)
   *  from provider_unavailable (>0 but none eligible). */
  bindingsCount: number;
  timeout: number;
  hooks: HookName[];
  permissions: Permission[];
}

export interface ProviderPlan {
  capabilityId: string;
  steps: ProviderPlanStep[];
  retryPolicy?: { attempts: number; backoffMs: number };
  scheduling?: unknown;             // reserved for future batching/scheduling
}

const DEFAULT_TIMEOUT = 30_000;

/** CAP-4 provider resolver — replaces strategy-keyed ExecutionResolver dispatch.
 *  Deterministic candidate selection (bindings order + eligibility + pin);
 *  the runtime owns the attempt/failover walk. Identity never changes here. */
export class ProviderResolver {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly providers: ProviderExecutorRegistry,
    private readonly opts: { isProviderHealthy?: (binding: CapabilityProviderBinding) => boolean } = {},
  ) {}

  resolve(capabilityId: string, _ctx: CapabilityContext): ProviderPlan[] {
    const rc = this.registry.get(capabilityId);
    if (!rc) throw new CapabilityNotFoundError(capabilityId);
    const steps = this.buildSteps(rc.definition, [], new Set());
    return [{ capabilityId, steps }];
  }

  private buildSteps(def: CapabilityDefinition, chain: string[], visited: Set<string>): ProviderPlanStep[] {
    if (chain.includes(def.id)) {
      throw new Error(`Circular capability dependency: ${[...chain, def.id].join(' → ')}`);
    }
    const steps: ProviderPlanStep[] = [];
    const nextChain = [...chain, def.id];
    for (const depId of def.dependencies ?? []) {
      if (visited.has(depId)) continue;
      const dep = this.registry.get(depId);
      if (!dep) throw new CapabilityNotFoundError(depId);
      steps.push(...this.buildSteps(dep.definition, nextChain, visited));
      visited.add(depId);
    }
    steps.push(this.stepFor(def));
    return steps;
  }

  private isEligible(binding: CapabilityProviderBinding): boolean {
    if (!this.providers.has(binding.type)) return false;
    return this.opts.isProviderHealthy ? this.opts.isProviderHealthy(binding) : true;
  }

  private stepFor(def: CapabilityDefinition): ProviderPlanStep {
    // Pinning (user refinement): allowFallbacks=false resolves over a bounded
    // list of ONE — only bindings[0] participates; if it is ineligible, the
    // result is [] (STOP). The pin applies BEFORE candidate traversal.
    const bounded = def.allowFallbacks === false ? def.bindings.slice(0, 1) : def.bindings;
    // Preserve the ORIGINAL bindings[] position in bindingIndex (the eligible
    // subset is filtered, so its own indices would be wrong).
    const candidates: ProviderCandidate[] = bounded
      .map((binding, bindingIndex) => ({ binding, bindingIndex }))
      .filter(({ binding }) => this.isEligible(binding))
      .map(({ binding, bindingIndex }) => ({
        binding,
        providerId: binding.id,
        providerType: binding.type,
        bindingIndex,
        executor: this.providers.get(binding.type)!,
      }));
    const first = candidates[0];
    const timeout = typeof first?.binding.config?.timeoutMs === "number" ? first.binding.config.timeoutMs : DEFAULT_TIMEOUT;
    return {
      capabilityId: def.id,
      candidates,
      bindingsCount: def.bindings.length,
      timeout,
      hooks: [],
      permissions: [...def.requiredPermissions],
    };
  }
}
