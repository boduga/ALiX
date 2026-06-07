import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Tui", () => {

  it("appendOutput, resetOutput, updateTokenUsage exist as functions", async () => {
    const { Tui } = await import("../../src/tui/index.js");
    const tui = new Tui({ sessionId: "test", maxTokens: 100000 });
    assert.ok(typeof tui.appendOutput === "function", "appendOutput exists");
    assert.ok(typeof tui.resetOutput === "function", "resetOutput exists");
    assert.ok(typeof tui.updateTokenUsage === "function", "updateTokenUsage exists");
    assert.ok(typeof tui.destroy === "function", "destroy exists");
    assert.ok(typeof tui.init === "function", "init exists");
  });

});
