// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { ProposalSignalChannel } from "../../src/capability/evolution/proposal-signal-channel.js";
import type {
  ProposalSignalSink,
  ProposalSignalSource,
  CapabilityEvolutionSignal,
} from "../../src/capability/evolution/proposals.js";

const sig = (kind: "gap" | "underperformer"): CapabilityEvolutionSignal =>
  kind === "gap"
    ? { kind: "gap", score: 0.6, evidenceIds: [] }
    : { kind: "underperformer", capabilityId: "cap@1", score: 0.4, evidenceIds: [] };

describe("ProposalSignalChannel (CAP-10.5 ruling #R4)", () => {
  it("publish then signals returns the published signal", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish(sig("underperformer"));
    const out = await channel.signals();
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("underperformer");
  });

  it("accumulate multiple publishes", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish(sig("underperformer"));
    await channel.publish(sig("gap"));
    const out = await channel.signals();
    expect(out.map((s) => s.kind).sort()).toEqual(["gap", "underperformer"]);
  });

  it("signals() is non-destructive (idempotent reads)", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish(sig("underperformer"));
    const first = await channel.signals();
    const second = await channel.signals();
    expect(second).toHaveLength(1);
    expect(first).toEqual(second);
  });

  it("signals() returns a defensive copy", async () => {
    const channel = new ProposalSignalChannel();
    await channel.publish(sig("underperformer"));
    const out = await channel.signals();
    // Mutating the returned array must not affect internal state.
    (out as CapabilityEvolutionSignal[]).length = 0;
    const out2 = await channel.signals();
    expect(out2).toHaveLength(1);
  });

  it("implements both ProposalSignalSink and ProposalSignalSource (compile-time)", () => {
    const channel = new ProposalSignalChannel();
    const asSink: ProposalSignalSink = channel;
    const asSource: ProposalSignalSource = channel;
    expect(asSink).toBeDefined();
    expect(asSource).toBeDefined();
  });

  it("fresh channel returns empty signals", async () => {
    const channel = new ProposalSignalChannel();
    const out = await channel.signals();
    expect(out).toEqual([]);
  });
});