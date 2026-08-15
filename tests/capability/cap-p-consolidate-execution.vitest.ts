// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-P — End-to-end consolidation execution path.
 *
 * CAP-N closed gap/deprecation discriminators. CAP-O closed
 * `underperformer`. CAP-P closes the final discriminator:
 * `consolidation_opportunity` MUST route `capability.consolidate`
 * (NOT `capability.transition` — the silent fall-through bug pre-CAP-P).
 *
 * Tests pin locked architectural boundaries (rulings #534 + #544,
 * 2026-08-14/15):
 *
 * - Operator-CLI-supplied values reach the executor VERBATIM
 *   (`survivorCapabilityId` → `target`, `absorbedCapabilityIds` →
 *   `sources`, `consolidateDefinition` → `definition`,
 *   `sourceDisposition` → `sourceDisposition`). No derivation,
 *   inference, expansion, or completion anywhere along the path.
 *
 * - CAP-P invariant guards throw STRUCTURED ERRORS (mirrors CAP-O's
 *   underperformer-patch invariant guard):
 *   - missing `consolidateDefinition` → throws
 *   - invalid `sourceDisposition`   → throws
 *   - empty `absorbedCapabilityIds` → throws (ruling #534)
 *
 * - The discriminator's `default` case THROWS (fail-closed) rather
 *   than silently fall through to `capability.transition`. This is
 *   the bug that broke CAP-P pre-CAP-P impl — locked forever.
 *
 * Test strategy (mirrors CAP-N/CAP-O `*candidate-mapping.vitest.ts`):
 * - `candidateToExecutionStep` is module-private — observe via executor
 *   spy on `service.apply({ proposalId })`. The spy captures
 *   `ExecutionStep.operation` + `ExecutionStep.parameters`.
 * - Three orthogonal injection paths exercised:
 *   - axis 1 (real path): A7 emits signal → `signalToCandidate` →
 *     candidate → `candidateToExecutionStep` → executor spy.
 *   - axes 2/3/4/5 (verbatim copy): same path; assertion is that
 *     operator's exact CLI bytes land in `parameters.*`.
 *   - axes 6/7/8/9 (guard + default): `proposeDirect` injects a
 *     hand-rolled candidate with the invariant-violating shape OR an
 *     unrecognized sourcePatternId.
 */

// Enable CAP-O/CAP-P test seam (`proposeDirect`). MUST be set before
// any `CapabilityService` instance is constructed so the seam is
// available throughout the test file.
process.env["CAPABILITY_TEST_SEAM"] = "1";

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CapabilityPlatform } from "../../src/capability/platform.js";
import { registerInitialCapabilities } from "../../src/capability/initial-capabilities.js";
import { registerSessionCapabilities } from "../../src/integrations/session-capabilities.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityService } from "../../src/capability/capability-service.js";
import { A7ProposalGenerator } from "../../src/capability/evolution/a7-proposals.js";
import type {
  CapabilityEvolutionSignal,
  ProposalSignalSource,
} from "../../src/capability/evolution/a7-proposals.js";
import type {
  CapabilityEvolutionCandidate,
} from "../../src/adaptation/capability-evolution-types.js";
import type { ExecutionStep } from "../../src/evolution/execution/contracts/execution-contract.js";
import type { CapabilityMutationExecutor } from "../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import type { CapabilityResolver } from "../../src/capability/provider-resolver.js";
import type { CapabilityEvolutionRiskClass } from "../../src/adaptation/capability-evolution-types.js";
import { def } from "../_support/capability-test-fixtures.js";

// ---------------------------------------------------------------------------
// Test doubles — identical pattern to cap-n/cap-o `*candidate-mapping.vitest.ts`.
// ---------------------------------------------------------------------------

interface ExecutorCall {
  readonly step: ExecutionStep;
}

/**
 * Spied mutation executor. Records the most recent `ExecutionStep` it
 * received so the test can assert on `step.operation` +
 * `step.parameters` (the fields CAP-P depends on for its verbatim
 * copy discipline).
 */
function makeExecutorSpy(): { executor: CapabilityMutationExecutor; calls: ExecutorCall[] } {
  const calls: ExecutorCall[] = [];
  const executor: CapabilityMutationExecutor = {
    async executeStep(
      step: ExecutionStep,
      _context: Record<string, unknown>,
    ): Promise<{ success: boolean; output: Record<string, unknown>; artifactId?: string; error?: string }> {
      calls.push({ step });
      return {
        success: true,
        output: {
          operation: step.operation,
          mutation: { operation: step.operation },
          result: { artifactId: "a".repeat(64) },
        },
        artifactId: "a".repeat(64),
      };
    },
  } as unknown as CapabilityMutationExecutor;
  return { executor, calls };
}

/** `ProposalSignalSource` that yields a fixed list of signals. */
class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly queue: readonly CapabilityEvolutionSignal[]) {}
  signals(): Promise<readonly CapabilityEvolutionSignal[]> {
    return Promise.resolve(this.queue);
  }
}

/** Build a definition object with the conservative-merge-required fields. */
// `def` is shared via `_support/capability-test-fixtures.ts` (J2).

/**
 * Build a sibling `CapabilityService` sharing the platform's catalog,
 * resolver, and eventLog — but routed through (a) a test-controlled
 * A7 `proposalGenerator` driving the supplied signal and (b) a spied
 * mutation executor that captures the `ExecutionStep` emitted by
 * `candidateToExecutionStep`. Mirrors `buildSpiedSiblingService` in
 * cap-n/cap-o `*candidate-mapping.vitest.ts`.
 */
function buildSpiedSiblingService(
  platform: CapabilityPlatform,
  eventLog: EventLog,
  signal: CapabilityEvolutionSignal,
): { service: CapabilityService; calls: ExecutorCall[] } {
  const generator = new A7ProposalGenerator({
    signalSource: new FakeSignalSource([signal]),
  });
  const { executor, calls } = makeExecutorSpy();
  const platformCatalog = (platform.service as unknown as { readonly catalog: CapabilityCatalog }).catalog;
  const platformResolver = (platform.service as unknown as { readonly resolver: CapabilityResolver }).resolver;
  const service = new CapabilityService({
    catalog: platformCatalog,
    resolver: platformResolver,
    mutationExecutor: executor,
    eventLog,
    proposalGenerator: generator,
  });
  return { service, calls };
}

/**
 * Build a spy service with the test seam enabled (proposeDirect) but
 * with an empty signal source. The empty generator is still required
 * to satisfy `CapabilityServiceOptions` shape — we install one bound
 * to `FakeSignalSource([])` that emits nothing. Hand-rolled candidates
 * (for guard-throws axes) are injected via `proposeDirect`.
 */
function buildSpyServiceWithSeam(
  platform: CapabilityPlatform,
  eventLog: EventLog,
): { service: CapabilityService; calls: ExecutorCall[] } {
  const generator = new A7ProposalGenerator({
    signalSource: new FakeSignalSource([]),
  });
  const { executor, calls } = makeExecutorSpy();
  const platformCatalog = (platform.service as unknown as { readonly catalog: CapabilityCatalog }).catalog;
  const platformResolver = (platform.service as unknown as { readonly resolver: CapabilityResolver }).resolver;
  const service = new CapabilityService({
    catalog: platformCatalog,
    resolver: platformResolver,
    mutationExecutor: executor,
    eventLog,
    proposalGenerator: generator,
  });
  return { service, calls };
}

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

describe("CAP-P consolidation execution path (sentinels)", () => {
  let dir: string;
  let sessionDir: string;
  let platform: CapabilityPlatform;
  let eventLog: EventLog;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap-p-"));
    sessionDir = mkdtempSync(join(tmpdir(), "cap-p-sess-"));

    eventLog = new EventLog(sessionDir);
    await eventLog.init();

    platform = new CapabilityPlatform({ catalogDir: dir, eventLog });

    // Seed the catalog so the consolidation axes have a real
    // `target.id` to point at and so the executor's
    // `validateConsolidate()` can resolve `sources` against catalog
    // state. Mirrors cap-n/cap-o test fixtures.
    const registry = (platform as unknown as { readonly registry: CapabilityRegistry }).registry;
    registerInitialCapabilities(registry, platform.native);
    await registerSessionCapabilities(registry, platform.native);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  });

  // ─── Sentinel 1: consolidation_opportunity → capability.consolidate ─────
  // The bug CAP-P closes: pre-CAP-P, this discriminator fell through
  // to `capability.transition` because `consolidation_opportunity`
  // shared the `default` arm with `capability.transition`. The CAP-P
  // discriminator gives consolidation_opportunity its OWN case, and
  // the `default` now THROWS — so any future sourcePatternId that
  // lacks an explicit case will fail loud rather than silently emit a
  // transition mutation.
  it("sentinel 1: consolidation_opportunity → capability.consolidate (no fall-through to capability.transition)", async () => {
    const survivorId = "core.session.list";
    const absorbedId = "core.session.show";
    const signal: CapabilityEvolutionSignal = {
      kind: "consolidation_opportunity",
      survivorCapabilityId: survivorId,
      absorbedCapabilityIds: [absorbedId],
      consolidateDefinition: def({ id: survivorId, version: "2.0.0" }),
      sourceDisposition: "deprecate",
      score: 0.85,
      evidenceIds: ["cap-p-sentinel-1"],
    };

    const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
    const proposal = await service.propose();
    const applyResult = await service.apply({ proposalId: proposal.proposalId });

    expect(applyResult.status).toBe("executed");
    expect(calls.length).toBe(1);

    const step = calls[0]!.step;
    expect(step.operation).toBe("capability.consolidate");
    // Sentinel: explicitly NOT capability.transition (the bug).
    expect(step.operation).not.toBe("capability.transition");
  });

  // ─── Sentinel 2: consolidateDefinition reaches executor verbatim ────────
  it("sentinel 2: operator-supplied consolidateDefinition reaches the executor verbatim (no transformation, no synthesis)", async () => {
    const survivorId = "core.session.list";
    const absorbedId = "core.session.show";
    const operatorDefinition = def({
      id: survivorId,
      version: "2.0.0",
      title: "Operator-defined consolidated capability",
      risk: "high",
    });

    const signal: CapabilityEvolutionSignal = {
      kind: "consolidation_opportunity",
      survivorCapabilityId: survivorId,
      absorbedCapabilityIds: [absorbedId],
      consolidateDefinition: operatorDefinition,
      sourceDisposition: "deprecate",
      score: 0.85,
      evidenceIds: ["cap-p-sentinel-2"],
    };

    const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
    const proposal = await service.propose();
    await service.apply({ proposalId: proposal.proposalId });

    const params = calls[0]!.step.parameters as Record<string, unknown>;
    // Sentinel: the operator-supplied definition reaches the executor
    // structurally intact (no transformation, no synthesis, no
    // reclassification). Deep equality confirms every field the
    // operator named reaches the executor exactly. The executor's
    // `validateConsolidate()` runs structural checks against
    // catalog-resolved sources — but it MUST NOT have to do that work
    // because A7 already transported a well-formed object.
    expect(params["definition"]).toEqual(operatorDefinition);
    expect(params["target"]).toBe(survivorId);
    expect(params["operation"]).toBe("capability.consolidate");
  });

  // ─── Sentinel 3: sourceDisposition reaches executor verbatim ────────────
  it("sentinel 3: operator-supplied sourceDisposition reaches the executor verbatim ('deprecate' and 'remove')", async () => {
    for (const disposition of ["deprecate", "remove"] as const) {
      const survivorId = "core.session.list";
      const absorbedId = "core.session.show";
      const signal: CapabilityEvolutionSignal = {
        kind: "consolidation_opportunity",
        survivorCapabilityId: survivorId,
        absorbedCapabilityIds: [absorbedId],
        consolidateDefinition: def({ id: survivorId, version: "2.0.0" }),
        sourceDisposition: disposition,
        score: 0.85,
        evidenceIds: [`cap-p-sentinel-3-${disposition}`],
      };

      const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
      const proposal = await service.propose();
      await service.apply({ proposalId: proposal.proposalId });

      const params = calls[0]!.step.parameters as Record<string, unknown>;
      expect(params["sourceDisposition"]).toBe(disposition);
    }
  });

  // ─── Sentinel 4: sources reach executor in same order ──────────────────
  // Operator typed `--absorbed=B@1.0.0,C@1.0.0,D@1.0.0`. The CLI
  // must pass those exact three ids in that exact order to the
  // executor. NO expansion, NO inference, NO reordering, NO
  // deduplication. (CLI rejects empty entries and duplicate survivor
  // ids in the absorbed set; the executor relies on the CLI / A7
  // not silently collapsing the operator's exact set.)
  it("sentinel 4: sources (= absorbedCapabilityIds) reach the executor verbatim in the same order (no expansion, no inference, no reorder)", async () => {
    const survivorId = "core.session.list";
    const absorbedIds = ["core.session.show", "core.session.get", "core.session.fetch"];
    const signal: CapabilityEvolutionSignal = {
      kind: "consolidation_opportunity",
      survivorCapabilityId: survivorId,
      absorbedCapabilityIds: absorbedIds,
      consolidateDefinition: def({ id: survivorId, version: "2.0.0" }),
      sourceDisposition: "deprecate",
      score: 0.85,
      evidenceIds: ["cap-p-sentinel-4"],
    };

    const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
    const proposal = await service.propose();
    await service.apply({ proposalId: proposal.proposalId });

    const params = calls[0]!.step.parameters as Record<string, unknown>;
    expect(params["sources"]).toEqual(absorbedIds);
    // Sentinel: order must be preserved EXACTLY — the executor's
    // conservative merge rules iterate sources in array order
    // (`validateConsolidateMerge` reads `proposal.sources`), so any
    // reordering here would silently change merge semantics.
    expect((params["sources"] as string[])[0]).toBe("core.session.show");
    expect((params["sources"] as string[])[1]).toBe("core.session.get");
    expect((params["sources"] as string[])[2]).toBe("core.session.fetch");
  });

  // ─── Sentinel 5: target (= survivorCapabilityId) reaches executor ───────
  it("sentinel 5: target (= survivorCapabilityId) reaches the executor verbatim (no transformation)", async () => {
    const survivorId = "core.session.list";
    const absorbedId = "core.session.show";
    const signal: CapabilityEvolutionSignal = {
      kind: "consolidation_opportunity",
      survivorCapabilityId: survivorId,
      absorbedCapabilityIds: [absorbedId],
      consolidateDefinition: def({ id: survivorId, version: "2.0.0" }),
      sourceDisposition: "deprecate",
      score: 0.85,
      evidenceIds: ["cap-p-sentinel-5"],
    };

    const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
    const proposal = await service.propose();
    await service.apply({ proposalId: proposal.proposalId });

    const params = calls[0]!.step.parameters as Record<string, unknown>;
    expect(params["target"]).toBe(survivorId);
    // Sentinel: target is the SURVIVOR, not one of the absorbed
    // sources. Pre-CAP-P fall-through produced `capabilityId: sourceId`
    // (= absorbed source) which would silently absorb the wrong
    // capability.
    expect(params["target"]).not.toBe(absorbedId);
  });

  // ─── Sentinel 6: missing consolidateDefinition → throws (guard) ───────
  // CAP-P invariant guard (mirrors CAP-O underperformer-patch guard).
  // The candidate MUST carry the operator-supplied consolidateDefinition;
  // a candidate lacking it would produce a structurally invalid
  // `capability.consolidate` mutation that the executor's
  // `validateConsolidate()` would reject with a less-precise error.
  // The CAP-P discriminator guards BEFORE constructing the
  // parameters, so the apply path fails loud at the discriminator
  // itself with the candidate id + missing-field context.
  it("sentinel 6: candidate missing consolidateDefinition throws (invariant guard, mirrors CAP-O)", async () => {
    const survivorId = "core.session.list";
    const absorbedId = "core.session.show";
    const candidate: CapabilityEvolutionCandidate = {
      candidateId: "a7-consolidation-opportunity-test-no-def",
      sourcePatternId: "consolidation_opportunity",
      confidence: 0.85,
      target: { kind: "capability", id: survivorId },
      description: "Consolidation opportunity (score=0.85)",
      expectedEffect: "Consolidate overlapping capability",
      riskClass: "high",
      evidenceIds: ["cap-p-sentinel-6"],
      absorbedCapabilityIds: [absorbedId],
      sourceDisposition: "deprecate",
      // consolidateDefinition deliberately omitted — invariant violation.
    };

    const { service, calls } = buildSpyServiceWithSeam(platform, eventLog);
    const proposal = await service.proposeDirect(candidate);

    await expect(
      service.apply({ proposalId: proposal.proposalId }),
    ).rejects.toThrow(/consolidateDefinition/);

    // Executor MUST NOT have been called — guard fires before the
    // step is constructed, so the executor receives nothing.
    expect(calls.length).toBe(0);
  });

  // ─── Sentinel 7: invalid sourceDisposition → throws (guard) ───────────
  // The discriminator only accepts `'deprecate'` or `'remove'`. Any
  // other value (including undefined, '', 'unknown', 'destroy',
  // etc.) is rejected BEFORE constructing the parameters.
  it("sentinel 7: candidate with invalid sourceDisposition throws (invariant guard)", async () => {
    const survivorId = "core.session.list";
    const absorbedId = "core.session.show";
    // Cast through unknown to attach an invalid sourceDisposition —
    // mirrors CAP-O's `proposedPatch` test pattern.
    const candidate: CapabilityEvolutionCandidate = {
      candidateId: "a7-consolidation-opportunity-test-bad-disposition",
      sourcePatternId: "consolidation_opportunity",
      confidence: 0.85,
      target: { kind: "capability", id: survivorId },
      description: "Consolidation opportunity (score=0.85)",
      expectedEffect: "Consolidate overlapping capability",
      riskClass: "high",
      evidenceIds: ["cap-p-sentinel-7"],
      absorbedCapabilityIds: [absorbedId],
      consolidateDefinition: def({ id: survivorId, version: "2.0.0" }),
      sourceDisposition: "destroy" as unknown as "deprecate",
    };

    const { service, calls } = buildSpyServiceWithSeam(platform, eventLog);
    const proposal = await service.proposeDirect(candidate);

    await expect(
      service.apply({ proposalId: proposal.proposalId }),
    ).rejects.toThrow(/sourceDisposition/);

    expect(calls.length).toBe(0);
  });

  // ─── Sentinel 8: empty absorbedCapabilityIds → throws (ruling #534) ──
  // Even though the A7 signal validator enforces non-empty
  // absorbedCapabilityIds, the CAP-P discriminator ALSO enforces it
  // (defense in depth — same pattern as CAP-O's `proposedPatch`
  // non-empty check). A hand-rolled candidate (via `proposeDirect`)
  // with empty absorbedCapabilityIds must throw at the discriminator
  // BEFORE constructing the parameters.
  it("sentinel 8: candidate with empty absorbedCapabilityIds throws (ruling #534, defense-in-depth)", async () => {
    const survivorId = "core.session.list";
    const candidate: CapabilityEvolutionCandidate = {
      candidateId: "a7-consolidation-opportunity-test-empty-absorbed",
      sourcePatternId: "consolidation_opportunity",
      confidence: 0.85,
      target: { kind: "capability", id: survivorId },
      description: "Consolidation opportunity (score=0.85)",
      expectedEffect: "Consolidate overlapping capability",
      riskClass: "high",
      evidenceIds: ["cap-p-sentinel-8"],
      absorbedCapabilityIds: [], // Ruling #534: non-empty enforcement.
      consolidateDefinition: def({ id: survivorId, version: "2.0.0" }),
      sourceDisposition: "deprecate",
    };

    const { service, calls } = buildSpyServiceWithSeam(platform, eventLog);
    const proposal = await service.proposeDirect(candidate);

    await expect(
      service.apply({ proposalId: proposal.proposalId }),
    ).rejects.toThrow(/absorbedCapabilityIds/);

    expect(calls.length).toBe(0);
  });

  // ─── Sentinel 9: unrecognized sourcePatternId throws (default case) ──
  // The CAP-P discriminator explicitly throws on unrecognized
  // sourcePatternIds. Pre-CAP-P, the discriminator silently fell
  // through to `capability.transition` — that was the bug. CAP-P
  // makes the default case fail-closed: any future sourcePatternId
  // that lacks an explicit case throws rather than emitting a
  // mutation the observer didn't intend.
  it("sentinel 9: unrecognized sourcePatternId throws (default case is fail-closed, no silent fall-through)", async () => {
    const survivorId = "core.session.list";
    // Cast through unknown to attach an unrecognized sourcePatternId.
    const candidate = {
      candidateId: "a7-unknown-pattern-test",
      sourcePatternId: "totally_made_up_pattern" as unknown as "consolidation_opportunity",
      confidence: 0.85,
      target: { kind: "capability" as const, id: survivorId },
      description: "Unknown pattern",
      expectedEffect: "Unknown",
      riskClass: "low" as CapabilityEvolutionRiskClass,
      evidenceIds: ["cap-p-sentinel-9"],
      absorbedCapabilityIds: ["core.session.show"],
      consolidateDefinition: def({ id: survivorId, version: "2.0.0" }),
      sourceDisposition: "deprecate" as const,
    };

    const { service, calls } = buildSpyServiceWithSeam(platform, eventLog);
    const proposal = await service.proposeDirect(candidate as CapabilityEvolutionCandidate);

    await expect(
      service.apply({ proposalId: proposal.proposalId }),
    ).rejects.toThrow(/unrecognized sourcePatternId/);

    // Executor MUST NOT have been called — the default case throws
    // BEFORE constructing any step, so the executor receives nothing.
    expect(calls.length).toBe(0);
  });
});
