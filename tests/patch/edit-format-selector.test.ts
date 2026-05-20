import { describe, it } from "node:test";
import assert from "node:assert";
import { EditFormatSelector } from "../../src/patch/edit-format-selector.js";

describe("EditFormatSelector", () => {
  it("selects unified diff for simple line changes", () => {
    const selector = new EditFormatSelector();
    const format = selector.select({
      fileType: "ts",
      changeType: "replace_lines",
      contextLines: 3,
    });
    assert.equal(format, "unified");
  });

  it("selects structured for language-aware edits", () => {
    const selector = new EditFormatSelector();
    const format = selector.select({
      fileType: "ts",
      changeType: "replace_function",
      contextLines: 5,
    });
    assert.equal(format, "structured");
  });

  it("selects search-replace for pattern-based edits", () => {
    const selector = new EditFormatSelector();
    const format = selector.select({
      fileType: "json",
      changeType: "replace_value",
      contextLines: 1,
    });
    assert.equal(format, "search_replace");
  });

  it("considers file type for format selection", () => {
    const selector = new EditFormatSelector();
    const tsFormat = selector.select({ fileType: "ts", changeType: "any", contextLines: 3 });
    const jsonFormat = selector.select({ fileType: "json", changeType: "any", contextLines: 3 });
    assert.notEqual(tsFormat, jsonFormat);
  });

  it("returns confidence score with selection", () => {
    const selector = new EditFormatSelector();
    const result = selector.selectWithConfidence({ fileType: "ts", changeType: "any", contextLines: 3 });
    assert.ok(typeof result.confidence === "number");
    assert.ok(result.reasoning);
  });
});
