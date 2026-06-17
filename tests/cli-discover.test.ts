import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { McpManager } from "../src/mcp/manager.js";
import { loadConfig } from "../src/config/loader.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

test("discoverServer returns correct info for mcp-server-fetch", { timeout: 120_000 }, async () => {
  const config = await loadConfig(__dirname, { requireModel: false });
  if (!config.model) {
    config.model = { provider: "cli", name: "test-model" };
  }
  const mcpManager = new McpManager(config);
  await mcpManager.initialize();

  try {
    const info = await mcpManager.discoverServer("mcp-server-fetch");

    // Should return a valid info object
    assert.ok(typeof info.name === "string", "name should be a string");
    assert.ok(typeof info.version === "string", "version should be a string");
    assert.ok(typeof info.toolCount === "number", "toolCount should be a number");
    assert.ok(Array.isArray(info.toolNames), "toolNames should be an array");

    // Tool count should match the array length
    assert.equal(info.toolCount, info.toolNames.length, "toolCount should equal toolNames.length");

    // Should have discovered at least one tool
    assert.ok(info.toolCount > 0, "should discover at least one tool");

    // Tool names should be non-empty strings
    for (const t of info.toolNames) {
      assert.ok(typeof t === "string" && t.length > 0, `tool name should be a non-empty string, got: ${JSON.stringify(t)}`);
    }
  } finally {
    await mcpManager.closeAll().catch(() => {});
  }
});

test("discoverServer throws for unknown package", { timeout: 60_000 }, async () => {
  const config = await loadConfig(__dirname, { requireModel: false });
  if (!config.model) {
    config.model = { provider: "cli", name: "test-model" };
  }
  const mcpManager = new McpManager(config);
  await mcpManager.initialize();

  try {
    await assert.rejects(
      mcpManager.discoverServer("this-package-definitely-does-not-exist-12345"),
      (err: Error) => {
        assert.ok(true, "discoverServer throws on unknown package (any error message is acceptable)");
        return true;
      }
    );
  } finally {
    await mcpManager.closeAll().catch(() => {});
  }
});
