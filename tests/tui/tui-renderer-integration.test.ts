import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TuiRenderer } from "../../src/tui/render.js";

describe("TuiRenderer", () => {
  it("appendOutput writes to stdout", () => {
    const renderer = new TuiRenderer();
    let written = "";
    const orig = process.stdout.write;
    process.stdout.write = ((s: string) => { written += s; return true; }) as any;
    try {
      renderer.start();
      renderer.appendOutput("hello");
      assert.ok(written.includes("hello"));
    } finally {
      process.stdout.write = orig;
      renderer.stop();
    }
  });
});
