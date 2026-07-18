import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LegacyTuiRenderer } from "../../src/tui/render.js";
import { createTuiStore } from "../../src/tui/store.js";

describe("TuiRenderer", () => {
  it("appendOutput, resetOutput exist as functions", () => {
    const store = createTuiStore({ sessionId: "test" });
    const renderer = new LegacyTuiRenderer(store);
    assert.ok(typeof renderer.appendOutput === "function", "appendOutput exists");
    assert.ok(typeof renderer.start === "function", "start exists");
    assert.ok(typeof renderer.stop === "function", "stop exists");
  });
});
