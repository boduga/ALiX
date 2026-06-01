// tests/tui/diff-render.test.ts
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { diffLines, renderDiff, type DiffOp } from "../../src/tui/diff-render.js";

describe("diffLines", () => {
  it("returns empty ops for identical strings", () => {
    const ops = diffLines("hello\nworld", "hello\nworld");
    assert.equal(ops.length, 0);
  });

  it("returns insert op when a line is added at the end", () => {
    const ops = diffLines("hello", "hello\nworld");
    const inserts = ops.filter((o) => o.type === "insert");
    assert.equal(inserts.length, 1);
    assert.equal((inserts[0] as any).line, "world");
  });

  it("returns insert op when a line is added in the middle", () => {
    const ops = diffLines("a\nc", "a\nb\nc");
    const inserts = ops.filter((o) => o.type === "insert");
    assert.equal(inserts.length, 1);
    assert.equal((inserts[0] as any).line, "b");
  });

  it("returns delete op when a line is removed", () => {
    const ops = diffLines("a\nb\nc", "a\nc");
    const deletes = ops.filter((o) => o.type === "delete");
    assert.equal(deletes.length, 1);
  });

  it("returns replace op when a line is changed", () => {
    const ops = diffLines("hello\nworld", "hello\nWORLD");
    const replaces = ops.filter((o) => o.type === "replace");
    assert.equal(replaces.length, 1);
    assert.equal((replaces[0] as any).line, "WORLD");
  });

  it("handles completely different content", () => {
    const ops = diffLines("a\nb\nc", "x\ny\nz");
    // Should produce some operations (all 3 lines change)
    assert.ok(ops.length > 0);
  });

  it("handles empty prev (all inserts)", () => {
    const ops = diffLines("", "a\nb\nc");
    const inserts = ops.filter((o) => o.type === "insert");
    assert.equal(inserts.length, 3);
  });

  it("handles empty next (all deletes)", () => {
    const ops = diffLines("a\nb\nc", "");
    const deletes = ops.filter((o) => o.type === "delete");
    assert.equal(deletes.length, 3);
  });

  it("keeps unchanged lines (no op emitted)", () => {
    const ops = diffLines("a\nb\nc", "a\nB\nc");
    // Only the middle line changed; "a" and "c" should be kept (no op)
    const lineB = ops.find((o) => o.type === "replace" && (o as any).line === "B");
    assert.ok(lineB);
  });
});

describe("renderDiff", () => {
  it("writes nothing when prev equals next", () => {
    const writes: string[] = [];
    const stream = { write: (s: string) => { writes.push(s); return true; } };
    renderDiff("hello", "hello", stream as any);
    assert.equal(writes.length, 0);
  });

  it("writes ANSI sequence to move cursor when replacing a line", () => {
    const writes: string[] = [];
    const stream = { write: (s: string) => { writes.push(s); return true; } };
    renderDiff("hello\nworld", "hello\nWORLD", stream as any);
    assert.ok(writes.length > 0);
    // Should include cursor positioning
    assert.ok(writes.some((w) => w.includes("\x1b[")));
  });

  it("writes a new line for insert at the end", () => {
    const writes: string[] = [];
    const stream = { write: (s: string) => { writes.push(s); return true; } };
    renderDiff("a", "a\nb", stream as any);
    assert.ok(writes.some((w) => w.includes("b")));
  });
});