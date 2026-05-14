import type { AlixConfig } from "../config/schema.js";
import type { McpServerConfig } from "../config/schema.js";
import type { ToolResult } from "../tools/types.js";
import { McpToolRegistry, RegisteredTool } from "./registry.js";
import { ProcessManager } from "./process-manager.js";
import { McpClient } from "./client.js";
import { mapServerCapabilities, type MappedPolicyRule } from "./capability-mapper.js";

export class McpManager {
  private registry: McpToolRegistry;
  private processManager: ProcessManager;
  private capabilityRules = new Map<string, MappedPolicyRule[]>();

  constructor(private config: AlixConfig) {
    this.registry = new McpToolRegistry();
    this.processManager = new ProcessManager();
  }

  async initialize(): Promise<void> {
    const servers = this.config.mcpServers ?? [];

    for (const serverConfig of servers) {
      try {
        await this.connectServer(serverConfig);
      } catch (err) {
        console.error(`[McpManager] Failed to connect to server '${serverConfig.name}':`, err instanceof Error ? err.message : String(err));
      }
    }

    if (this.config.mcpServerPaths) {
      for (const path of this.config.mcpServerPaths) {
        try {
          await this.autoDiscoverServer(path);
        } catch (err) {
          console.error(`[McpManager] Auto-discover failed for '${path}':`, err instanceof Error ? err.message : String(err));
        }
      }
    }
  }

  private async connectServer(config: McpServerConfig): Promise<void> {
    await this.registry.registerServer(config);

    const client = this.registry.getClient(config.name);
    if (!client) return;

    const tools = await client.listTools();
    if (client.capabilities) {
      const rules = mapServerCapabilities(config.name, client.capabilities, tools);
      this.capabilityRules.set(config.name, rules);
    }
  }

  private async autoDiscoverServer(path: string): Promise<void> {
    const config: McpServerConfig & { type: "stdio" } = {
      type: "stdio",
      name: path,
      command: "npx",
      args: ["--yes", path]
    };

    try {
      await this.connectServer(config);
    } catch {
      const directConfig: McpServerConfig & { type: "stdio" } = {
        type: "stdio",
        name: path,
        command: path
      };
      try {
        await this.connectServer(directConfig);
      } catch {
        // Both failed — skip silently
      }
    }
  }

  async callTool(fullName: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this.registry.callTool(fullName, args);
  }

  listTools(): RegisteredTool[] {
    return this.registry.listTools();
  }

  listServers(): string[] {
    return this.registry.listMcpServers();
  }

  getCapabilityRules(): MappedPolicyRule[] {
    return [...this.capabilityRules.values()].flat();
  }

  async closeServer(name: string): Promise<void> {
    await this.registry.closeServer(name);
    this.capabilityRules.delete(name);
  }

  async closeAll(): Promise<void> {
    await this.processManager.closeAll();
  }
}