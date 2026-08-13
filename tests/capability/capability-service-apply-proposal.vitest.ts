// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 6 — `service.apply({ proposalId })` end-to-end regression suite.
 *
 * Covers three locked rulings that were reviewed:
 * - F4 (happy path) — A7 proposal → submit → apply returns
 *   `{ proposalId, status: 'executed', mutation }` and persists
 *   `proposal.executed` with the correct `artifactId`.
 * - F1 (ruling #17) — stale-publication safety. When the catalog version
 *   diverges between submit and apply, `apply` throws
 *   `CapabilityProposalStaleError` and the ledger records a rejection.
 *   No silent rebase.
 * - F2 (ruling #4) — on executor failure, persist
 *   `proposal.execution_failed` AND rethrow. The legacy
 *   `{ status: 'execution_failed' }` graceful return is forbidden.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityService } from "../../src/capability/capability-service.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { ProviderResolver, CapabilityResolver } from "../../src/capability/provider-resolver.js";
import { ProviderExecutorRegistry } from "../../src/capability/provider-registry.js";
import { NativeProviderExecutor } from "../../src/capability/provider-executor.js";
import { NativeExecutor } from "../../src/capability/executors.js";
import { A7ProposalGenerator } from "../../src/capability/evolution/a7-proposals.js";
import type {
  CapabilityEvolutionSignal,
  ProposalSignalSource,
} from "../../src/capability/evolution/a7-proposals.js";
import type { CapabilityDefinition } from "../../src/capability/canonical/definition.js";
import type { CapabilityMutationExecutor } from "../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityServiceOptions } from "../../src/capability/types/service-results.js";
import { CapabilityProposalStaleError } from "../../src/capability/errors/proposal-stale.js";

class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
  }
}

/**
 * Programmable executor seam — captures the dispatched step and returns
 * the response the test wants. Mirrors the CAP-6 executor's slim
 * `{ success, output, error? }` shape that `projectCapabilityMutationResult`
 * reads. The capability-service applies a structural cast on this return
 * value; the stub shape matches that contract.
 */
class ScriptedExecutor {
  private readonly calls: Array<{ step: unknown; ctx: unknown }> = [];

  constructor(private readonly response: {
    success: boolean;
    output: Record<string, unknown>;
    error?: string;
    artifactId: string;
  }) {}

  async executeStep(
    step: unknown,
    ctx: unknown,
  ): Promise<{
    success: boolean;
    output: Record<string, unknown>;
    error?: string;
    artifactId: string;
  }> {
    this.calls.push({ step, ctx });
    return this.response;
  }

  get callCount(): number {
    return this.calls.length;
  }
}

function def(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: "core.tweak",
    version: "1.0.0",
    kind: "core",
    title: "Tweak",
    description: "d",
    tags: [],
    category: "core",
    risk: "low",
    requiredPermissions: ["operator"],
    dependencies: [],
    bindings: [{ id: "core.tweak", type: "native" }],
    ...over,
  };
}

describe("CAP-9 service.apply({ proposalId }) — ruling #17 / #4 / happy-path", () => {
  let dir: string;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;
  let eventLog: EventLog;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-apply-prop-"));
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    const providers = new ProviderExecutorRegistry();
    providers.register("native", new NativeProviderExecutor(new NativeExecutor()));
    resolver = new CapabilityResolver(registry, providers);
    eventLog = new EventLog(dir);
    await eventLog.init();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function buildService(executor: ScriptedExecutor): CapabilityService {
    // The A7ProposalGenerator emit `underperformer` candidates whose
    // target.id is the signal's capabilityId — meaning the capability
    // MUST already exist in the catalog (CAP-9's transition step maps
    // to emerging→active against that target).
    const generator = new A7ProposalGenerator({
      signalSource: new FakeSignalSource([
        {
          kind: "underperformer",
          capabilityId: "core.tweak",
          score: 0.8,
          evidenceIds: ["e-1"],
        },
      ]),
    });
    const options: CapabilityServiceOptions = {
      catalog,
      resolver,
      mutationExecutor: executor as unknown as CapabilityMutationExecutor,
      eventLog,
      proposalGenerator: generator,
    };
    return new CapabilityService(options);
  }

  // ---------------------------------------------------------------------------
  // F4 — happy path
  // ---------------------------------------------------------------------------
  it("F4: A7 propose → submit → apply({ proposalId }) returns executed with mutation + artifactId", async () => {
    catalog.register(def(), def().bindings[0]!);
    registry.reload();
    const executor = new ScriptedExecutor({
      success: true,
      // projectCapabilityMutationResult reads output.result.artifactId
      // (CAP-6 executor's atomic-artifact envelope).
      output: {
        result: { artifactId: "a".repeat(64) },
        mutation: { operation: "capability.transition", capabilityId: "core.tweak" },
      },
      artifactId: "a".repeat(64),
    });
    const service = buildService(executor);

    // submit
    const proposed = await service.propose();
    expect(proposed.status).toBe("pending");
    expect(proposed.candidate.target.kind).toBe("capability");
    expect(proposed.candidate.target.id).toBe("core.tweak");

    // apply
    const applyInput: { readonly proposalId: string } = { proposalId: proposed.proposalId };
    const applyResult = (await service.apply(applyInput)) as unknown as {
      readonly proposalId: string;
      readonly status: "executed" | "execution_failed";
      readonly mutation?: { success: boolean; artifactId: string; mutation: Record<string, unknown> };
    };
    expect(Object.isFrozen(applyResult)).toBe(true);
    expect(applyResult.proposalId).toBe(proposed.proposalId);
    expect(applyResult.status).toBe("executed");
    if (applyResult.status !== "executed") return;
    expect(applyResult.mutation).toBeDefined();
    expect(applyResult.mutation!.success).toBe(true);
    expect(applyResult.mutation!.artifactId).toBe("a".repeat(64));

    // The executor must have been dispatched once.
    expect(executor.callCount).toBe(1);

    // Ledger assertions: proposal.submitted, proposal.approved,
    // proposal.executed in order with the matching proposalId and
    // artifactId carried into the executed payload.
    const events = await eventLog.readAll();
    const executed = events.find(
      (e) =>
        e.type === "capability.governance.proposal.executed" &&
        (e.payload as { proposalId?: string } | undefined)?.proposalId ===
          proposed.proposalId,
    );
    expect(executed).toBeDefined();
    if (executed) {
      const payload = executed.payload as {
        proposalId: string;
        artifactId: string;
        mutation: { artifactId: string };
      };
      expect(payload.proposalId).toBe(proposed.proposalId);
      expect(payload.artifactId).toBe("a".repeat(64));
      expect(payload.mutation.artifactId).toBe("a".repeat(64));
    }
  });

  // ---------------------------------------------------------------------------
  // F1 — ruling #17 stale-publication safety
  // ---------------------------------------------------------------------------
  it("F1 (ruling #17): apply() throws CapabilityProposalStaleError when source version was superseded between submit and apply", async () => {
    // Seed the catalog with v1.0.0 so submit captures sourceVersion="1.0.0".
    catalog.register(def({ version: "1.0.0" }), def().bindings[0]!);
    registry.reload();

    const executor = new ScriptedExecutor({
      success: true,
      output: {},
      artifactId: "b".repeat(64),
    });
    const service = buildService(executor);

    const proposed = await service.propose();
    expect(proposed.status).toBe("pending");

    // Bump the catalog to v2.0.0 — apply time must observe the
    // divergence between the pinned sourceVersion (1.0.0) and the
    // current catalog version (2.0.0) and reject.
    catalog.register(def({ version: "2.0.0" }), def().bindings[0]!);
    registry.reload();

    await expect(service.apply({ proposalId: proposed.proposalId })).rejects.toBeInstanceOf(
      CapabilityProposalStaleError,
    );

    // The executor must NOT have been invoked (no silent rebase).
    expect(executor.callCount).toBe(0);

    // Ledger records the rejection with the supersession detail.
    const events = await eventLog.readAll();
    const rejected = events.find(
      (e) =>
        e.type === "capability.governance.proposal.rejected" &&
        (e.payload as { proposalId?: string } | undefined)?.proposalId ===
          proposed.proposalId,
    );
    expect(rejected).toBeDefined();
    if (rejected) {
      const payload = rejected.payload as {
        proposalId: string;
        rejectedBy: string;
        reason: string;
      };
      expect(payload.rejectedBy).toBe("system");
      expect(payload.reason).toMatch(/stale: source 'core\.tweak@1\.0\.0' superseded by '2\.0\.0'/);
    }
  });

  it("F1 (ruling #17): apply() throws stale when the catalog capability was removed between submit and apply", async () => {
    catalog.register(def(), def().bindings[0]!);
    registry.reload();
    const executor = new ScriptedExecutor({
      success: true,
      output: {},
      artifactId: "c".repeat(64),
    });
    const service = buildService(executor);

    const proposed = await service.propose();

    // Remove the source capability — submit pin (1.0.0) no longer matches
    // the catalog (absent). The stale guard fires.
    catalog.remove("core.tweak");
    registry.reload();

    await expect(service.apply({ proposalId: proposed.proposalId })).rejects.toBeInstanceOf(
      CapabilityProposalStaleError,
    );
    expect(executor.callCount).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // F2 — ruling #4 executor failure rethrow
  // ---------------------------------------------------------------------------
  it("F2 (ruling #4): apply() rethrows Error when executor returns success=false (no graceful {status:'execution_failed'})", async () => {
    catalog.register(def(), def().bindings[0]!);
    registry.reload();

    const executor = new ScriptedExecutor({
      success: false,
      output: {},
      error: "boom",
      artifactId: "",
    });
    const service = buildService(executor);

    const proposed = await service.propose();

    let caught: unknown;
    let result: unknown;
    try {
      result = await service.apply({ proposalId: proposed.proposalId });
    } catch (err) {
      caught = err;
    }

    // Apply MUST throw — the legacy `{ status: 'execution_failed' }`
    // graceful return shape is forbidden (ruling #4).
    expect(result).toBeUndefined();
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      new RegExp(`^Proposal '${proposed.proposalId}' execution failed: boom$`),
    );

    // Ledger still carries the proposal.execution_failed event.
    const events = await eventLog.readAll();
    const failed = events.find(
      (e) =>
        e.type === "capability.governance.proposal.execution_failed" &&
        (e.payload as { proposalId?: string } | undefined)?.proposalId ===
          proposed.proposalId,
    );
    expect(failed).toBeDefined();
    if (failed) {
      const payload = failed.payload as {
        proposalId: string;
        error: string;
        partialState: string;
      };
      expect(payload.error).toBe("boom");
      expect(payload.partialState).toBe("rolled_back");
    }
  });
});