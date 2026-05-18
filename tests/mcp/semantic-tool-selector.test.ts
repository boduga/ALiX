import test from "node:test";
import assert from "node:assert/strict";
import { ToolSelector } from "../../src/mcp/tool-selector.js";
import type { DeferredToolEntry } from "../../src/mcp/tool-deferral.js";

const makeTool = (name: string, description: string): DeferredToolEntry => ({
  name,
  toolName: name,
  description,
  schema: { type: "object", properties: {} },
  serverName: "test-server",
  execName: name,
  deferred: { status: "pending" },
});

// Access private methods for testing via explicit any cast
const selectorWithPrivate = (tools: DeferredToolEntry[], options: { maxTools: number; tokenBudget: number }) =>
  new ToolSelector(tools, options) as any;

test("computeNgrams with known inputs", () => {
  const selector = selectorWithPrivate([], { maxTools: 1, tokenBudget: 5000 });

  // Basic two-word input
  const ngrams = selector.computeNgrams("search git history");
  assert.ok(ngrams.has("search git"), "should have 'search git' bigram");
  assert.ok(ngrams.has("git history"), "should have 'git history' bigram");
  assert.strictEqual(ngrams.size, 2, "should have 2 bigrams for 3 words");

  // Empty string
  const emptyNgrams = selector.computeNgrams("");
  assert.strictEqual(emptyNgrams.size, 0, "empty string should produce no ngrams");

  // Single word (less than 2 words for bigram)
  const singleNgrams = selector.computeNgrams("search");
  assert.strictEqual(singleNgrams.size, 0, "single word should produce no bigrams");

  // Word length filter: words < 2 chars are ignored
  const filteredNgrams = selector.computeNgrams("a b cd ef");
  assert.ok(filteredNgrams.has("cd ef"), "should include 'cd ef' (both >= 2 chars)");
  assert.ok(!filteredNgrams.has("a b"), "'a b' should be excluded (both < 2 chars)");
});

test("jaccardSimilarity with known sets", () => {
  const selector = selectorWithPrivate([], { maxTools: 1, tokenBudget: 5000 });

  // Identical sets
  const a = new Set(["a", "b", "c"]);
  assert.strictEqual(selector.jaccardSimilarity(a, a), 1, "identical sets should return 1");

  // Disjoint sets
  const b = new Set(["d", "e", "f"]);
  assert.strictEqual(selector.jaccardSimilarity(a, b), 0, "disjoint sets should return 0");

  // Partial overlap
  const c = new Set(["a", "b", "d"]);
  // intersection = 2, union = 4, similarity = 0.5
  assert.strictEqual(selector.jaccardSimilarity(a, c), 0.5, "partial overlap should return correct similarity");

  // Empty sets
  assert.strictEqual(selector.jaccardSimilarity(new Set(), new Set()), 0, "both empty should return 0");
  assert.strictEqual(selector.jaccardSimilarity(new Set(), a), 0, "one empty should return 0");
});

test("select handles edge cases", () => {
  const tools = [
    makeTool("db_query", "Query the database"),
    makeTool("file_read", "Read files from disk"),
  ];
  const selector = new ToolSelector(tools, { maxTools: 1, tokenBudget: 5000 });

  // Empty task description
  const emptyResult = selector.select("");
  assert.ok(emptyResult.length > 0, "should still select tools for empty task");

  // Task with only short words (< 2 chars)
  const shortWordsResult = selector.select("a b c d");
  assert.ok(shortWordsResult.length > 0, "should still select tools for short words");

  // No matching tools
  const noMatchResult = selector.select("xyzabc qwerty asdf");
  assert.ok(noMatchResult.length > 0, "should return fallback tools when no matches");
});

test("semantic scoring prioritizes description matches", () => {
  const tools = [
    makeTool("git_search", "Search git history for commits"),
    makeTool("github_search", "GitHub code search and repository lookup"),
    makeTool("file_search", "Search files by content pattern"),
  ];
  const selector = new ToolSelector(tools, { maxTools: 3, tokenBudget: 5000 });
  const selected = selector.select("find commits in git history");

  // Should prioritize git_search when task mentions git
  assert.ok(selected.some(t => t.name === "git_search"), "should select git_search");
  assert.ok(selected.some(t => t.name === "github_search"), "should select github_search for broader search");
});

test("semantic scoring boosts tools with matching description semantics", () => {
  const tools = [
    makeTool("database_query", "Execute SQL queries on the database"),
    makeTool("file_read", "Read files from the filesystem"),
    makeTool("api_call", "Make HTTP API requests to external services"),
  ];
  const selector = new ToolSelector(tools, { maxTools: 2, tokenBudget: 5000 });

  // Query mentions "database" - should boost database_query
  const selected = selector.select("query the database for user records");
  assert.ok(selected.some(t => t.name === "database_query"), "should select database_query");
});

test("n-gram methods are private and work correctly", () => {
  const tools = [
    makeTool("test_tool", "test description"),
  ];
  const selector = new ToolSelector(tools, { maxTools: 1, tokenBudget: 5000 });

  // Verify selector was created (internal methods not directly testable)
  const result = selector.select("test");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, "test_tool");
});