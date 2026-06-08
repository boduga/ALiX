import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAgentCard } from "../../src/registry/agent-card.js";
import { validateToolCard } from "../../src/registry/tool-card.js";
import { CardRegistry } from "../../src/registry/card-registry.js";
import type { AgentCard } from "../../src/registry/agent-card.js";
import type { ToolCard } from "../../src/registry/tool-card.js";

describe("AgentCard validation", () => {

  it("passes for valid card", () => {
    const card: AgentCard = {
      id: "research.scout", name: "Research Scout", description: "Searches the web",
      version: "1.0.0", domains: ["research"], capabilities: ["web.search"],
      enabled: true,
    };
    assert.equal(validateAgentCard(card).valid, true);
  });

  it("fails for missing id", () => {
    const card = { name: "Test", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true } as unknown as AgentCard;
    const v = validateAgentCard(card);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some(e => e.includes("id")));
  });

  it("fails for missing name", () => {
    assert.equal(validateAgentCard({ id: "x", name: "", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true } as unknown as AgentCard).valid, false);
  });
});

describe("ToolCard validation", () => {

  it("passes for valid card", () => {
    const card: ToolCard = {
      id: "web.search", name: "Web Search", description: "Search the web",
      version: "1.0.0", capabilities: ["web.search"],
      riskLevel: "low", approvalMode: "auto", enabled: true,
    };
    assert.equal(validateToolCard(card).valid, true);
  });

  it("fails for invalid riskLevel", () => {
    const card = { id: "t", name: "t", description: "x", version: "1.0", capabilities: [], riskLevel: "extreme", approvalMode: "auto", enabled: true } as unknown as ToolCard;
    assert.equal(validateToolCard(card).valid, false);
  });

  it("fails for missing approvalMode", () => {
    const card = { id: "t", name: "t", description: "x", version: "1.0", capabilities: [], riskLevel: "low", approvalMode: "", enabled: true } as unknown as ToolCard;
    assert.equal(validateToolCard(card).valid, false);
  });
});

describe("CardRegistry", () => {

  it("registers and lists agents", () => {
    const reg = new CardRegistry();
    reg.registerAgent({ id: "a1", name: "Agent 1", description: "x", version: "1.0", domains: ["d"], capabilities: ["c1"], enabled: true });
    reg.registerAgent({ id: "a2", name: "Agent 2", description: "x", version: "1.0", domains: ["d"], capabilities: ["c2"], enabled: true });
    assert.equal(reg.listAgents().length, 2);
  });

  it("rejects duplicate agent IDs", () => {
    const reg = new CardRegistry();
    reg.registerAgent({ id: "dup", name: "A", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true });
    assert.throws(() => reg.registerAgent({ id: "dup", name: "B", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true }));
  });

  it("rejects duplicate tool IDs", () => {
    const reg = new CardRegistry();
    reg.registerTool({ id: "t1", name: "T", description: "x", version: "1.0", capabilities: [], riskLevel: "low", approvalMode: "auto", enabled: true });
    assert.throws(() => reg.registerTool({ id: "t1", name: "T2", description: "x", version: "1.0", capabilities: [], riskLevel: "low", approvalMode: "auto", enabled: true }));
  });

  it("findAgentsByCapability returns matching agents", () => {
    const reg = new CardRegistry();
    reg.registerAgent({ id: "r1", name: "R1", description: "x", version: "1.0", domains: [], capabilities: ["web.search"], enabled: true });
    reg.registerAgent({ id: "r2", name: "R2", description: "x", version: "1.0", domains: [], capabilities: ["file.read"], enabled: true });
    assert.equal(reg.findAgentsByCapability("web.search").length, 1);
    assert.equal(reg.findAgentsByCapability("web.search")[0].id, "r1");
  });

  it("findToolsByCapability returns matching tools", () => {
    const reg = new CardRegistry();
    reg.registerTool({ id: "ws", name: "Web Search", description: "x", version: "1.0", capabilities: ["web.search"], riskLevel: "low", approvalMode: "auto", enabled: true });
    reg.registerTool({ id: "fr", name: "File Read", description: "x", version: "1.0", capabilities: ["file.read"], riskLevel: "low", approvalMode: "auto", enabled: true });
    assert.equal(reg.findToolsByCapability("file.read").length, 1);
    assert.equal(reg.findToolsByCapability("file.read")[0].id, "fr");
  });

  it("excludes disabled cards by default", () => {
    const reg = new CardRegistry();
    reg.registerAgent({ id: "enabled", name: "E", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true });
    reg.registerAgent({ id: "disabled", name: "D", description: "x", version: "1.0", domains: [], capabilities: [], enabled: false });
    assert.equal(reg.listAgents().length, 1);
    assert.equal(reg.listAgents(true).length, 2);
  });

  it("getAgent returns single agent by ID", () => {
    const reg = new CardRegistry();
    reg.registerAgent({ id: "get_me", name: "G", description: "x", version: "1.0", domains: [], capabilities: [], enabled: true });
    assert.ok(reg.getAgent("get_me"));
    assert.equal(reg.getAgent("nonexistent"), undefined);
  });
});
