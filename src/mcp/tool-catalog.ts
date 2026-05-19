export type ToolCategory = "file" | "shell" | "git" | "network" | "browser" | "mcp" | "custom";
export type TrustLevel = "builtin" | "project" | "user" | "remote";

export type ToolDescriptor = {
  tool: any;
  category: ToolCategory;
  capabilities: string[];
  trustLevel: TrustLevel;
  registeredAt: string;
};

export type CatalogOptions = {
  includeCategories?: ToolCategory[];
  excludeCategories?: ToolCategory[];
  requireApproval?: TrustLevel[];
};

function inferCategory(toolName: string): ToolCategory {
  const name = toolName.toLowerCase();
  if (name.includes("file") || name.includes("read") || name.includes("write")) return "file";
  if (name.includes("shell") || name.includes("exec") || name.includes("run")) return "shell";
  if (name.includes("git")) return "git";
  if (name.includes("http") || name.includes("fetch") || name.includes("network")) return "network";
  if (name.includes("browser") || name.includes("web")) return "browser";
  if (name.includes("mcp_")) return "mcp";
  return "custom";
}

function inferTrustLevel(serverName: string): TrustLevel {
  if (["builtin", "filesystem", "shell", "git"].includes(serverName)) return "builtin";
  if (serverName.includes("project")) return "project";
  return "remote";
}

export class ToolCatalog {
  private descriptors: Map<string, ToolDescriptor> = new Map();

  register(tool: any & { category?: ToolCategory; trustLevel?: TrustLevel }): void {
    const name = tool.name;
    const category = tool.category ?? inferCategory(name);
    const trustLevel = tool.trustLevel ?? inferTrustLevel(tool.serverName);

    this.descriptors.set(name, {
      tool,
      category,
      capabilities: [name],
      trustLevel,
      registeredAt: new Date().toISOString(),
    });
  }

  listCategories(): ToolCategory[] {
    const cats = new Set<ToolCategory>();
    for (const d of this.descriptors.values()) {
      cats.add(d.category);
    }
    return [...cats];
  }

  byCategory(category: ToolCategory): any[] {
    return [...this.descriptors.values()]
      .filter(d => d.category === category)
      .map(d => d.tool);
  }

  byTrustLevel(level: TrustLevel): any[] {
    return [...this.descriptors.values()]
      .filter(d => d.trustLevel === level)
      .map(d => d.tool);
  }

  listToolNames(): string[] {
    return [...this.descriptors.keys()];
  }

  get size(): number {
    return this.descriptors.size;
  }
}