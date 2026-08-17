/**
 * tool-registry.ts -- Canonical searchable tool capability index.
 *
 * Pure data structures for registering tool capabilities, indexing them by
 * intent tag, and retrieving subsets by domain, risk, or intent keywords.
 * No execution, no I/O, no side effects.
 *
 * This module is the single canonical source of tool/capability metadata for
 * the repo. It covers the fixed executable surface (file.*, shell.run,
 * patch.apply, done, delegate, web_*, self-extend tools) plus the dynamic
 * `mcp.<server>.<tool>` family via the single `mcp.*` wildcard entry.
 *
 * Compatible with existing CompositeToolRouter. The registry keys tool names
 * as plain strings (not the legacy ToolName union) so it can represent tools
 * beyond the typed-arg subset, including the dynamic MCP tool family.
 * No runtime integration with routers or PolicyGate yet.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityRisk = "low" | "medium" | "high" | "critical";

export type ToolDomain =
  | "filesystem" | "shell" | "network" | "code" | "search"
  | "agent" | "memory" | "policy" | "system" | "mcp";

export type ToolCapability = {
  /** Tool name exposed to the model (e.g. "file.read", "mcp.github.repos.list"). */
  name: string;
  /** Canonical capability id (e.g. "filesystem.write"). Shared across tools that mutate the same underlying capability. */
  capabilityId: string;
  /** Config-facing policy key, read by the policy gate against config.permissions.tools[policyKey]. */
  policyKey: string;
  description: string;
  risk: CapabilityRisk;
  domain: ToolDomain;
  mutates: boolean;
  alwaysInclude: boolean;
  tags: string[];
  /** Optional execution-profile labels (e.g. "artifact", "research"). */
  executionProfiles?: string[];
};

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools = new Map<string, ToolCapability>();

  register(capability: ToolCapability): void {
    // Warn on duplicate registration — prevents CapabilityIndex sync drift
    if (this.tools.has(capability.name)) {
      console.warn(`ToolRegistry: overwriting existing tool "${capability.name}"`);
    }
    this.tools.set(capability.name, capability);
  }

  lookup(name: string): ToolCapability | undefined {
    return this.tools.get(name);
  }

  lookupByName(name: string): ToolCapability | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolCapability[] {
    return Array.from(this.tools.values());
  }

  getByDomain(domain: ToolDomain): ToolCapability[] {
    return this.getAll().filter(t => t.domain === domain);
  }

  getByRisk(risk: CapabilityRisk): ToolCapability[] {
    return this.getAll().filter(t => t.risk === risk);
  }

  getMutating(): ToolCapability[] {
    return this.getAll().filter(t => t.mutates);
  }

  getEssential(): ToolCapability[] {
    return this.getAll().filter(t => t.alwaysInclude);
  }
}

// ---------------------------------------------------------------------------
// CapabilityIndex
// ---------------------------------------------------------------------------

export type IntentTag = string;

export class CapabilityIndex {
  private tagToTools = new Map<IntentTag, string[]>();

  index(capability: ToolCapability): void {
    for (const tag of capability.tags) {
      const existing = this.tagToTools.get(tag) ?? [];
      if (!existing.includes(capability.name)) {
        existing.push(capability.name);
        this.tagToTools.set(tag, existing);
      }
    }
  }

  findByTag(tag: IntentTag): string[] {
    // Return a copy to prevent callers from mutating internal state
    return [...(this.tagToTools.get(tag) ?? [])];
  }

  findByTags(tags: IntentTag[]): string[] {
    const results = new Set<string>();
    for (const tag of tags) {
      for (const tool of this.findByTag(tag)) {
        results.add(tool);
      }
    }
    return Array.from(results);
  }

  getAllTags(): IntentTag[] {
    return Array.from(this.tagToTools.keys());
  }
}

// ---------------------------------------------------------------------------
// Default tool index factory
// ---------------------------------------------------------------------------

export function buildDefaultToolIndex(): { registry: ToolRegistry; index: CapabilityIndex } {
  const registry = new ToolRegistry();
  const idx = new CapabilityIndex();

  const defaults: ToolCapability[] = [
    {
      name: "file.read",
      capabilityId: "filesystem.read",
      policyKey: "file.read",
      description: "Read the contents of a file",
      risk: "low",
      domain: "filesystem",
      mutates: false,
      alwaysInclude: true,
      tags: ["read", "file", "code", "config"],
    },
    {
      name: "file.create",
      capabilityId: "filesystem.write",
      policyKey: "file.write",
      description: "Create or overwrite a file",
      risk: "medium",
      domain: "filesystem",
      mutates: true,
      alwaysInclude: false,
      tags: ["write", "file", "create"],
      executionProfiles: ["artifact"],
    },
    {
      name: "file.delete",
      capabilityId: "filesystem.write",
      policyKey: "file.write",
      description: "Delete a file",
      risk: "high",
      domain: "filesystem",
      mutates: true,
      alwaysInclude: false,
      tags: ["delete", "file", "remove"],
      executionProfiles: ["artifact"],
    },
    {
      name: "file.exists",
      capabilityId: "filesystem.read",
      policyKey: "file.read",
      description: "Check if a file exists",
      risk: "low",
      domain: "filesystem",
      mutates: false,
      alwaysInclude: false,
      tags: ["read", "file", "check"],
    },
    {
      name: "dir.search",
      capabilityId: "filesystem.search",
      policyKey: "file.search",
      description: "Search directory for files matching a pattern",
      risk: "low",
      domain: "filesystem",
      mutates: false,
      alwaysInclude: true,
      tags: ["search", "file", "directory", "code"],
    },
    {
      name: "shell.run",
      capabilityId: "shell.exec",
      policyKey: "shell.run",
      description: "Execute a shell command",
      risk: "high",
      domain: "shell",
      mutates: true,
      alwaysInclude: false,
      tags: ["shell", "command", "run", "execute"],
    },
    {
      name: "patch.apply",
      capabilityId: "patch.apply",
      policyKey: "patch.apply",
      description: "Apply a structured patch to the codebase",
      risk: "high",
      domain: "code",
      mutates: true,
      alwaysInclude: false,
      tags: ["patch", "code", "edit", "modify"],
    },
    {
      name: "done",
      capabilityId: "task.complete",
      policyKey: "task.complete",
      description: "Signal that the task is complete",
      risk: "low",
      domain: "system",
      mutates: false,
      alwaysInclude: true,
      tags: ["done", "complete", "finish"],
    },
    {
      name: "delegate",
      capabilityId: "agent.delegate",
      policyKey: "delegate",
      description: "Delegate a subtask to a sub-agent",
      risk: "medium",
      domain: "agent",
      mutates: true,
      alwaysInclude: false,
      tags: ["delegate", "agent", "subtask"],
    },
    {
      name: "web_search",
      capabilityId: "web.search",
      policyKey: "web.search",
      description: "Search the web",
      risk: "low",
      domain: "network",
      mutates: false,
      alwaysInclude: false,
      tags: ["web", "search"],
      executionProfiles: ["research"],
    },
    {
      name: "web_fetch",
      capabilityId: "web.fetch",
      policyKey: "web.fetch",
      description: "Fetch a web page",
      risk: "medium",
      domain: "network",
      mutates: false,
      alwaysInclude: false,
      tags: ["web", "fetch"],
      executionProfiles: ["research"],
    },
    {
      name: "create_skill",
      capabilityId: "tool.invoke",
      policyKey: "tool.invoke",
      description: "Create a reusable skill",
      risk: "medium",
      domain: "system",
      mutates: true,
      alwaysInclude: false,
      tags: ["skill", "create", "self-extend"],
    },
    {
      name: "list_extensions",
      capabilityId: "tool.invoke",
      policyKey: "tool.invoke",
      description: "List installed extensions",
      risk: "low",
      domain: "system",
      mutates: false,
      alwaysInclude: false,
      tags: ["extension", "list", "self-extend"],
    },
    {
      name: "inspect_extension",
      capabilityId: "tool.invoke",
      policyKey: "tool.invoke",
      description: "Inspect an extension",
      risk: "low",
      domain: "system",
      mutates: false,
      alwaysInclude: false,
      tags: ["extension", "inspect", "self-extend"],
    },
    {
      name: "create_hook",
      capabilityId: "tool.invoke",
      policyKey: "tool.invoke",
      description: "Create a hook",
      risk: "high",
      domain: "system",
      mutates: true,
      alwaysInclude: false,
      tags: ["hook", "create", "self-extend"],
    },
    {
      name: "mcp.*",
      capabilityId: "mcp.invoke",
      policyKey: "mcp.invoke",
      description: "Invoke an MCP server tool",
      risk: "high",
      domain: "mcp",
      mutates: true,
      alwaysInclude: false,
      tags: ["mcp", "tool"],
    },
  ];

  for (const cap of defaults) {
    registry.register(cap);
    idx.index(cap);
  }

  return { registry, index: idx };
}

// ---------------------------------------------------------------------------
// ToolRetriever
// ---------------------------------------------------------------------------

export class ToolRetriever {
  constructor(
    private registry: ToolRegistry,
    private index: CapabilityIndex,
  ) {}

  selectForIntent(intentKeywords: string[]): ToolCapability[] {
    const selected = new Map<string, ToolCapability>();

    // Always include essential tools
    for (const tool of this.registry.getEssential()) {
      selected.set(tool.name, tool);
    }

    // Add tools whose tags match the intent keywords
    const matched = this.index.findByTags(intentKeywords);
    for (const name of matched) {
      const tool = this.registry.lookup(name);
      if (tool) selected.set(tool.name, tool);
    }

    return Array.from(selected.values());
  }

  selectForDomain(domain: ToolDomain): ToolCapability[] {
    return this.registry.getByDomain(domain);
  }
}

// ---------------------------------------------------------------------------
// Derived capability views
// ---------------------------------------------------------------------------
//
// Thin, stateless derived lookups over the canonical default registry
// (`buildDefaultToolIndex`). These are the ONLY reverse/forward capability↔tool
// lookups callers should use. They are computed from the canonical data at call
// time — no reverse mapping is independently maintained, so they cannot drift
// from the registry.

function defaultToolRegistry(): ToolRegistry {
  return buildDefaultToolIndex().registry;
}

/** Names of every tool whose canonical `capabilityId` matches. Sorted for determinism. */
export function getToolsForCapability(capabilityId: string): string[] {
  return defaultToolRegistry()
    .getAll()
    .filter(t => t.capabilityId === capabilityId)
    .map(t => t.name)
    .sort();
}

/** Canonical `capabilityId`(s) for a tool name (`[]` for unknown tools). */
export function getCapabilitiesForTool(toolName: string): string[] {
  const entry = defaultToolRegistry().lookup(toolName);
  return entry ? [entry.capabilityId] : [];
}
