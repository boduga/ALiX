/**
 * server.test.ts — Tests for registry API routes.
 *
 * Validates card loading from disk, default fallback,
 * and live HTTP endpoint responses.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { get } from "node:http";

describe("Registry HTTP API", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "server-registry-test-"));
    // Create agent card files
    const agentsDir = join(tmpDir, ".alix", "cards", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "custom.json"), JSON.stringify({
      id: "custom.test", name: "Custom", description: "A custom agent",
      version: "1.0.0", domains: ["custom"], capabilities: ["custom.test"],
      enabled: true,
    }));
    // Create tool card files
    const toolsDir = join(tmpDir, ".alix", "cards", "tools");
    mkdirSync(toolsDir, { recursive: true });
    writeFileSync(join(toolsDir, "search.json"), JSON.stringify({
      id: "custom.search", name: "Custom Search", description: "A custom search tool",
      version: "1.0.0", capabilities: ["custom.search"], riskLevel: "low",
      approvalMode: "auto", sideEffects: "read", enabled: true,
    }));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadCardRegistry loads custom card from disk", async () => {
    const { loadCardRegistry } = await import("../../src/registry/card-loader.js");
    const registry = await loadCardRegistry(tmpDir);
    const agents = registry.listAgents(true);
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "custom.test");
  });

  it("default registry when no cards dir exists", async () => {
    const { loadCardRegistry, defaultAgentCards, defaultToolCards } = await import("../../src/registry/card-loader.js");
    const blankDir = mkdtempSync(join(tmpdir(), "server-registry-blank-"));
    try {
      const registry = await loadCardRegistry(blankDir);
      assert.equal(registry.listAgents(true).length, defaultAgentCards().length);
      assert.equal(registry.listTools(true).length, defaultToolCards().length);
    } finally {
      rmSync(blankDir, { recursive: true, force: true });
    }
  });

  it("GET /api/registry/agents returns JSON array", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      const body = await httpGet(`${url}/api/registry/agents`);
      const data = JSON.parse(body);
      assert.ok(Array.isArray(data), "response should be an array");
      assert.ok(data.length >= 1, "should have at least the custom agent");
      const custom = data.find((a: any) => a.id === "custom.test");
      assert.ok(custom, "custom.test agent should be present");
      assert.equal(custom.name, "Custom");
    } finally {
      await close();
    }
  });

  it("GET /api/registry/tools returns JSON array with custom tool", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    try {
      const body = await httpGet(`${url}/api/registry/tools`);
      const data = JSON.parse(body);
      assert.ok(Array.isArray(data), "response should be an array");
      assert.ok(data.length >= 1, "should have at least the custom tool");
      const custom = data.find((t: any) => t.id === "custom.search");
      assert.ok(custom, "custom.search tool should be present");
      assert.equal(custom.name, "Custom Search");
    } finally {
      await close();
    }
  });
});

/**
 * Helper: perform an HTTP GET and return the full body as a string.
 */
async function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => void (body += chunk));
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}
