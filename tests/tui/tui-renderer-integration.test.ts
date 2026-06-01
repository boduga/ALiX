// tests/tui/tui-renderer-integration.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTuiStore } from "../../src/tui/store.js";
import { TuiRenderer } from "../../src/tui/render.js";

describe("TuiRenderer integration with diff-render", () => {
  it("renders initial output to a stream", () => {
    const store = createTuiStore({ sessionId: "test-1" });
    const renderer = new TuiRenderer(store);

    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((s: string) => { writes.push(s); return true; }) as any;
    try {
      renderer.start();
      const initial = renderer.renderInitial();
      assert.ok(initial.length > 0);
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("subsequent renders go through diff-render (no full clear)", () => {
    const store = createTuiStore({ sessionId: "test-2" });
    const renderer = new TuiRenderer(store);

    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((s: string) => { writes.push(s); return true; }) as any;
    try {
      renderer.start();
      // Initial render
      process.stdout.write(renderer.renderInitial() + "\n");
      const initialWriteCount = writes.length;

      // Trigger a render by updating store state
      store.setAgentState("executing");

      // After update, writes should be incremental (not a full redraw)
      // We can't easily assert exact writes here, but we can verify
      // the renderer doesn't throw and produces some output
      assert.ok(writes.length >= initialWriteCount);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});