import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SubagentCLI } from "../../src/agents/subagent-cli.js";

describe("SubagentCLI", () => {
  it("exposes static main method", () => {
    assert.equal(typeof SubagentCLI.main, "function");
  });
});