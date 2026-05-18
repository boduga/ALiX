import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendSubagentResponseText, SubagentCLI } from "../../src/agents/subagent-cli.js";

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
});
