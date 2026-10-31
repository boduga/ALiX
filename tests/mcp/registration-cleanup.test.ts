import test from "node:test";
import assert from "node:assert/strict";
import { McpToolRegistry } from "../../src/capabilities/mcp/registry.js";
import type { McpTransport } from "../../src/capabilities/mcp/transport.js";

for (const failure of ["initialize", "tools/list"] as const) for (const closeFails of [false, true]) {
  test(`failed ${failure} registration closes its transport (cleanup rejects: ${closeFails})`, async t => {
    const registry = new McpToolRegistry();
    const original = new Error(`${failure} failed`);
    let closed = 0;
    const transport: McpTransport = {
      name: "broken", type: "stdio",
      async connect() {},
      async send(message) {
        if (message.method === failure) throw original;
        return { jsonrpc: "2.0", id: message.id, result: {
          capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" },
        } };
      },
      async sendNotification() {},
      onMessage() {},
      async close() { closed++; if (closeFails) throw new Error("cleanup failed"); },
    };
    t.mock.method(registry, "createTransport", () => transport);
    await assert.rejects(registry.registerServer({ name: "broken", type: "stdio", command: "unused" }), error => error === original);
    assert.equal(closed, 1);
    assert.deepEqual(registry.listMcpServers(), []);
    assert.deepEqual(registry.listTools(), []);
  });
}
