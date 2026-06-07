import { describe, it } from "node:test";
import assert from "node:assert";
import { applyTransform } from "../src/transforms/index.js";

describe("transforms", () => {
  describe("remove", () => {
    it("removes a null field from args", () => {
      const result = applyTransform("remove", { timeout: null, command: "ls" }, "timeout");
      assert.strictEqual(result.changed, true);
      assert.strictEqual("timeout" in result.args, false);
      assert.strictEqual(result.args.command, "ls");
    });

    it("no-ops if field doesn't exist", () => {
      const result = applyTransform("remove", { command: "ls" }, "timeout");
      assert.strictEqual(result.changed, false);
    });

    it("removes a field that is undefined", () => {
      const result = applyTransform("remove", { timeout: undefined, command: "ls" }, "timeout");
      assert.strictEqual(result.changed, true);
      assert.strictEqual("timeout" in result.args, false);
    });
  });

  describe("strip_markdown_links", () => {
    it('strips [text](url) to url', () => {
      const result = applyTransform("strip_markdown_links", { file_path: "[README](src/README.md)" }, "file_path");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.file_path, "src/README.md");
    });

    it("strips trailing )", () => {
      const result = applyTransform("strip_markdown_links", { file_path: "src/file.ts)" }, "file_path");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.file_path, "src/file.ts");
    });

    it("leaves plain paths unchanged", () => {
      const result = applyTransform("strip_markdown_links", { file_path: "src/file.ts" }, "file_path");
      assert.strictEqual(result.changed, false);
    });

    it("handles non-string values gracefully", () => {
      const result = applyTransform("strip_markdown_links", { count: 42 }, "count");
      assert.strictEqual(result.changed, false);
    });
  });

  describe("parse_json_string_to_array", () => {
    it('parses a JSON string array', () => {
      const result = applyTransform("parse_json_string_to_array", { extensions: '["ts", "js"]' }, "extensions");
      assert.strictEqual(result.changed, true);
      assert.deepStrictEqual(result.args.extensions, ["ts", "js"]);
    });

    it("no-ops on non-array JSON", () => {
      const result = applyTransform("parse_json_string_to_array", { path: '"hello"' }, "path");
      assert.strictEqual(result.changed, false);
    });

    it("no-ops on plain strings", () => {
      const result = applyTransform("parse_json_string_to_array", { command: "ls -la" }, "command");
      assert.strictEqual(result.changed, false);
    });

    it("no-ops on numbers", () => {
      const result = applyTransform("parse_json_string_to_array", { count: 42 }, "count");
      assert.strictEqual(result.changed, false);
    });
  });

  describe("smart_default", () => {
    it("adds offset=0 when missing", () => {
      const result = applyTransform("default_first_read", {}, "offset");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.offset, 0);
    });

    it("adds limit=100 when missing", () => {
      const result = applyTransform("default_first_read", {}, "limit");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.limit, 100);
    });

    it("no-ops when value already present", () => {
      const result = applyTransform("default_first_read", { offset: 50 }, "offset");
      assert.strictEqual(result.changed, false);
    });

    it("no-ops for unknown param names", () => {
      const result = applyTransform("default_first_read", {}, "unknownParam");
      assert.strictEqual(result.changed, false);
    });

    it("sets default when value is null", () => {
      const result = applyTransform("default_first_read", { offset: null }, "offset");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.offset, 0);
    });
  });

  describe("strip_outer_quotes", () => {
    it('strips outer double quotes', () => {
      const result = applyTransform("strip_outer_quotes", { command: '"ls -la"' }, "command");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.command, "ls -la");
    });

    it("no-ops on plain strings without quotes", () => {
      const result = applyTransform("strip_outer_quotes", { command: "ls -la" }, "command");
      assert.strictEqual(result.changed, false);
    });

    it("handles single-char strings", () => {
      const result = applyTransform("strip_outer_quotes", { command: '"a"' }, "command");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.command, "a");
    });

    it("no-ops on numbers", () => {
      const result = applyTransform("strip_outer_quotes", { count: 42 }, "count");
      assert.strictEqual(result.changed, false);
    });
  });

  describe("replace_with_value", () => {
    it("replaces param with the given value", () => {
      const result = applyTransform("replace_with_value", { cwd: undefined }, "cwd", ".");
      assert.strictEqual(result.changed, true);
      assert.strictEqual(result.args.cwd, ".");
    });

    it("no-ops when value already matches", () => {
      const result = applyTransform("replace_with_value", { cwd: "." }, "cwd", ".");
      assert.strictEqual(result.changed, false);
    });
  });
});
