import { describe, it, expect } from "vitest";
import { CapabilityProposalStaleError } from "../../src/capability/errors/proposal-stale.js";

describe("CapabilityProposalStaleError (CAP-9 ruling #17)", () => {
  it("carries the standard code", () => {
    const err = new CapabilityProposalStaleError("p-abc", "tool.file.read", "1.0.0", "1.5.0");
    expect(err.code).toBe("CAPABILITY_PROPOSAL_STALE");
  });

  it("includes proposalId + source pin + current version in message", () => {
    const err = new CapabilityProposalStaleError("p-abc", "tool.file.read", "1.0.0", "1.5.0");
    expect(err.message).toContain("p-abc");
    expect(err.message).toContain("tool.file.read");
    expect(err.message).toContain("1.0.0");
    expect(err.message).toContain("1.5.0");
  });

  it("is an Error subclass with frozen instance", () => {
    const err = new CapabilityProposalStaleError("p-abc", "tool.file.read", "1.0.0", "1.5.0");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CapabilityProposalStaleError");
    expect(Object.isFrozen(err)).toBe(true);
  });

  it("handles absent current version (capability removed)", () => {
    const err = new CapabilityProposalStaleError("p-abc", "tool.file.read", "1.0.0", undefined);
    expect(err.message).toContain("undefined");
  });
});
