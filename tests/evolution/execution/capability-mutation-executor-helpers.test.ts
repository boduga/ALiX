import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bumpSemVer, applyCapabilityDefinitionPatch, toCapabilityMutationChange } from "../../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function def(overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: "tool.file.read",
    version: "1.0.0",
    kind: "operation" as const,
    title: "Read file",
    description: "read",
    tags: ["file"],
    category: "files",
    risk: "low" as const,
    requiredPermissions: ["operator"] as const,
    dependencies: [],
    bindings: [{ type: "tool" as const, id: "tool-1" }],
    ...overrides,
  };
}

describe("bumpSemVer", () => {
  it("bumps major", () => assert.equal(bumpSemVer("1.2.3", "major"), "2.0.0"));
  it("bumps minor", () => assert.equal(bumpSemVer("1.2.3", "minor"), "1.3.0"));
  it("bumps patch", () => assert.equal(bumpSemVer("1.2.3", "patch"), "1.2.4"));
  it("rejects non-semver", () => assert.throws(() => bumpSemVer("1.2", "patch")));
});

describe("applyCapabilityDefinitionPatch", () => {
  it("spreads patch over previous, stripping undefined", () => {
    const next = applyCapabilityDefinitionPatch(def(), { description: "new desc", tags: ["a", "b"] });
    assert.equal(next.description, "new desc");
    assert.deepEqual(next.tags, ["a", "b"]);
    assert.equal(next.id, "tool.file.read"); // immutable fields survive
  });
  it("never patches id/version/kind even if present in patch (defensive)", () => {
    const next = applyCapabilityDefinitionPatch(def(), { id: "evil", version: "9.9.9", kind: "query" } as never);
    assert.equal(next.id, "tool.file.read");
    assert.equal(next.version, "1.0.0");
  });
});

describe("toCapabilityMutationChange", () => {
  it("wraps a mutation as a plan change", () => {
    const change = toCapabilityMutationChange({ operation: "capability.create", definition: def(), initialLifecycle: "emerging" });
    assert.equal(change.operation, "capability.create");
    assert.equal(change.idempotent, false);
    assert.deepEqual(change.parameters, { operation: "capability.create", definition: def(), initialLifecycle: "emerging" });
  });
});
