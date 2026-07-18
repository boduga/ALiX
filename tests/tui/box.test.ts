import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { box, green, yellow, red, dim, bold, truncate, pad, formatAge, statusDot, bar } from "../../src/tui/box.js";

describe("box helpers", () => {
  it("truncate shortens long strings", () => {
    assert.equal(truncate("hello world", 6), "hello…");
  });

  it("truncate leaves short strings unchanged", () => {
    assert.equal(truncate("hi", 5), "hi");
  });

  it("pad fills to width", () => {
    assert.equal(pad("ab", 4), "ab  ");
  });

  it("pad truncates if over width", () => {
    assert.equal(pad("abcdef", 4), "abcd");
  });

  it("green wraps in ANSI", () => {
    const r = green("ok");
    assert.ok(r.includes("\x1b[32m"));
    assert.ok(r.includes("\x1b[0m"));
  });

  it("red wraps in ANSI", () => {
    assert.ok(red("err").includes("\x1b[31m"));
  });

  it("yellow wraps in ANSI", () => {
    assert.ok(yellow("warn").includes("\x1b[33m"));
  });

  it("dim wraps in ANSI", () => {
    assert.ok(dim("muted").includes("\x1b[2m"));
  });

  it("bold wraps in ANSI", () => {
    assert.ok(bold("title").includes("\x1b[1m"));
  });

  it("formatAge shows seconds", () => {
    const ts = new Date(Date.now() - 5000).toISOString();
    assert.match(formatAge(ts), /\d+s/);
  });

  it("statusDot shows green for running", () => {
    assert.ok(statusDot("running").includes("\x1b[32m"));
  });

  it("statusDot shows red for failed", () => {
    assert.ok(statusDot("failed").includes("\x1b[31m"));
  });

  it("bar renders filled and empty", () => {
    const r = bar(50, 10);
    assert.ok(r.includes("█"));
    assert.ok(r.includes("░"));
  });

  it("box renders consistent borders", () => {
    const lines = box("TEST", ["line 1", "line 2"], 20);
    assert.ok(lines[0].startsWith("┌"));
    assert.ok(lines[lines.length - 1].startsWith("└"));
    assert.equal(lines.length, 4); // top + 2 content + bottom
  });
});

