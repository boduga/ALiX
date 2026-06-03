// tests/tui/tui-renderer-integration.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTuiStore } from "../../src/tui/store.js";
import { TuiRenderer } from "../../src/tui/render.js";

describe("TuiRenderer split-screen layout", () => {
  it("drawLayout calls process.stdout.write", () => {
    const store = createTuiStore({ sessionId: "test-1" });
    const renderer = new TuiRenderer(store);

    let called = false;
    const origWrite = process.stdout.write;
    process.stdout.write = ((s: string) => { called = true; return true; }) as any;
    try {
      renderer.start();
      renderer.drawLayout();
      assert.ok(called, "drawLayout should write to stdout");
    } finally {
      process.stdout.write = origWrite;
      renderer.stop();
    }
  });

  it("appendOutput does not throw", () => {
    const store = createTuiStore({ sessionId: "test-2" });
    const renderer = new TuiRenderer(store);

    const origWrite = process.stdout.write;
    process.stdout.write = ((s: string) => { return true; }) as any;
    try {
      renderer.start();
      renderer.drawLayout();
      renderer.appendOutput("hello");
      store.setAgentState("executing");
      renderer.appendOutput("world");
      // No crash = pass
      assert.ok(true);
    } finally {
      process.stdout.write = origWrite;
      renderer.stop();
    }
  });
});
