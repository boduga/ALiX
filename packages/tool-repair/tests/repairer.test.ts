import { describe, it } from "node:test";
import assert from "node:assert";
import { repairToolCall } from "../src/engine/repairer.js";
import type { Pattern } from "../src/types.js";

const NULL_PATTERN: Pattern = {
  id: "test-null-remove",
  category: "null_in_optional_field",
  description: "Test",
  tools: ["*"],
  params: { timeout: { repair: "remove" } },
  match: { null_fields: ["timeout"] },
  hint: "Removed null timeout.",
  severity: "error",
  confidence: 0.95,
  since: "2026-06-01",
  deprecated: null,
};

const MARKDOWN_PATTERN: Pattern = {
  id: "test-markdown",
  category: "markdown_in_path",
  description: "Test",
  tools: ["*"],
  params: { file_path: { repair: "strip_markdown_links" } },
  match: { pattern: "\\[.*\\]\\(.*\\)" },
  hint: "Stripped markdown.",
  severity: "error",
  confidence: 0.99,
  since: "2026-06-01",
  deprecated: null,
};

const MISSING_PATTERN: Pattern = {
  id: "test-cwd",
  category: "missing_required_param",
  description: "Test",
  tools: ["*"],
  params: { cwd: { repair: "replace_with_value", value: "." } },
  match: { missing_fields: ["cwd"] },
  hint: "Added cwd.",
  severity: "warning",
  confidence: 0.70,
  since: "2026-06-01",
  deprecated: null,
};

describe("repairToolCall", () => {
  it("repairs a null field by removing it", () => {
    const result = repairToolCall([NULL_PATTERN], { command: "ls", timeout: null });
    assert.strictEqual(result.repaired, true);
    assert.strictEqual("timeout" in result.args, false);
    assert.strictEqual(result.args.command, "ls");
    assert.ok(result.hint);
  });

  it("no-ops when no pattern matches", () => {
    const result = repairToolCall([NULL_PATTERN], { command: "ls" });
    assert.strictEqual(result.repaired, false);
  });

  it("applies multiple transforms from different patterns", () => {
    const result = repairToolCall(
      [NULL_PATTERN, MARKDOWN_PATTERN],
      { command: "ls", timeout: null, file_path: "[README](README.md)" }
    );
    assert.strictEqual(result.repaired, true);
    assert.strictEqual("timeout" in result.args, false);
    assert.strictEqual(result.args.file_path, "README.md");
  });

  it("replaces missing value with default", () => {
    const result = repairToolCall([MISSING_PATTERN], { command: "ls" });
    assert.strictEqual(result.repaired, true);
    assert.strictEqual(result.args.cwd, ".");
  });

  it("includes hint in outcome", () => {
    const result = repairToolCall([NULL_PATTERN], { command: "ls", timeout: null });
    assert.strictEqual(result.repaired, true);
    assert.ok(typeof result.hint === "string");
    assert.ok(result.hint.length > 0);
  });

  it("includes patternId in outcome", () => {
    const result = repairToolCall([NULL_PATTERN], { command: "ls", timeout: null });
    assert.strictEqual(result.repaired, true);
    assert.ok(typeof result.patternId === "string");
    assert.ok(result.patternId.includes("test-null-remove"));
  });
});
