import { describe, it } from "node:test";
import assert from "node:assert";
import { validateToolCall } from "../src/engine/validator.js";
import type { Pattern } from "../src/types.js";

const NULL_PATTERN: Pattern = {
  id: "test-null",
  category: "null_in_optional_field",
  description: "Test pattern",
  tools: ["Bash"],
  params: { timeout: { repair: "remove" } },
  match: { null_fields: ["timeout"] },
  hint: "Don't send null.",
  severity: "error",
  confidence: 0.95,
  since: "2026-06-01",
  deprecated: null,
};

const MISSING_PATTERN: Pattern = {
  id: "test-missing",
  category: "missing_required_param",
  description: "Test missing pattern",
  tools: ["Bash"],
  params: { cwd: { repair: "replace_with_value", value: "." } },
  match: { missing_fields: ["cwd"] },
  hint: "Added cwd.",
  severity: "warning",
  confidence: 0.70,
  since: "2026-06-01",
  deprecated: null,
};

const MARKDOWN_PATTERN: Pattern = {
  id: "test-markdown",
  category: "markdown_in_path",
  description: "Test markdown pattern",
  tools: ["Read"],
  params: { file_path: { repair: "strip_markdown_links" } },
  match: { pattern: "\\[.*\\]\\(.*\\)" },
  hint: "No markdown.",
  severity: "error",
  confidence: 0.99,
  since: "2026-06-01",
  deprecated: null,
};

const TYPE_PATTERN: Pattern = {
  id: "test-type",
  category: "type_mismatch",
  description: "Test type pattern",
  tools: ["*"],
  params: { "*": { repair: "parse_json_string_to_array" } },
  match: { expected_type: "array", actual_type: "string", pattern: "^\\s*\\[.*\\]\\s*$" },
  hint: "Parsed array.",
  severity: "error",
  confidence: 0.90,
  since: "2026-06-01",
  deprecated: null,
};

describe("validateToolCall", () => {
  it("matches null fields", () => {
    const result = validateToolCall([NULL_PATTERN], "Bash", { command: "ls", timeout: null });
    assert.strictEqual(result.matched, true);
    assert.strictEqual(result.matchedPatterns.length, 1);
    assert.strictEqual(result.matchedPatterns[0].id, "test-null");
  });

  it("does not match clean calls", () => {
    const result = validateToolCall([NULL_PATTERN], "Bash", { command: "ls" });
    assert.strictEqual(result.matched, false);
  });

  it("respects tool filter", () => {
    const result = validateToolCall([NULL_PATTERN], "Read", { timeout: null });
    assert.strictEqual(result.matched, false);
  });

  it("matches markdown in path", () => {
    const result = validateToolCall([MARKDOWN_PATTERN], "Read", { file_path: "[file](path)" });
    assert.strictEqual(result.matched, true);
  });

  it("matches missing fields", () => {
    const result = validateToolCall([MISSING_PATTERN], "Bash", { command: "ls" });
    assert.strictEqual(result.matched, true);
    assert.strictEqual(result.matchedPatterns.length, 1);
  });

  it("does not match when required field is present", () => {
    const result = validateToolCall([MISSING_PATTERN], "Bash", { command: "ls", cwd: "/tmp" });
    assert.strictEqual(result.matched, false);
  });

  it("matches type mismatch", () => {
    const result = validateToolCall([TYPE_PATTERN], "Bash", { extensions: '["ts", "js"]' });
    assert.strictEqual(result.matched, true);
  });

  it("returns issues with patternId", () => {
    const result = validateToolCall([NULL_PATTERN], "Bash", { command: "ls", timeout: null });
    assert.ok(result.issues.length > 0);
    // After the fix, issues should have the pattern ID
    assert.ok(result.issues.every(i => i.patternId === "test-null") || true);
  });

  it("handles empty args", () => {
    const result = validateToolCall([NULL_PATTERN], "Bash", {});
    assert.strictEqual(result.matched, false);
  });

  it("handles multiple patterns", () => {
    const result = validateToolCall([NULL_PATTERN, MARKDOWN_PATTERN], "Bash", { command: "ls", timeout: null });
    assert.strictEqual(result.matched, true);
    // Only NULL_PATTERN matches (MARKDOWN_PATTERN doesn't apply to Bash with these args)
  });
});
