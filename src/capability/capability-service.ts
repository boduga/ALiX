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
import type {
  CapabilityEvolutionCandidate,
  LifecycleState,
} from "../adaptation/capability-evolution-types.js";
import { CapabilityNotFoundError } from "./errors.js";
import { CapabilityServiceNotImplementedError } from "./errors/service-not-implemented.js";
import { CapabilityProposalStaleError } from "./errors/proposal-stale.js";
import { ProposalStore } from "./governance/proposal-store.js";
import {
  isGovernanceEventType,
  projectCapabilityMutationResult,
  type CapabilityGovernanceEventProjection,
  type ProposalSubmittedPayload,
} from "./governance/governance-types.js";
import type { CapabilityMeasurementEngine } from "./measurement/capability-measurement-engine.js";
import {
  MEASUREMENT_EVENT_PREFIX,
  MEASUREMENT_GOVERNANCE_PREFIX,
} from "./measurement/measurement-event-types.js";
import { A7ProposalGenerator } from "./evolution/a7-proposals.js";
import type {
  CapabilityProposeResult,
  CapabilityApplyProposalResult,
  CapabilityGovernanceResult,
} from "./types/service-results.js";
import type {
  CapabilityApplyInput,
  CapabilityApplyResult,
  CapabilityApplyStep,
  CapabilityHistoryEvent,
  CapabilityHistoryResult,
  CapabilityInspectResult,
  CapabilityListItem,
  CapabilityListResult,
  CapabilityRecommendInput,
  CapabilityRecommendResult,
  CapabilitySearchQuery,
  CapabilitySearchResult,
  CapabilityHealthResult,
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
  /** CAP-9 ruling #5 — A7 proposal intelligence. Optional so backward-compat
   *  CAP-8 read-only consumers keep constructing the service without it. */
  private readonly proposalGenerator?: A7ProposalGenerator;
  /** CAP-10 ruling #22 — measurement engine. Optional. Absent →
   *  `service.measure()` throws `CapabilityServiceNotImplementedError`
   *  (CAP-8 ruling #4 preserved). NEVER required. */
  private readonly measurementEngine?: CapabilityMeasurementEngine;
  /** CAP-9 ruling #19 — derive from `eventLog` so the service does not
   *  grow a separate persistence constructor dep. */
  private readonly proposalStore: ProposalStore;

  constructor(opts: CapabilityServiceOptions) {
    this.catalog = opts.catalog;
    this.resolver = opts.resolver;
    this.executor = opts.mutationExecutor;
    this.eventLog = opts.eventLog;
    this.proposalGenerator = opts.proposalGenerator;
    this.measurementEngine = opts.measurementEngine;
    this.proposalStore = new ProposalStore({ eventLog: this.eventLog });
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

  async apply(input: CapabilityApplyInput, ctx?: Record<string, unknown>): Promise<CapabilityApplyResult>;
  async apply(input: { proposalId: string }, ctx?: Record<string, unknown>): Promise<CapabilityApplyProposalResult>;
  async apply(
    input: CapabilityApplyInput | { proposalId: string },
    ctx?: Record<string, unknown>,
  ): Promise<CapabilityApplyResult | CapabilityApplyProposalResult> {
    if ("proposalId" in input) {
      return this.applyProposal(input.proposalId);
    }
    return this.applyStep(input.step, ctx ?? {});
  }

  private async applyStep(
    step: CapabilityApplyStep,
    ctx: Record<string, unknown>,
  ): Promise<CapabilityApplyResult> {
    const executionStep: ExecutionStep = {
      stepId: step.stepId,
      operation: step.operation,
      parameters: step.parameters,
      idempotent: step.idempotent ?? false,
      preconditions: step.preconditions ?? {},
      postconditions: step.postconditions ?? {},
    };
    const result = await this.executor.executeStep(executionStep, ctx);
    return {
      success: result.success,
      operation: step.operation,
      affected: this.affectedFromResult(step, result),
      // CAP-6 success output shape: { operation, mutation, result } where
      // `result` is the frozen CapabilityMutationResult carrying artifactId.
      // Failure paths return `output = {}`, so we guard with a single cast.
      artifactId: CapabilityService.readArtifactId(result.output),
      error: result.error,
    };
  }

  /**
   * CAP-9 ruling #4 — bridge a ledger-bound proposal through the CAP-6 executor.
   *
   * Steps:
   *   1. Reconstruct the proposal events (`proposalStore.findById`).
   *   2. Extract the candidate body from the `proposal.submitted` event.
   *   3. Re-resolve source id@version against the current catalog. Stale
   *      proposals (capability removed since submission) raise
   *      `CapabilityProposalStaleError` (ruling #17) and persist
   *      `proposal.rejected` with `system` actor.
   *   4. Persist `proposal.approved` (operator actor — A7 has no default
   *      approver; the apply caller is the operator).
   *   5. Map the candidate onto a CAP-6 `ExecutionStep` via the
   *      consumption-policy stub (transitions for now; CAP-N work
   *      tightens the candidate→mutation mapping).
   *   6. Delegate to the CAP-6 executor. On success, persist
   *      `proposal.executed` with the projected ArtifactId. On
   *      failure, persist `proposal.execution_failed` and rethrow.
   */
  private async applyProposal(proposalId: string): Promise<CapabilityApplyProposalResult> {
    const events = await this.proposalStore.findById(proposalId);
    const submitted = events.find((e) => e.type === "capability.governance.proposal.submitted");
    if (!submitted) {
      throw new Error(`Proposal '${proposalId}' not found`);
    }
    // Narrow the union down to the discriminated submitted event payload.
    if (submitted.type !== "capability.governance.proposal.submitted") {
      throw new Error(`Proposal '${proposalId}' found event is not a submission`);
    }
    const candidate = submitted.payload.candidate;
    const sourceId = candidate.target.id;

    // CAP-9 ruling #17 — re-resolve the proposal's pinned source version
    // (captured at submit time) against the current catalog. If the
    // pinned version no longer matches, surface a stale error and
    // ledger-record the rejection (no silent rebase).
    //
    // CAP-9 cherry-pick N1 — create-intent (gap) proposals carry
    // `sourceVersion = null` because the target capability did not
    // exist at submit time. The stale predicate covers four
    // non-trivial truth-table cells:
    //   (null, undefined)        → NOT stale (create intent, both absent)
    //   (null, "1.0.0")          → STALE   (target id now taken — race)
    //   ("1.0.0", "1.5.0")       → STALE   (superseded)
    //   ("1.0.0", "1.0.0")       → NOT stale (match)
    //   ("1.0.0", undefined)     → STALE   (capability was removed)
    //
    // Implementation: `null === undefined` is treated as the non-stale
    // "both absent" anchor for create intents (both ends of the
    // comparison are absent → no drift to detect). Any other
    // inequality is stale.
    const submittedPayload = submitted.payload as ProposalSubmittedPayload & {
      readonly sourceVersion: string | null;
    };
    const sourceVersion = submittedPayload.sourceVersion;
    const current = this.catalog.get(sourceId);
    const currentVersion = current?.version;
    // CAP-9 cherry-pick N1 — create-intent (gap) proposals carry
    // `sourceVersion = null` because the target capability did not
    // exist at submit time. The stale predicate covers five
    // truth-table cells:
    //   (null, undefined)        → NOT stale (create intent, both absent)
    //   (null, "1.0.0")          → STALE   (target id now taken — race)
    //   ("1.0.0", "1.5.0")       → STALE   (superseded)
    //   ("1.0.0", "1.0.0")       → NOT stale (match)
    //   ("1.0.0", undefined)     → STALE   (capability was removed)
    //
    // Implementation: throw iff BOTH ends are defined AND they differ.
    // The (null, undefined) anchor is treated as non-stale (both ends
    // absent → no drift to detect). The (null, "x") / ("x", undefined)
    // cases still fail because one side is defined and the other is
    // mismatched/absent.
    if (sourceVersion !== null && sourceVersion !== currentVersion) {
      const detail = `stale: source '${sourceId}@${sourceVersion ?? "absent"}' superseded by '${currentVersion ?? "absent"}'`;
      await this.proposalStore.recordRejected(proposalId, "system", detail);
      throw new CapabilityProposalStaleError(
        proposalId,
        sourceId,
        sourceVersion ?? "absent",
        currentVersion,
      );
    }

    await this.proposalStore.recordApproved(proposalId, "operator");

    // Map candidate → CAP-6 step. CAP-9 ships a conservative consumption
    // policy; CAP-N tightens the candidate→mutation mapping per kind.
    //
    // `sourceVersion ?? currentVersion ?? "0.0.0"` covers three cases
    // that survive the throw above:
    //   - matched strings (`sourceVersion` is the non-null current `currentVersion`).
    //   - create-intent: sourceVersion=null, currentVersion=undefined →
    //     both absent, falls back to the explicit placeholder. Executor
    //     treats this as a forecast anchor for the new capability.
    //   - matched (null, null) is impossible: `currentVersion` is
    //     `string | undefined`, never `null`.
    const step = candidateToExecutionStep(
      candidate,
      sourceId,
      sourceVersion ?? currentVersion ?? "0.0.0",
    );
    try {
      // The executor returns the slim `StepExecutor` shape
      // (`{ success, output, error? }`); the projection reads only those
      // three fields, so a structural cast is sound — the function does
      // not touch the missing `stepId`/`startedAt`/`completedAt`.
      const result = await this.executor.executeStep(step, {});
      if (result.success) {
        const projected = projectCapabilityMutationResult(
          result as unknown as import("../evolution/execution/contracts/execution-contract.js").ExecutionStepResult,
        );
        await this.proposalStore.recordExecuted(proposalId, projected, projected.artifactId);
        return Object.freeze({
          proposalId,
          status: "executed" as const,
          mutation: projected,
        });
      }
      // CAP-9 ruling #4 — on executor failure, persist
      // `proposal.execution_failed` AND rethrow so callers (CLI, tests)
      // see the failure instead of a silent `{ status: "execution_failed" }`.
      const errorMessage = result.error ?? "unknown executor error";
      await this.proposalStore.recordExecutionFailed(proposalId, errorMessage, "rolled_back");
      throw new Error(`Proposal '${proposalId}' execution failed: ${errorMessage}`);
    } catch (err) {
      // If we already threw a rethrow for execution_failed, pass it
      // through unchanged. For unexpected exceptions, ledger-record and
      // rethrow the original error.
      if (err instanceof Error && err.message.startsWith(`Proposal '${proposalId}' execution failed: `)) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.proposalStore.recordExecutionFailed(proposalId, message, "rolled_back");
      throw err;
    }
  }

  private affectedFromResult(
    step: CapabilityApplyStep,
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
  async propose(_input?: unknown): Promise<CapabilityProposeResult> {
    // CAP-9 ruling #3 — sole proposal submission route. The CAP-8
    // forward-wired stub contract (CAP-8 ruling #4) is preserved:
    // callers that did not inject `proposalGenerator` still receive
    // the stable `CapabilityServiceNotImplementedError`.
    if (!this.proposalGenerator) {
      throw new CapabilityServiceNotImplementedError("propose()");
    }
    const candidates = await this.proposalGenerator.generate();
    if (candidates.length === 0) {
      throw new Error("A7 produced no candidates — no signals available");
    }
    // Persist every candidate; the synthesized proposalId is the
    // canonical-JSON SHA-256 of the candidate body. Callers receive
    // only the first proposalId in the return shape; the rest are
    // independent ledger entries awaiting separate approval.
    let firstProposalId: string | undefined;
    for (const candidate of candidates) {
      // CAP-9 ruling #17 — capture the source's current catalog version
      // BEFORE persistence so apply time can re-resolve the pin. Null
      // means the target capability is not yet in the catalog (create
      // intent); submit carries it into the persisted payload verbatim.
      const current = this.catalog.get(candidate.target.id);
      const sourceVersion: string | null = current?.version ?? null;
      const { proposalId } = await this.proposalStore.submit(
        candidate,
        candidate.evidenceIds,
        sourceVersion,
      );
      if (firstProposalId === undefined) {
        firstProposalId = proposalId;
      }
    }
    return Object.freeze({
      proposalId: firstProposalId!,
      status: "pending" as const,
      candidate: candidates[0]!,
    });
  }

  /**
   * CAP-9 ruling #10, #22, #23 — pure projection over the shared
   * EventLog. No catalog reads, no registry reads, no service state.
   *
   * Optional `capabilityId` filter matches events whose payload
   * `candidate.target.id` equals the supplied id. Without a filter,
   * returns every governance event written so far.
   */
  async governance(capabilityId?: string): Promise<CapabilityGovernanceResult> {
    if (!this.eventLog) {
      return Object.freeze({ events: [] });
    }
    const all = await this.eventLog.readAll();
    // CAP-10 ruling #6, #20 — widens filter from
    // `capability.governance.proposal.` (CAP-9) to the parent
    // `capability.governance.` prefix so projection includes both
    // `proposal.*` (CAP-9) AND `measurement.*` (CAP-10) events.
    // Pure projection — never calculate, reinterpret, or override
    // events.
    const governanceEvents = all.filter(
      (e): e is AlixEvent =>
        typeof e.type === "string" &&
        e.type.startsWith(MEASUREMENT_GOVERNANCE_PREFIX),
    );
    const filtered = capabilityId
      ? governanceEvents.filter((e) => {
          const payload = e.payload as { candidate?: CapabilityEvolutionCandidate } | undefined;
          return payload?.candidate?.target?.id === capabilityId;
        })
      : governanceEvents;
    const projections: Array<
      CapabilityGovernanceEventProjection | import("./types/service-results.js").CapabilityMeasurementEventProjection
    > = filtered.map(toProjection);
    return Object.freeze({ events: projections });
  }

  /**
   * CAP-9 Task 9 — record a rejection of a pending proposal.
   *
   * CLI seam: the operator-facing reject path. Records
   * `proposal.rejected` (long-form `capability.governance.proposal.rejected`)
   * via the shared ProposalStore. Distinct from `apply()` which routes
   * through CAP-6's mutation executor; `reject()` is a store-level write
   * only — no executor delegation, no atomicity matrix, no rollback.
   *
   * Returns `{ proposalId, status: "rejected" }` snapshot. The CLI may
   * print this and exit 0. The governance ledger records the rejection
   * with `operator` actor and the supplied `reason`.
   */
  async reject(
    proposalId: string,
    reason: string,
  ): Promise<{ readonly proposalId: string; readonly status: "rejected" }> {
    await this.proposalStore.recordRejected(proposalId, "operator", reason);
    return Object.freeze({ proposalId, status: "rejected" as const });
  }

  /**
   * CAP-10 ruling #2, #22 — measure a capability at id@version.
   * Optional baseline via `baselineObservationId?`.
   * Delegates to the injected `CapabilityMeasurementEngine`
   * (ruling #8, #18). Absent engine →
   * `CapabilityServiceNotImplementedError` (CAP-8 ruling #4 preserved).
   */
  async measure(input: {
    capabilityId: string;
    version: string;
    baselineObservationId?: string;
  }): Promise<import("./types/service-results.js").CapabilityMeasureResult> {
    if (!this.measurementEngine) {
      throw new CapabilityServiceNotImplementedError(
        "measure() requires measurementEngine",
      );
    }
    return this.measurementEngine.measure(input);
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/**
 * Project an EventLog event into a governance projection.
 * Pops the locked `capability.governance.proposal.` prefix for the
 * type-narrowing cast; the long-form literal is preserved in the projection
 * so consumers can filter by prefix alone (ruling #1).
 *
 * CAP-10 ruling #6 — measurement events (`capability.governance.measurement.*`)
 * fall through the widened governance filter; they project to
 * `CapabilityMeasurementEventProjection` (no `proposalId` field — the
 * measurement payload carries the capability id@version directly).
 *
 * Pure projection — never calculate, reinterpret, or override events
 * (ruling #6).
 */
function toProjection(
  e: AlixEvent,
): CapabilityGovernanceEventProjection | import("./types/service-results.js").CapabilityMeasurementEventProjection {
  if (
    typeof e.type === "string" &&
    e.type.startsWith(MEASUREMENT_EVENT_PREFIX)
  ) {
    return Object.freeze({
      seq: e.seq,
      timestamp: e.timestamp,
      type: e.type as "capability.governance.measurement.measured",
      payload: e.payload as import("./measurement/measurement-event-types.js").CapabilityMeasurementPayload,
    }) as import("./types/service-results.js").CapabilityMeasurementEventProjection;
  }
  const type = e.type as CapabilityGovernanceEventProjection["type"];
  if (!isGovernanceEventType(type)) {
    throw new Error(`Unknown governance event type: ${e.type}`);
  }
  const payload = e.payload as { proposalId: string } & Record<string, unknown>;
  return Object.freeze({
    seq: e.seq,
    timestamp: e.timestamp,
    proposalId: payload.proposalId,
    type,
    payload: payload as never,
  }) as CapabilityGovernanceEventProjection;
}

/**
 * CAP-9 ruling #4 + consumption-policy stub — map a candidate to a
 * CAP-6 `ExecutionStep`. CAP-9 ships a conservative transition stub
 * (`capability.transition` to `active`); CAP-N work tightens the
 * candidate→mutation mapping per candidate kind (e.g. `gap` →
 * `capability.create`, `deprecation_signal` → `capability.remove`).
 *
 * The current `sourceId` + `currentVersion` are passed in so the
 * forecast is forward-pinned to the catalog state at apply time
 * (ruling #17 — stale-detection source).
 */
function candidateToExecutionStep(
  candidate: CapabilityEvolutionCandidate,
  sourceId: string,
  currentVersion: string,
): ExecutionStep {
  return {
    stepId: `proposal-${candidate.candidateId}`,
    operation: "capability.transition",
    parameters: {
      operation: "capability.transition",
      capabilityId: sourceId,
      from: "emerging",
      to: "active",
      // Forecast pin — the catalog version the apply was authorised against.
      sourceVersion: currentVersion,
    },
    idempotent: true,
    preconditions: {},
    postconditions: {},
  };
}
