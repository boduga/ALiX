import { describe, it, expect } from "vitest";
import {
  buildDefaultToolIndex,
  getToolsForCapability,
  getCapabilitiesForTool,
} from "../../src/tools/tool-registry.js";

/**
 * Derived capability↔tool views (Task 5).
 *
 * `getToolsForCapability` / `getCapabilitiesForTool` are pure derived lookups
 * over the canonical default registry — they must never carry independent
 * data. The final test asserts each view equals a filter over `getAll()`
 * directly, which is the closest observable check for "derived, not
 * independently maintained".
 */
describe("derived tool↔capability views", () => {
  it("getToolsForCapability returns sorted tool names for a shared capability", () => {
    expect(getToolsForCapability("filesystem.write")).toEqual(["file.create", "file.delete"]);
  });

  it("getToolsForCapability returns the four self-extend tools for tool.invoke", () => {
    expect(getToolsForCapability("tool.invoke")).toEqual([
      "create_hook",
      "create_skill",
      "inspect_extension",
      "list_extensions",
    ]);
  });

  it("getToolsForCapability returns [] for an unknown capability", () => {
    expect(getToolsForCapability("nonexistent.cap")).toEqual([]);
  });

  it("getCapabilitiesForTool returns the entry's canonical capabilityId", () => {
    expect(getCapabilitiesForTool("file.read")).toEqual(["filesystem.read"]);
  });

  it("getCapabilitiesForTool returns [] for an unknown tool", () => {
    expect(getCapabilitiesForTool("unknown_tool")).toEqual([]);
  });

  it("getToolsForCapability is derived from the registry (no independent data)", () => {
    const { registry } = buildDefaultToolIndex();
    const all = registry.getAll();
    const capabilityIds = Array.from(new Set(all.map(t => t.capabilityId)));
    for (const id of capabilityIds) {
      const expected = all
        .filter(t => t.capabilityId === id)
        .map(t => t.name)
        .sort();
      expect(getToolsForCapability(id)).toEqual(expected);
    }
  });
});
