import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toolResultText } from "../../src/tools/result-text.js";

/**
 * The renderer exists because two consumers disagreed: telemetry previewed a
 * search result's `matches[]` while the message handed to the model was built
 * from `output`/`content` only, so a *successful* grep arrived as an empty
 * <tool_result>. Every payload shape a success branch can carry must render.
 */
describe("toolResultText", () => {
  it("renders matches[] as path:line: text", () => {
    assert.equal(
      toolResultText({
        kind: "success",
        matches: [
          { path: "src/a.ts", lineNumber: 3, line: "export const a = 1;" },
          { path: "src/b.ts", lineNumber: 10, line: "export const b = 2;" },
        ],
      }),
      "src/a.ts:3: export const a = 1;\nsrc/b.ts:10: export const b = 2;",
    );
  });

  it("prefers output, then content, then value", () => {
    assert.equal(toolResultText({ kind: "success", output: "shell out", content: "ignored" }), "shell out");
    assert.equal(toolResultText({ kind: "success", content: "file body" }), "file body");
    assert.equal(toolResultText({ kind: "success", value: "scalar" }), "scalar");
  });

  it("renders an existence check", () => {
    assert.equal(toolResultText({ kind: "success", exists: true }), "exists");
    assert.equal(toolResultText({ kind: "success", exists: false }), "does not exist");
  });

  it("returns empty text for an empty match list and for errors", () => {
    assert.equal(toolResultText({ kind: "success", matches: [] }), "");
    assert.equal(toolResultText({ kind: "success" }), "");
    assert.equal(toolResultText({ kind: "error", message: "boom" }), "");
  });
});
