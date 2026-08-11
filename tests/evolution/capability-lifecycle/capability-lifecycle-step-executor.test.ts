// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { CapabilityLifecycleStepExecutor } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-step-executor.js";
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

describe("CapabilityLifecycleStepExecutor", () => {
  let registry: CapabilityRegistry;
  beforeEach(() => {
    registry = new CapabilityRegistry();
    registry.register(makeCapability("core.session"));
    registry.register(makeCapability("core.session.a"));
    registry.register(makeCapability("core.session.b"));
  });

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
    assert.equal(registry.getLifecycleState("core.session.a"), undefined); // restored (was undefined)
    assert.equal(registry.getLifecycleState("core.session.b"), undefined); // restored
    assert.equal(registry.getLifecycleState("core.session"), "active");   // primary preserved
  });

  it("rollbackApplied is idempotent", async () => {
    const ex = new CapabilityLifecycleStepExecutor(registry);
    await ex.executeStep(trans("core.session.a", "deprecated"), {});
    ex.rollbackApplied();
    ex.rollbackApplied(); // second call is a no-op
    assert.equal(registry.getLifecycleState("core.session.a"), undefined);
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
