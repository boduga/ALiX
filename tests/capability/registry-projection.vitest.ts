import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CapabilityRegistry } from "../../src/capability/registry.js";
import { CatalogBackedCapabilityMutationPort } from "../../src/capability/mutation-port.js";
import { legacyToCanonicalDefinition } from "../../src/capability/legacy-adapter.js";
import type { Capability } from "../../src/capability/types.js";

function makeLegacyCap(): Capability {
  return { id: "tool.file.read", version: "1.0", kind: "tool", title: "Read file", description: "d",
    tags: [], category: "file", risk: "low", requiredPermissions: ["developer"],
    execution: { strategy: "tool" }, extensions: { toolName: "file.read" } };
}

function makeRegistry(dir: string): { catalog: CapabilityCatalog; registry: CapabilityRegistry } {
  const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  const registry = new CapabilityRegistry(catalog);
  registry.setMutationPort(new CatalogBackedCapabilityMutationPort(catalog));
  return { catalog, registry };
}

describe("CAP-3 registry projection", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cap3-reg-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("list() == catalog current state (registry owns no independent definitions)", () => {
    const { catalog, registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    expect(registry.list()).toHaveLength(1);
    expect(catalog.list()).toHaveLength(1);            // register went through the port → catalog
    expect(registry.list()[0]!.id).toBe("tool.file.read");
    // Remove from the catalog directly → registry reflects it (projection)
    catalog.remove("tool.file.read");
    expect(registry.list()).toHaveLength(0);
  });

  it("canonical get() returns RegisteredCapability with lifecycle + availability + bindings", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    const rc = registry.get("tool.file.read");
    expect(rc?.definition.id).toBe("tool.file.read");
    expect(rc?.lifecycle).toBe("emerging");            // default current state
    expect(rc?.availability.enabled).toBe(true);
    expect(rc?.bindings[0]?.type).toBe("tool");
  });

  it("lifecycle state is registry current state (set/get authority, not A7 overlay)", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    expect(registry.getLifecycleState("tool.file.read")).toBe("emerging");
    registry.setLifecycleState("tool.file.read", "active");
    expect(registry.getLifecycleState("tool.file.read")).toBe("active");
    expect(registry.listLifecycleStates()).toEqual([{ capabilityId: "tool.file.read", state: "active" }]);
  });

  it("setLifecycleState on an unknown id throws", () => {
    const { registry } = makeRegistry(dir);
    expect(() => registry.setLifecycleState("nope", "active")).toThrow(/unknown/i);
  });

  it("legacy adapter derives Capability and never mutates canonical state", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    const legacy = registry.find("tool.file.read");
    expect(legacy?.extensions?.toolName).toBe("file.read"); // recovered from binding.config
    legacy!.kind = "core";                                  // mutating the derived object...
    expect(registry.get("tool.file.read")?.definition.kind).toBe("operation"); // ...does NOT touch canonical
  });

  it("query() still filters over legacy-derived capabilities", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap());
    expect(registry.query({ category: "file" })).toHaveLength(1);
    expect(registry.query({ category: "session" })).toHaveLength(0);
  });

  it("getProviders() = distinct binding provider types; getAvailableProviders() filters by bound executor", () => {
    const { registry } = makeRegistry(dir);
    registry.register(makeLegacyCap()); // binding type "tool"
    registry.register({ ...makeLegacyCap(), id: "core.session.list", kind: "core", execution: { strategy: "native" }, extensions: undefined });
    expect(registry.getProviders().sort()).toEqual(["native", "tool"]); // declarative — no CAP-4 semantics
    const exec = new Set(["native"]); // only native is bound in this fake executor registry
    expect(registry.getAvailableProviders("core.session.list", (t) => exec.has(t))).toEqual(["native"]);
    expect(registry.getAvailableProviders("tool.file.read", (t) => exec.has(t))).toEqual([]);
  });
});
