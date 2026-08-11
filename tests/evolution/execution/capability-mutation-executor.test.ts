import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityCatalog } from "../../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { CapabilityMutationExecutor, createCapabilityRollbackResolver } from "../../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";
import type { CapabilityCreateMutation } from "../../../src/capability/mutation-contract.js";

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

function makeCreate(overrides: Partial<CapabilityCreateMutation> = {}): CapabilityCreateMutation {
  return { operation: "capability.create", definition: def(), initialLifecycle: "emerging", ...overrides };
}

describe("CapabilityMutationExecutor — create", () => {
  let dir: string;
  let catalog: CapabilityCatalog;
  let registry: CapabilityRegistry;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "cap6-"));
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("applies a complete authored definition (no placeholder)", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const step = { stepId: "s1", operation: "capability.create", parameters: { ...makeCreate() }, idempotent: false, preconditions: {}, postconditions: {} };
    const res = await executor.executeStep(step, {});
    assert.equal(res.success, true);
    const published = catalog.get("tool.file.read")!;
    assert.equal(published.version, "1.0.0");
    assert.equal(published.title, "Read file"); // complete definition, not a placeholder
    assert.equal(registry.getLifecycleState("tool.file.read"), "emerging"); // #481
  });

  it("rejects a duplicate id (REJECT → nothing mutated)", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: { ...makeCreate() }, idempotent: false, preconditions: {}, postconditions: {} }, {});
    const res = await executor.executeStep({ stepId: "s2", operation: "capability.create", parameters: { ...makeCreate() }, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /already exists/);
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.read").length, 1); // unchanged
  });

  it("invalid mutation shape → rejected without touching the catalog", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: { operation: "capability.create", definition: { ...def({ id: "tool.file.invalid" }), version: "not-semver" } }, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.equal(catalog.has("tool.file.invalid"), false);
  });

  it("record-sink failure → restores pre-state byte-identical", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry, record: { record: async (): Promise<void> => { throw new Error("record failed"); } } });
    const before = JSON.stringify(catalog.list());
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: { ...makeCreate({ definition: def({ id: "tool.file.write" }) }) }, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /record failed/);
    assert.equal(JSON.stringify(catalog.list()), before); // byte-identical
  });

  it("returns immutable output (no aliasing to live catalog state)", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: { ...makeCreate({ definition: def({ id: "tool.file.append" }) }) }, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    const out = res.output.result as { mutation: { definition: CapabilityDefinition } };
    out.mutation.definition.title = "MUTATED"; // must not affect the catalog
    assert.notEqual(catalog.get("tool.file.append")!.title, "MUTATED");
  });

  it("createRollbackResolver emits restore_create + restore_transition", () => {
    const resolver = createCapabilityRollbackResolver();
    const createStep = { stepId: "s1", operation: "capability.create", parameters: { capabilityId: "tool.file.read" }, idempotent: false, preconditions: {}, postconditions: {} };
    const rbCreate = resolver.createRollback(createStep);
    assert.equal(rbCreate.operation, "capability.restore_create");
    assert.equal(rbCreate.safe, true);
    assert.equal(rbCreate.rollbackType, "automatic");
    const transStep = { stepId: "s2", operation: "capability.transition", parameters: { capabilityId: "tool.file.read" }, idempotent: true, preconditions: {}, postconditions: {} };
    const rbTrans = resolver.createRollback(transStep);
    assert.equal(rbTrans.operation, "capability.restore_transition");
    assert.equal(rbTrans.safe, true);
  });
});
