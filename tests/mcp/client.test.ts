import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { McpClient } from "../../src/mcp/client.js";
import type { McpTransport } from "../../src/mcp/transport.js";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../../src/mcp/types.js";

function makeMockTransport(): McpTransport & {
  responses: JsonRpcResponse[];
  notifications: JsonRpcNotification[];
  onMessageHandler: ((msg: JsonRpcResponse | JsonRpcNotification) => void) | null;
} {
  return {
    name: "mock-stdio",
    type: "stdio" as const,
    responses: [],
    notifications: [],
    onMessageHandler: null,
    async connect() {},
    async send(req: JsonRpcRequest): Promise<JsonRpcResponse> {
      const resp = this.responses.shift();
      if (!resp) throw new Error("No mock response for: " + req.method);
      return resp;
    },
    async sendNotification(n: JsonRpcNotification) {
      this.notifications.push(n);
    },
    onMessage(handler) {
      this.onMessageHandler = handler;
    },
    async close() {},
  };
}

describe("McpClient", () => {
  let transport: ReturnType<typeof makeMockTransport>;

  beforeEach(() => {
    transport = makeMockTransport();
  });

  it("initializes and returns capabilities", async () => {
    transport.responses.push({
      jsonrpc: "2.0",
      id: "1",
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "test-server", version: "1.0.0" }
      }
    });

    const client = new McpClient(transport);
    const caps = await client.initialize("test-client", "2.0");
    assert.deepEqual(caps, { tools: {} });
    assert.equal(client.serverInfo?.name, "test-server");
    assert.equal(client.serverInfo?.version, "1.0.0");
  });

  it("throws on initialize error", async () => {
    transport.responses.push({
      jsonrpc: "2.0",
      id: "1",
      error: { code: -32600, message: "Invalid version" }
    });

    const client = new McpClient(transport);
    await assert.rejects(
      client.initialize(),
      /Initialize failed/
    );
  });

  it("lists tools and caches result", async () => {
    transport.responses.push({
      jsonrpc: "2.0",
      id: "1",
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "srv", version: "1.0" }
      }
    });
    transport.responses.push({
      jsonrpc: "2.0",
      id: "2",
      result: {
        tools: [
          { name: "tool-a", description: "A tool", inputSchema: { type: "object" } },
          { name: "tool-b", description: "B tool", inputSchema: { type: "object" } }
        ]
      }
    });

    const client = new McpClient(transport);
    await client.initialize();
    const tools = await client.listTools();

    assert.equal(tools.length, 2);
    assert.equal(tools[0].name, "tool-a");
    assert.equal(tools[1].name, "tool-b");

    // Second call returns cached
    const tools2 = await client.listTools();
    assert.equal(tools2.length, 2);
    assert.equal(transport.responses.length, 0); // no new request made
  });

  it("calls a tool", async () => {
    transport.responses.push({
      jsonrpc: "2.0",
      id: "1",
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "srv", version: "1.0" }
      }
    });
    transport.responses.push({
      jsonrpc: "2.0",
      id: "2",
      result: {
        content: [{ type: "text", text: "done" }],
        isError: false
      }
    });

    const client = new McpClient(transport);
    await client.initialize();
    const result = await client.callTool("echo", { msg: "hello" });

    assert.equal(result.content[0].text, "done");
    assert.equal(result.isError, false);
  });

  it("throws on tool call error", async () => {
    transport.responses.push({
      jsonrpc: "2.0",
      id: "1",
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "srv", version: "1.0" }
      }
    });
    transport.responses.push({
      jsonrpc: "2.0",
      id: "2",
      error: { code: -32600, message: "Unknown tool" }
    });

    const client = new McpClient(transport);
    await client.initialize();
    await assert.rejects(
      client.callTool("unknown"),
      /tools\/call failed/
    );
  });

  it("getter returns null before initialize", () => {
    const client = new McpClient(transport);
    assert.equal(client.capabilities, null);
    assert.equal(client.serverInfo, null);
    assert.deepEqual(client.tools, []);
  });

  it("close calls transport close", async () => {
    let closed = false;
    const t = makeMockTransport();
    t.close = async () => { closed = true; };
    const client = new McpClient(t);
    await client.close();
    assert.equal(closed, true);
  });
});