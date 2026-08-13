// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 9 — Governance CLI commands end-to-end regression suite.
 *
 * Covers three new CAP-9 CLI seams:
 *   - `proposals` — `service.governance(capabilityId?)` projection
 *   - `approve` — `service.apply({ proposalId })` execution bridge
 *   - `reject` — `service.reject(proposalId, reason)` store-level write
 *
 * Each test wires a `CapabilityService` directly (no CLI binary); the
 * CLI command files are pure functions over a `service: CapabilityService`
 * arg, so the assertions exercise the same shape the dispatcher invokes.
 *
 * Event-type expectations use the LONG-form
 * `capability.governance.proposal.*` prefix (ruling #1). The CLI brief's
 * short-form was a pre-resolved bug (Bug 2).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EventLog } from "../../src/events/event-log.js";
import { CapabilityService } from "../../src/capability/capability-service.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { ProviderExecutorRegistry } from "../../src/capability/provider-registry.js";
import { NativeProviderExecutor } from "../../src/capability/provider-executor.js";
import { NativeExecutor } from "../../src/capability/executors.js";
import { CapabilityResolver } from "../../src/capability/provider-resolver.js";
import { CapabilityMutationExecutor } from "../../src/evolution/execution/capability-mutation-executor.js";
import { A7ProposalGenerator } from "../../src/capability/evolution/a7-proposals.js";
import type {
  CapabilityEvolutionSignal,
  ProposalSignalSource,
} from "../../src/capability/evolution/a7-proposals.js";
import type { CapabilityServiceOptions } from "../../src/capability/types/service-results.js";
import { CapabilityProposalStaleError } from "../../src/capability/errors/proposal-stale.js";

import { capabilityProposalsCommand } from "../../src/cli/commands/capability-proposals.js";
import { capabilityApproveCommand } from "../../src/cli/commands/capability-approve.js";
import { capabilityRejectCommand } from "../../src/cli/commands/capability-reject.js";

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
  }
}

/**
 * Programmable executor seam — records dispatched steps and returns a
 * scripted response. Mirrors the CAP-6 executor's slim
 * `{ success, output, error? }` shape that `projectCapabilityMutationResult`
 * reads. The service applies a structural cast on this return value;
 * the stub shape matches that contract.
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

interface Harness {
  readonly service: CapabilityService;
  readonly executor: ScriptedExecutor;
  readonly eventLog: EventLog;
}

async function buildHarness(
  signals: ReadonlyArray<CapabilityEvolutionSignal>,
  executor: ScriptedExecutor,
  dir: string,
): Promise<Harness> {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  const providers = new ProviderExecutorRegistry();
  providers.register("native", new NativeProviderExecutor(new NativeExecutor()));
  const resolver = new CapabilityResolver(registry, providers);
  const eventLog = new EventLog(dir);
  await eventLog.init();
  const mutationExecutor = executor as unknown as CapabilityMutationExecutor;
  const proposalGenerator = new A7ProposalGenerator({
    signalSource: new FakeSignalSource(signals),
  });
  const options: CapabilityServiceOptions = {
    catalog, resolver, mutationExecutor, eventLog, proposalGenerator,
  };
  const service = new CapabilityService(options);
  return { service, executor, eventLog };
}

describe("CAP-9 governance CLI — proposals / approve / reject seams", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap9-cli-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // proposals
  // -------------------------------------------------------------------------

  it("proposals command routes through service.governance — returns pending events", async () => {
    const { service } = await buildHarness(
      [
        { kind: "gap", score: 0.9, evidenceIds: ["e-1"] },
      ],
      new ScriptedExecutor({
        success: true,
        output: { result: { artifactId: "a".repeat(64) } },
        artifactId: "a".repeat(64),
      }),
      dir,
    );

    const proposed = await service.propose();
    assert.equal(proposed.status, "pending");

    // CLI call — service is supplied via the dispatch contract
    // (no platform instantiation, no direct catalog access).
    const exitCode = await capabilityProposalsCommand([], { service });
    assert.equal(exitCode, 0);

    const result = await service.governance();
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0]!.proposalId, proposed.proposalId);
  });

  // -------------------------------------------------------------------------
  // approve — applies via service.apply({proposalId}); the candidate target
  // does not exist in the catalog so the stale guard fires and the ledger
  // records `proposal.rejected` (long-form).
  // -------------------------------------------------------------------------

  it("approve routes through service.apply({ proposalId }) — stale target records proposal.rejected", async () => {
    const { service } = await buildHarness(
      [
        // deprecation_signal → candidate.target.id = capabilityId from signal.
        // We deliberately do NOT register anything in the catalog, so the
        // apply path will hit the stale guard before the executor runs.
        { kind: "deprecation_signal", capabilityId: "nonexistent.capability", score: 0.7, evidenceIds: [] },
      ],
      new ScriptedExecutor({
        success: true,
        output: {},
        artifactId: "a".repeat(64),
      }),
      dir,
    );

    const { proposalId } = await service.propose();

    // apply MUST route through the service seam (CAP-6 delegation)
    // and throw CapabilityProposalStaleError when the candidate target
    // is absent from the catalog.
    await assert.rejects(
      async () => service.apply({ proposalId }),
      (err: unknown) => err instanceof CapabilityProposalStaleError,
    );

    const events = await service.governance();
    const types = events.events.map((e) => e.type);
    assert.ok(
      types.includes("capability.governance.proposal.submitted"),
      `expected submitted event, got: ${types.join(", ")}`,
    );
    assert.ok(
      types.includes("capability.governance.proposal.rejected"),
      `expected rejected event, got: ${types.join(", ")}`,
    );
    // proposal.approved NOT recorded — stale guard short-circuits before approval.
    assert.ok(
      !types.includes("capability.governance.proposal.approved"),
      `did not expect approved event, got: ${types.join(", ")}`,
    );
  });

  // -------------------------------------------------------------------------
  // reject — service.reject(proposalId, reason) is a store-level write only.
  // No executor delegation. Records `proposal.rejected` with operator actor.
  // -------------------------------------------------------------------------

  it("reject routes through service.reject — records proposal.rejected without executor delegation", async () => {
    const executor = new ScriptedExecutor({
      success: true,
      output: {},
      artifactId: "a".repeat(64),
    });
    const { service } = await buildHarness(
      [{ kind: "gap", score: 0.5, evidenceIds: [] }],
      executor,
      dir,
    );

    const { proposalId } = await service.propose();

    // CLI command — service arg from the dispatch contract.
    const exitCode = await capabilityRejectCommand(
      [proposalId, "rejected", "by", "tests"],
      { service },
    );
    assert.equal(exitCode, 0);

    // executor MUST NOT have been invoked — reject is store-level only.
    assert.equal(executor.callCount, 0);

    const events = await service.governance();
    const types = events.events.map((e) => e.type);
    assert.ok(
      types.includes("capability.governance.proposal.submitted"),
      `expected submitted event, got: ${types.join(", ")}`,
    );
    assert.ok(
      types.includes("capability.governance.proposal.rejected"),
      `expected rejected event, got: ${types.join(", ")}`,
    );

    // Verify the rejection payload includes operator actor + reason.
    const rejected = events.events.find(
      (e) => e.type === "capability.governance.proposal.rejected",
    );
    assert.ok(rejected);
    const payload = rejected!.payload as {
      proposalId: string;
      rejectedBy: string;
      reason: string;
    };
    assert.equal(payload.rejectedBy, "operator");
    assert.equal(payload.reason, "rejected by tests");
  });

  it("reject command exits 2 when proposalId or reason is missing", async () => {
    const executor = new ScriptedExecutor({
      success: true,
      output: {},
      artifactId: "a".repeat(64),
    });
    const { service } = await buildHarness([], executor, dir);

    // No args
    const noArgs = await capabilityRejectCommand([], { service });
    assert.equal(noArgs, 2);

    // proposalId only — no reason
    const noReason = await capabilityRejectCommand(["some-id"], { service });
    assert.equal(noReason, 2);
  });

  it("approve command exits 2 when proposalId is missing", async () => {
    const executor = new ScriptedExecutor({
      success: true,
      output: {},
      artifactId: "a".repeat(64),
    });
    const { service } = await buildHarness([], executor, dir);

    const exitCode = await capabilityApproveCommand([], { service });
    assert.equal(exitCode, 2);
  });

  it("proposals command exits 1 when service is absent (dispatcher contract violation)", async () => {
    const exitCode = await capabilityProposalsCommand([], { service: undefined });
    assert.equal(exitCode, 1);
  });
});