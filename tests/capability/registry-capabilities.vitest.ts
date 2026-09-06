import { describe, it, expect } from "vitest";
import { buildDefaultToolIndex } from "../../src/tools/tool-registry.js";
import type { ToolCapability } from "../../src/tools/tool-registry.js";
import type { Capability } from "../../src/capability/types.js";
import {
  toolCapabilityId,
  projectToolCapability,
  projectRegistryTools,
  registerRegistryToolCapabilities,
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

  it("shell.run: risk=high, extensions.toolName=shell.run, requiredPermissions includes admin", () => {
    const cap = projectToolCapability(findTool("shell.run"));
    expect(cap.risk).toBe("high");
    expect(cap.extensions?.toolName).toBe("shell.run");
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

describe("round-trip matrix: every canonical registry entry projects losslessly", () => {
  const entries = buildDefaultToolIndex().registry.getAll();

  it.each(entries.map((t) => [t.name, t] as const))(
    "%s round-trips risk, capabilityId, mutates, toolName",
    (_name, tool) => {
      const cap = projectToolCapability(tool);

      expect(cap.risk).toBe(tool.risk);

      expect(cap.extensions?.capabilityId).toBe(tool.capabilityId);
      expect(cap.extensions?.mutates).toBe(tool.mutates);
      expect(cap.extensions?.toolName).toBe(tool.name);

      expect(cap.id).toBe(toolCapabilityId(tool.name));
    },
  );

  it.each(entries.map((t) => [t.name, t] as const))(
    "%s maps risk to the governance permission tier",
    (_name, tool) => {
      const cap = projectToolCapability(tool);
      const expected: string[] =
        tool.risk === "high" || tool.risk === "critical"
          ? ["admin"]
          : ["developer"];
      expect(cap.requiredPermissions).toEqual(expected);
    },
  );
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

describe("registerRegistryToolCapabilities", () => {
  it("registers the 15 concrete tools, excluding the mcp.* wildcard", () => {
    const registered: Capability[] = [];
    registerRegistryToolCapabilities({ register: (cap) => { registered.push(cap); } });

    const ids = registered.map((c) => c.id);
    expect(ids).toHaveLength(15);
    // Back-compat ids survive via the registry projection.
    expect(ids).toContain("tool.file.read");
    expect(ids).toContain("tool.shell.run");
    // The full concrete surface is present.
    expect(ids).toContain("tool.file.create");
    expect(ids).toContain("tool.patch.apply");
    // The mcp.* wildcard is not a concrete invocable tool → never registered
    // (its id also fails the palette capability-id grammar).
    expect(ids).not.toContain("tool.mcp.*");
    expect(ids.every((id) => !id.includes("*"))).toBe(true);
    // Every registered cap carries the toolName extension used for routing.
    for (const cap of registered) {
      expect(cap.kind).toBe("tool");
      expect(cap.execution.strategy).toBe("tool");
      expect(typeof cap.extensions?.toolName).toBe("string");
    }
  });
});
