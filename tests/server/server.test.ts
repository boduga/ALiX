/**
 * server.test.ts — Tests for registry API routes.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Registry HTTP API", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "server-registry-test-"));
    // Create card files
    const agentsDir = join(tmpDir, ".alix", "cards", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "custom.json"), JSON.stringify({
      id: "custom.test", name: "Custom", description: "A custom agent",
      version: "1.0.0", domains: ["custom"], capabilities: ["custom.test"],
      enabled: true,
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
});
