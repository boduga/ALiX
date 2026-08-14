// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-O Task 1 — Candidate → ExecutionStep operation mapping for
 * `underperformer` (3-axis unit test).
 *
 * CAP-N closed the gap/deprecation discriminators. CAP-O closes the
 * remaining `underperformer` gap: under §4.1 contract an
 * `underperformer` candidate MUST route to `capability.update` (NOT
 * `capability.transition` which is what pre-CAP-O `candidateToExecutionStep`
 * defaults to at `src/capability/capability-service.ts:707+`).
 *
 * In addition, CAP-O adds an invariant guard: an `underperformer` candidate
 * MUST carry a non-empty `proposedPatch`. Missing or empty patches throw
 * a structured error before `applyProposal` calls the executor. The guard
 * protects the executor from emitting a structurally-invalid
 * `capability.update` step (no patch ⇒ no provenance extensions ⇒ no
 * downstream observer sees the a7-underperformer evidence chain).
 *
 * Test strategy: `candidateToExecutionStep` is module-private — we cannot
 * import it directly. Instead, we observe the `operation` + `parameters`
 * fields via an executor spy. `service.apply({ proposalId })` walks the
 * full propose→apply path, calls `candidateToExecutionStep(candidate, ...)`,
 * and passes the resulting `ExecutionStep` to the executor.
 *
 * For axis 1 (non-empty patch), use `FakeSignalSource` + `buildSpiedSiblingService`
 * so the candidate flows through A7's `signalToCandidate` — exactly the path
 * production will use post-T2.
 *
 * For axes 2/3 (the guard), we need to inject a hand-rolled candidate that
 * A7 cannot produce (no patch / empty patch). `CapabilityService.proposeDirect`
 * is a CAP-O T1 test-only seam that bypasses A7 and persists the hand-rolled
 * candidate directly. It is gated behind `process.env.CAPABILITY_TEST_SEAM === "1"`
 * so production callers receive a clear error instead of silently persisting
 * a candidate that bypassed A7's purity invariants (locked ruling #14).
 *
 * Expected behavior on current (pre-CAP-O-T2) code:
 *   - axis 1 (underperformer + non-empty patch) FAILS — receives
 *     "capability.transition" instead of "capability.update" with patch.
 *   - axis 2 (missing proposedPatch) FAILS — no guard exists yet so the
 *     apply call does not throw the expected regex.
 *   - axis 3 (empty proposedPatch {}) FAILS — no guard exists yet so the
 *     apply call does not throw the expected regex. Additionally, a naive
 *     `if (!patch)` truthiness check would silently accept `{}` as truthy
 *     and pass through without throwing — CAP-O's guard uses a deep-empty
 *     check instead.
 *
 * After T2 rewrites `candidateToExecutionStep` to discriminate on
 * `candidate.sourcePatternId` AND adds the underperformer proposedPatch
 * invariant guard, all 3 axes pass.
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
 * so the test can assert on `step.operation` and `step.parameters` (the
 * fields the carve-out site hardcodes today). Returns a success-shaped
 * result mirroring the production executor's `StepExecutor` return so
 * `apply()` walks the success branch.
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
 * executor that captures the `ExecutionStep` emitted by
 * `candidateToExecutionStep`.
 *
 * Mirrors `buildSpiedSiblingService` from `tests/capability/cap-n-candidate-mapping.vitest.ts`.
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

/**
 * Build a sibling `CapabilityService` with an `executor` spy but NO A7
 * `proposalGenerator` (or with one that emits no signals). Axes 2/3
 * inject hand-rolled candidates via `proposeDirect` instead of going
 * through A7. The empty generator is still required by the
 * `CapabilityServiceOptions` shape, so we install one bound to a
 * `FakeSignalSource` that emits no signals.
 */
function buildSpyServiceWithSeam(
  platform: CapabilityPlatform,
  eventLog: EventLog,
): {
  service: CapabilityService;
  calls: ExecutorCall[];
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
  return { service, calls };
}

/**
 * Hand-rolled underperformer candidate WITHOUT a `proposedPatch` field.
 * Mirrors A7's `signalToCandidate("underperformer", ...)` output shape
 * (candidateId derived the same way: `a7-underperformer-<capabilityId>`),
 * but with `proposedPatch` deliberately omitted. After T2's guard runs
 * in `candidateToExecutionStep` / `applyProposal`, this candidate must
 * throw the regex `/underperformer.*non-empty.*proposedPatch/`.
 *
 * NOTE: `proposedPatch` does NOT exist on `CapabilityEvolutionCandidate`
 * pre-CAP-O-T2 (T2 adds the field). We construct the candidate via the
 * canonical shape and only LATER attach `proposedPatch` if/when T2
 * adds the field. To carry an `underperformer` candidate with NO patch
 * for axis 2, we simply build the canonical candidate without adding
 * the field.
 *
 * For axis 3 (empty `proposedPatch: {}`), we cast to `unknown as` to add
 * the optional field — once T2 adds it to the type spine, the test
 * continues to compile because the cast is non-constraining.
 */
function makeUnderperformerCandidateWithoutPatch(
  seedId: string,
  candidateIdOverride?: string,
): CapabilityEvolutionCandidate {
  return {
    candidateId: candidateIdOverride ?? `a7-underperformer-${seedId}`,
    sourcePatternId: "underperformer",
    confidence: 0.7,
    target: { kind: "capability", id: seedId },
    description: "Underperformer update (score=0.7)",
    expectedEffect: "Improve observed underperformance",
    riskClass: "medium",
    evidenceIds: ["cap-o-t1-axis-2"],
  };
}

/**
 * Hand-rolled underperformer candidate WITH an overridable `proposedPatch`.
 * Used by axis 3 to inject `proposedPatch: {}` (the empty-object case the
 * naive `if (!patch)` truthiness guard would silently accept).
 *
 * Cast to `unknown as` to attach `proposedPatch` — T2 will add the field
 * to `CapabilityEvolutionCandidate`. The cast is non-constraining: once
 * the field exists, the resulting value still satisfies the type.
 */
function makeUnderperformerCandidate(
  seedId: string,
  overrides: { proposedPatch?: CapabilityDefinitionPatch | undefined },
): CapabilityEvolutionCandidate {
  const candidate: CapabilityEvolutionCandidate = {
    candidateId: `a7-underperformer-${seedId}`,
    sourcePatternId: "underperformer",
    confidence: 0.7,
    target: { kind: "capability", id: seedId },
    description: "Underperformer update (score=0.7)",
    expectedEffect: "Improve observed underperformance",
    riskClass: "medium",
    evidenceIds: ["cap-o-t1-axis-3"],
  };
  if (overrides.proposedPatch !== undefined) {
    return {
      ...candidate,
      proposedPatch: overrides.proposedPatch,
    } as unknown as CapabilityEvolutionCandidate;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

describe("CAP-O T1 — candidate→ExecutionStep operation mapping (3 axes)", () => {
  let dir: string;
  let sessionDir: string;
  let platform: CapabilityPlatform;
  let eventLog: EventLog;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap-o-t1-"));
    sessionDir = mkdtempSync(join(tmpdir(), "cap-o-t1-sess-"));

    eventLog = new EventLog(sessionDir);
    await eventLog.init();

    platform = new CapabilityPlatform({ catalogDir: dir, eventLog });

    // Seed the catalog so the underperformer axis has a real `target.id`
    // to point at. Same composition-root seeding `cap-12-e2e.vitest.ts`
    // uses; keeps the test on the canonical universe.
    const registry = (platform as unknown as { readonly registry: CapabilityRegistry }).registry;
    registerInitialCapabilities(registry, platform.native);
    await registerSessionCapabilities(registry, platform.native);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sessionDir, { recursive: true, force: true });
  });

  // ─── Axis 1: underperformer + non-empty patch → capability.update ──────
  // FAILING on current code: receives "capability.transition".
  // Expected post-T2: receives "capability.update" with
  // `parameters.patch.extensions.provenance` carrying the a7-underperformer
  // evidence chain.
  it("axis 1: underperformer with non-empty proposedPatch → capability.update", async () => {
    const seedId = "core.session.show";
    const signal: CapabilityEvolutionSignal = {
      kind: "underperformer",
      capabilityId: seedId,
      score: 0.7,
      evidenceIds: ["cap-o-t1-axis-1"],
    };
    const { service, calls } = buildSpiedSiblingService(platform, eventLog, signal);
    const proposal = await service.propose();
    const applyResult = await service.apply({ proposalId: proposal.proposalId });

    expect(applyResult.status).toBe("executed");
    expect(calls.length).toBe(1);

    const step = calls[0]!.step;
    const params = step.parameters as Record<string, unknown>;

    expect(step.operation).toBe("capability.update");
    expect(params["operation"]).toBe("capability.update");
    expect(params["capabilityId"]).toBe(seedId);
    expect(typeof params["sourceVersion"]).toBe("string");
    expect(params["patch"]).toEqual({
      extensions: {
        provenance: {
          kind: "a7-underperformer",
          candidateId: proposal.candidate.candidateId,
          score: 0.7,
          evidenceIds: ["cap-o-t1-axis-1"],
        },
      },
    });
  });

  // ─── Axis 2: underperformer + missing proposedPatch → throws (guard) ──
  // FAILING on current code: no guard exists yet, so the apply call
  // does NOT throw the expected regex. Expected post-T2: throws
  // /underperformer.*non-empty.*proposedPatch/.
  it("axis 2: underperformer with missing proposedPatch throws (guard)", async () => {
    const seedId = "core.session.show";

    // proposeDirect accepts a hand-rolled candidate (test-only seam).
    const { service } = buildSpyServiceWithSeam(platform, eventLog);
    const candidate = makeUnderperformerCandidateWithoutPatch(seedId);
    const proposal = await service.proposeDirect(candidate);

    await expect(
      service.apply({ proposalId: proposal.proposalId }),
    ).rejects.toThrow(/underperformer.*non-empty.*proposedPatch/);
  });

  // ─── Axis 3: underperformer + empty proposedPatch {} → throws (guard) ─
  // FAILING on current code: no guard exists yet. Even after T2's guard
  // lands, a naive `if (!patch)` truthiness check would silently accept
  // `{}` (truthy object) and pass through — CAP-O's guard uses a
  // deep-empty check instead, so this axis specifically defends against
  // that implementation shortcut.
  it("axis 3: underperformer with empty proposedPatch {} throws (guard)", async () => {
    const seedId = "core.session.show";

    const { service } = buildSpyServiceWithSeam(platform, eventLog);
    const candidate = makeUnderperformerCandidate(seedId, { proposedPatch: {} });
    const proposal = await service.proposeDirect(candidate);

    await expect(
      service.apply({ proposalId: proposal.proposalId }),
    ).rejects.toThrow(/underperformer.*non-empty.*proposedPatch/);
  });
});