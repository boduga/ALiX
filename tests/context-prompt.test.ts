import test from "node:test";
import assert from "node:assert/strict";
import { renderContextBundleForPrompt } from "../src/run.js";

test("renderContextBundleForPrompt includes reasons and symbol locations", () => {
  const rendered = renderContextBundleForPrompt({
    id: "bundle-test",
    taskType: "bugfix",
    budget: { maxTokens: 1000, usedTokens: 100 },
    primaryFiles: [
      { path: "src/auth.ts", kind: "file", score: 100, tokenEstimate: 80, reason: "task_mention:100" },
      { path: "src/auth.ts", kind: "symbol", symbolName: "login", lineStart: 3, lineEnd: 3, score: 25, tokenEstimate: 20, reason: "symbol_match" },
    ],
    supportingFiles: [
      { path: "package.json", kind: "config", score: 10, tokenEstimate: 20, reason: "config_file" },
    ],
    tests: [
      { path: "tests/auth.test.ts", kind: "test", score: 40, tokenEstimate: 50, reason: "test_relationship:src/auth.ts" },
    ],
    pinned: [],
  });

  assert.match(rendered, /src\/auth\.ts \(task_mention:100\)/);
  assert.match(rendered, /login@src\/auth\.ts:3 \(symbol_match\)/);
  assert.match(rendered, /tests\/auth\.test\.ts \(test_relationship:src\/auth\.ts\)/);
});

test("renderContextBundleForPrompt omits empty sections", () => {
  const rendered = renderContextBundleForPrompt({
    id: "bundle-empty",
    taskType: "feature",
    budget: { maxTokens: 1000, usedTokens: 0 },
    primaryFiles: [],
    supportingFiles: [],
    tests: [],
    pinned: [],
  });

  assert.ok(!rendered.includes("Primary files:"));
  assert.ok(!rendered.includes("Related tests:"));
  assert.ok(!rendered.includes("Supporting files:"));
});

test("renderContextBundleForPrompt renders only files when no symbols", () => {
  const rendered = renderContextBundleForPrompt({
    id: "bundle-files-only",
    taskType: "bugfix",
    budget: { maxTokens: 1000, usedTokens: 50 },
    primaryFiles: [
      { path: "src/auth.ts", kind: "file", score: 100, tokenEstimate: 80, reason: "task_mention:100" },
    ],
    supportingFiles: [],
    tests: [],
    pinned: [],
  });

  assert.match(rendered, /src\/auth\.ts/);
  assert.ok(!rendered.includes("Symbols:"));
});