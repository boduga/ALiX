import { describe, expect, it } from "vitest";
import {
  AGENT_REGISTRY,
  getToolCategory,
} from "../../src/agents/agent-registry.js";
import { getToolPolicy } from "../../src/agents/tool-policy.js";

describe("agent taxonomy architecture sentinels", () => {
  it("Sentinel L: getToolPolicy buckets match registry toolCategory", () => {
    const expectedByCategory: Record<string, string[]> = {
      read: ["read"],
      write: ["read", "write", "mcp"],
      research: ["read", "mcp"],
    };

    for (const def of AGENT_REGISTRY) {
      const category = getToolCategory(def.role)!;

      expect(
        getToolPolicy(def.role).allowedCategories,
        def.role,
      ).toEqual(expectedByCategory[category]);
    }
  });
});
