import { describe, it, expect } from "vitest";
import { buildDefaultToolIndex } from "../../src/tools/tool-registry.js";
import type { ToolCapability } from "../../src/tools/tool-registry.js";
import {
  toolCapabilityId,
  projectToolCapability,
  projectRegistryTools,
} from "../../src/capability/registry-capabilities.js";

function findTool(name: string): ToolCapability {
  const { registry } = buildDefaultToolIndex();
  const t = registry.getAll().find((t) => t.name === name);
  if (!t) throw new Error(`Tool "${name}" not found in default registry`);
  return t;
}

describe("toolCapabilityId", () => {
  it('("file.read") === "tool.file.read"', () => {
    expect(toolCapabilityId("file.read")).toBe("tool.file.read");
  });

  it('("shell.run") === "tool.shell.run"', () => {
    expect(toolCapabilityId("shell.run")).toBe("tool.shell.run");
  });

  it('("file.create") === "tool.file.create"', () => {
    expect(toolCapabilityId("file.create")).toBe("tool.file.create");
  });
});

describe("projectToolCapability", () => {
  it("file.create: risk=medium, extensions.capabilityId=filesystem.write, extensions.toolName=file.create", () => {
    const cap = projectToolCapability(findTool("file.create"));
    expect(cap.risk).toBe("medium");
    expect(cap.extensions?.capabilityId).toBe("filesystem.write");
    expect(cap.extensions?.toolName).toBe("file.create");
    expect(cap.kind).toBe("tool");
    expect(cap.execution.strategy).toBe("tool");
    expect(cap.requiredPermissions).toContain("developer");
  });

  it("shell.run: risk=high, requiredPermissions includes admin", () => {
    const cap = projectToolCapability(findTool("shell.run"));
    expect(cap.risk).toBe("high");
    expect(cap.requiredPermissions).toContain("admin");
  });

  it("file.read: id=tool.file.read, extensions.toolName=file.read, risk=low", () => {
    const cap = projectToolCapability(findTool("file.read"));
    expect(cap.id).toBe("tool.file.read");
    expect(cap.extensions?.toolName).toBe("file.read");
    expect(cap.risk).toBe("low");
  });

  it("sets common defaults: version, execution.timeout, execution.cancellable", () => {
    const cap = projectToolCapability(findTool("file.read"));
    expect(cap.version).toBe("1.0");
    expect(cap.execution.timeout).toBe(30_000);
    expect(cap.execution.cancellable).toBe(true);
  });

  it("copies domain as category and tags from registry entry", () => {
    const cap = projectToolCapability(findTool("file.create"));
    expect(cap.category).toBe("filesystem");
    expect(cap.tags).toEqual(["write", "file", "create"]);
  });

  it("maps critical risk to admin permissions", () => {
    const cap = projectToolCapability({
      name: "test.critical",
      capabilityId: "test.critical",
      policyKey: "test.critical",
      description: "crit",
      risk: "critical",
      domain: "system",
      mutates: false,
      alwaysInclude: false,
      tags: [],
    });
    expect(cap.requiredPermissions).toContain("admin");
  });
});

describe("projectRegistryTools", () => {
  it("returns all 16 registry tools with unique sorted ids", () => {
    const { registry } = buildDefaultToolIndex();
    const caps = projectRegistryTools(registry);
    expect(caps).toHaveLength(16);

    const ids = caps.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(16);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it("filters to a name subset when names is provided", () => {
    const { registry } = buildDefaultToolIndex();
    const caps = projectRegistryTools(registry, ["file.read", "shell.run"]);
    expect(caps).toHaveLength(2);
    expect(caps.map((c) => c.id).sort()).toEqual(["tool.file.read", "tool.shell.run"]);
  });

  it("every projected capability has kind=tool and strategy=tool", () => {
    const { registry } = buildDefaultToolIndex();
    const caps = projectRegistryTools(registry);
    for (const cap of caps) {
      expect(cap.kind).toBe("tool");
      expect(cap.execution.strategy).toBe("tool");
    }
  });
});
