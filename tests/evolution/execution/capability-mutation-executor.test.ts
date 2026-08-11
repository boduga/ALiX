import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityCatalog } from "../../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { CapabilityMutationExecutor, createCapabilityRollbackResolver, type CapabilityPreState } from "../../../src/evolution/execution/capability-mutation-executor.js";
import { nextDefinitionForUpdate } from "../../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";
import type { CapabilityCreateMutation } from "../../../src/capability/mutation-contract.js";
import { classifyUpdateBump, validateConsolidateMerge } from "../../../src/capability/mutation-contract.js";

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
    const beforeRegistry = JSON.stringify(registry.listLifecycleStates());
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: { ...makeCreate({ definition: def({ id: "tool.file.write" }) }) }, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /record failed/);
    assert.equal(JSON.stringify(catalog.list()), before); // byte-identical catalog
    assert.equal(JSON.stringify(registry.listLifecycleStates()), beforeRegistry); // registry projection unchanged
  });

  it("returns immutable output (no aliasing to live catalog state)", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: { ...makeCreate({ definition: def({ id: "tool.file.append" }) }) }, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    const out = res.output.result as { mutation: { definition: CapabilityDefinition } };
    out.mutation.definition.title = "MUTATED"; // must not affect the catalog
    assert.notEqual(catalog.get("tool.file.append")!.title, "MUTATED");
  });

  it("result.preState retains Map fields and post.published is a faithful snapshot", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: { ...makeCreate({ definition: def({ id: "tool.file.snap" }) }) }, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    const result = res.output.result as { preState: CapabilityPreState; post: { published: CapabilityDefinition } };
    // Maps must survive the immutable-artifact copy (structuredClone, not JSON).
    assert.ok(result.preState.bindings instanceof Map);
    assert.ok(result.preState.lifecycle instanceof Map);
    assert.ok(result.preState.availability instanceof Map);
    // Mutating the returned snapshot's definitions must not alias the catalog.
    result.preState.definitions.push({ ...def({ id: "ghost" }) });
    assert.equal(catalog.has("ghost"), false);
    // post.published is a faithful snapshot of the live publication, not a reference.
    const live = catalog.get("tool.file.snap")!;
    assert.deepEqual(result.post.published, live);
    result.post.published.title = "MUTATED";
    assert.equal(catalog.get("tool.file.snap")!.title, "Read file");
  });

  it("nested undefined in argsSchema passes validation but does not break artifactId", async () => {
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.create", parameters: { ...makeCreate({ definition: def({ id: "tool.file.undef", argsSchema: { type: "object", properties: { a: undefined } } }) }) }, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true); // canonicalStringify must not throw on the sanitized copy
    const artifactId = (res.output.result as { artifactId: string }).artifactId;
    assert.equal(typeof artifactId, "string");
    assert.equal(artifactId.length, 64); // sha256 hex
  });

  it("createRollbackResolver emits restore_create + restore_transition", () => {
    const resolver = createCapabilityRollbackResolver();
    // Realistic create step: parameters IS the mutation (toCapabilityMutationChange),
    // so the capability id must be resolved from parameters.definition.id.
    const createStep = { stepId: "s1", operation: "capability.create", parameters: { ...makeCreate() }, idempotent: false, preconditions: {}, postconditions: {} };
    const rbCreate = resolver.createRollback(createStep);
    assert.equal(rbCreate.operation, "capability.restore_create");
    assert.equal(rbCreate.safe, true);
    assert.equal(rbCreate.rollbackType, "automatic");
    assert.equal(rbCreate.parameters.capabilityId, "tool.file.read"); // resolved from definition.id
    // A top-level parameters.capabilityId is honored first (passthrough).
    const directStep = { stepId: "s1b", operation: "capability.create", parameters: { capabilityId: "tool.file.read" }, idempotent: false, preconditions: {}, postconditions: {} };
    assert.equal(resolver.createRollback(directStep).parameters.capabilityId, "tool.file.read");
    const transStep = { stepId: "s2", operation: "capability.transition", parameters: { capabilityId: "tool.file.read" }, idempotent: true, preconditions: {}, postconditions: {} };
    const rbTrans = resolver.createRollback(transStep);
    assert.equal(rbTrans.operation, "capability.restore_transition");
    assert.equal(rbTrans.safe, true);
    assert.equal(rbTrans.parameters.capabilityId, "tool.file.read");
  });
});

describe("CapabilityMutationExecutor — update", () => {
  let dir: string; let catalog: CapabilityCatalog; let registry: CapabilityRegistry;
  before(() => { dir = mkdtempSync(join(tmpdir(), "cap6-upd-")); catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir })); registry = new CapabilityRegistry(catalog); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  async function seed() {
    // `before` runs once per suite (not per test), so reset the shared id to a
    // clean single publication before re-seeding — otherwise a prior test's
    // new id@version collides on "already exists". Behavior-identical to a
    // fresh catalog per test: each seed leaves exactly tool.file.read@1.0.0.
    catalog.remove("tool.file.read");
    catalog.register(def(), def().bindings[0]);
    registry.reload();
  }

  it("publishes a new immutable id@version with the classified bump", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "updated desc" } };
    const step = { stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} };
    const res = await executor.executeStep(step, {});
    assert.equal(res.success, true);
    const cur = catalog.get("tool.file.read")!;
    assert.equal(cur.version, "1.0.1"); // PATCH bump
    assert.equal(cur.description, "updated desc");
    // Immutability: the old publication is still in the catalog
    const all = catalog.list().filter((d) => d.id === "tool.file.read");
    assert.equal(all.length, 2);
    assert.ok(all.some((d) => d.version === "1.0.0" && d.description === "read"));
  });

  it("classifies a binding change as MAJOR and bumps major", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { bindings: [{ type: "mcp" as const, id: "mcp-2" }] } };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    assert.equal(catalog.get("tool.file.read")!.version, "2.0.0");
  });

  it("rejects a stale sourceVersion (actual !== sourceVersion)", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "0.5.0", patch: { description: "x" } };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /sourceVersion/);
    assert.equal(catalog.get("tool.file.read")!.version, "1.0.0"); // unchanged
  });

  it("rejects a patch that touches immutable id/version/kind", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { id: "tool.evil", version: "9.9.9", kind: "query" } as never };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /immutable/);
  });

  it("rejects a no-op update (#480: failed update = no-op, no redundant publication)", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "read" } }; // identical value
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /no change/);
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.read").length, 1);
  });

  it("record-sink failure after update → byte-identical restore", async () => {
    await seed();
    const executor = new CapabilityMutationExecutor({ catalog, registry, record: { record: async (): Promise<void> => { throw new Error("boom"); } } });
    const before = JSON.stringify(catalog.list());
    const mutation = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "x" } };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.update", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.equal(JSON.stringify(catalog.list()), before);
  });
});

describe("nextDefinitionForUpdate", () => {
  it("applies patch and classifies bump", () => {
    const next = nextDefinitionForUpdate(def(), { description: "new" });
    assert.equal(next.version, "1.0.1");
    assert.equal(next.description, "new");
    assert.equal(next.id, "tool.file.read");
  });
  it("throws when the patched result is not a valid definition", () => {
    assert.throws(() => nextDefinitionForUpdate(def(), { bindings: [] }), /binding/);
  });
});

describe("CapabilityMutationExecutor — transition", () => {
  let dir: string; let catalog: CapabilityCatalog; let registry: CapabilityRegistry;
  before(() => { dir = mkdtempSync(join(tmpdir(), "cap6-tr-")); catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir })); registry = new CapabilityRegistry(catalog); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  async function seedActive() {
    // `before` runs once per suite (not per test), so reset the shared id to a
    // clean single publication before re-seeding — otherwise a prior test's
    // publication collides on "already exists". Behavior-identical to a fresh
    // catalog per test: each seed leaves exactly tool.file.read@1.0.0 active.
    if (catalog.has("tool.file.read")) catalog.remove("tool.file.read");
    catalog.register(def(), def().bindings[0]);
    registry.reload();
    registry.setLifecycleState("tool.file.read", "active");
  }

  it("applies a legal transition (active → mature)", async () => {
    await seedActive();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.transition" as const, capabilityId: "tool.file.read", from: "active" as const, to: "mature" as const };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.transition", parameters: mutation, idempotent: true, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    assert.equal(registry.getLifecycleState("tool.file.read"), "mature");
  });

  it("refuses a stale decision (actual !== from)", async () => {
    await seedActive();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    // declining → deprecated is a #481-legal pair, but the actual lifecycle
    // state is "active", so the stale-decision precondition must fire.
    const mutation = { operation: "capability.transition" as const, capabilityId: "tool.file.read", from: "declining" as const, to: "deprecated" as const };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.transition", parameters: mutation, idempotent: true, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /actual 'active' !== expected 'declining'/);
    assert.match(res.error ?? "", /#34/);
    assert.equal(registry.getLifecycleState("tool.file.read"), "active"); // unchanged
  });

  it("does not mutate the catalog (lifecycle is registry state)", async () => {
    await seedActive();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = { operation: "capability.transition" as const, capabilityId: "tool.file.read", from: "active" as const, to: "declining" as const };
    const before = JSON.stringify(catalog.list());
    await executor.executeStep({ stepId: "s1", operation: "capability.transition", parameters: mutation, idempotent: true, preconditions: {}, postconditions: {} }, {});
    assert.equal(JSON.stringify(catalog.list()), before);
  });

  it("record-sink failure after transition → byte-identical restore (lifecycle set back)", async () => {
    await seedActive();
    const before = JSON.stringify(catalog.list());
    const executor = new CapabilityMutationExecutor({ catalog, registry, record: { record: async (): Promise<void> => { throw new Error("boom"); } } });
    const mutation = { operation: "capability.transition" as const, capabilityId: "tool.file.read", from: "active" as const, to: "mature" as const };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.transition", parameters: mutation, idempotent: true, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /record failed/);
    // The transitioned lifecycle must be restored to its pre-transition state
    // (the lifecycle-SET branch of restorePreState), not left "mature".
    assert.equal(registry.getLifecycleState("tool.file.read"), "active");
    // Catalog untouched — lifecycle is registry state, so no publication change.
    assert.equal(JSON.stringify(catalog.list()), before);
  });
});

describe("CapabilityMutationExecutor — consolidate", () => {
  let dir: string; let catalog: CapabilityCatalog; let registry: CapabilityRegistry;
  before(() => { dir = mkdtempSync(join(tmpdir(), "cap6-co-")); catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir })); registry = new CapabilityRegistry(catalog); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const merged = (id: string, overrides: Partial<CapabilityDefinition> = {}) => def({ id, title: `Merged ${id}`, description: "merged", requiredPermissions: ["operator"], dependencies: [], ...overrides });

  async function seedSources() {
    // `before` runs once per suite (not per test), so reset all shared ids to a
    // clean state before re-seeding — otherwise a prior test's target
    // publication (tool.file.ab) or lifecycle state collides. Behavior-identical
    // to a fresh catalog per test: each seed leaves exactly a + b registered.
    for (const id of ["tool.file.a", "tool.file.b", "tool.file.ab"]) {
      if (catalog.has(id)) catalog.remove(id);
    }
    catalog.register(merged("tool.file.a", { bindings: [{ type: "tool", id: "ta" }] }), { type: "tool", id: "ta" });
    catalog.register(merged("tool.file.b", { bindings: [{ type: "tool", id: "tb" }] }), { type: "tool", id: "tb" });
    registry.reload();
  }

  it("publishes the approved target definition and deprecates sources (deprecate disposition)", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: ["tool.file.a", "tool.file.b"] }),
      sourceDisposition: "deprecate" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    // Real definition mutation: target published, not just deprecate-related
    const target = catalog.get("tool.file.ab")!;
    assert.equal(target.title, "Merged tool.file.ab");
    assert.equal(target.version, "1.0.0");
    // Sources deprecated (still present)
    assert.equal(registry.getLifecycleState("tool.file.a"), "deprecated");
    assert.equal(registry.getLifecycleState("tool.file.b"), "deprecated");
  });

  it("removes sources when disposition is 'remove'", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: ["tool.file.a", "tool.file.b"] }),
      sourceDisposition: "remove" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    assert.equal(catalog.has("tool.file.a"), false);
    assert.equal(catalog.has("tool.file.b"), false);
  });

  it("rejects a merge that violates the #477 conservative rules (source-aware)", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: [], requiredPermissions: [] }), // missing the sources' union required permission "operator"
      sourceDisposition: "deprecate" as const,
    };
    // Sanity: the CAP-5 validator rejects it too (executor must route through it)
    const srcs = mutation.sources.map((id) => catalog.get(id)!).filter(Boolean);
    assert.equal(validateConsolidateMerge(mutation, srcs).valid, false);
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.ok(!catalog.has("tool.file.ab")); // nothing mutated
  });

  it("rejects a definition whose id does not match the target", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.WRONG", { version: "1.0.0", dependencies: ["tool.file.a", "tool.file.b"] }),
      sourceDisposition: "deprecate" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /id.*target|target.*id/);
  });

  it("existing target: rejects a proposed version that does not advance the current target (user-refined #479)", async () => {
    await seedSources();
    catalog.register(merged("tool.file.ab", { version: "1.0.0", bindings: [{ type: "tool", id: "tab" }] }), { type: "tool", id: "tab" });
    registry.reload();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: ["tool.file.a", "tool.file.b"] }), // same version as current target
      sourceDisposition: "deprecate" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /advance|higher|current/);
    // Nothing re-registered/overwritten: still exactly one tool.file.ab publication at 1.0.0
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.ab").length, 1);
  });

  it("existing target: advancing version publishes a new immutable publication", async () => {
    await seedSources();
    catalog.register(merged("tool.file.ab", { version: "1.0.0", bindings: [{ type: "tool", id: "tab" }] }), { type: "tool", id: "tab" });
    registry.reload();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.1.0", dependencies: ["tool.file.a", "tool.file.b"] }), // advances to 1.1.0
      sourceDisposition: "deprecate" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, true);
    assert.equal(catalog.get("tool.file.ab")!.version, "1.1.0");
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.ab").length, 2); // old + new, both immutable
  });

  it("rejects a source that does not resolve", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.missing"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: ["tool.file.a"] }),
      sourceDisposition: "deprecate" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.match(res.error ?? "", /does not resolve/);
  });

  it("record-sink failure after consolidate → byte-identical restore", async () => {
    await seedSources();
    const executor = new CapabilityMutationExecutor({ catalog, registry, record: { record: async (): Promise<void> => { throw new Error("boom"); } } });
    const before = JSON.stringify(catalog.list());
    const beforeLifecycleA = registry.getLifecycleState("tool.file.a");
    const mutation = {
      operation: "capability.consolidate" as const,
      sources: ["tool.file.a", "tool.file.b"],
      target: "tool.file.ab",
      definition: merged("tool.file.ab", { version: "1.0.0", dependencies: ["tool.file.a", "tool.file.b"] }),
      sourceDisposition: "remove" as const,
    };
    const res = await executor.executeStep({ stepId: "s1", operation: "capability.consolidate", parameters: mutation, idempotent: false, preconditions: {}, postconditions: {} }, {});
    assert.equal(res.success, false);
    assert.equal(JSON.stringify(catalog.list()), before);
    // Lifecycle also restored to its pre-mutation state (sources are "emerging"
    // in a fresh suite; the assertion is relative so it is ordering-independent).
    assert.equal(registry.getLifecycleState("tool.file.a"), beforeLifecycleA);
  });
});
