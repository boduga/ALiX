/**
 * card-loader.test.ts — Tests for card loading from disk and defaults.
 *
 * Each test uses an isolated temp directory to avoid cross-test pollution.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCardRegistry, defaultAgentCards, defaultToolCards } from "../../src/registry/card-loader.js";

function makeTemp(): string {
  return mkdtempSync(join(tmpdir(), "card-loader-test-"));
}

function writeAgent(dir: string, id: string, overrides: Record<string, unknown> = {}) {
  const agentsDir = join(dir, ".alix", "cards", "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, `${id}.json`), JSON.stringify({
    id,
    name: "Test Agent",
    description: "A test agent card",
    version: "1.0.0",
    domains: ["general"],
    capabilities: ["test.op"],
    enabled: true,
    ...overrides,
  }));
}

function writeTool(dir: string, id: string, overrides: Record<string, unknown> = {}) {
  const toolsDir = join(dir, ".alix", "cards", "tools");
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(join(toolsDir, `${id}.json`), JSON.stringify({
    id,
    name: "Test Tool",
    description: "A test tool card",
    version: "1.0.0",
    capabilities: ["test.op"],
    riskLevel: "low",
    approvalMode: "auto",
    sideEffects: "read",
    enabled: true,
    ...overrides,
  }));
}

describe("CardLoader", () => {
  it("loads default cards when no card files exist", async () => {
    const tmp = makeTemp();
    try {
      const registry = await loadCardRegistry(tmp);
      assert.equal(registry.listAgents().length, defaultAgentCards().length);
      assert.equal(registry.listTools().length, defaultToolCards().length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loads agent cards from .alix/cards/agents/", async () => {
    const tmp = makeTemp();
    try {
      writeAgent(tmp, "test.custom");
      const registry = await loadCardRegistry(tmp);
      const agent = registry.getAgent("test.custom");
      assert.ok(agent);
      assert.equal(agent?.name, "Test Agent");
      // Disk cards found → no defaults loaded
      assert.equal(registry.listAgents().length, 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loads tool cards from .alix/cards/tools/", async () => {
    const tmp = makeTemp();
    try {
      writeTool(tmp, "test.tool");
      const registry = await loadCardRegistry(tmp);
      const tools = registry.findToolsByCapability("test.op");
      assert.equal(tools.length, 1);
      assert.equal(tools[0].id, "test.tool");
      assert.equal(registry.listTools().length, 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("loads both agents and tools from disk together", async () => {
    const tmp = makeTemp();
    try {
      writeAgent(tmp, "disk.agent");
      writeTool(tmp, "disk.tool");
      const registry = await loadCardRegistry(tmp);
      assert.equal(registry.listAgents().length, 1);
      assert.equal(registry.listTools().length, 1);
      assert.ok(registry.getAgent("disk.agent"));
      assert.equal(registry.findToolsByCapability("test.op").length, 1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("skips invalid card files without crashing", async () => {
    const tmp = makeTemp();
    try {
      const agentsDir = join(tmp, ".alix", "cards", "agents");
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, "bad.json"), "not valid json");

      const registry = await loadCardRegistry(tmp);
      // bad.json fails parse → no valid cards loaded → falls back to defaults
      assert.equal(registry.listAgents().length, defaultAgentCards().length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("returns defaults when card dirs exist but are empty", async () => {
    const tmp = makeTemp();
    try {
      mkdirSync(join(tmp, ".alix", "cards", "agents"), { recursive: true });
      mkdirSync(join(tmp, ".alix", "cards", "tools"), { recursive: true });
      const registry = await loadCardRegistry(tmp);
      // Dirs exist but have no .json files → falls back to defaults
      assert.equal(registry.listAgents().length, defaultAgentCards().length);
      assert.equal(registry.listTools().length, defaultToolCards().length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("defaultAgentCards returns expected set", () => {
    const cards = defaultAgentCards();
    assert.ok(cards.find(c => c.id === "orchestrator.core"));
    assert.ok(cards.find(c => c.id === "research.scout"));
    assert.equal(cards.length, 6);
  });

  it("defaultToolCards returns expected set", () => {
    const cards = defaultToolCards();
    assert.ok(cards.find(c => c.id === "web_search"));
    assert.ok(cards.find(c => c.id === "shell_exec"));
    assert.equal(cards.length, 4);
  });
});
