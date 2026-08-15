// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-N Task 1 — Candidate → ExecutionStep operation mapping (4-axis unit test).
 *
 * CAP-12 §20 #12 carve-out site: `src/capability/capability-service.ts:702,704`
 * hardcodes `operation: "capability.transition"` for every candidate. This file
 * demonstrates the mapping is broken before CAP-N's T2 rewrites
 * `candidateToExecutionStep`.
 *
 * Test strategy: `candidateToExecutionStep` is module-private — we cannot
 * import it directly. Instead, we observe the `operation` field via an
 * executor spy. `service.apply({ proposalId })` walks the full propose→apply
 * path, calls `candidateToExecutionStep(candidate, sourceId, currentVersion)`,
 * and passes the resulting `ExecutionStep` to the executor. The spy records
 * what `operation` was passed.
 *
 * Expected behavior on current (pre-CAP-N-T2) code:
 *   - axis 1 (gap)            FAILS — receives "capability.transition"
 *   - axis 2 (deprecation)    FAILS — receives "capability.transition"
 *   - axis 3 (underperformer) PASSES — receives "capability.transition"
 *   - axis 4 (consolidation)  PASSES — receives "capability.transition"
 *
 * After T2 rewrites `candidateToExecutionStep` to discriminate on
 * `candidate.sourcePatternId` per §4.1 contract:
 *   - gap            → "capability.create"
 *   - deprecation    → "capability.remove"
 *   - underperformer → "capability.transition"
 *   - consolidation  → "capability.transition"
 */

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
import type { ExecutionStep } from "../../src/evolution/execution/contracts/execution-contract.js";
import type { CapabilityMutationExecutor } from "../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import type { CapabilityResolver } from "../../src/capability/provider-resolver.js";
import type { CapabilityServiceOptions } from "../../src/capability/types/service-results.js";
import type { CapabilityKind } from "../../src/capability/canonical/kind.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Programmable signal source — emits the signals we inject at construction. */
class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
  }
}

/** Captured-call record for the executor spy. */
interface ExecutorCall {
  readonly step: ExecutionStep;
}

/**
 * Spied mutation executor. Records the most recent `ExecutionStep` it received
 * so the test can assert on `step.operation` (the field the carve-out site
 * hardcodes today). Returns a success-shaped result mirroring the production
 * executor's `StepExecutor` return so `apply()` walks the success branch.
 */
function makeExecutorSpy(): {
  executor: CapabilityMutationExecutor;
  calls: ExecutorCall[];
} {
  const calls: ExecutorCall[] = [];
  const executor: CapabilityMutationExecutor = {
    async executeStep(
      step: ExecutionStep,
      _context: Record<string, unknown>,
    ): Promise<{
      success: boolean;
      output: Record<string, unknown>;
      artifactId?: string;
      error?: string;
    }> {
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

/**
 * Build a sibling `CapabilityService` that shares the platform's catalog,
 * resolver, and eventLog — but routes through (a) a test-controlled A7
 * `proposalGenerator` driving the supplied signal and (b) a spied mutation
 * executor that captures the `ExecutionStep.operation` emitted by
 * `candidateToExecutionStep`.
 *
 * Mirrors `buildSiblingService` from `tests/capability/cap-12-e2e.vitest.ts`
 * but swaps the stub executor for an executor spy.
 */
function buildSpiedSiblingService(
  platform: CapabilityPlatform,
  eventLog: EventLog,
  signal: CapabilityEvolutionSignal,
): {
  service: CapabilityService;
  calls: ExecutorCall[];
} {
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
  } as CapabilityServiceOptions);
  return { service, calls };
}

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

describe("CAP-N T1 — candidate→ExecutionStep operation mapping (4 axes)", () => {
  let dir: string;
  let sessionDir: string;
  let platform: CapabilityPlatform;
  let eventLog: EventLog;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap-n-t1-"));
    sessionDir = mkdtempSync(join(tmpdir(), "cap-n-t1-sess-"));

    eventLog = new EventLog(sessionDir);
    await eventLog.init();

    platform = new CapabilityPlatform({ catalogDir: dir, eventLog });

    // Seed the catalog so deprecation/underperformer/consolidation axes have a
    // real `target.id` to point at. The same composition-root seeding
    // `cap-12-e2e.vitest.ts` uses; keeps the test on the canonical universe.
    const registry = (platform as unknown as { readonly registry: CapabilityRegistry }).registry;
    registerInitialCapabilities(registry, platform.native);
    await registerSessionCapabilities(registry, platform.native);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  });

  // ─── Axis 1: gap → capability.create ───────────────────────────────────
  // FAILING on current code: receives "capability.transition".
  // Expected post-T2: receives "capability.create".
  it("axis 1: sourcePatternId=gap → operation=\"capability.create\"", async () => {
    const signal: CapabilityEvolutionSignal = {
      kind: "gap",
      // capabilityId is undefined for gap signals per A7's signal type;
      // A7's `signalToCandidate` derives `target.id = "new.a7-gap-new"`.
      capabilityId: undefined,
      score: 0.9,
      evidenceIds: ["cap-n-t1-axis-1"],
    };
    const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
    const proposal = await service.propose();
    const applyResult = await service.apply({ proposalId: proposal.proposalId });
    expect(applyResult.status).toBe("executed");
    expect(calls.length).toBe(1);
    expect(calls[0]!.step.operation).toBe("capability.create");
  });

  // ─── Axis 2: deprecation_signal → capability.remove ─────────────────────
  // FAILING on current code: receives "capability.transition".
  // Expected post-T2: receives "capability.remove".
  it("axis 2: sourcePatternId=deprecation_signal → operation=\"capability.remove\"", async () => {
    const seedId = "core.session.list"; // registered in beforeEach seed.
    const signal: CapabilityEvolutionSignal = {
      kind: "deprecation_signal",
      capabilityId: seedId,
      score: 0.85,
      evidenceIds: ["cap-n-t1-axis-2"],
    };
    const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
    const proposal = await service.propose();
    const applyResult = await service.apply({ proposalId: proposal.proposalId });
    expect(applyResult.status).toBe("executed");
    expect(calls.length).toBe(1);
    expect(calls[0]!.step.operation).toBe("capability.remove");
  });

  // ─── Axis 3: underperformer — superseded by CAP-O ─────────
  // CAP-N originally asserted underperformer → capability.transition
  // (the preserved default at CAP-N's time). CAP-O's locked ruling
  // supersedes that: underperformer candidates now emit
  // capability.update rather than capability.transition.
  it("axis 3: sourcePatternId=underperformer → operation=\"capability.update\"", async () => {
    const seedId = "core.session.show";
    const signal: CapabilityEvolutionSignal = {
      kind: "underperformer",
      capabilityId: seedId,
      score: 0.7,
      evidenceIds: ["cap-n-t1-axis-3"],
    };
    const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
    const proposal = await service.propose();
    const applyResult = await service.apply({ proposalId: proposal.proposalId });
    expect(applyResult.status).toBe("executed");
    expect(calls.length).toBe(1);
    expect(calls[0]!.step.operation).toBe("capability.update");
  });

  // ─── Axis 4: consolidation_opportunity → capability.consolidate (CAP-P)
  // Pre-CAP-N this discriminator fell through to capability.transition (the
  // silent fall-through bug). CAP-N kept that fall-through; CAP-P closes
  // it by giving consolidation_opportunity its own explicit case in the
  // discriminator. The operator-CLI-supplied identity carries the
  // required `consolidateDefinition` and `sourceDisposition` fields.
  it("axis 4: sourcePatternId=consolidation_opportunity → operation=\"capability.consolidate\" (CAP-P closed the fall-through)", async () => {
    const seedId = "tool.file.read";
    const absorbedId = "tool.file.fetch";
    const signal: CapabilityEvolutionSignal = {
      kind: "consolidation_opportunity",
      survivorCapabilityId: seedId,
      absorbedCapabilityIds: [absorbedId],
      consolidateDefinition: {
        id: seedId,
        version: "2.0.0",
        kind: "tool" as CapabilityKind,
        title: "consolidated",
        description: "d",
        tags: [],
        category: "tool",
        risk: "low",
        requiredPermissions: ["operator"],
        dependencies: [],
        bindings: [{ id: seedId, type: "native" }],
      },
      sourceDisposition: "deprecate",
      score: 0.8,
      evidenceIds: ["cap-n-t1-axis-4"],
    };
    const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
    const proposal = await service.propose();
    const applyResult = await service.apply({ proposalId: proposal.proposalId });
    expect(applyResult.status).toBe("executed");
    expect(calls.length).toBe(1);
    expect(calls[0]!.step.operation).toBe("capability.consolidate");
  });
});