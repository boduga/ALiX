import type { McpServerConfig } from "../config/schema.js";
import type { McpTransport } from "./transport.js";
import type { Tool } from "./types.js";
import type { ToolResult } from "../tools/types.js";
import { McpClient } from "./client.js";
import { StdioTransport } from "./transports/stdio-transport.js";
import { HttpTransport } from "./transports/http-transport.js";
import { WebSocketTransport } from "./transports/websocket-transport.js";
import { spawn } from "node:child_process";

export interface RegisteredTool {
  fullName: string;     // e.g., "github/repos.list"
  serverName: string;  // e.g., "github"
  toolName: string;     // e.g., "repos.list"
  description?: string;
  inputSchema: Record<string, unknown>;
  isMcp: boolean;
}

export class McpToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private clients = new Map<string, McpClient>();

  createTransport(config: McpServerConfig): McpTransport {
    switch (config.type) {
      case "stdio": {
        const proc = spawn(config.command, config.args ?? [], {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...config.env }
        });
        return new StdioTransport(config.name, proc);
      }
      case "http":
        return new HttpTransport(config.name, config.url, config.headers);
      case "websocket":
        return new WebSocketTransport(config.name, config.url, config.headers);
    }
  }

  async registerServer(config: McpServerConfig): Promise<void> {
    const transport = this.createTransport(config);
    const client = new McpClient(transport);
    // Let errors propagate — McpManager catches them per-server
    await client.initialize();

    this.clients.set(config.name, client);

    const tools = await client.listTools();
    for (const tool of tools) {
      // MCP servers may prefix tool.name with server name (e.g. "fetch/fetch").
      // Strip the prefix so fullName is always "server/tool" without duplication.
      const cleanName = tool.name.startsWith(`${config.name}/`)
        ? tool.name.slice(config.name.length + 1)
        : tool.name;
      const fullName = `${config.name}/${cleanName}`;
      this.tools.set(fullName, {
        fullName,
        serverName: config.name,
        toolName: cleanName,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        isMcp: true
      });
    }
  }

  getTool(fullName: string): RegisteredTool | undefined {
    return this.tools.get(fullName);
  }

  listTools(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  listMcpServers(): string[] {
    return [...this.clients.keys()];
  }

  getClient(serverName: string): McpClient | undefined {
    return this.clients.get(serverName);
  }

  async callTool(fullName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(fullName);
    if (!tool) {
      return { kind: "error", message: `Unknown MCP tool: ${fullName}` };
    }

    const client = this.clients.get(tool.serverName);
    if (!client) {
      return { kind: "error", message: `MCP server '${tool.serverName}' is not connected` };
    }

    try {
      const result = await client.callTool(tool.toolName, args);
      const content = result.content
        .map(c => c.type === "text" ? c.text ?? "" : JSON.stringify(c))
        .join("\n");

      return result.isError
        ? { kind: "error", message: content }
        : { kind: "success", output: content };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }

  async closeServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.close();
      this.clients.delete(name);
    }

    for (const key of [...this.tools.keys()]) {
      if (key.startsWith(`${name}/`)) {
        this.tools.delete(key);
      }
    }
  }
}