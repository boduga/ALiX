// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CapabilityValidationError } from "../../src/capability/errors.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "../../src/capability/mutation-port.js";
import type { Capability } from "../../src/capability/types.js";

function makeCapability(id: string): Capability {
  return { id, version: "1.0.0", kind: "core", title: id, description: id, tags: [], category: "core",
    risk: "low", requiredPermissions: ["operator"], execution: { strategy: "native" } };
}

// CAP-3: registry is a catalog projection — build over a temp-dir catalog + port.
function makeRegistry(dir: string): CapabilityRegistry {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return registry;
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cap3-overlay-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("CapabilityRegistry lifecycle overlay", () => {
  it("lifecycle defaults to emerging until set", () => {
    const r = makeRegistry(dir);
    r.register(makeCapability("core.session.list"));
    assert.equal(r.getLifecycleState("core.session.list"), "emerging");
  });

  it("applyLifecycleTransition stores state", () => {
    const r = makeRegistry(dir);
    r.register(makeCapability("core.old"));
    r.applyLifecycleTransition("core.old", "deprecated");
    assert.equal(r.getLifecycleState("core.old"), "deprecated");
  });

  it("throws on an unknown id", () => {
    const r = makeRegistry(dir);
    assert.throws(() => r.applyLifecycleTransition("core.nope", "active"), CapabilityValidationError);
  });

  it("unregister removes the entry (lifecycle read becomes undefined)", () => {
    const r = makeRegistry(dir);
    r.register(makeCapability("core.old"));
    r.applyLifecycleTransition("core.old", "deprecated");
    r.unregister("core.old");
    assert.equal(r.getLifecycleState("core.old"), undefined);
  });

  it("register does not pre-seed explicit lifecycle state (default emerging)", () => {
    const r = makeRegistry(dir);
    r.register(makeCapability("core.session.list"));
    assert.equal(r.getLifecycleState("core.session.list"), "emerging");
  });

  it("clearLifecycleState resets to default and is a no-op on an absent id", () => {
    const r = makeRegistry(dir);
    r.register(makeCapability("core.old"));
    r.applyLifecycleTransition("core.old", "deprecated");
    r.clearLifecycleState("core.old");
    assert.equal(r.getLifecycleState("core.old"), "emerging"); // reset to default, not undefined
    r.clearLifecycleState("core.old"); // idempotent
    assert.equal(r.getLifecycleState("core.old"), "emerging");
    r.clearLifecycleState("core.never"); // no-op on unknown id
    assert.equal(r.getLifecycleState("core.never"), undefined); // never registered
  });
});
