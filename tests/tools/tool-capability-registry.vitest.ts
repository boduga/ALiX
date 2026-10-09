/**
 * R5.3 — ToolCapabilityRegistry port adapter over the single tool catalogue.
 */
import { describe, expect, it } from "vitest";
import { createToolCapabilityRegistry } from "../../src/capabilities/tools/tool-registry.js";

describe("ToolCapabilityRegistry port (R5.3)", () => {
  const registry = createToolCapabilityRegistry();

  it("lists the full catalogue with the canonical entry shape", () => {
    const list = registry.list();
    expect(list.length).toBeGreaterThan(0);
    expect(list.find((entry) => entry.name === "file.read")).toEqual({
      name: "file.read",
      capabilityId: "filesystem.read",
      policyKey: "file.read",
      risk: "low",
      mutates: false,
    });
  });

  it("resolves a known tool and returns undefined for an unknown one", () => {
    expect(registry.resolve("file.read")?.capabilityId).toBe("filesystem.read");
    expect(registry.resolve("nope.nope")).toBeUndefined();
  });
});
