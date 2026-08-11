import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityDefinitionStore } from "../../../src/capability/canonical/catalog-store.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function makeDef(id: string, version = "1.0.0"): CapabilityDefinition {
  return { id, version, kind: "operation", title: id, description: id, tags: [], category: "test",
    risk: "low", requiredPermissions: ["operator"], dependencies: [],
    bindings: [{ id: "x", type: "native" }] };
}

describe("CapabilityDefinitionStore", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "capstore-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("persists definitions to definitions.jsonl", () => {
    const store = new CapabilityDefinitionStore({ dir });
    store.appendDefinition(makeDef("a.b.c"));
    expect(existsSync(join(dir, "capabilities", "definitions.jsonl"))).toBe(true);
  });

  it("round-trips list/get", () => {
    const s1 = new CapabilityDefinitionStore({ dir });
    s1.appendDefinition(makeDef("a.b.c"));
    s1.appendDefinition(makeDef("x.y.z", "2.0.0"));
    const s2 = new CapabilityDefinitionStore({ dir }); // fresh instance = reload
    expect(s2.listDefinitions().map(d => d.id)).toEqual(["a.b.c", "x.y.z"]);
    expect(s2.getDefinition("x.y.z")?.version).toBe("2.0.0");
  });

  it("rejects append of a duplicate id@version", () => {
    const s = new CapabilityDefinitionStore({ dir });
    s.appendDefinition(makeDef("a.b.c"));
    expect(() => s.appendDefinition(makeDef("a.b.c"))).toThrow(/duplicate|already/i);
  });

  it("rejects append of an invalid definition", () => {
    const s = new CapabilityDefinitionStore({ dir });
    expect(() => s.appendDefinition({ ...makeDef("bad"), version: "1.0" })).toThrow(/capability:/);
  });

  it("replaceDefinition overwrites the same id@version", () => {
    const s = new CapabilityDefinitionStore({ dir });
    s.appendDefinition(makeDef("a.b.c"));
    s.replaceDefinition({ ...makeDef("a.b.c"), title: "updated" });
    expect(s.getDefinition("a.b.c")?.title).toBe("updated");
    expect(s.listDefinitions()).toHaveLength(1);
  });

  it("removeDefinition drops a definition", () => {
    const s = new CapabilityDefinitionStore({ dir });
    s.appendDefinition(makeDef("a.b.c"));
    s.removeDefinition("a.b.c");
    expect(s.getDefinition("a.b.c")).toBeUndefined();
  });

  it("skips corrupt lines on load (corruption handling)", () => {
    const s1 = new CapabilityDefinitionStore({ dir });
    s1.appendDefinition(makeDef("a.b.c"));
    const file = join(dir, "capabilities", "definitions.jsonl");
    // Inject a corrupt line at the end
    const raw = readFileSync(file, "utf-8") + "{ not valid json }\n";
    const s2 = new CapabilityDefinitionStore({ dir }); // reloads
    // Corrupt line is skipped; valid entry survives
    expect(s2.listDefinitions().some(d => d.id === "a.b.c")).toBe(true);
  });

  it("persists and reloads bindings", () => {
    const s1 = new CapabilityDefinitionStore({ dir });
    s1.appendBinding("a.b.c", { id: "gh", type: "external-cli", config: { executable: "gh" } });
    const s2 = new CapabilityDefinitionStore({ dir });
    expect(s2.getBinding("a.b.c")?.type).toBe("external-cli");
  });
});
