import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendSubagentResponseText, buildSubagentFindings, formatSubagentResult, SubagentCLI } from "../../src/agents/subagent-cli.js";

describe("SubagentCLI", () => {
  it("exposes static main method", () => {
    assert.equal(typeof SubagentCLI.main, "function");
  });

  it("preserves earlier response text when a later tool turn has no text", () => {
    const first = appendSubagentResponseText("", "Found src/auth.ts");
    const second = appendSubagentResponseText(first, "");

    assert.equal(second, "Found src/auth.ts");
  });

  it("separates multi-turn response text in findings", () => {
    const first = appendSubagentResponseText("", "First finding");
    const second = appendSubagentResponseText(first, "Second finding");

    assert.equal(second, "First finding\n\nSecond finding");
  });

  it("uses tool output as findings when the model returns no final text", () => {
    const findings = buildSubagentFindings("", ["delegate-tool.ts\nsubagent-cli.ts"]);

    assert.deepEqual(findings, [{
      type: "summary",
      content: "delegate-tool.ts\nsubagent-cli.ts",
      confidence: "high",
    }]);
  });

  it("prefers model text over raw tool output when both are available", () => {
    const findings = buildSubagentFindings("Final summary", ["raw output"]);

    assert.equal(findings[0].content, "Final summary");
  });

  it("deduplicates repeated tool outputs in fallback findings", () => {
    const findings = buildSubagentFindings("", ["same output", "same output"]);

    assert.equal(findings[0].content, "same output");
  });

  it("prefers real tool output over tool-call-shaped model text", () => {
    const findings = buildSubagentFindings(
      "{\"name\": \"alix_file_read\", \"parameters\": {\"root\": \"/home/\"}}",
      ["babasola\nlinuxbrew"]
    );

    assert.equal(findings[0].content, "babasola\nlinuxbrew");
  });

  it("formats direct CLI output as plain text", () => {
    const output = formatSubagentResult({
      id: "task-1",
      role: "explorer",
      status: "success",
      findings: [{ type: "summary", content: "babasola\nlinuxbrew", confidence: "high" }],
      events: [],
    }, "text");

    assert.equal(output, "babasola\nlinuxbrew");
  });

  it("keeps JSON output for machine consumers", () => {
    const output = formatSubagentResult({
      id: "task-1",
      role: "explorer",
      status: "success",
      findings: [{ type: "summary", content: "babasola", confidence: "high" }],
      events: [],
    }, "json");

    assert.deepEqual(JSON.parse(output).findings[0].content, "babasola");
  });
});
