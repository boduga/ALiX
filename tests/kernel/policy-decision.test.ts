import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPermissivePolicyDecision, hashArguments, assertPolicyArgumentsMatch } from "../../src/kernel/policy-decision.js";

describe("PolicyDecision", () => {

  it("creates permissive allow decision", () => {
    const pd = createPermissivePolicyDecision({
      requestId: "req_1", capability: "filesystem.read",
      actorId: "file.read", args: { path: "/tmp/test.txt" },
    });
    assert.equal(pd.decision, "allow");
    assert.ok(pd.id.startsWith("pol_"));
  });

  it("hashes arguments deterministically", () => {
    const a = hashArguments({ path: "/tmp/a.txt" });
    const b = hashArguments({ path: "/tmp/a.txt" });
    assert.equal(a, b);
  });

  it("different args produce different hashes", () => {
    const a = hashArguments({ path: "/tmp/a.txt" });
    const b = hashArguments({ path: "/tmp/b.txt" });
    assert.notEqual(a, b);
  });

  it("sorted keys produce same hash regardless of insertion order", () => {
    const a = hashArguments({ z: 1, a: 2 });
    const b = hashArguments({ a: 2, z: 1 });
    assert.equal(a, b);
  });

  it("assertPolicyArgumentsMatch passes for matching args", () => {
    const pd = createPermissivePolicyDecision({
      requestId: "req_1", capability: "test",
      actorId: "test", args: { x: 1 },
    });
    assert.doesNotThrow(() => assertPolicyArgumentsMatch(pd, { x: 1 }));
  });

  it("assertPolicyArgumentsMatch throws for mismatched args", () => {
    const pd = createPermissivePolicyDecision({
      requestId: "req_1", capability: "test",
      actorId: "test", args: { x: 1 },
    });
    assert.throws(() => assertPolicyArgumentsMatch(pd, { x: 2 }));
  });
});
