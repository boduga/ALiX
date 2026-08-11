// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { CapabilityLifecycleStepExecutor } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-step-executor.js";
import { CapabilityCatalog } from "../../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "../../../src/capability/mutation-port.js";
import type { Capability } from "../../../src/capability/types.js";
import type { ExecutionStep } from "../../../src/evolution/execution/contracts/execution-contract.js";

function makeCapability(id: string): Capability {
  return { id, version: "1.0.0", kind: "core", title: id, description: id, tags: [], category: "core",
    risk: "low", requiredPermissions: ["operator"], execution: { strategy: "native" } };
}
function trans(capabilityId: string, to: string): ExecutionStep {
  return { stepId: "s1", operation: "capability.transition", parameters: { capabilityId, to },
    idempotent: true, preconditions: {}, postconditions: {} };
}

let dir: string;

describe("CapabilityLifecycleStepExecutor", () => {
  let registry: CapabilityRegistry;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap3-step-"));
    // CAP-3: registry is a catalog projection — build over a temp-dir catalog + port.
    const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    registry = new CapabilityRegistry(catalog);
    registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
    registry.register(makeCapability("core.session"));
    registry.register(makeCapability("core.session.a"));
    registry.register(makeCapability("core.session.b"));
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("applies a single transition", async () => {
    const ex = new CapabilityLifecycleStepExecutor(registry);
    const res = await ex.executeStep(trans("core.session", "active"), {});
    assert.equal(res.success, true);
    assert.equal(registry.getLifecycleState("core.session"), "active");
  });

  it("consolidation all-or-nothing: second step fails → BOTH restored", async () => {
    const ex = new CapabilityLifecycleStepExecutor(registry);
    registry.applyLifecycleTransition("core.session", "active");
    // B succeeds, C's transition is a no-op success — simulate a mid-plan failure by
    // executing B then asserting rollbackApplied restores both A and B.
    await ex.executeStep(trans("core.session.a", "deprecated"), {});
    await ex.executeStep(trans("core.session.b", "deprecated"), {});
    assert.equal(registry.getLifecycleState("core.session.a"), "deprecated");
    assert.equal(registry.getLifecycleState("core.session.b"), "deprecated");
    ex.rollbackApplied();
    assert.equal(registry.getLifecycleState("core.session.a"), "emerging"); // restored to default (was undefined in overlay model)
    assert.equal(registry.getLifecycleState("core.session.b"), "emerging"); // restored to default
    assert.equal(registry.getLifecycleState("core.session"), "active");   // primary preserved
  });

  it("rollbackApplied is idempotent", async () => {
    const ex = new CapabilityLifecycleStepExecutor(registry);
    await ex.executeStep(trans("core.session.a", "deprecated"), {});
    ex.rollbackApplied();
    ex.rollbackApplied(); // second call is a no-op
    assert.equal(registry.getLifecycleState("core.session.a"), "emerging"); // restored to default
  });

  it("rollback restores the PRE-execution value, not a later state", async () => {
    const ex = new CapabilityLifecycleStepExecutor(registry);
    registry.applyLifecycleTransition("core.session.a", "deprecated"); // pre-state = deprecated
    await ex.executeStep(trans("core.session.a", "active"), {});        // displace to active
    ex.rollbackApplied();
    assert.equal(registry.getLifecycleState("core.session.a"), "deprecated"); // restores deprecated, not undefined
  });

  it("handles the capability.restore_transition in-plan rollback step", async () => {
    const ex = new CapabilityLifecycleStepExecutor(registry);
    registry.applyLifecycleTransition("core.session.a", "deprecated"); // pre-state = deprecated
    await ex.executeStep(trans("core.session.a", "active"), {});        // displace to active
    const rbStep: ExecutionStep = { stepId: "rb-s1", operation: "capability.restore_transition",
      parameters: { capabilityId: "core.session.a" }, idempotent: true, preconditions: {}, postconditions: {} };
    const res = await ex.executeStep(rbStep, {});
    assert.equal(res.success, true);
    assert.equal(registry.getLifecycleState("core.session.a"), "deprecated"); // restored to true pre-state
  });
});
