import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ALIX_BUILTIN_EXECUTORS, ALIX_CANONICAL_BUILTIN_TOOLS } from "../../src/agents/tool-manifest.js";
import { WRITE_TOOLS } from "../../src/agents/tool-policy.js";
import { CORE_TOOL_NAMES } from "../../src/config/tool-scoping.js";
import { buildDefaultToolIndex, getToolsForCapability, getCapabilitiesForTool } from "../../src/tools/tool-registry.js";
import { BASE_TOOLS, READ_ONLY_TOOL_NAMES } from "../../src/run/helpers.js";

const REPO_SRC = fileURLToPath(new URL("../../src/", import.meta.url));

describe("tool taxonomy sentinels", () => {
  it("keeps registry and derived capability helpers", () => {
    expect(typeof buildDefaultToolIndex).toBe("function");
    expect(typeof getToolsForCapability).toBe("function");
    expect(typeof getCapabilitiesForTool).toBe("function");
    expect(existsSync(join(REPO_SRC, "policy", "capability-registry.ts"))).toBe(false);
  });

  it("derives capability-to-tool views from the registry", () => {
    const { registry } = buildDefaultToolIndex();
    for (const capability of new Set(registry.getAll().map(tool => tool.capabilityId))) {
      const expected = registry.getAll().filter(tool => tool.capabilityId === capability).map(tool => tool.name);
      expect([...getToolsForCapability(capability)].sort()).toEqual(expected.sort());
    }
  });

  it("maps built-ins only to real executors or the two intercepted tools", () => {
    const registryNames = new Set(buildDefaultToolIndex().registry.getAll().map(tool => tool.name));
    const intercepted = new Set([
      "mcp_search_tools",
      "alix_execution_state_propose",
      "collaboration.publish_finding",
      "collaboration.publish_artifact",
      "collaboration.query_findings",
      "collaboration.get_dependency_results",
      "collaboration.report_conflict",
      "collaboration.list_conflicts",
    ]);
    for (const name of ALIX_CANONICAL_BUILTIN_TOOLS) {
      const exec = ALIX_BUILTIN_EXECUTORS[name];
      expect(name).toMatch(/^alix_/);
      expect(registryNames.has(exec) || intercepted.has(exec), `${name} -> ${exec}`).toBe(true);
    }
    expect(existsSync(join(REPO_SRC, "agents", "tool-name-map.ts"))).toBe(false);
  });

  it("offers only canonical manifest names and excludes phantoms", () => {
    const names = new Set<string>(ALIX_CANONICAL_BUILTIN_TOOLS);
    const offered = new Set(BASE_TOOLS.map(tool => tool.name));
    for (const name of offered) expect(names.has(name), name).toBe(true);
    for (const name of READ_ONLY_TOOL_NAMES) expect(offered.has(name)).toBe(true);
    for (const phantom of ["alix_file_write", "alix_dir_search", "alix_patch_create", "alix_git_status"]) {
      expect(names.has(phantom)).toBe(false);
      expect(offered.has(phantom)).toBe(false);
      expect(CORE_TOOL_NAMES.has(phantom)).toBe(false);
      expect(WRITE_TOOLS.has(phantom)).toBe(false);
    }
  });
});
