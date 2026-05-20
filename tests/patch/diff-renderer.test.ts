import { describe, it } from "node:test";
import assert from "node:assert";
import { DiffRenderer } from "../../src/patch/diff-renderer.js";

describe("DiffRenderer", () => {
  it("renders unified diff with colors", () => {
    const renderer = new DiffRenderer({ format: "unified", color: true });
    const result = renderer.render({
      oldContent: "line1\nline2\n",
      newContent: "line1\nmodified\n",
      file: "test.txt",
    });
    assert.ok(result.includes("line2"));
    assert.ok(result.includes("modified"));
  });

  it("renders side-by-side diff", () => {
    const renderer = new DiffRenderer({ format: "side-by-side" });
    const result = renderer.render({
      oldContent: "old\n",
      newContent: "new\n",
      file: "test.txt",
    });
    assert.ok(result.includes("old") && result.includes("new"));
  });

  it("highlights changed lines", () => {
    const renderer = new DiffRenderer({ format: "unified" });
    const result = renderer.render({
      oldContent: "a\nb\nc\n",
      newContent: "a\nB\nc\n",
      file: "test.txt",
    });
    assert.ok(result.includes("-") || result.includes("+"));
  });
});
