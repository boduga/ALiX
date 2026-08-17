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
import { buildDefaultToolIndex } from "../../src/tools/tool-registry.js";

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
    assert.ok(cards.find(c => c.id === "workflow.execution")); assert.equal(cards.length, 11);
  });

  it("defaultToolCards returns expected set", () => {
    const cards = defaultToolCards();
    // 16 cards — one per canonical tool registry entry
    assert.equal(cards.length, buildDefaultToolIndex().registry.getAll().length);
    assert.equal(cards.length, 16);
    // ids are the canonical tool names
    assert.ok(cards.find(c => c.id === "web_search"));
    assert.ok(cards.find(c => c.id === "file.read"));
    assert.ok(cards.find(c => c.id === "shell.run"));
    assert.ok(cards.find(c => c.id === "mcp.*"));
    // the old hand-written card ids are GONE
    assert.ok(!cards.find(c => c.id === "shell_exec"));
    assert.ok(!cards.find(c => c.id === "file_write"));
    assert.ok(!cards.find(c => c.id === "file_read"));
    // capability/risk/approval/side-effect projection from canonical registry
    const web = cards.find(c => c.id === "web_search")!;
    assert.deepEqual(web.capabilities, ["web.search"]);
    assert.equal(web.riskLevel, "low");
    assert.equal(web.approvalMode, "auto");
    const shell = cards.find(c => c.id === "shell.run")!;
    assert.deepEqual(shell.capabilities, ["shell.exec"]);
    assert.equal(shell.riskLevel, "high");
    assert.equal(shell.approvalMode, "ask");
    assert.equal(shell.sideEffects, "write"); // shell.run mutates
    const fileRead = cards.find(c => c.id === "file.read")!;
    assert.equal(fileRead.sideEffects, "read"); // file.read does not mutate
    const fileCreate = cards.find(c => c.id === "file.create")!;
    assert.deepEqual(fileCreate.allowedExecutionProfiles, ["artifact"]);
    // display-name projection
    assert.equal(web.name, "Web Search");
    assert.equal(cards.find(c => c.id === "mcp.*")!.name, "MCP Tool");
  });

  // --- partial-config regression tests (per-kind independent defaulting) ---
  // Previously a single `hasFiles` flag meant a tools-only dir suppressed the
  // AGENT defaults (and vice versa). Each kind must default independently.

  it("tools-only config: agents fall back to defaults, tools = custom only", async () => {
    const tmp = makeTemp();
    try {
      writeTool(tmp, "test.tool");
      const registry = await loadCardRegistry(tmp);
      // Agents have no disk files → agent defaults (11)
      assert.equal(registry.listAgents().length, defaultAgentCards().length);
      // Tools have a disk file → no tool defaults
      assert.equal(registry.listTools().length, 1);
      assert.equal(registry.findToolsByCapability("test.op").length, 1);
      assert.equal(registry.getTool("file.read"), undefined);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("agents-only config: tools fall back to defaults, agents = custom only", async () => {
    const tmp = makeTemp();
    try {
      writeAgent(tmp, "test.custom");
      const registry = await loadCardRegistry(tmp);
      assert.equal(registry.listAgents().length, 1);
      // Tools have no disk files → tool defaults (16)
      assert.equal(registry.listTools().length, defaultToolCards().length);
      assert.ok(registry.getTool("file.read"));
      assert.ok(registry.getTool("mcp.*"));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("empty-but-present dirs: both kinds fall back to defaults", async () => {
    const tmp = makeTemp();
    try {
      mkdirSync(join(tmp, ".alix", "cards", "agents"), { recursive: true });
      mkdirSync(join(tmp, ".alix", "cards", "tools"), { recursive: true });
      const registry = await loadCardRegistry(tmp);
      assert.equal(registry.listAgents().length, defaultAgentCards().length);
      assert.equal(registry.listTools().length, defaultToolCards().length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("full config: no defaults for either kind", async () => {
    const tmp = makeTemp();
    try {
      writeAgent(tmp, "disk.agent");
      writeTool(tmp, "disk.tool");
      const registry = await loadCardRegistry(tmp);
      assert.equal(registry.listAgents().length, 1);
      assert.equal(registry.listTools().length, 1);
      assert.equal(registry.getAgent("orchestrator.core"), undefined);
      assert.equal(registry.getTool("file.read"), undefined);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("file-only config: tools card with filesystem.read capability resolves", async () => {
    const tmp = makeTemp();
    try {
      writeTool(tmp, "file.reader", { capabilities: ["filesystem.read"], sideEffects: "read" });
      const registry = await loadCardRegistry(tmp);
      const tools = registry.findToolsByCapability("filesystem.read");
      assert.equal(tools.length, 1);
      assert.equal(tools[0].id, "file.reader");
      // tools-only config → agents still fall back to defaults
      assert.equal(registry.listAgents().length, defaultAgentCards().length);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
