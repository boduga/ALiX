// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 7 — Platform composition root wires `proposalGenerator`.
 *
 * Brief Step 1 asserted `platform.service` was missing; bug 1 in the
 * triage corrected that to verifying the NEW wiring — that an injected
 * `proposalGenerator` flows through to the constructed `CapabilityService`.
 *
 * Observable behavior (per ruling #2 — service is the only public surface):
 *   - `platform.service` is a defined `CapabilityService` (already true
 *     from CAP-8).
 *   - When constructed with `proposalGenerator`, `service.propose()`
 *     succeeds (does not throw `CapabilityServiceNotImplementedError`).
 *   - Without `proposalGenerator`, `service.propose()` throws the
 *     stable `CapabilityServiceNotImplementedError` (CAP-8 ruling #4).
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
} from "../../src/capability/evolution/a7-proposals.js";
import { EventLog } from "../../src/events/event-log.js";
import { CapabilityServiceNotImplementedError } from "../../src/capability/errors/service-not-implemented.js";

class FakeSignalSource implements ProposalSignalSource {
  constructor(private readonly items: ReadonlyArray<CapabilityEvolutionSignal>) {}
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return this.items;
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
      signalSource: new FakeSignalSource([
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

  it("without proposalGenerator, service.propose() throws stable not-implemented error (CAP-8 ruling #4)", async () => {
    const platform = new CapabilityPlatform({ eventLog });
    await expect(platform.service.propose()).rejects.toBeInstanceOf(
      CapabilityServiceNotImplementedError,
    );
  });
});
