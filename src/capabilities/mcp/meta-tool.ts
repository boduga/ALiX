export type ToolCatalog = {
  listCategories(): string[];
  byCategory(category: string): Array<{ name: string; description?: string }>;
};

interface ToolDiscovery {
  search(query: string): Promise<{ kind: string; output: string }>;
}

interface SchemaCache {
  get(toolName: string): unknown;
  size: number;
}

export class MetaToolExecutor {
  constructor(
    private deps: {
      catalog?: ToolCatalog;
      discovery?: ToolDiscovery;
      schemaCache?: SchemaCache;
    }
  ) {}

  async execute(cmd: { command: string; args: Record<string, unknown> }): Promise<string> {
    switch (cmd.command) {
      case "catalog.list":
        return this.listCategories();
      case "catalog.by_category":
        return this.byCategory(cmd.args.category as string);
      case "tools.search":
        return this.searchTools(cmd.args.query as string);
      case "schema.get":
        return this.getSchema(cmd.args.toolName as string);
      case "schema.list":
        return this.listSchemas();
      default:
        throw new Error(`Unknown meta-tool command: ${cmd.command}`);
    }
  }

  private listCategories(): string {
    const catalog = this.deps.catalog;
    if (!catalog) return "ToolCatalog not available";

    const categories = catalog.listCategories();
    const lines = categories.map((c: string) => {
      const tools = catalog.byCategory(c as any);
      return `  ${c} (${tools.length} tools)`;
    });
    return `Available categories:\n${lines.join("\n")}`;
  }

  private byCategory(category: string): string {
    const catalog = this.deps.catalog;
    if (!catalog) return "ToolCatalog not available";

    const tools = catalog.byCategory(category as any);
    if (tools.length === 0) {
      return `No tools in category: ${category}`;
    }

    const lines = tools.map((t: any) => `  - ${t.name}: ${t.description ?? ""}`);
    return `Tools in ${category}:\n${lines.join("\n")}`;
  }

  private async searchTools(query: string): Promise<string> {
    const discovery = this.deps.discovery;
    if (!discovery) return "ToolDiscovery not available";

    const result = await discovery.search(query);
    return result.output;
  }

  private getSchema(toolName: string): string {
    const cache = this.deps.schemaCache;
    if (!cache) return "SchemaCache not available";

    const schema = cache.get(toolName);
    if (!schema) {
      return `Schema not found for: ${toolName}`;
    }

    return JSON.stringify(schema, null, 2);
  }

  private listSchemas(): string {
    const cache = this.deps.schemaCache;
    if (!cache) return "SchemaCache not available";

    return `Cached schemas: ${cache.size} tools`;
  }
}