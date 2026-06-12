/**
 * tool-registry.ts -- Searchable tool capability index.
 *
 * Pure data structures for registering tool capabilities, indexing them by
 * intent tag, and retrieving subsets by domain, risk, or intent keywords.
 * No execution, no I/O, no side effects.
 *
 * Compatible with existing CompositeToolRouter and ToolName types.
 * No runtime integration with routers or PolicyGate yet.
 */

import type { ToolName } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CapabilityRisk = "low" | "medium" | "high" | "critical";

export type ToolDomain =
  | "filesystem" | "shell" | "network" | "code" | "search"
  | "agent" | "memory" | "policy" | "system" | "mcp";

export type ToolCapability = {
  name: ToolName;
  /** Policy-facing capability ID (e.g. "filesystem.read", "shell.exec") */
  capabilityId: string;
  description: string;
  risk: CapabilityRisk;
  domain: ToolDomain;
  mutates: boolean;
  alwaysInclude: boolean;
  tags: string[];
};

// ---------------------------------------------------------------------------
// ToolRegistry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private tools = new Map<ToolName, ToolCapability>();

  register(capability: ToolCapability): void {
    this.tools.set(capability.name, capability);
  }

  lookup(name: ToolName): ToolCapability | undefined {
    return this.tools.get(name);
  }

  lookupByName(name: string): ToolCapability | undefined {
    return this.tools.get(name as ToolName);
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
  private tagToTools = new Map<IntentTag, ToolName[]>();

  index(capability: ToolCapability): void {
    for (const tag of capability.tags) {
      const existing = this.tagToTools.get(tag) ?? [];
      if (!existing.includes(capability.name)) {
        existing.push(capability.name);
        this.tagToTools.set(tag, existing);
      }
    }
  }

  findByTag(tag: IntentTag): ToolName[] {
    return this.tagToTools.get(tag) ?? [];
  }

  findByTags(tags: IntentTag[]): ToolName[] {
    const results = new Set<ToolName>();
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
      description: "Create or overwrite a file",
      risk: "medium",
      domain: "filesystem",
      mutates: true,
      alwaysInclude: false,
      tags: ["write", "file", "create"],
    },
    {
      name: "file.delete",
      capabilityId: "filesystem.write",
      description: "Delete a file",
      risk: "high",
      domain: "filesystem",
      mutates: true,
      alwaysInclude: false,
      tags: ["delete", "file", "remove"],
    },
    {
      name: "file.exists",
      capabilityId: "filesystem.read",
      description: "Check if a file exists",
      risk: "low",
      domain: "filesystem",
      mutates: false,
      alwaysInclude: false,
      tags: ["read", "file", "check"],
    },
    {
      name: "dir.search",
      capabilityId: "file.search",
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
      description: "Execute a shell command",
      risk: "high",
      domain: "shell",
      mutates: true,
      alwaysInclude: false,
      tags: ["shell", "command", "run", "execute"],
    },
    {
      name: "patch.apply",
      capabilityId: "code.patch",
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
      description: "Signal that the task is complete",
      risk: "low",
      domain: "system",
      mutates: false,
      alwaysInclude: true,
      tags: ["done", "complete", "finish"],
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
    const selected = new Map<ToolName, ToolCapability>();

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
