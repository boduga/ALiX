import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { CapabilityRegistry } from "../../src/policy/capability-registry.js";

describe("CapabilityRegistry", () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it("registers tool capabilities", () => {
    registry.register("file.read", {
      description: "Read file contents",
      riskLevel: "low",
      requiresApproval: false,
    });

    const capability = registry.get("file.read");
    assert.ok(capability);
    assert.equal(capability.riskLevel, "low");
  });

  it("classifies tools by risk level", () => {
    registry.register("shell.exec", {
      description: "Execute shell commands",
      riskLevel: "critical",
      requiresApproval: true,
    });

    const critical = registry.getByRiskLevel("critical");
    assert.ok(critical.some(t => t.name === "shell.exec"));
  });

  it("filters tools by pattern", () => {
    registry.register("git.push", {
      description: "Push to remote",
      riskLevel: "high",
      requiresApproval: true,
    });

    const writeOps = registry.filter(cap => cap.riskLevel !== "low");
    assert.ok(writeOps.length >= 1);
  });

  it("provides default capabilities", () => {
    const defaults = registry.getDefaults();
    assert.ok(defaults.length > 0);
    assert.ok(defaults.some(c => c.name === "file.read"));
  });

  it("requires approval for high-risk tools", () => {
    const approval = registry.requiresApproval("shell.exec");
    assert.equal(approval, true);
  });

  it("returns risk level for registered tools", () => {
    const risk = registry.getRiskLevel("file.write");
    assert.equal(risk, "medium");
  });
});