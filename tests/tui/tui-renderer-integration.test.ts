// tests/tui/tui-renderer-integration.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTuiStore } from "../../src/tui/store.js";
import { TuiRenderer } from "../../src/tui/render.js";

describe("TuiRenderer single-line status", () => {
  it("appendOutput writes to stdout", () => {
    const store = createTuiStore({ sessionId: "test-1" });
    const renderer = new TuiRenderer(store);

    let written = "";
    const orig = process.stdout.write;
    process.stdout.write = ((s: string) => { written += s; return true; }) as any;
    try {
      renderer.start();
      renderer.appendOutput("hello");
      assert.ok(written.includes("hello"), "appendOutput should write to stdout");
    } finally {
      process.stdout.write = orig;
      renderer.stop();
    }
  });

  it("store change triggers status line", () => {
    const store = createTuiStore({ sessionId: "test-2" });
    const renderer = new TuiRenderer(store);

    let written = "";
    const orig = process.stdout.write;
    process.stdout.write = ((s: string) => { written += s; return true; }) as any;
    try {
      renderer.start();
      store.setAgentState("executing");
      assert.ok(written.includes("EXECUTING"), "status should show agent state");
    } finally {
      process.stdout.write = orig;
      renderer.stop();
    }
  });
});
