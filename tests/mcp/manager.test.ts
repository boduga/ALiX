import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { McpManager } from "../../src/mcp/manager.js";
import type { AlixConfig } from "../../src/config/schema.js";

function makeConfig(overrides: Partial<AlixConfig> = {}): AlixConfig {
  return {
    version: 1 as const,
    model: { provider: "anthropic", name: "claude-3-5-sonnet-20241022" },
    ui: { enabled: true, host: "localhost", port: 3000, transport: "sse" as const },
    context: { repoMap: true, maxRepoMapTokens: 4096, repoMapMode: "lite" as const, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process" as const, shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
    permissions: { protectedPaths: [], denyCommands: [], default: "ask" as const, tools: {}, allowNetworkDomains: [] },
    ...overrides,
  };
}

describe("McpManager", () => {
  it("creates with config", () => {
    const manager = new McpManager(makeConfig());
    assert.ok(manager instanceof McpManager);
  });

  it("listTools returns empty array before initialization", () => {
    const manager = new McpManager(makeConfig());
    const tools = manager.listTools();
    assert.deepEqual(tools, []);
  });

  it("listServers returns empty array before initialization", () => {
    const manager = new McpManager(makeConfig());
    const servers = manager.listServers();
    assert.deepEqual(servers, []);
  });

  it("getCapabilityRules returns empty array before initialization", () => {
    const manager = new McpManager(makeConfig());
    const rules = manager.getCapabilityRules();
    assert.deepEqual(rules, []);
  });

  it("getClient returns undefined before initialization", () => {
    const manager = new McpManager(makeConfig());
    const client = manager.getClient("any-server");
    assert.equal(client, undefined);
  });

  it("initialize handles empty mcpServers gracefully", async () => {
    const manager = new McpManager(makeConfig({ mcpServers: [] }));
    await manager.initialize(); // should not throw
  });

  it("initialize handles missing mcpServers gracefully", async () => {
    const manager = new McpManager(makeConfig());
    await manager.initialize(); // should not throw
  });

  it("closeAll does not throw", async () => {
    const manager = new McpManager(makeConfig());
    await manager.closeAll(); // should not throw
  });

  it("closeServer does not throw for unknown server", async () => {
    const manager = new McpManager(makeConfig());
    await manager.closeServer("nonexistent");
  });
});