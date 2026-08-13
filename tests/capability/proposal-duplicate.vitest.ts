import { describe, it, expect } from "vitest";
import { CapabilityProposalDuplicateError } from "../../src/capability/errors/proposal-duplicate.js";

describe("CapabilityProposalDuplicateError (CAP-9 ruling #21)", () => {
  it("carries the standard code", () => {
    const err = new CapabilityProposalDuplicateError("p-abc");
    expect(err.code).toBe("CAPABILITY_PROPOSAL_DUPLICATE");
  });

  it("includes proposalId in message", () => {
    const err = new CapabilityProposalDuplicateError("p-abc");
    expect(err.message).toContain("p-abc");
  });

  it("is an Error subclass with frozen instance", () => {
    const err = new CapabilityProposalDuplicateError("p-abc");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CapabilityProposalDuplicateError");
    expect(Object.isFrozen(err)).toBe(true);
  });
});
