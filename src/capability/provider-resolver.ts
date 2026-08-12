// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { CapabilityNotFoundError } from "./errors.js";
import type { Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityHooks } from "./hook-registry.js";
import type { ProviderExecutorRegistry, ProviderCandidate } from "./provider-registry.js";
import type { CapabilityProviderBinding } from "./canonical/provider.js";
import type { CapabilityDefinition } from "./canonical/definition.js";
import { isLifecycleEligible, type LifecycleEligibility } from "./lifecycle-eligibility.js";
import type { LifecycleState } from "../adaptation/capability-evolution-types.js";

export type HookName = keyof CapabilityHooks;

/** CAP-7 — Resolver context. Deliberately narrower than `CapabilityContext`:
 *  the resolver only needs the lifecycle-axis override. Actor / permissions /
 *  cancellation / workspace belong to the runtime invocation seam, not the
 *  capability-selection seam. */
export interface ResolverContext {
  /** Opt-in to including `deprecated` capabilities in the result. Default false.
   *  Does NOT bypass provider / availability eligibility (locked ruling #1). */
  allowDeprecated?: boolean;
}

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
  /** CAP-7 — Per-step lifecycle eligibility annotation (locked ruling #6).
   *  Always present; the resolver reads `registry.getLifecycleState` and
   *  applies the lifecycle gate FIRST, then the provider gate. */
  lifecycleEligibility: LifecycleEligibility;
}

export interface ProviderPlan {
  capabilityId: string;
  steps: ProviderPlanStep[];
  retryPolicy?: { attempts: number; backoffMs: number };
  scheduling?: unknown;             // reserved for future batching/scheduling
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_LIFECYCLE: LifecycleState = "emerging";

/** CAP-4 provider resolver — replaces strategy-keyed ExecutionResolver dispatch.
 *  Deterministic candidate selection (bindings order + eligibility + pin);
 *  the runtime owns the attempt / failover walk. Identity never changes here.
 *
 *  CAP-7 — the resolver now also enforces the lifecycle-eligibility gate
 *  (locked rulings #1, #5, #7) and annotates every step with a
 *  `lifecycleEligibility` annotation (locked ruling #6). The lifecycle gate
 *  runs FIRST; the provider gate runs SECOND. */
export class ProviderResolver {
  constructor(
    protected readonly registry: CapabilityRegistry,
    protected readonly providers: ProviderExecutorRegistry,
    private readonly opts: { isProviderHealthy?: (binding: CapabilityProviderBinding) => boolean } = {},
  ) {}

  /** CAP-7 — second arg is now `ResolverContext` (was `CapabilityContext`, ignored).
   *  Existing callers passing `CapabilityContext` must pass a `ResolverContext`
   *  instead; the runtime invocation seam (which carries `CapabilityContext`)
   *  is downstream of selection. */
  resolve(capabilityId: string, _ctx: ResolverContext = {}): ProviderPlan[] {
    const rc = this.registry.get(capabilityId);
    if (!rc) throw new CapabilityNotFoundError(capabilityId);
    const steps = this.buildSteps(rc.definition, [], new Set());
    return [{ capabilityId, steps }];
  }

  private buildSteps(def: CapabilityDefinition, chain: string[], visited: Set<string>): ProviderPlanStep[] {
    if (chain.includes(def.id)) {
      throw new Error(`Circular capability dependency: ${[...chain, def.id].join(" → ")}`);
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

  protected isEligible(binding: CapabilityProviderBinding): boolean {
    if (!this.providers.has(binding.type)) return false;
    return this.opts.isProviderHealthy ? this.opts.isProviderHealthy(binding) : true;
  }

  private stepFor(def: CapabilityDefinition): ProviderPlanStep {
    // CAP-7 lifecycle gate (FIRST). Reads the current lifecycle state from the
    // registry (the in-process projection CAP-3 owns; CAP-6's `registry.reload()`
    // after A4 mutation keeps it current). Locked ruling #7: lifecycle table is
    // a strict boolean; this module does not encode availability. Two-stage
    // gate: lifecycle filter first, then CAP-4 provider filter. The annotation
    // is ALWAYS present — locked ruling #6: step carries the lifecycle decision
    // explicitly so downstream consumers / observers do not need to re-derive.
    const lifecycleState = this.registry.getLifecycleState(def.id) ?? DEFAULT_LIFECYCLE;
    const lifecycleEligible = isLifecycleEligible(lifecycleState);
    const lifecycleEligibility: LifecycleEligibility = {
      state: lifecycleState,
      eligible: lifecycleEligible,
      overrideUsed: false,   // base ProviderResolver has no override surface
    };

    // Lifecycle-axis short-circuit: when state is `deprecated` (and no override
    // exists in the base class), the step is still produced (so callers see the
    // capability, its annotation, and the empty-candidate fact) but carries NO
    // candidates. bindingsCount still reports the pre-filter count for symmetry
    // with the provider-axis empty case.
    if (!lifecycleEligible) {
      const first = def.bindings[0];
      const timeout = typeof first?.config?.timeoutMs === "number" ? first.config.timeoutMs : DEFAULT_TIMEOUT;
      return {
        capabilityId: def.id,
        candidates: [],
        bindingsCount: def.bindings.length,
        timeout,
        hooks: [],
        permissions: [...def.requiredPermissions],
        lifecycleEligibility,
      };
    }

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
      lifecycleEligibility,   // CAP-7 — always present
    };
  }
}

/** CAP-7 — Canonical resolver alias. Owns the lifecycle-eligibility table
 *  (locked ruling #2: `CapabilityResolver` is the policy-axis owner; the
 *  base `ProviderResolver` is the CAP-4 implementation superclass kept for
 *  backward compatibility with existing tests). The subclass exposes
 *  `allowDeprecated` via the `ResolverContext` without widening the CAP-4
 *  `ProviderResolver` signature. */
export class CapabilityResolver extends ProviderResolver {
  override resolve(capabilityId: string, ctx: ResolverContext = {}): ProviderPlan[] {
    // Forward to a private plan-build that honours the override. The override
    // is meaningful ONLY for `deprecated`; any other state produces an
    // identical result to the base resolver (overrideUsed: false).
    return this.buildPlanWithOverride(capabilityId, ctx);
  }

  private buildPlanWithOverride(capabilityId: string, ctx: ResolverContext): ProviderPlan[] {
    const rc = this.registry.get(capabilityId);
    if (!rc) throw new CapabilityNotFoundError(capabilityId);
    const allowDeprecated = ctx.allowDeprecated ?? false;
    const steps = this.buildStepsWithOverride(rc.definition, [], new Set(), allowDeprecated);
    return [{ capabilityId, steps }];
  }

  private buildStepsWithOverride(
    def: CapabilityDefinition,
    chain: string[],
    visited: Set<string>,
    allowDeprecated: boolean,
  ): ProviderPlanStep[] {
    if (chain.includes(def.id)) {
      throw new Error(`Circular capability dependency: ${[...chain, def.id].join(" → ")}`);
    }
    const steps: ProviderPlanStep[] = [];
    const nextChain = [...chain, def.id];
    for (const depId of def.dependencies ?? []) {
      if (visited.has(depId)) continue;
      const dep = this.registry.get(depId);
      if (!dep) throw new CapabilityNotFoundError(depId);
      steps.push(...this.buildStepsWithOverride(dep.definition, nextChain, visited, allowDeprecated));
      visited.add(depId);
    }
    steps.push(this.stepForWithOverride(def, allowDeprecated));
    return steps;
  }

  private stepForWithOverride(def: CapabilityDefinition, allowDeprecated: boolean): ProviderPlanStep {
    // CAP-7 lifecycle gate (FIRST), now with override awareness. overrideUsed is
    // true iff allowDeprecated=true AND state==='deprecated'. The override
    // bypasses ONLY the lifecycle-eligibility gate — provider / availability
    // filters still apply (locked ruling #1).
    const lifecycleState = this.registry.getLifecycleState(def.id) ?? DEFAULT_LIFECYCLE;
    const baseEligible = isLifecycleEligible(lifecycleState);
    const overrideUsed = allowDeprecated && lifecycleState === "deprecated";
    const eligible = baseEligible || overrideUsed;
    const lifecycleEligibility: LifecycleEligibility = {
      state: lifecycleState,
      eligible,
      overrideUsed,
    };

    // Lifecycle-axis short-circuit: deprecated WITHOUT override → step present,
    // candidates empty, bindingsCount preserved. lifecycleEligibility carries
    // eligible=false / overrideUsed=false explicitly.
    if (!eligible) {
      const first = def.bindings[0];
      const timeout = typeof first?.config?.timeoutMs === "number" ? first.config.timeoutMs : DEFAULT_TIMEOUT;
      return {
        capabilityId: def.id,
        candidates: [],
        bindingsCount: def.bindings.length,
        timeout,
        hooks: [],
        permissions: [...def.requiredPermissions],
        lifecycleEligibility,
      };
    }

    // Provider gate (SECOND) — same logic as base class. Override has no effect
    // on provider / availability eligibility (locked ruling #1).
    const bounded = def.allowFallbacks === false ? def.bindings.slice(0, 1) : def.bindings;
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
      lifecycleEligibility,
    };
  }
}