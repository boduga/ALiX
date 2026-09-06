import { describe, it, expect } from "vitest";
import { buildDefaultToolIndex, ToolRegistry } from "../../src/tools/tool-registry.js";
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

/** Spec tier table (plan: low/medium→developer, high/critical→admin). A
 *  standalone literal — NOT recomputed from the projection's mapping — so a
 *  wrong mapping in the source fails these assertions. */
const SPEC_RISK_TIER: Record<string, string[]> = {
  low: ["developer"],
  medium: ["developer"],
  high: ["admin"],
  critical: ["admin"],
};

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
    expect(cap.requiredPermissions).toEqual(["developer"]);
  });

  it("shell.run: risk=high, extensions.toolName=shell.run, requiredPermissions includes admin", () => {
    const cap = projectToolCapability(findTool("shell.run"));
    expect(cap.risk).toBe("high");
    expect(cap.extensions?.toolName).toBe("shell.run");
    expect(cap.requiredPermissions).toEqual(["admin"]);
  });

  it("file.read: id=tool.file.read, extensions.toolName=file.read, risk=low", () => {
    const cap = projectToolCapability(findTool("file.read"));
    expect(cap.id).toBe("tool.file.read");
    expect(cap.extensions?.toolName).toBe("file.read");
    expect(cap.risk).toBe("low");
  });

  it("file.read: always-included tool surfaces as active", () => {
    const cap = projectToolCapability(findTool("file.read"));
    expect(cap.extensions?.source).toBe("registry");
    expect(cap.extensions?.alwaysInclude).toBe(true);
    expect(cap.extensions?.surface).toBe("active");
  });

  it("patch.apply: governed tool (alwaysInclude=false) surfaces as governed", () => {
    const cap = projectToolCapability(findTool("patch.apply"));
    expect(cap.extensions?.source).toBe("registry");
    expect(cap.extensions?.alwaysInclude).toBe(false);
    expect(cap.extensions?.surface).toBe("governed");
  });

  it("shell.run: governed tool (alwaysInclude=false) surfaces as governed", () => {
    const cap = projectToolCapability(findTool("shell.run"));
    expect(cap.extensions?.alwaysInclude).toBe(false);
    expect(cap.extensions?.surface).toBe("governed");
  });

  it("version=1.0; execution is per-tool from the registry, never a fabricated uniform default", () => {
    const read = projectToolCapability(findTool("file.read"));
    expect(read.version).toBe("1.0");
    // file.read declares 10s / non-cancellable in the registry → copied through.
    expect(read.execution.strategy).toBe("tool");
    expect(read.execution.timeout).toBe(10_000);
    expect(read.execution.cancellable).toBe(false);

    // shell.run declares 30s / cancellable → copied through.
    const run = projectToolCapability(findTool("shell.run"));
    expect(run.execution.timeout).toBe(30_000);
    expect(run.execution.cancellable).toBe(true);

    // A tool with NO declared execution profile emits strategy only — no
    // invented timeout/cancellable.
    const done = projectToolCapability(findTool("done"));
    expect(done.execution).toEqual({ strategy: "tool" });
  });

  it("copies argsSchema/resultSchema through only when the registry entry declares them", () => {
    const read = projectToolCapability(findTool("file.read"));
    expect(read.argsSchema).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    });
    expect(read.resultSchema).toEqual({
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
    });

    // shell.run declares argsSchema only.
    const run = projectToolCapability(findTool("shell.run"));
    expect(run.argsSchema).toBeDefined();
    expect(run.resultSchema).toBeUndefined();

    // Entries that never declared schemas project without them.
    const del = projectToolCapability(findTool("file.delete"));
    expect(del.argsSchema).toBeUndefined();
    expect(del.resultSchema).toBeUndefined();
  });

  it("copies domain as category and tags from registry entry", () => {
    const cap = projectToolCapability(findTool("file.create"));
    expect(cap.category).toBe("filesystem");
    expect(cap.tags).toEqual(["write", "file", "create"]);
  });

  it("maps critical risk to exactly the admin permission tier", () => {
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
    expect(cap.requiredPermissions).toEqual(["admin"]);
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
    "%s surfaces alwaysInclude and a consistent active/governed surface label",
    (_name, tool) => {
      const cap = projectToolCapability(tool);
      const expectedSurface = tool.alwaysInclude ? "active" : "governed";

      expect(cap.extensions?.alwaysInclude).toBe(tool.alwaysInclude);
      expect(cap.extensions?.surface).toBe(expectedSurface);
      expect(typeof cap.extensions?.surface).toBe("string");
    },
  );

  it.each(entries.map((t) => [t.name, t] as const))(
    "%s maps risk to the governance permission tier",
    (_name, tool) => {
      const cap = projectToolCapability(tool);
      // Explicit spec-tier literal (SPEC_RISK_TIER), NOT a recomputation of the
      // source mapping — a wrong mapping in source fails this.
      expect(cap.requiredPermissions).toEqual(SPEC_RISK_TIER[tool.risk]);
    },
  );
});

describe("projectRegistryTools", () => {
  it("returns every registry tool with unique sorted ids", () => {
    const { registry } = buildDefaultToolIndex();
    const all = registry.getAll();
    const caps = projectRegistryTools(registry);
    expect(caps).toHaveLength(all.length);

    const ids = caps.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(all.length);
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
  it("registers every concrete registry tool, excluding the mcp.* wildcard", () => {
    const registered: Capability[] = [];
    registerRegistryToolCapabilities({ register: (cap) => { registered.push(cap); } });

    const { registry } = buildDefaultToolIndex();
    const concrete = registry.getAll().filter((t) => t.name !== "mcp.*");

    const ids = registered.map((c) => c.id);
    expect(ids).toHaveLength(concrete.length);
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

  it("injects a caller-supplied registry instead of silently building the default", () => {
    const injected = new ToolRegistry();
    injected.register({
      name: "custom.read",
      capabilityId: "custom.read",
      policyKey: "custom.read",
      description: "custom read",
      risk: "low",
      domain: "system",
      mutates: false,
      alwaysInclude: false,
      tags: ["custom"],
    });

    const registered: Capability[] = [];
    registerRegistryToolCapabilities(
      { register: (cap) => { registered.push(cap); } },
      injected,
    );

    expect(registered.map((c) => c.id)).toEqual(["tool.custom.read"]);
    // The injected entry still projects with full registry provenance.
    expect(registered[0]?.extensions?.source).toBe("registry");
    expect(registered[0]?.extensions?.toolName).toBe("custom.read");
  });
});
