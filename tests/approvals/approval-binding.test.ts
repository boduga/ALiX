import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  approvalExpiryState,
  computeBindingKey,
  computeOwnershipClaimsHash,
  normalizeApprovalRecord,
} from "../../src/governance/approvals/approval-binding.js";

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


describe("normalizeApprovalRecord authority expiry", () => {
  it("does not fabricate an expiry for a legacy record that omitted one", () => {
    const normalized = normalizeApprovalRecord({
      id: "legacy-no-expiry",
      status: "approved",
      bindingKey: "binding",
      capabilities: ["file.write"],
      createdAt: "2026-10-29T00:00:00.000Z",
    }, { defaultPolicyRevision: "legacy", now: new Date("2026-10-29T01:00:00.000Z") });
    assert.equal(normalized.expiresAt, "", "missing persisted expiry must remain invalid authority");
  });

  it("preserves an explicitly persisted expiry", () => {
    const normalized = normalizeApprovalRecord({
      id: "legacy-with-expiry",
      status: "approved",
      bindingKey: "binding",
      capabilities: ["file.write"],
      createdAt: "2026-10-29T00:00:00.000Z",
      expiresAt: "2026-10-29T02:00:00.000Z",
    }, { defaultPolicyRevision: "legacy", now: new Date("2026-10-29T01:00:00.000Z") });
    assert.equal(normalized.expiresAt, "2026-10-29T02:00:00.000Z");
  });

  it("preserves empty and unparsable expiry as invalid authority", () => {
    for (const expiresAt of ["", "not-a-date"]) {
      const normalized = normalizeApprovalRecord({
        id: `legacy-${expiresAt || "empty"}`,
        status: "approved",
        bindingKey: "binding",
        capabilities: ["file.write"],
        createdAt: "2026-10-29T00:00:00.000Z",
        expiresAt,
      }, { defaultPolicyRevision: "legacy", now: new Date("2026-10-29T01:00:00.000Z") });
      assert.equal(normalized.expiresAt, expiresAt);
      assert.equal(approvalExpiryState(normalized.expiresAt), "invalid");
    }
  });
});

describe("approvalExpiryState", () => {
  const now = new Date("2026-10-29T01:00:00.000Z");

  it("classifies only a non-empty parseable future timestamp as valid", () => {
    assert.equal(approvalExpiryState("2026-10-29T02:00:00.000Z", now), "valid");
    assert.equal(approvalExpiryState("2026-10-29T00:59:59.999Z", now), "expired");
  });

  it("treats missing, empty, and unparsable expiry as invalid, never unbounded", () => {
    for (const value of [undefined, null, "", "   ", "not-a-date", 0, {}]) {
      assert.equal(approvalExpiryState(value, now), "invalid", String(value));
    }
  });
});
