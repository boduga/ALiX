// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-10.5 — Emission-sentinel (6-axis), behavioral edition (#697).
 *
 * Locks the M1 evolution-signal emission seam through the real interfaces:
 * - A5 publishes through the write-side contract only (no read-back).
 * - ProposalSignalChannel exposes only `publish` (write) and `signals`
 *   (read); the buffer is unobservable except through a defensive copy.
 * - The channel is composed exactly once in `src/`.
 * - The `signals_unpublished` event type is a live member of the
 *   measurement event vocabulary.
 * - The default decider's ineffective→underperformer behavior is pinned
 *   by tests/capability/a5-capability-measurement.vitest.ts (not repeated
 *   here — no source-text assertions for behaviorally covered claims).
 *
 * @module tests/capability/cap-10-5-emission-sentinel
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { globSync } from "glob";
import { codeOnly } from "../helpers/import-graph.js";
import { ProposalSignalChannel } from "../../src/capability/evolution/proposal-signal-channel.js";
import {
  CAPABILITY_MEASUREMENT_EVENT_TYPES,
  isMeasurementEventType,
} from "../../src/capability/measurement/measurement-event-types.js";
import type { CapabilityEvolutionSignal } from "../../src/capability/evolution/proposals.js";

const SRC = resolve(__dirname, "../../src");

function signal(): CapabilityEvolutionSignal {
  return { kind: "underperformer", capabilityId: "a@1", score: 0.5, evidenceIds: ["e1"] };
}

describe("CAP-10.5 emission-sentinel (6-axis)", () => {
  it("axis 1: A5 exposes no read-back surface (sink-only composition)", async () => {
    // The composition-root channel is the only ProposalSignalSource in
    // the write path: A5 receives a sink and never observes the buffer.
    // Behaviorally: a published signal is observable only through an
    // explicit signals() read — there is no push, subscription, or event
    // surface on the write side. (TypeScript `private` is compile-time
    // only, so the pin is on observable behavior, not field hiding —
    // buffer isolation itself is pinned by axis 3's copy test.)
    const channel = new ProposalSignalChannel();
    await channel.publish(signal());
    const exposed = channel as unknown as Record<string, unknown>;
    for (const name of ["subscribe", "onSignal", "on", "addListener", "events"]) {
      expect(exposed[name]).toBeUndefined();
    }
    expect(await channel.signals()).toHaveLength(1);
  });

  it("axis 2: channel API exposes only publish (write) and signals (read)", async () => {
    const channel = new ProposalSignalChannel();
    expect(typeof channel.publish).toBe("function");
    expect(typeof channel.signals).toBe("function");
    // No mutator escape hatches on the instance or its prototype.
    for (const name of ["reset", "clear", "drain", "consume"]) {
      expect((channel as unknown as Record<string, unknown>)[name]).toBeUndefined();
    }
    // Roundtrip through the real contracts.
    await channel.publish(signal());
    const seen = await channel.signals();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe("underperformer");
  });

  it("axis 3: the buffer is private (defensive copy on read)", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish(signal());
    const first = await channel.signals();
    (first as CapabilityEvolutionSignal[]).length = 0;
    (first as CapabilityEvolutionSignal[]).push(signal());
    // Internal buffer unaffected by mutating the returned copy.
    expect(await channel.signals()).toHaveLength(1);
  });

  it("axis 4: ProposalSignalChannel is composed exactly once in src/", () => {
    // Whole-tree census (not a hardcoded file list): any second
    // composition root breaks the sole-instance invariant.
    const files = globSync("**/*.ts", { cwd: SRC, ignore: ["**/node_modules/**"] });
    const sites: string[] = [];
    for (const rel of files) {
      const code = codeOnly(readFileSync(resolve(SRC, rel), "utf8"));
      const found = code.match(/new\s+ProposalSignalChannel\s*\(/g) ?? [];
      for (const _ of found) sites.push(rel);
    }
    expect(sites).toEqual(["capability/platform.ts"]);
  });

  it("axis 5: signals_unpublished is a live measurement event type", () => {
    expect(CAPABILITY_MEASUREMENT_EVENT_TYPES).toContain(
      "capability.governance.measurement.signals_unpublished",
    );
    expect(isMeasurementEventType("capability.governance.measurement.signals_unpublished")).toBe(true);
    expect(isMeasurementEventType("capability.governance.measurement.nope")).toBe(false);
  });

  it("axis 6: ineffective measurement publishes exactly one underperformer", async () => {
    // The default decider's ineffective→underperformer rule (ruling #R3),
    // exercised through the real CapabilityMeasurement with in-memory
    // doubles. The full decider matrix lives in
    // tests/capability/a5-capability-measurement.vitest.ts; this axis pins
    // the critical path so the emission seam can never silently change it.
    const { CapabilityMeasurement } = await import(
      "../../src/evolution/observation/capability-measurement.js"
    );
    const published: CapabilityEvolutionSignal[] = [];
    const measurement = new CapabilityMeasurement({
      observationEngine: {
        observe: async () => ({
          observationId: "obs-post",
          status: "fail",
          confidence: 0.8,
          observedAt: new Date().toISOString(),
          evidence: {},
        }),
      } as never,
      signalSink: {
        publish: async (signal: CapabilityEvolutionSignal) => {
          published.push(signal);
        },
      },
      catalog: { get: (id: string) => ({ id, bindings: [{ type: "native" }] }) } as never,
      eventLog: { append: async () => ({ seq: 1 }) } as never,
    });
    const out = await measurement.measureCapability({ capabilityId: "cap-x", version: "1.0.0" });
    expect(out.kind).toBe("ineffective");
    expect(published).toHaveLength(1);
    expect(published[0]!.kind).toBe("underperformer");
  });
});
