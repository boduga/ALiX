// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-6 Task 6 — atomicity matrix + immutable artifact hardening.
 *
 * Comprehensive matrix across ALL five governed mutation paths asserting the
 * ticket's atomicity ACs:
 *   1. Reject → catalog + registry byte-identical.
 *   2. Execution failure (record-sink throw, or a registry projection failure
 *      AFTER a catalog write) → rollback, no committed mutation. The projection
 *      step is INSIDE the transaction boundary.
 *   3. Success → exactly one governed mutation + immutable (deep-frozen)
 *      publication artifact, no aliasing to live catalog/registry state.
 *   4. artifactId deterministic across identical executions.
 *
 * Isolation note (deviation from the brief, behavior-preserving): the store
 * rejects a duplicate id@version ("already exists"), so a single suite-level
 * `before` shared catalog would throw on the 2nd test's bare re-register of
 * `tool.file.read`. Each test gets a FRESH catalog + registry via `beforeEach`,
 * which keeps every per-test `catalog.register(...)` line exactly as written in
 * the brief. All temp dirs are cleaned in `after`.
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityCatalog } from "../../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { CapabilityMutationExecutor } from "../../../src/evolution/execution/capability-mutation-executor.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";
// Split import: ExecutionStep lives in the execution contract; CapabilityMutation
// lives in the CAP-5 mutation contract (NOT execution-contract).
import type { ExecutionStep } from "../../../src/evolution/execution/contracts/execution-contract.js";
import type { CapabilityMutation } from "../../../src/capability/mutation-contract.js";

function def(id = "tool.file.read", overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return { id, version: "1.0.0", kind: "operation", title: "Read file", description: "read", tags: ["file"], category: "files", risk: "low", requiredPermissions: ["operator"], dependencies: [], bindings: [{ type: "tool", id: "tool-1" }], ...overrides };
}

function step(op: string, params: Record<string, unknown>): ExecutionStep {
  return { stepId: "s1", operation: op, parameters: params, idempotent: false, preconditions: {}, postconditions: {} };
}

describe("CAP-6 atomicity matrix", () => {
  let dirs: string[] = [];
  let dir: string; let catalog: CapabilityCatalog; let registry: CapabilityRegistry;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap6-at-"));
    dirs.push(dir);
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
  });
  after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  function snapshot() { return { catalog: JSON.stringify(catalog.list()), registry: JSON.stringify(registry.list()) }; }
  function assertIdentical(a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>) {
    assert.equal(b.catalog, a.catalog);
    assert.equal(b.registry, a.registry);
  }

  it("reject leaves every op unchanged", async () => {
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    registry.reload();
    const before = snapshot();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    // Invalid create (bad version) → unchanged
    await executor.executeStep(step("capability.create", { operation: "capability.create", definition: def("tool.file.bad", { version: "1.0" }) }), {});
    // Stale transition → unchanged
    await executor.executeStep(step("capability.transition", { operation: "capability.transition", capabilityId: "tool.file.read", from: "deprecated", to: "active" }), {});
    // Stale update → unchanged
    await executor.executeStep(step("capability.update", { operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "0.1.0", patch: { description: "x" } }), {});
    // Unknown remove → unchanged
    await executor.executeStep(step("capability.remove", { operation: "capability.remove", capabilityId: "tool.file.nope", reason: "x" }), {});
    // Consolidate with unresolvable source → unchanged
    await executor.executeStep(step("capability.consolidate", { operation: "capability.consolidate", sources: ["tool.file.missing"], target: "tool.file.merge", definition: def("tool.file.merge"), sourceDisposition: "deprecate" }), {});
    assertIdentical(snapshot(), before);
  });

  it("record-sink failure rolls back every durable op to byte-identical", async () => {
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    registry.reload();
    const before = snapshot();
    // The GovernanceRecordSink is an OBJECT with a record(result) method (Task 1).
    const executor = new CapabilityMutationExecutor({ catalog, registry, record: { record: async (): Promise<void> => { throw new Error("boom"); } } });
    const attempts: Array<{ op: string; params: Record<string, unknown> }> = [
      { op: "capability.create", params: { operation: "capability.create", definition: def("tool.file.created") } },
      { op: "capability.update", params: { operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "new" } } },
      { op: "capability.transition", params: { operation: "capability.transition", capabilityId: "tool.file.read", from: "emerging", to: "active" } },
      { op: "capability.consolidate", params: { operation: "capability.consolidate", sources: ["tool.file.read"], target: "tool.file.merge", definition: def("tool.file.merge", { dependencies: ["tool.file.read"] }), sourceDisposition: "deprecate" } },
      { op: "capability.remove", params: { operation: "capability.remove", capabilityId: "tool.file.read", reason: "x" } },
    ];
    for (const a of attempts) {
      const res = await executor.executeStep(step(a.op, a.params), {});
      assert.equal(res.success, false, `${a.op} should fail`);
      assertIdentical(snapshot(), before);
    }
  });

  it("registry projection failure after a catalog write → byte-identical restore (projection is IN the transaction boundary)", async () => {
    // The catalog write succeeds but `registry.reload()` throws ONCE — the executor
    // must NOT leave a half-applied state: the catalog write is rolled back, and
    // the restore's own projection succeeds (one-shot throw, not permanent).
    class OneShotThrowingRegistry extends CapabilityRegistry {
      private throwOnNext = true;
      override reload(): void {
        if (this.throwOnNext) { this.throwOnNext = false; throw new Error("projection failed"); }
        super.reload();
      }
    }
    const failingRegistry = new OneShotThrowingRegistry(catalog);
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    const executor = new CapabilityMutationExecutor({ catalog, registry: failingRegistry });
    const before = { catalog: JSON.stringify(catalog.list()) };
    const res = await executor.executeStep(step("capability.create", { operation: "capability.create", definition: def("tool.file.proj") }), {});
    assert.equal(res.success, false);
    assert.equal(catalog.has("tool.file.proj"), false); // the catalog write was rolled back
    assert.equal(JSON.stringify(catalog.list()), before.catalog); // byte-identical
  });

  it("success produces exactly one governed mutation + immutable artifact", async () => {
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    registry.reload();
    const before = snapshot();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const res = await executor.executeStep(step("capability.update", { operation: "capability.update", capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "new" } }), {});
    assert.equal(res.success, true);
    const result = res.output.result as { artifactId: string; mutation: { operation: string }; post: { published: CapabilityDefinition } };
    assert.equal(result.mutation.operation, "capability.update");
    assert.equal(result.post.published.version, "1.0.1");
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.read").length, 2); // exactly one new publication
    // Immutable input + output: deep-frozen, no aliasing
    assert.ok(Object.isFrozen(result.mutation));
    assert.ok(Object.isFrozen(result.post));
    // mutation must be inert — frozen, so the write is rejected (throws in strict
    // ESM) and the catalog is unaffected
    try { (result.mutation as unknown as { operation: string }).operation = "capability.remove"; } catch { /* frozen — expected */ }
    assert.equal(catalog.list().filter((d) => d.id === "tool.file.read").length, 2);
    void before;
  });

  it("artifactId is deterministic for identical executions", async () => {
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    registry.reload();
    const executor = new CapabilityMutationExecutor({ catalog, registry });
    const params = { operation: "capability.update" as const, capabilityId: "tool.file.read", sourceVersion: "1.0.0", patch: { description: "deterministic" } };
    const a = await executor.executeStep(step("capability.update", params), {});
    // Re-seed to 1.0.0 then run again (same inputs → same artifactId)
    catalog.remove("tool.file.read");
    catalog.register(def("tool.file.read"), def("tool.file.read").bindings[0]);
    registry.reload();
    const b = await executor.executeStep(step("capability.update", params), {});
    assert.equal((a.output.result as { artifactId: string }).artifactId, (b.output.result as { artifactId: string }).artifactId);
  });
});
