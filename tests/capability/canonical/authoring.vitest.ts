import { describe, it, expect } from "vitest";
import { evaluateDefinitionAuthoring } from "../../../src/capability/canonical/authoring.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function makeDef(): CapabilityDefinition {
  return { id: "a.b.c", version: "1.0.0", kind: "operation", title: "t", description: "d",
    tags: [], category: "c", risk: "low", requiredPermissions: ["operator"], dependencies: [],
    bindings: [{ id: "x", type: "native" }] };
}

describe("two-phase definition authoring", () => {
  it("returns required when no input", () => {
    expect(evaluateDefinitionAuthoring(undefined).status).toBe("required");
  });
  it("returns incomplete for a partial definition", () => {
    const res = evaluateDefinitionAuthoring({ id: "a.b.c" });
    expect(res.status).toBe("incomplete");
    expect(res.missing.length).toBeGreaterThan(0);
  });
  it("returns incomplete for short SemVer", () => {
    const res = evaluateDefinitionAuthoring({ ...makeDef(), version: "1.0" });
    expect(res.status).toBe("incomplete");
    expect(res.missing).toContain("version");
  });
  it("returns incomplete for no bindings", () => {
    const res = evaluateDefinitionAuthoring({ ...makeDef(), bindings: [] });
    expect(res.status).toBe("incomplete");
    expect(res.missing).toContain("bindings");
  });
  it("returns valid for a complete definition", () => {
    const res = evaluateDefinitionAuthoring(makeDef());
    expect(res.status).toBe("valid");
    expect(res.missing).toHaveLength(0);
  });
  it("never invents defaults", () => {
    // A definition missing requiredPermissions must be flagged, not defaulted.
    const { id, version, kind, title, description, tags, category, risk, dependencies, bindings } = makeDef();
    const res = evaluateDefinitionAuthoring({ id, version, kind, title, description, tags, category, risk, dependencies, bindings });
    expect(res.status).toBe("incomplete");
    expect(res.missing).toContain("requiredPermissions");
  });
});
