// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-8 — CapabilityService (design §72).
 *
 * The single, mandatory capability surface boundary per locked rulings #2
 * and #stub. Replaces the CAP-7 stub in place (same module identity;
 * "no compatibility facade"). Composition-root only constructs registry +
 * resolver + executor + eventLog + service; every non-composition-root caller
 * reaches capability semantics through this surface.
 *
 * Locked ruling #stub (verbatim): "CAP-8 extends the existing CAP-7
 * src/capability/capability-service.ts stub in place. Same module identity,
 * new authoritative contract. No rename, no compatibility facade, no parallel
 * service. If CAP-7 stub constructor/method shape conflicts with CAP-8
 * contract, replace in place."
 *
 * Locked ruling #6 (verbatim): "Constructor-injected service; composition-
 * root wired; no singleton. `new CapabilityService(catalog, resolver,
 * mutationExecutor, eventLog)` — exact dep list derived from ownership graph,
 * NOT blindly five params. `CapabilityResolver` already owns the
 * `CapabilityRegistry` dependency; service should not double-inject."
 *
 * @module capability/capability-service
 */

import type { CapabilityCatalog } from "./canonical/catalog.js";
import type { CapabilityDefinition } from "./canonical/definition.js";
import type { CapabilityResolver } from "./provider-resolver.js";
import type { CapabilityMutationExecutor } from "../evolution/execution/capability-mutation-executor.js";
import type { EventLog } from "../events/event-log.js";
import type { LifecycleState } from "../adaptation/capability-evolution-types.js";
import { CapabilityNotFoundError } from "./errors.js";
import type {
  CapabilityListResult, CapabilityListItem,
  CapabilityInspectResult,
  CapabilitySearchQuery, CapabilitySearchResult,
  CapabilityHealthResult,
  CapabilityRecommendInput, CapabilityRecommendResult,
  CapabilityServiceOptions,
} from "./types/service-results.js";

export type {
  CapabilityListResult, CapabilityListItem,
  CapabilityInspectResult,
  CapabilitySearchQuery, CapabilitySearchResult,
  CapabilityHealthResult,
  CapabilityRecommendInput, CapabilityRecommendResult,
  CapabilityServiceOptions,
} from "./types/service-results.js";

export class CapabilityService {
  private readonly catalog: CapabilityCatalog;
  private readonly resolver: CapabilityResolver;
  private readonly executor: CapabilityMutationExecutor;
  private readonly eventLog: EventLog;

  constructor(opts: CapabilityServiceOptions) {
    this.catalog = opts.catalog;
    this.resolver = opts.resolver;
    this.executor = opts.mutationExecutor;
    this.eventLog = opts.eventLog;
    Object.freeze(this); // service surface is immutable post-construction.
  }

  // -------------------------------------------------------------------------
  // Read methods (locked ruling #3 — recommend is read-only; AC#2 — list/inspect/search/health).
  // -------------------------------------------------------------------------

  /** Service-authoritative list (AC#5: `service.list == registry.list`). */
  list(): CapabilityListResult {
    const caps = this.catalog.list();
    const items: readonly CapabilityListItem[] = Object.freeze(
      caps.map((c: CapabilityDefinition) => {
        const lifecycle = this.lifecycleOf(c.id);
        const available = this.resolverAvailable(c.id, { allowDeprecated: false });
        return {
          id: c.id,
          version: c.version,
          kind: c.kind,
          title: c.title,
          lifecycle,
          available,
          bindings: c.bindings.map((b) => ({ id: b.id, type: b.type })),
        };
      }),
    );
    return { items, total: items.length };
  }

  /** Single-capability full snapshot (AC#2). */
  inspect(id: string): CapabilityInspectResult {
    const c = this.catalog.get(id);
    if (!c) throw new CapabilityNotFoundError(id);
    const availability = this.availabilityOf(id);
    const lifecycle = this.lifecycleOf(id);
    return {
      id: c.id,
      version: c.version,
      kind: c.kind,
      title: c.title,
      description: c.description,
      lifecycle,
      availability,
      bindings: c.bindings,
      requiredPermissions: c.requiredPermissions,
      tags: c.tags,
      category: c.category,
      risk: c.risk,
      dependencies: c.dependencies,
      allowFallbacks: c.allowFallbacks,
    };
  }

  /** Filtered enumeration (AC#2). `total` is the full-match count even when `limit` caps `items`. */
  search(q: CapabilitySearchQuery): CapabilitySearchResult {
    const lcText = (q.text ?? '').toLowerCase();
    const all = this.list().items;
    const matched = all.filter((it) => {
      if (q.kind && it.kind !== q.kind) return false;
      if (q.lifecycle && it.lifecycle !== q.lifecycle) return false;
      if (q.availableOnly && !it.available) return false;
      if (lcText && !it.id.toLowerCase().includes(lcText)) return false;
      return true;
    });
    const items = Object.freeze(q.limit ? matched.slice(0, q.limit) : matched);
    return { query: q, items, total: matched.length };
  }

  /** Read-only recommendations (locked ruling #3 — never triggers A7 / mutation). */
  recommend(input: CapabilityRecommendInput): CapabilityRecommendResult {
    const suggestions = Object.freeze(this.search({ text: input.text, limit: input.limit ?? 10 }).items);
    return { input, suggestions, total: suggestions.length };
  }

  /**
   * Narrow health snapshot (locked ruling #9: resolution stays on
   * CapabilityResolver; this method just narrows and labels).
   * Returns `CapabilityHealthResult`, never `ProviderCandidate[]`.
   */
  health(id: string, ctx: { allowDeprecated?: boolean } = {}): CapabilityHealthResult {
    let plan: ReturnType<CapabilityResolver['resolve']>;
    try {
      plan = this.resolver.resolve(id, ctx);
    } catch (e) {
      if (e instanceof CapabilityNotFoundError) throw e;
      throw e;
    }
    const step = plan.flatMap((p) => p.steps).find((s) => s.capabilityId === id);
    const lifecycle = step?.lifecycleEligibility.state;
    const eligible = step?.lifecycleEligibility.eligible ?? false;
    const overrideUsed = step?.lifecycleEligibility.overrideUsed ?? false;
    const candidatesCount = step?.candidates.length ?? 0;
    const bindingsCount = step?.bindingsCount ?? 0;

    let available = false;
    let reason: CapabilityHealthResult['reason'];
    if (!eligible) {
      reason = 'lifecycle_ineligible';
    } else if (bindingsCount === 0) {
      reason = 'missing_binding';
    } else if (candidatesCount === 0) {
      reason = 'provider_unavailable';
    } else {
      available = true;
    }

    // `overrideUsed` is not part of CapabilityHealthResult (the resolver exposed that
    // information internally; the surface reflects only available + reason + lifecycle).
    void overrideUsed;

    // Read version from the catalog so the snapshot reflects the current publication.
    const def = this.catalog.get(id);
    return {
      id,
      version: def?.version ?? 'unknown',
      available,
      reason,
      lifecycle,
      providersChecked: candidatesCount,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers — resolve lifecycle and availability through the canonical owners.
  // The service never mutates registry state.
  // -------------------------------------------------------------------------

  private lifecycleOf(id: string): LifecycleState | undefined {
    // CapabilityResolver owns lifecycle eligibility and exposes a narrow read-only
    // accessor (locked ruling #11). Service READS only — never reaches through
    // the resolver into the underlying Registry.
    return this.resolver.getLifecycleState(id);
  }

  private resolverAvailable(id: string, _ctx: { allowDeprecated: boolean }): boolean {
    try {
      const plan = this.resolver.resolve(id, _ctx);
      return plan.some((p) => p.steps.some((s) => s.lifecycleEligibility.eligible && s.candidates.length > 0));
    } catch {
      return false;
    }
  }

  private availabilityOf(id: string): { available: boolean; reason?: "missing_binding" | "provider_unavailable" } {
    try {
      const plan = this.resolver.resolve(id, { allowDeprecated: false });
      const step = plan.flatMap((p) => p.steps).find((s) => s.capabilityId === id);
      if (!step) return { available: false, reason: "missing_binding" };
      if (step.bindingsCount === 0) return { available: false, reason: "missing_binding" };
      if (step.candidates.length === 0) return { available: false, reason: "provider_unavailable" };
      return { available: true };
    } catch {
      return { available: false, reason: "missing_binding" };
    }
  }
}
