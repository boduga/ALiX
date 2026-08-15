// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-O Task 4 — Behavioral sentinel for underperformer→capability.update
 * routing + invariant guard.
 *
 * Pins the §4.1 contract for the `underperformer` discriminator:
 *   - Axis 1: underperformer always emits `capability.update` (NEVER
 *     `capability.transition`), across 3 different score/evidence
 *     variations — confirms the routing is unconditional on
 *     score/evidence content.
 *   - Axis 2: underperformer with missing `proposedPatch` → throws with
 *     the structured error `/underperformer.*non-empty.*proposedPatch/`.
 *   - Axis 3: underperformer with `proposedPatch: {}` → throws (a naive
 *     `if (!patch)` truthiness check would silently accept `{}` and pass
 *     through; CAP-O's guard uses a deep-empty check).
 *
 * Test philosophy: behavioral, NOT source-text dependent. The test
 * constructs candidates via the test-only `proposeDirect` seam added in
 * T1 and observes `step.operation` from a spied mutation executor —
 * exactly the same wiring as `cap-o-candidate-mapping.vitest.ts`.
 *
 * This contrasts with `cap-n-sentinel.vitest.ts` (structural: reads the
 * function body). CAP-O's sentinel is intentionally behavioral so the
 * assertion is robust to refactors that preserve behavior but move the
 * discriminator code.
 */

// Enable CAP-O test seam (proposeDirect). MUST be set before any
// CapabilityService instance is constructed so the seam is available
// throughout the test.
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
import type {
  CapabilityDefinitionPatch,
} from "../../src/capability/mutation-contract.js";
import type { ExecutionStep } from "../../src/evolution/execution/contracts/execution-contract.js";
import type { CapabilityMutationExecutor } from "../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import type { CapabilityResolver } from "../../src/capability/provider-resolver.js";
import type { CapabilityServiceOptions } from "../../src/capability/types/service-results.js";

// ---------------------------------------------------------------------------
// Helpers — mirror cap-o-candidate-mapping.vitest.ts
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
 * Spied mutation executor. Records the most recent `ExecutionStep` it
 * received so the test can assert on `step.operation` (the field the
 * underperformer discriminator routes on).
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
 * Sibling `CapabilityService` with NO A7 signals (the test-only
 * `proposeDirect` seam is used instead). Shares the platform's catalog,
 * resolver, and eventLog. The spy captures `step.operation` for axis 1.
 */
function buildSpyServiceWithSeam(
  platform: CapabilityPlatform,
  eventLog: EventLog,
): {
  service: CapabilityService;
  calls: ExecutorCall[];
  lastSeenOperation: () => string;
} {
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
  } as CapabilityServiceOptions);
  return {
    service,
    calls,
    lastSeenOperation: () => {
      if (calls.length === 0) {
        throw new Error("executor spy: no captured step");
      }
      return calls[calls.length - 1]!.step.operation;
    },
  };
}

/**
 * Hand-rolled underperformer candidate. When `proposedPatch` is omitted
 * the candidate carries no patch (axis 2). When `proposedPatch: {}` is
 * passed the candidate carries an empty patch (axis 3). When a fully
 * populated `proposedPatch` is provided the candidate is valid and
 * passes the guard (axis 1).
 *
 * Cast to `unknown as` to attach `proposedPatch` — the field was added
 * to `CapabilityEvolutionCandidate` in T2.
 */
function makeUnderperformerCandidate(
  seedId: string,
  overrides: {
    score?: number;
    evidenceIds?: string[];
    proposedPatch?: CapabilityDefinitionPatch | Record<string, never> | undefined;
  },
): CapabilityEvolutionCandidate {
  const score = overrides.score ?? 0.7;
  const evidenceIds = overrides.evidenceIds ?? ["cap-o-sentinel-axis"];
  const baseCandidate: CapabilityEvolutionCandidate = {
    candidateId: `a7-underperformer-${seedId}`,
    sourcePatternId: "underperformer",
    confidence: score,
    target: { kind: "capability", id: seedId },
    description: `Underperformer update (score=${score})`,
    expectedEffect: "Improve observed underperformance",
    riskClass: "medium",
    evidenceIds,
  };
  if (overrides.proposedPatch !== undefined) {
    return {
      ...baseCandidate,
      proposedPatch: overrides.proposedPatch as CapabilityDefinitionPatch,
    } as unknown as CapabilityEvolutionCandidate;
  }
  return baseCandidate;
}

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

describe("CAP-O behavioral sentinel", () => {
  let dir: string;
  let sessionDir: string;
  let platform: CapabilityPlatform;
  let eventLog: EventLog;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap-o-t4-"));
    sessionDir = mkdtempSync(join(tmpdir(), "cap-o-t4-sess-"));

    eventLog = new EventLog(sessionDir);
    await eventLog.init();

    platform = new CapabilityPlatform({ catalogDir: dir, eventLog });

    // Seed the catalog so the underperformer axis has a real
    // `target.id` to point at. Same composition-root seeding
    // `cap-o-candidate-mapping.vitest.ts` uses.
    const registry = (platform as unknown as { readonly registry: CapabilityRegistry }).registry;
    registerInitialCapabilities(registry, platform.native);
    await registerSessionCapabilities(registry, platform.native);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  });

  // ─── Axis 1: underperformer → capability.update (NEVER transition) ─────
  // Three sub-iterations with different score / evidence variations
  // confirm the routing is unconditional on score/evidence content.
  it("axis 1: underperformer always emits capability.update (not transition)", async () => {
    const seedId = "core.session.show";

    for (const overrides of [
      { score: 0.5 },
      { score: 0.9 },
      { score: 0.71, evidenceIds: ["a", "b", "c"] },
    ]) {
      const { service, lastSeenOperation } = buildSpyServiceWithSeam(platform, eventLog);
      const score = overrides.score;
      const evidenceIds = overrides.evidenceIds ?? ["x"];
      const candidate = makeUnderperformerCandidate(seedId, {
        score,
        evidenceIds,
        proposedPatch: {
          extensions: {
            provenance: {
              kind: "a7-underperformer",
              candidateId: `a7-underperformer-${seedId}`,
              score,
              evidenceIds,
            },
          },
        },
      });

      const proposal = await service.proposeDirect(candidate);
      const applyResult = await service.apply({ proposalId: proposal.proposalId });

      expect(applyResult.status).toBe("executed");
      const op = lastSeenOperation();
      expect(op).toBe("capability.update");
      expect(op).not.toBe("capability.transition");
    }
  });

  // ─── Axis 2: underperformer + missing proposedPatch → throws ───────────
  it("axis 2: underperformer with missing proposedPatch throws", async () => {
    const seedId = "core.session.show";
    const { service } = buildSpyServiceWithSeam(platform, eventLog);
    const candidate = makeUnderperformerCandidate(seedId, { proposedPatch: undefined });
    const proposal = await service.proposeDirect(candidate);

    await expect(
      service.apply({ proposalId: proposal.proposalId }),
    ).rejects.toThrow(/underperformer.*non-empty.*proposedPatch/);
  });

  // ─── Axis 3: underperformer + empty proposedPatch {} → throws ─────────
  // A naive `if (!patch)` truthiness check would silently accept `{}` as
  // truthy and pass through. CAP-O's guard uses a deep-empty check.
  it("axis 3: underperformer with empty proposedPatch {} throws (not truthiness-bypass)", async () => {
    const seedId = "core.session.show";
    const { service } = buildSpyServiceWithSeam(platform, eventLog);
    const candidate = makeUnderperformerCandidate(seedId, { proposedPatch: {} });
    const proposal = await service.proposeDirect(candidate);

    await expect(
      service.apply({ proposalId: proposal.proposalId }),
    ).rejects.toThrow(/underperformer.*non-empty.*proposedPatch/);
  });
});