// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 7 — Platform composition root wires `proposalGenerator`.
 * CAP-10.5 — Platform composition root also owns the sole ProposalSignalChannel
 *            instance and auto-constructs A7 bound to the channel.
 *
 * Brief Step 1 asserted `platform.service` was missing; bug 1 in the
 * triage corrected that to verifying the NEW wiring — that an injected
 * `proposalGenerator` flows through to the constructed `CapabilityService`.
 *
 * Observable behavior (per ruling #2 — service is the only public surface):
 *   - `platform.service` is a defined `CapabilityService` (already true
 *     from CAP-8).
 *   - When constructed with `proposalGenerator`, `service.propose()`
 *     succeeds (does not throw).
 *   - Without `proposalGenerator`, the composition root (CAP-10.5) auto-constructs
 *     an A7ProposalGenerator bound to the empty ProposalSignalChannel —
 *     `service.propose()` surfaces the stable A7-zero-candidates error.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";
import { A7ProposalGenerator } from "../../src/capability/evolution/a7-proposals.js";
import type {
  CapabilityEvolutionSignal,
  ProposalSignalSource,
  ProposalSignalSink,
} from "../../src/capability/evolution/a7-proposals.js";
import { EventLog } from "../../src/events/event-log.js";

class FakeSignalChannel implements ProposalSignalSink, ProposalSignalSource {
  constructor(private readonly seedSignals: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async publish(_signal: CapabilityEvolutionSignal): Promise<void> {
    // no-op — sink side unused in these tests (channel wired by composition root)
  }
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.seedSignals;
  }
}

describe("CapabilityPlatform — CAP-9 wiring (proposalGenerator)", () => {
  let dir: string;
  let eventLog: EventLog;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-plat-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("constructs without proposalGenerator (existing CAP-8 contract preserved)", () => {
    const platform = new CapabilityPlatform({ eventLog });
    expect(platform).toBeDefined();
    expect(platform.service).toBeDefined();
  });

  it("exposes a CapabilityService instance reachable via platform.service", () => {
    const platform = new CapabilityPlatform({ eventLog });
    expect(platform.service).toBeDefined();
  });

  it("wires proposalGenerator through to the service (observable via propose())", async () => {
    const generator = new A7ProposalGenerator({
      signalSource: new FakeSignalChannel([
        { kind: "gap", capabilityId: undefined, score: 0.9, evidenceIds: ["e-1"] },
      ]),
    });
    const platform = new CapabilityPlatform({ eventLog, proposalGenerator: generator });
    expect(platform.service).toBeDefined();

    // If proposalGenerator did NOT flow through, the service would throw
    // CapabilityServiceNotImplementedError (CAP-8 ruling #4). If it did
    // flow through, propose() persists and returns a SHA-256 proposalId.
    const result = await platform.service.propose();
    expect(result.proposalId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.status).toBe("pending");
    expect(result.candidate.target.kind).toBe("capability");
  });

  it("auto-constructs A7 with channel signalSource when proposalGenerator not provided (CAP-10.5 ruling #R4); empty channel surfaces stable A7-zero-candidates error", async () => {
    const platform = new CapabilityPlatform({ eventLog });
    // CAP-10.5 — composition root constructs an A7ProposalGenerator bound to the
    // ProposalSignalChannel. Empty channel → A7 produces no candidates → the
    // service surfaces its stable "no candidates" error (no fallback to the
    // CAP-8 not-implemented stub).
    await expect(platform.service.propose()).rejects.toThrow(
      /A7 produced no candidates/,
    );
  });
});
