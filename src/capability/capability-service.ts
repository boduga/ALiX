// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-7 — CapabilityService stub (CAP-8 boundary).
 *
 * Locks the delegation invariant required by locked ruling #4: the service
 * delegates lifecycle/provider eligibility decisions to `CapabilityResolver`
 * and does NOT independently reproduce the eligibility table. CAP-7 ships
 * only the `resolve` surface needed to prove AC#5/AC#6; the full service
 * (list, inspect, history, measure, governance integration) is CAP-8.
 *
 * Locked ruling #4 (verbatim): "CapabilityService must delegate lifecycle/
 * provider eligibility decisions to CapabilityResolver and must not
 * independently reproduce the eligibility table."
 *
 * @module capability/capability-service
 */

import type { ProviderPlan, ResolverContext } from "./provider-resolver.js";
import type { CapabilityResolver } from "./provider-resolver.js";
import type { CapabilityRegistry } from "./registry.js";

export interface CapabilityServiceOptions {
  /** Canonical resolver — owns the lifecycle-eligibility table (locked ruling #2). */
  resolver: CapabilityResolver;
  /** Read-only reference for surface-level queries CAP-8 will add. CAP-7 does NOT write through this. */
  registry: CapabilityRegistry;
}

/** CAP-7 stub — CAP-8 broadens this surface (list, inspect, history, measure, governance). */
export class CapabilityService {
  constructor(private readonly options: CapabilityServiceOptions) {}

  /** CAP-7 — delegates to the resolver verbatim. No service-level lifecycle
   *  or provider filtering; no parallel eligibility table. */
  resolve(capabilityId: string, ctx: ResolverContext = {}): ProviderPlan[] {
    return this.options.resolver.resolve(capabilityId, ctx);
  }
}
