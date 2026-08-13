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
import type { ExecutionStep } from "../evolution/execution/contracts/execution-contract.js";
import type { EventLog } from "../events/event-log.js";
import type { AlixEvent } from "../events/types.js";
import type { LifecycleState } from "../adaptation/capability-evolution-types.js";
import { CapabilityNotFoundError } from "./errors.js";
import { CapabilityServiceNotImplementedError } from "./errors/service-not-implemented.js";
import type {
  CapabilityListResult, CapabilityListItem,
  CapabilityInspectResult,
  CapabilitySearchQuery, CapabilitySearchResult,
  CapabilityHealthResult,
  CapabilityRecommendInput, CapabilityRecommendResult,
  CapabilityApplyInput, CapabilityApplyResult,
  CapabilityHistoryEvent, CapabilityHistoryResult,
  CapabilityServiceOptions,
} from "./types/service-results.js";

export type {
  CapabilityListResult, CapabilityListItem,
  CapabilityInspectResult,
  CapabilitySearchQuery, CapabilitySearchResult,
  CapabilityHealthResult,
  CapabilityRecommendInput, CapabilityRecommendResult,
  CapabilityApplyInput, CapabilityApplyResult,
  CapabilityHistoryEvent, CapabilityHistoryResult,
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
   * EventLog projection for a single capability (locked ruling #5).
   * Pure EventLog facts — no catalog reconstruction, no registry snapshot walk.
   * Filtering rule: an event belongs to capability `id` iff its payload
   * contains `capabilityId === id`, or `sources.includes(id)`, or `target === id`.
   * Output is ascending by `seq`; `opts.limit` caps the returned `events`
   * array but does NOT change `total` (which is the full-match count).
   */
  async history(
    id: string,
    opts: { limit?: number; beforeSeq?: number } = {},
  ): Promise<CapabilityHistoryResult> {
    const all: readonly AlixEvent[] = await this.eventLog.readAll();
    const CAPABILITY_EVENT_PREFIX = 'capability.';
    const matched = all.filter((evt) => {
      if (!evt.type.startsWith(CAPABILITY_EVENT_PREFIX)) return false;
      const p = evt.payload as Record<string, unknown> | undefined;
      if (!p) return false;
      if (p.capabilityId === id) return true;
      if (Array.isArray(p.sources) && (p.sources as unknown[]).includes(id)) return true;
      if (p.target === id) return true;
      return false;
    });
    let filtered = matched;
    if (typeof opts.beforeSeq === 'number') {
      filtered = filtered.filter((e) => e.seq < (opts.beforeSeq as number));
    }
    const ordered = [...filtered].sort((a, b) => a.seq - b.seq);
    const capped = opts.limit ? ordered.slice(-opts.limit) : ordered;
    const events: readonly CapabilityHistoryEvent[] = capped.map((e) => ({
      seq: e.seq,
      type: e.type,
      payload: e.payload as Readonly<Record<string, unknown>>,
      at: e.timestamp,
    }));
    return { id, events, total: matched.length };
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
  // apply() — single mutation seam. Locked ruling #1: thin delegation to
  // CAP-6's CapabilityMutationExecutor.executeStep. The service introduces
  // NO second mutation execution path; CAP-6 owns validation, atomicity,
  // rollback, registry projection, and governance-result dispatch. We
  // construct a structurally-typed ExecutionStep with the service-step's
  // idempotent/preconditions/postconditions defaulted (CAP-6 requires them)
  // and project the executor's output into CapabilityApplyResult.
  // -------------------------------------------------------------------------

  async apply(input: CapabilityApplyInput, ctx?: Record<string, unknown>): Promise<CapabilityApplyResult> {
    const step: ExecutionStep = {
      stepId: input.step.stepId,
      operation: input.step.operation,
      parameters: input.step.parameters,
      idempotent: input.step.idempotent ?? false,
      preconditions: input.step.preconditions ?? {},
      postconditions: input.step.postconditions ?? {},
    };
    const result = await this.executor.executeStep(step, ctx ?? {});
    return {
      success: result.success,
      operation: input.step.operation,
      affected: this.affectedFromResult(input.step, result),
      // CAP-6 success output shape: { operation, mutation, result } where
      // `result` is the frozen CapabilityMutationResult carrying artifactId.
      // Failure paths return `output = {}`, so we guard with a single cast.
      artifactId: CapabilityService.readArtifactId(result.output),
      error: result.error,
    };
  }

  private affectedFromResult(
    step: CapabilityApplyInput["step"],
    result: { success: boolean; output: Record<string, unknown> },
  ): readonly string[] {
    const fromOutput = Array.isArray(result.output?.affected)
      ? (result.output.affected as readonly unknown[]).filter((x): x is string => typeof x === "string")
      : undefined;
    if (fromOutput && fromOutput.length > 0) return fromOutput;
    const params = step.parameters as Record<string, unknown>;
    const out: string[] = [];
    const def = params.definition as { id?: unknown } | undefined;
    if (def && typeof def.id === "string") out.push(def.id);
    if (typeof params.capabilityId === "string") out.push(params.capabilityId);
    if (Array.isArray(params.sources)) {
      for (const s of params.sources) if (typeof s === "string") out.push(s);
    }
    if (typeof params.target === "string") out.push(params.target);
    return out;
  }

  // Helper: read the SHA-256 `artifactId` produced by CAP-6's commit boundary.
  // CAP-6's success path returns output = { operation, mutation, result }; the
  // frozen `result` (a CapabilityMutationResult) carries the `artifactId`.
  // Failure paths return output = {} so we guard explicitly.
  private static readArtifactId(output: Record<string, unknown>): string | undefined {
    const inner = output["result"];
    if (!inner || typeof inner !== "object") return undefined;
    const candidate = (inner as { artifactId?: unknown }).artifactId;
    return typeof candidate === "string" ? candidate : undefined;
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

  /**
   * Forward-wired stub (locked ruling #4). Body lands in CAP-9.
   * Throws `CapabilityServiceNotImplementedError` (code `not_implemented_yet`).
   * The signature is async so CAP-9 can replace the body without changing the surface.
   */
  async propose(_input: unknown): Promise<never> {
    throw new CapabilityServiceNotImplementedError("propose() lands in CAP-9");
  }

  /**
   * Forward-wired stub (locked ruling #4). Body lands in CAP-10.
   * Throws `CapabilityServiceNotImplementedError` (code `not_implemented_yet`).
   */
  async measure(_input: unknown): Promise<never> {
    throw new CapabilityServiceNotImplementedError("measure() lands in CAP-10");
  }
}
