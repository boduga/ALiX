// tests/cli/commands/issue-changed-files-guardrail.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateChangedFilesGuardrail } from "../../../src/cli/commands/issue-changed-files-guardrail.js";

describe("evaluateChangedFilesGuardrail", () => {
  // -- Pass ----------------------------------------------------------------

  it("passes when file count is within limit", () => {
    const result = evaluateChangedFilesGuardrail(["src/main.ts", "src/utils.ts"]);
    assert.strictEqual(result.status, "pass");
    assert.strictEqual(result.proposedFileCount, 2);
    assert.strictEqual(result.allowedFiles.length, 2);
    assert.strictEqual(result.blockedFiles.length, 0);
  });

  it("passes with empty file list", () => {
    const result = evaluateChangedFilesGuardrail([]);
    assert.strictEqual(result.status, "pass");
    assert.strictEqual(result.proposedFileCount, 0);
  });

  it("passes with custom allowed paths", () => {
    const result = evaluateChangedFilesGuardrail(
      ["src/main.ts", "src/utils.ts"],
      { allowedPaths: ["src/"] },
    );
    assert.strictEqual(result.status, "pass");
    assert.strictEqual(result.allowedFiles.length, 2);
  });

  // -- Fail ----------------------------------------------------------------

  it("fails when file count exceeds limit", () => {
    const files = Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`);
    const result = evaluateChangedFilesGuardrail(files, { maxFilesChanged: 10 });
    assert.strictEqual(result.status, "fail");
    assert.ok(result.reasons.some((r) => r.includes("exceeds limit")));
  });

  it("fails when a proposed file matches blocked paths", () => {
    const result = evaluateChangedFilesGuardrail(
      ["src/main.ts", ".env.prod"],
    );
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.blockedFiles.length, 1);
    assert.strictEqual(result.blockedFiles[0], ".env.prod");
    assert.strictEqual(result.allowedFiles.length, 1);
  });

  it("fails when a proposed file is outside allowed paths", () => {
    const result = evaluateChangedFilesGuardrail(
      ["src/main.ts", "docs/readme.md"],
      { allowedPaths: ["src/"] },
    );
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.blockedFiles.length, 1);
    assert.strictEqual(result.blockedFiles[0], "docs/readme.md");
  });

  it("fails on git directory paths", () => {
    const result = evaluateChangedFilesGuardrail([".git/config"]);
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.blockedFiles.length, 1);
  });

  it("fails on node_modules paths", () => {
    const result = evaluateChangedFilesGuardrail(["node_modules/foo/index.js"]);
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.blockedFiles.length, 1);
  });

  // -- Warn ---------------------------------------------------------------

  it("warns instead of failing when warnOnly is set", () => {
    const result = evaluateChangedFilesGuardrail(
      [".env.prod"],
      { warnOnly: true },
    );
    assert.strictEqual(result.status, "warn");
    assert.ok(result.reasons.length > 0);
  });

  // -- Edge cases ---------------------------------------------------------

  it("blocks files at nested blocked paths", () => {
    const result = evaluateChangedFilesGuardrail(
      ["src/.env", "src/.git/HEAD"],
    );
    assert.strictEqual(result.status, "fail");
    assert.strictEqual(result.blockedFiles.length, 2);
  });

  it("recommended action indicates pass when guardrail passes", () => {
    const result = evaluateChangedFilesGuardrail(["src/main.ts"]);
    assert.ok(result.recommendedAction.includes("Proceed"));
  });

  it("recommended action indicates failure when guardrail fails", () => {
    const result = evaluateChangedFilesGuardrail([".env"]);
    assert.ok(result.recommendedAction.includes("Fix violations"));
  });
});
