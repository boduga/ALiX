// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 6 — `service.governance()` (EventLog projection).
 *
 * Locked ruling #10, #22, #23:
 *   - Returns `CapabilityGovernanceResult { events }` filtered by
 *     `capability.governance.*` prefix.
 *   - Optional `capabilityId` filter — matches events whose payload
 *     candidate.target.id === capabilityId.
 *   - Pure projection over EventLog — no catalog reads, no service-level
 *     state reconstruction.
 *
 * Bug-1 fix: event type is long-form `capability.governance.proposal.submitted`,
 * not the brief's verbatim short form.
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
import type { CapabilityMutationExecutor } from "../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityServiceOptions } from "../../src/capability/types/service-results.js";

class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
  }
}

class StubExecutor {
  async executeStep(): Promise<{
    success: boolean;
    output: Record<string, unknown>;
    error?: string;
  }> {
    return { success: true, output: {} };
  }
}

describe("CapabilityService.governance (CAP-9 rulings #10, #22, #23)", () => {
  let dir: string;
  let eventLog: EventLog;
  let service: CapabilityService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-gov-"));
    const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    const registry = new CapabilityRegistry(catalog);
    const providers = new ProviderExecutorRegistry();
    providers.register("native", new NativeProviderExecutor(new NativeExecutor()));
    const resolver = new CapabilityResolver(registry, providers);
    eventLog = new EventLog(dir);
    await eventLog.init();

    const options: CapabilityServiceOptions = {
      catalog,
      resolver,
      mutationExecutor: new StubExecutor() as unknown as CapabilityMutationExecutor,
      eventLog,
      proposalGenerator: new A7ProposalGenerator({
        signalSource: new FakeSignalSource([
          { kind: "gap", capabilityId: undefined, score: 0.9, evidenceIds: ["e-1"] },
        ]),
      }),
    };
    service = new CapabilityService(options);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty events when ledger has no governance events", async () => {
    const result = await service.governance();
    expect(result.events).toEqual([]);
  });

  it("returns Object.freeze'd result (CAP-8 surface invariant)", async () => {
    const result = await service.governance();
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("projects proposal.submitted events with full payload (long-form type, ruling #1)", async () => {
    const proposed = await service.propose();
    const result = await service.governance();
    expect(result.events).toHaveLength(1);
    const ev = result.events[0]!;
    expect(ev.type).toBe("capability.governance.proposal.submitted");
    // CAP-10 widening — events array is the proposal+measurement union;
    // narrow by type before accessing `proposalId` (proposal-only field).
    expect((ev as { proposalId: string }).proposalId).toBe(proposed.proposalId);
    expect(ev.seq).toBeGreaterThan(0);
    expect(typeof ev.timestamp).toBe("string");
  });

  it("filters by capabilityId when supplied (returns empty for unrelated id)", async () => {
    await service.propose();
    const result = await service.governance("tool.unrelated-capability");
    expect(result.events).toEqual([]);
  });

  it("does not pick up non-governance events (prefix filter, ruling #1)", async () => {
    // Write a non-governance event directly to the EventLog.
    await eventLog.append({
      type: "session.started",
      actor: "system",
      sessionId: "sess-1",
      payload: { proposalId: "should-not-match" },
    });
    const result = await service.governance();
    expect(result.events).toEqual([]);
  });
});
