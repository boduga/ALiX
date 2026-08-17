import { describe, it, expect } from "vitest";
import {
  buildDefaultToolIndex,
  type ToolCapability,
} from "../../src/tools/tool-registry.js";
import { legacyCapabilityToCanonical } from "../../src/tools/capability-map.js";

/**
 * Contract test for the canonical tool/capability taxonomy (INV-4).
 *
 * `src/tools/tool-registry.ts` is the single canonical source of
 * tool/capability metadata. This test locks the exact 16-entry executable
 * surface (names, capability ids, policy keys, risk, mutation flags,
 * domains, always-include behavior, tags, execution profiles) plus the
 * INV-4 invariant:
 *
 *   legacyCapabilityToCanonical(entry.policyKey) === entry.capabilityId
 *
 * capabilityId-sharing decision: the corrected table intentionally SHARES
 * capability ids across tools that address the same underlying capability
 * (e.g. file.create + file.delete both map to `filesystem.write`; the four
 * self-extend tools all map to `tool.invoke`). Therefore we do NOT assert
 * strict capabilityId uniqueness; instead we assert:
 *   - every `name` is unique;
 *   - the capabilityId→names grouping matches the table exactly.
 */

type EntryShape = {
  capabilityId: string;
  policyKey: string;
  risk: string;
  mutates: boolean;
  domain: string;
  alwaysInclude: boolean;
  tags: string[];
  executionProfiles?: string[];
};

const EXPECTED: Record<string, EntryShape> = {
  "file.read": {
    capabilityId: "filesystem.read",
    policyKey: "file.read",
    risk: "low",
    mutates: false,
    domain: "filesystem",
    alwaysInclude: true,
    tags: ["read", "file", "code", "config"],
  },
  "file.create": {
    capabilityId: "filesystem.write",
    policyKey: "file.write",
    risk: "medium",
    mutates: true,
    domain: "filesystem",
    alwaysInclude: false,
    tags: ["write", "file", "create"],
    executionProfiles: ["artifact"],
  },
  "file.delete": {
    capabilityId: "filesystem.write",
    policyKey: "file.write",
    risk: "high",
    mutates: true,
    domain: "filesystem",
    alwaysInclude: false,
    tags: ["delete", "file", "remove"],
    executionProfiles: ["artifact"],
  },
  "file.exists": {
    capabilityId: "filesystem.read",
    policyKey: "file.read",
    risk: "low",
    mutates: false,
    domain: "filesystem",
    alwaysInclude: false,
    tags: ["read", "file", "check"],
  },
  "dir.search": {
    capabilityId: "filesystem.search",
    policyKey: "file.search",
    risk: "low",
    mutates: false,
    domain: "filesystem",
    alwaysInclude: true,
    tags: ["search", "file", "directory", "code"],
  },
  "shell.run": {
    capabilityId: "shell.exec",
    policyKey: "shell.run",
    risk: "high",
    mutates: true,
    domain: "shell",
    alwaysInclude: false,
    tags: ["shell", "command", "run", "execute"],
  },
  "patch.apply": {
    capabilityId: "patch.apply",
    policyKey: "patch.apply",
    risk: "high",
    mutates: true,
    domain: "code",
    alwaysInclude: false,
    tags: ["patch", "code", "edit", "modify"],
  },
  done: {
    capabilityId: "task.complete",
    policyKey: "task.complete",
    risk: "low",
    mutates: false,
    domain: "system",
    alwaysInclude: true,
    tags: ["done", "complete", "finish"],
  },
  delegate: {
    capabilityId: "agent.delegate",
    policyKey: "delegate",
    risk: "medium",
    mutates: true,
    domain: "agent",
    alwaysInclude: false,
    tags: ["delegate", "agent", "subtask"],
  },
  web_search: {
    capabilityId: "web.search",
    policyKey: "web.search",
    risk: "low",
    mutates: false,
    domain: "network",
    alwaysInclude: false,
    tags: ["web", "search"],
    executionProfiles: ["research"],
  },
  web_fetch: {
    capabilityId: "web.fetch",
    policyKey: "web.fetch",
    risk: "medium",
    mutates: false,
    domain: "network",
    alwaysInclude: false,
    tags: ["web", "fetch"],
    executionProfiles: ["research"],
  },
  create_skill: {
    capabilityId: "tool.invoke",
    policyKey: "tool.invoke",
    risk: "medium",
    mutates: true,
    domain: "system",
    alwaysInclude: false,
    tags: ["skill", "create", "self-extend"],
  },
  list_extensions: {
    capabilityId: "tool.invoke",
    policyKey: "tool.invoke",
    risk: "low",
    mutates: false,
    domain: "system",
    alwaysInclude: false,
    tags: ["extension", "list", "self-extend"],
  },
  inspect_extension: {
    capabilityId: "tool.invoke",
    policyKey: "tool.invoke",
    risk: "low",
    mutates: false,
    domain: "system",
    alwaysInclude: false,
    tags: ["extension", "inspect", "self-extend"],
  },
  create_hook: {
    capabilityId: "tool.invoke",
    policyKey: "tool.invoke",
    risk: "high",
    mutates: true,
    domain: "system",
    alwaysInclude: false,
    tags: ["hook", "create", "self-extend"],
  },
  "mcp.*": {
    capabilityId: "mcp.invoke",
    policyKey: "mcp.invoke",
    risk: "high",
    mutates: true,
    domain: "mcp",
    alwaysInclude: false,
    tags: ["mcp", "tool"],
  },
};

function project(cap: ToolCapability): EntryShape & { name: string } {
  const {
    name,
    capabilityId,
    policyKey,
    risk,
    mutates,
    domain,
    alwaysInclude,
    tags,
    executionProfiles,
  } = cap;
  return {
    name,
    capabilityId,
    policyKey,
    risk,
    mutates,
    domain,
    alwaysInclude,
    tags,
    executionProfiles,
  };
}

describe("canonical tool capability taxonomy contract", () => {
  it("registers exactly 16 canonical entries", () => {
    const { registry } = buildDefaultToolIndex();
    expect(registry.getAll().length).toBe(16);
  });

  it("matches the canonical table exactly", () => {
    const { registry } = buildDefaultToolIndex();
    const actual = registry.getAll().map(project);
    const expected = Object.entries(EXPECTED).map(([name, shape]) => ({
      name,
      ...shape,
    }));
    expect(actual).toEqual(expected);
  });

  it("every entry carries the full required metadata", () => {
    const { registry } = buildDefaultToolIndex();
    for (const entry of registry.getAll()) {
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.capabilityId).toBe("string");
      expect(entry.capabilityId.length).toBeGreaterThan(0);
      expect(typeof entry.policyKey).toBe("string");
      expect(entry.policyKey.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
      expect(["low", "medium", "high", "critical"]).toContain(entry.risk);
      expect(typeof entry.mutates).toBe("boolean");
      expect(typeof entry.domain).toBe("string");
      expect(typeof entry.alwaysInclude).toBe("boolean");
      expect(Array.isArray(entry.tags)).toBe(true);
      expect(entry.tags.length).toBeGreaterThan(0);
      expect(entry.tags.every(t => typeof t === "string")).toBe(true);
    }
  });

  it("every entry name is unique", () => {
    const { registry } = buildDefaultToolIndex();
    const names = registry.getAll().map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("capabilityId sharing matches the table's intentional grouping", () => {
    const { registry } = buildDefaultToolIndex();
    const all = registry.getAll();

    const namesByCapabilityId = (id: string) =>
      all
        .filter(t => t.capabilityId === id)
        .map(t => t.name)
        .sort();

    // file.create + file.delete both mutate the filesystem.write capability
    expect(namesByCapabilityId("filesystem.write")).toEqual([
      "file.create",
      "file.delete",
    ]);
    // file.read + file.exists both read the filesystem.read capability
    expect(namesByCapabilityId("filesystem.read")).toEqual([
      "file.exists",
      "file.read",
    ]);
    // the four self-extend tools all invoke tool.invoke
    expect(namesByCapabilityId("tool.invoke")).toEqual([
      "create_hook",
      "create_skill",
      "inspect_extension",
      "list_extensions",
    ]);
  });

  it("applies the two deliberate capabilityId corrections", () => {
    const { registry } = buildDefaultToolIndex();
    expect(registry.lookup("file.create")?.capabilityId).toBe("filesystem.write");
    expect(registry.lookup("file.delete")?.capabilityId).toBe("filesystem.write");
  });

  it("INV-4: legacyCapabilityToCanonical(policyKey) === capabilityId (representative subset)", () => {
    const { registry } = buildDefaultToolIndex();
    const spotCheck = [
      "file.read",
      "file.create",
      "file.delete",
      "shell.run",
      "patch.apply",
      "mcp.*",
    ];
    for (const name of spotCheck) {
      const entry = registry.lookup(name);
      expect(entry, `missing entry ${name}`).toBeDefined();
      expect(
        legacyCapabilityToCanonical(entry!.policyKey),
        `${name}: legacyCapabilityToCanonical("${entry!.policyKey}") !== "${entry!.capabilityId}"`,
      ).toBe(entry!.capabilityId);
    }
  });
});
