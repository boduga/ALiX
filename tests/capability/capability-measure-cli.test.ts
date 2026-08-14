// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10 Task 9 — CLI command `alix capability measure <id@version> [--baseline <id>]`.
 *
 * Thin-adapter CLI test. Verifies the four exit-code paths from the
 * dispatcher contract:
 *   0 — success
 *   2 — usage error (missing id@version)
 *   3 — CapabilityMeasureFailedError (not exercised here — would require
 *       a service whose measurement engine throws; covered by the engine's
 *       own unit tests)
 *   4 — CapabilityMeasureInvalidTargetError (target absent in catalog)
 *   5 — service absent OR service.measure() not implemented
 *
 * The CLI is a thin adapter — no measurement logic, no projection logic,
 * no outcome computation (ruling #11). It MUST route through `service.measure()`
 * exclusively.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";
import { A5CapabilityMeasurement } from "../../src/evolution/observation/a5-capability-measurement.js";
import { ObservationEngine } from "../../src/evolution/observation/observation-engine.js";
import { EventLog } from "../../src/events/event-log.js";
import { capabilityMeasureCommand } from "../../src/cli/commands/capability-measure.js";
import type { ProposalSignalSink, ProposalSignalSource, CapabilityEvolutionSignal } from "../../src/capability/evolution/a7-proposals.js";

/** CAP-10.5 — sink+source fake for tests; implements both contracts so a
 *  single instance can stand in for either side of the channel. */
class FakeSignalChannel implements ProposalSignalSink, ProposalSignalSource {
  public readonly published: CapabilityEvolutionSignal[] = [];
  async publish(signal: CapabilityEvolutionSignal): Promise<void> {
    this.published.push(signal);
  }
  async signals(): Promise<ReadonlyArray<CapabilityEvolutionSignal>> {
    return [...this.published];
  }
}

describe("CLI: alix capability measure (CAP-10 ruling #11)", () => {
  it("exits 2 on usage error (missing id@version)", async () => {
    const exitCode = await capabilityMeasureCommand([], { service: undefined });
    assert.equal(exitCode, 2);
  });

  it("exits 5 when service is not supplied", async () => {
    const exitCode = await capabilityMeasureCommand(["x@1.0.0"], { service: undefined });
    assert.equal(exitCode, 5);
  });

  it("exits 4 when target absent in catalog — composition root auto-constructs A5 (CAP-10.5 ruling #R4)", async () => {
    // CAP-10.5 — composition root owns ProposalSignalChannel and auto-constructs
    // a real A5 bound to it when none is supplied. So the platform always has a
    // measurement engine; the no-engine stub is no longer reachable here.
    // The CLI now reaches the engine and surfaces CapabilityMeasureInvalidTargetError
    // (exit code 4) for the unknown id.
    const dir = mkdtempSync(join(tmpdir(), "cap10-cli-"));
    const eventLog = new EventLog(dir);
    await eventLog.init();
    const platform = new CapabilityPlatform({ catalogDir: dir, eventLog });
    const exitCode = await capabilityMeasureCommand(["x@1.0.0"], { service: platform.service });
    assert.equal(exitCode, 4);
    rmSync(dir, { recursive: true, force: true });
  });

  it("exits 4 when target absent in catalog (CapabilityMeasureInvalidTargetError)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cap10-cli-"));
    const eventLog = new EventLog(dir);
    await eventLog.init();
    const platform = new CapabilityPlatform({
      catalogDir: dir,
      eventLog,
      a5CapabilityMeasurement: new A5CapabilityMeasurement({
        observationEngine: new ObservationEngine(),
        signalSink: new FakeSignalChannel(),
        catalog: { get: () => undefined } as never,
        eventLog,
      }),
    });
    const exitCode = await capabilityMeasureCommand(["nonexistent@1.0.0"], { service: platform.service });
    assert.equal(exitCode, 4);
    rmSync(dir, { recursive: true, force: true });
  });
});
