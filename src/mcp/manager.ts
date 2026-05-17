import type { AlixConfig } from "../config/schema.js";
import type { McpServerConfig } from "../config/schema.js";
import type { ToolResult } from "../tools/types.js";
import { McpToolRegistry, RegisteredTool } from "./registry.js";
import { ProcessManager } from "./process-manager.js";
import { McpClient } from "./client.js";
import { mapServerCapabilities, type MappedPolicyRule } from "./capability-mapper.js";

import { McpToolDeferral } from "./tool-deferral.js";

export class McpManager {
  private registry: McpToolRegistry;
  private processManager: ProcessManager;
  private capabilityRules = new Map<string, MappedPolicyRule[]>();
  private _deferral: McpToolDeferral | null = null;

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
    try {
      await this.registry.registerServer(config);
    } catch (err) {
      // Remove any partial state left behind by a failed registration
      this.registry.closeServer(config.name);
      throw err;
    }

    const client = this.registry.getClient(config.name);
    if (!client) return;

    if (this._deferral) {
      this._deferral.clearServerCache(config.name);
    }

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

  getClient(serverName: string): McpClient | undefined {
    return this.registry.getClient(serverName);
  }

  getDeferral(cacheOptions?: { ttlMs?: number; maxSize?: number }): McpToolDeferral {
    if (!this._deferral) this._deferral = new McpToolDeferral(this.registry, cacheOptions);
    return this._deferral;
  }

  async closeServer(name: string): Promise<void> {
    await this.registry.closeServer(name);
    this.capabilityRules.delete(name);
    if (this._deferral) this._deferral.clearServerCache(name);
  }

    async discoverServer(packageName: string): Promise<{ name: string; version: string; toolCount: number; toolNames: string[] }> {
    const config: McpServerConfig & { type: "stdio" } = {
      type: "stdio",
      name: packageName,
      command: "uvx",
      args: [packageName]
    };
    try {
      await this.connectServer(config);
    } catch {
      // Fall back to npx
      const npxConfig: McpServerConfig & { type: "stdio" } = {
        type: "stdio",
        name: packageName,
        command: "npx",
        args: ["--yes", packageName]
      };
      try {
        await this.connectServer(npxConfig);
      } catch {
        throw new Error(`Could not connect to '${packageName}'. Is it a valid MCP server package?`);
      }
    }
    const client = this.registry.getClient(packageName);
    if (!client?.serverInfo) throw new Error(`Connected but no server info for '${packageName}'`);
    const tools = await client.listTools();
    return {
      name: client.serverInfo.name,
      version: client.serverInfo.version,
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name)
    };
  }

  async closeAll(): Promise<void> {
    await this.processManager.closeAll();
    // Close any discoverServer-ad-hoc clients that are tracked in the registry
    // but not managed by processManager (e.g. discoverServer's temp processes).
    for (const name of this.registry.listMcpServers()) {
      await this.registry.closeServer(name);
    }
  }
}