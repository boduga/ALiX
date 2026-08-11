import { describe, it, expect } from "vitest";
import { loadCatalogWithPrecedence, BOOTSTRAP_SOURCE_ORDER } from "../../../src/capability/canonical/bootstrap.js";
import type { CapabilityBootstrapProvider, CapabilityBootstrapEntry } from "../../../src/capability/canonical/bootstrap.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function makeDef(id: string, title: string): CapabilityDefinition {
  return { id, version: "1.0.0", kind: "operation", title, description: id, tags: [], category: "test",
    risk: "low", requiredPermissions: ["operator"], dependencies: [], bindings: [{ id: "x", type: "native" }] };
}
function provider(source: string, defs: CapabilityDefinition[]): CapabilityBootstrapProvider {
  return { source, load: () => defs.map((d) => ({ definition: d, source } as CapabilityBootstrapEntry)) };
}

describe("bootstrap source precedence", () => {
  it("orders sources built-in → … → overrides", () => {
    expect(BOOTSTRAP_SOURCE_ORDER).toEqual(["built-in", "project-local", "plugins", "provider-discovery", "governed", "overrides"]);
  });

  it("later sources override earlier on same id", () => {
    const entries = loadCatalogWithPrecedence([
      provider("built-in", [makeDef("a.b.c", "built-in title")]),
      provider("overrides", [makeDef("a.b.c", "override title")]),
    ]);
    const abc = entries.find((e) => e.definition.id === "a.b.c");
    expect(abc?.definition.title).toBe("override title");
  });

  it("unknown source lands at lowest precedence (overridden by a known source)", () => {
    const entries = loadCatalogWithPrecedence([
      provider("bulit-in", [makeDef("a.b.c", "typo title")]),
      provider("built-in", [makeDef("a.b.c", "built-in title")]),
    ]);
    const abc = entries.find((e) => e.definition.id === "a.b.c");
    expect(abc?.definition.title).toBe("built-in title");
  });

  it("unknown source still loads (fail-open) when it has a unique id", () => {
    const entries = loadCatalogWithPrecedence([
      provider("bulit-in", [makeDef("u.v.w", "typo title")]),
    ]);
    const uvw = entries.find((e) => e.definition.id === "u.v.w");
    expect(uvw?.definition.title).toBe("typo title");
  });

  it("keeps distinct ids from different sources", () => {
    const entries = loadCatalogWithPrecedence([
      provider("built-in", [makeDef("a.b.c", "x")]),
      provider("plugins", [makeDef("p.q.r", "y")]),
    ]);
    expect(entries.map((e) => e.definition.id).sort()).toEqual(["a.b.c", "p.q.r"]);
  });

  it("rejects an invalid definition from a provider", () => {
    expect(() => loadCatalogWithPrecedence([
      provider("built-in", [{ ...makeDef("bad", "x"), version: "1.0" }]),
    ])).toThrow(/capability:/);
  });
});
