import { describe, it, expect } from "vitest";
import { isCapabilityKind, migrateKind, CAPABILITY_KINDS } from "../../../src/capability/canonical/kind.js";

describe("CapabilityKind", () => {
  it("defines exactly the five semantic kinds", () => {
    expect([...CAPABILITY_KINDS].sort()).toEqual(["agent", "core", "operation", "query", "workflow"]);
  });
  it("rejects provider technologies as kinds", () => {
    expect(isCapabilityKind("tool")).toBe(false);
    expect(isCapabilityKind("mcp")).toBe(false);
    expect(isCapabilityKind("external-cli")).toBe(false);
    expect(isCapabilityKind("custom")).toBe(false);
  });
  it("accepts the five semantic kinds", () => {
    for (const k of CAPABILITY_KINDS) expect(isCapabilityKind(k)).toBe(true);
  });
  it("maps legacy kinds to semantic kinds", () => {
    expect(migrateKind("core")).toBe("core");
    expect(migrateKind("tool")).toBe("operation");
    expect(migrateKind("skill")).toBe("operation");
    expect(migrateKind("workflow")).toBe("workflow");
    expect(migrateKind("plugin")).toBe("agent");
  });
  it("throws on the legacy custom escape hatch", () => {
    expect(() => migrateKind("custom")).toThrow(/custom/);
  });
});
