// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CapabilityValidationError } from "../../src/capability/errors.js";
import type { Capability } from "../../src/capability/types.js";

function makeCapability(id: string): Capability {
  return {
    id, version: "1.0.0", kind: "core", title: id, description: id,
    tags: [], category: "core", risk: "low", requiredPermissions: ["operator"],
    execution: { strategy: "native" },
  };
}

describe("CapabilityRegistry lifecycle overlay", () => {
  it("has no lifecycle state until applied", () => {
    const r = new CapabilityRegistry();
    r.register(makeCapability("core.session.list"));
    assert.equal(r.getLifecycleState("core.session.list"), undefined);
  });

  it("applyLifecycleTransition stores the state", () => {
    const r = new CapabilityRegistry();
    r.register(makeCapability("core.old"));
    r.applyLifecycleTransition("core.old", "deprecated");
    assert.equal(r.getLifecycleState("core.old"), "deprecated");
  });

  it("throws on an unknown id", () => {
    const r = new CapabilityRegistry();
    assert.throws(() => r.applyLifecycleTransition("core.nope", "active"), CapabilityValidationError);
  });

  it("unregister clears the overlay entry", () => {
    const r = new CapabilityRegistry();
    r.register(makeCapability("core.old"));
    r.applyLifecycleTransition("core.old", "deprecated");
    r.unregister("core.old");
    assert.equal(r.getLifecycleState("core.old"), undefined);
  });

  it("register does not pre-seed a lifecycle state", () => {
    const r = new CapabilityRegistry();
    r.register(makeCapability("core.session.list"));
    assert.equal(r.getLifecycleState("core.session.list"), undefined);
  });

  it("clearLifecycleState removes the entry and is a no-op on an absent id", () => {
    const r = new CapabilityRegistry();
    r.register(makeCapability("core.old"));
    r.applyLifecycleTransition("core.old", "deprecated");
    r.clearLifecycleState("core.old");
    assert.equal(r.getLifecycleState("core.old"), undefined);
    r.clearLifecycleState("core.old"); // no-op on absent id
    assert.equal(r.getLifecycleState("core.old"), undefined);
    r.clearLifecycleState("core.never"); // no-op on unknown id
  });
});
