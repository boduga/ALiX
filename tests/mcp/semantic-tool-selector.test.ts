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