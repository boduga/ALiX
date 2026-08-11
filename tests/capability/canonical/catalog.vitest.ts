import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import { CapabilityCatalog } from "../../../src/capability/canonical/catalog.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function makeDef(id: string, version = "1.0.0"): CapabilityDefinition {
  return { id, version, kind: "operation", title: id, description: id, tags: [], category: "test",
    risk: "low", requiredPermissions: ["operator"], dependencies: [],
    bindings: [{ id: "x", type: "native" }] };
}

describe("CapabilityCatalog", () => {
  let dir: string; let store: CapabilityDefinitionStore; let catalog: CapabilityCatalog;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "capcat-")); store = new CapabilityDefinitionStore({ dir }); catalog = new CapabilityCatalog(store); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("register adds a definition + binding", () => {
    catalog.register(makeDef("a.b.c"), { id: "gh", type: "external-cli", config: { executable: "gh" } });
    expect(catalog.has("a.b.c")).toBe(true);
    expect(catalog.getBinding("a.b.c")?.type).toBe("external-cli");
  });

  it("register throws on duplicate id@version", () => {
    catalog.register(makeDef("a.b.c"));
    expect(() => catalog.register(makeDef("a.b.c"))).toThrow(/already exists/i);
  });

  it("get returns the highest version", () => {
    catalog.register(makeDef("a.b.c", "1.0.0"));
    catalog.register(makeDef("a.b.c", "1.1.0"));
    expect(catalog.get("a.b.c")?.version).toBe("1.1.0");
    expect(catalog.list()).toHaveLength(2); // all versions retained
  });

  it("update patches the highest version (replaces)", () => {
    catalog.register(makeDef("a.b.c", "1.0.0"));
    catalog.update("a.b.c", { title: "new title" });
    expect(catalog.get("a.b.c")?.title).toBe("new title");
    expect(catalog.list()).toHaveLength(1);
  });

  it("remove drops the definition and binding", () => {
    catalog.register(makeDef("a.b.c"), { id: "x", type: "native" });
    catalog.remove("a.b.c");
    expect(catalog.has("a.b.c")).toBe(false);
    expect(catalog.getBinding("a.b.c")).toBeUndefined();
  });
});
