// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 6 — `service.propose()` (A7 bridge into governance ledger).
 *
 * Locked ruling #3 — sole proposal submission route result.
 * Locked ruling #21 — duplicate detection via ledger scan.
 * Locked ruling #4 — missing `proposalGenerator` injection throws stable
 *                     `CapabilityServiceNotImplementedError` ("not_implemented")
 *                     — same contract as the CAP-8 forward-wired stub.
 *
 * EventLog event type is `capability.governance.proposal.submitted` (long form,
 * ruling #1) — the brief's verbatim short form ("proposal.submitted") was
 * superseded by Task 1's prefix correction.
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
import { CapabilityProposalGenerator } from "../../src/capability/evolution/proposals.js";
import type {
  CapabilityEvolutionSignal,
  ProposalSignalSource,
} from "../../src/capability/evolution/proposals.js";
import { CapabilityProposalDuplicateError } from "../../src/capability/errors/proposal-duplicate.js";
import { CapabilityServiceNotImplementedError } from "../../src/capability/errors/service-not-implemented.js";
import type { CapabilityMutationExecutor } from "../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityServiceOptions } from "../../src/capability/types/service-results.js";

class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
  }
}

/**
 * StubExecutor — propose() never reaches the executor; provide a minimal
 * structural seam so the four required deps compile. Cast in tests below.
 */
class StubExecutor {
  async executeStep(): Promise<{
    success: boolean;
    output: Record<string, unknown>;
    error?: string;
  }> {
    return { success: true, output: {} };
  }
}

describe("CapabilityService.propose (CAP-9 ruling #3 — sole submission route)", () => {
  let dir: string;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;
  let eventLog: EventLog;
  let service: CapabilityService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-svc-"));
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    const providers = new ProviderExecutorRegistry();
    providers.register("native", new NativeProviderExecutor(new NativeExecutor()));
    resolver = new CapabilityResolver(registry, providers);
    eventLog = new EventLog(dir);
    await eventLog.init();

    const generator = new CapabilityProposalGenerator({
      signalSource: new FakeSignalSource([
        { kind: "gap", capabilityId: undefined, score: 0.9, evidenceIds: ["e-1"] },
      ]),
    });

    const options: CapabilityServiceOptions = {
      catalog,
      resolver,
      mutationExecutor: new StubExecutor() as unknown as CapabilityMutationExecutor,
      eventLog,
      proposalGenerator: generator,
    };
    service = new CapabilityService(options);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("propose() persists proposal.submitted and returns CapabilityProposeResult", async () => {
    const result = await service.propose();
    expect(result.proposalId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.status).toBe("pending");
    expect(result.candidate).toBeDefined();
    expect(result.candidate.target.kind).toBe("capability");
  });

  it("propose() emits long-form capability.governance.proposal.submitted event", async () => {
    const result = await service.propose();
    const events = await eventLog.readAll();
    const submitted = events.find(
      (e) =>
        (e.payload as { proposalId?: string } | undefined)?.proposalId ===
        result.proposalId,
    );
    expect(submitted).toBeDefined();
    expect(submitted!.type).toBe("capability.governance.proposal.submitted");
  });

  it("propose() rejects duplicate (idempotency, ruling #21)", async () => {
    await service.propose();
    await expect(service.propose()).rejects.toBeInstanceOf(CapabilityProposalDuplicateError);
  });

  it("propose() returns Object.freeze'd result (CAP-8 surface invariant)", async () => {
    const result = await service.propose();
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("propose() throws stable error when proposalGenerator not injected (CAP-8 ruling #4)", async () => {
    const noGenOptions: CapabilityServiceOptions = {
      catalog,
      resolver,
      mutationExecutor: new StubExecutor() as unknown as CapabilityMutationExecutor,
      eventLog,
    };
    const noGenService = new CapabilityService(noGenOptions);
    await expect(noGenService.propose()).rejects.toBeInstanceOf(
      CapabilityServiceNotImplementedError,
    );
  });
});
