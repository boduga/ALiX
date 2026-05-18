import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OwnershipRegistry } from "../../src/agents/ownership-registry.js";
import { validateResult } from "../../src/agents/result-contract-validator.js";

describe("OwnershipRegistry", () => {
  const registry = new OwnershipRegistry();

  it("claims paths for a subagent", () => {
    registry.claim("sa-1", ["src/a.ts", "src/b.ts"]);
    assert.equal(registry.count(), 2);
    assert.ok(registry.isOwner("sa-1", "src/a.ts"));
    assert.ok(registry.isOwner("sa-1", "src/b.ts"));
  });

  it("rejects overlapping claims", () => {
    assert.throws(() => registry.claim("sa-2", ["src/a.ts"]), /overlapping/i);
  });

  it("releases paths on subagent exit", () => {
    registry.release("sa-1");
    assert.equal(registry.count(), 0);
    assert.ok(!registry.isOwner("sa-1", "src/a.ts"));
  });

  it("returns owned paths for a subagent", () => {
    registry.claim("sa-3", ["src/x.ts", "src/y.ts"]);
    const paths = registry.ownedBy("sa-3");
    assert.equal(paths.length, 2);
    assert.ok(paths.includes("src/x.ts"));
    registry.release("sa-3");
  });

  it("allows re-claim after release", () => {
    registry.release("sa-3");
    registry.claim("sa-4", ["src/a.ts"]);
    assert.ok(registry.isOwner("sa-4", "src/a.ts"));
    registry.release("sa-4");
  });
});

describe("validateResult", () => {
  it("returns valid when no expected output", () => {
    const result = { id: "t1", role: "explorer" as const, status: "success" as const, findings: [{ type: "summary" as const, content: "Found X", confidence: "high" as const, refs: [] }], events: [] };
    const v = validateResult(result);
    assert.equal(v.valid, true);
    assert.equal(v.warnings.length, 0);
  });

  it("warns when expected output not found", () => {
    const result = { id: "t1", role: "explorer" as const, status: "success" as const, findings: [{ type: "summary" as const, content: "No matches", confidence: "medium" as const, refs: [] }], events: [] };
    const v = validateResult(result, "specific keyword");
    assert.equal(v.valid, false);
    assert.ok(v.warnings[0].includes("specific keyword"));
  });

  it("warns on success with empty findings", () => {
    const result = { id: "t1", role: "explorer" as const, status: "success" as const, findings: [], events: [] };
    const v = validateResult(result);
    assert.equal(v.valid, false);
    assert.ok(v.warnings.some(w => w.includes("no findings")));
  });

  it("skips expected check on failed result", () => {
    const result = { id: "t1", role: "explorer" as const, status: "failed" as const, findings: [], events: [], error: "timeout" };
    const v = validateResult(result, "anything");
    assert.equal(v.valid, true); // no warnings on failure
  });
});