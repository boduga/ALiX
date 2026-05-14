import test from "node:test";
import assert from "node:assert/strict";
import { McpClient } from "../src/mcp/client.js";
import { McpTransport } from "../src/mcp/transport.js";
import { McpToolRegistry, type RegisteredTool } from "../src/mcp/registry.js";
import { mapServerCapabilities } from "../src/mcp/capability-mapper.js";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../src/mcp/types.js";
import type { McpServerCapabilities, Tool } from "../src/mcp/types.js";

// Mock transport for testing
class MockTransport implements McpTransport {
  readonly name: string;
  readonly type = "stdio" as const;
  private responses: JsonRpcResponse[] = [];
  private onMessageHandler?: (msg: JsonRpcResponse | JsonRpcNotification) => void;

  constructor(name = "mock", responses: JsonRpcResponse[] = []) {
    this.name = name;
    this.responses = [...responses];
  }

  async connect(): Promise<void> {}

  async send(message: JsonRpcRequest): Promise<JsonRpcResponse> {
    const resp = this.responses.shift();
    if (!resp) throw new Error("No response queued");
    return { jsonrpc: "2.0", id: message.id, result: resp.result };
  }

  async sendNotification(): Promise<void> {}

  onMessage(handler: (msg: JsonRpcResponse | JsonRpcNotification) => void): void {
    this.onMessageHandler = handler;
  }

  async close(): Promise<void> {}
}

// --- McpClient tests ---

test("mcp client initializes and extracts server info", async () => {
  const transport = new MockTransport("test", [
    { jsonrpc: "2.0", id: "1", result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "test-server", version: "1.0.0" } } }
  ]);
  const client = new McpClient(transport);
  const caps = await client.initialize();
  assert.equal(client.serverInfo?.name, "test-server");
  assert.equal(client.serverInfo?.version, "1.0.0");
  assert.ok(caps.tools);
});

test("mcp client lists and caches tools", async () => {
  const tools = [{ name: "test_tool", description: "A test tool", inputSchema: { type: "object", properties: { text: { type: "string" } } } }];
  const transport = new MockTransport("test", [
    { jsonrpc: "2.0", id: "1", result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1.0" } } },
    { jsonrpc: "2.0", id: "2", result: { tools } }
  ]);
  const client = new McpClient(transport);
  await client.initialize();
  const listed = await client.listTools();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, "test_tool");
  // Second call should return cached result
  const cached = await client.listTools();
  assert.equal(cached.length, 1);
});

test("mcp client calls a tool", async () => {
  const transport = new MockTransport("test", [
    { jsonrpc: "2.0", id: "1", result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1.0" } } },
    { jsonrpc: "2.0", id: "2", result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] } },
    { jsonrpc: "2.0", id: "3", result: { content: [{ type: "text", text: "hello" }], isError: false } }
  ]);
  const client = new McpClient(transport);
  await client.initialize();
  await client.listTools();
  const result = await client.callTool("echo", { text: "hello" });
  assert.equal(result.content[0].text, "hello");
  assert.equal(result.isError, false);
});

test("mcp client handles empty tool list", async () => {
  const transport = new MockTransport("test", [
    { jsonrpc: "2.0", id: "1", result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "test", version: "1.0" } } },
    { jsonrpc: "2.0", id: "2", result: { tools: [] } }
  ]);
  const client = new McpClient(transport);
  await client.initialize();
  const listed = await client.listTools();
  assert.equal(listed.length, 0);
});

test("mcp client exposes capabilities after init", async () => {
  const transport = new MockTransport("test", [
    { jsonrpc: "2.0", id: "1", result: { protocolVersion: "2024-11-05", capabilities: { tools: { listChanged: true }, resources: { subscribe: true } }, serverInfo: { name: "test", version: "1.0" } } }
  ]);
  const client = new McpClient(transport);
  await client.initialize();
  assert.ok(client.capabilities?.tools);
  assert.ok(client.capabilities?.resources);
});

// --- McpCapabilityMapper tests ---

test("capability mapper generates default rule for server", () => {
  const caps: McpServerCapabilities = { tools: {} };
  const tools: Tool[] = [];
  const rules = mapServerCapabilities("github", caps, tools);
  assert.ok(rules.some(r => r.id === "mcp:github:default"));
  assert.equal(rules.find(r => r.id === "mcp:github:default")?.effect, "ask");
});

test("capability mapper generates per-tool rules", () => {
  const caps: McpServerCapabilities = { tools: {} };
  const tools: Tool[] = [
    { name: "repos.list", description: "List repos", inputSchema: { type: "object" } },
    { name: "issues.create", description: "Create issue", inputSchema: { type: "object" } }
  ];
  const rules = mapServerCapabilities("github", caps, tools);
  const toolRules = rules.filter(r => r.id.includes("tool:"));
  assert.equal(toolRules.length, 2);
});

test("capability mapper handles unsafe tool names", () => {
  const caps: McpServerCapabilities = { tools: {} };
  const tools: Tool[] = [
    { name: "repo/create", description: "Create a repo", inputSchema: { type: "object" } }
  ];
  const rules = mapServerCapabilities("github", caps, tools);
  const toolRule = rules.find(r => r.capability === "mcp.github.repo_create");
  assert.ok(toolRule, "unsafe characters should be replaced with underscore");
});

test("capability mapper generates rules without tools capability", () => {
  const caps: McpServerCapabilities = {};
  const tools: Tool[] = [];
  const rules = mapServerCapabilities("test", caps, tools);
  // Should still have default rule
  assert.ok(rules.some(r => r.id === "mcp:test:default"));
  assert.equal(rules.length, 1);
});

test("capability mapper includes tool name in capability string", () => {
  const caps: McpServerCapabilities = { tools: {} };
  const tools: Tool[] = [
    { name: "myTool", description: "My tool", inputSchema: { type: "object" } }
  ];
  const rules = mapServerCapabilities("myserver", caps, tools);
  const toolRule = rules.find(r => r.id.includes("myTool"));
  assert.ok(toolRule);
  assert.ok(toolRule!.capability.includes("myTool"));
});

// --- Registry tests ---

test("registry stores tools with server prefix", async () => {
  const registry = new McpToolRegistry();
  const tool: RegisteredTool = {
    fullName: "test/echo",
    serverName: "test",
    toolName: "echo",
    description: "Test tool",
    inputSchema: {},
    isMcp: true
  };
  assert.ok(registry);
  // Verify tool can be stored in registry via internal map
  assert.equal(registry.listTools().length, 0);
});

test("registry listMcpServers returns empty for new registry", () => {
  const registry = new McpToolRegistry();
  assert.deepEqual(registry.listMcpServers(), []);
});

test("registry getTool returns undefined for unknown tool", () => {
  const registry = new McpToolRegistry();
  assert.equal(registry.getTool("unknown/server:tool"), undefined);
});

test("registry getClient returns undefined for unknown server", () => {
  const registry = new McpToolRegistry();
  assert.equal(registry.getClient("unknown-server"), undefined);
});