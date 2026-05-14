import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { McpServerConfig } from "../config/schema.js";
import { McpClient } from "./client.js";
import { StdioTransport } from "./transports/stdio-transport.js";

export class ProcessManager {
  private processes = new Map<string, {
    proc: ChildProcess;
    transport: StdioTransport;
    client: McpClient;
    lastUsed: number;
  }>();

  async getOrCreate(
    name: string,
    config: McpServerConfig & { type: "stdio" }
  ): Promise<McpClient> {
    const existing = this.processes.get(name);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    const proc = spawn(config.command, config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...config.env }
    });

    const transport = new StdioTransport(name, proc);
    const client = new McpClient(transport);
    await client.initialize();

    this.processes.set(name, {
      proc,
      transport,
      client,
      lastUsed: Date.now()
    });

    return client;
  }

  async closeServer(name: string): Promise<void> {
    const entry = this.processes.get(name);
    if (!entry) return;

    await entry.transport.close();
    entry.proc.kill();
    this.processes.delete(name);
  }

  async closeIdle(timeoutMs = 300_000): Promise<void> {
    const now = Date.now();
    for (const [name, entry] of this.processes) {
      if (now - entry.lastUsed > timeoutMs) {
        await this.closeServer(name);
      }
    }
  }

  async closeAll(): Promise<void> {
    for (const name of [...this.processes.keys()]) {
      await this.closeServer(name);
    }
  }

  listActiveServers(): string[] {
    return [...this.processes.keys()];
  }
}