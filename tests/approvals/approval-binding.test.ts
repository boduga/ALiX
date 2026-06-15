import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeBindingKey, computeOwnershipClaimsHash } from "../../src/approvals/approval-binding.js";

describe("computeBindingKey", () => {
  it("produces stable key for same inputs", () => {
    const a = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1" });
    const b = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1" });
    assert.equal(a, b);
  });

  it("changes when worker changes", () => {
    const a = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1", workerId: "w1" });
    const b = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1", workerId: "w2" });
    assert.notEqual(a, b);
  });

  it("changes when run changes", () => {
    const a = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1", coordinationRunId: "r1" });
    const b = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1", coordinationRunId: "r2" });
    assert.notEqual(a, b);
  });

  it("changes when policy revision changes", () => {
    const a = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1" });
    const b = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev2" });
    assert.notEqual(a, b);
  });

  it("changes when capabilities change", () => {
    const a = computeBindingKey({ capabilities: ["file.read"], requestFingerprint: "fp1", policyRevision: "rev1" });
    const b = computeBindingKey({ capabilities: ["file.write"], requestFingerprint: "fp1", policyRevision: "rev1" });
    assert.notEqual(a, b);
  });

  it("different ownership paths produce different keys", () => {
    const a = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1", ownershipClaims: [{ path: "src", recursive: true, sourcePattern: "src/**" }] });
    const b = computeBindingKey({ capabilities: ["file.create"], requestFingerprint: "fp1", policyRevision: "rev1", ownershipClaims: [{ path: "docs", recursive: true, sourcePattern: "docs/**" }] });
    assert.notEqual(a, b);
  });
});

describe("computeOwnershipClaimsHash", () => {
  it("produces same hash regardless of claim order", () => {
    const a = computeOwnershipClaimsHash([
      { path: "src", recursive: true, sourcePattern: "src/**" },
      { path: "docs", recursive: false, sourcePattern: "docs/*" },
    ]);
    const b = computeOwnershipClaimsHash([
      { path: "docs", recursive: false, sourcePattern: "docs/*" },
      { path: "src", recursive: true, sourcePattern: "src/**" },
    ]);
    assert.equal(a, b);
  });

  it("differs for different paths", () => {
    const a = computeOwnershipClaimsHash([{ path: "src", recursive: true }]);
    const b = computeOwnershipClaimsHash([{ path: "lib", recursive: true }]);
    assert.notEqual(a, b);
  });
});
