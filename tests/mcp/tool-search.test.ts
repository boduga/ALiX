import { describe, it } from "node:test";
import assert from "node:assert";
import { searchTools } from "../../src/mcp/tool-search.js";

interface Tool { name: string; description: string; [key: string]: string | number | boolean | object | undefined; }

describe("searchTools", () => {
  const tools: Tool[] = [
    { name: "mcp_github_repos_list", description: "List repositories for a user or organization" },
    { name: "mcp_github_issues_list", description: "List issues in a repository" },
    { name: "mcp_fetch_web_page", description: "Fetch the content of a web page" },
  ];

  it("returns exact match with highest score", () => {
    const results = searchTools("mcp_github_repos_list", tools);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].item.name, "mcp_github_repos_list");
    assert.strictEqual(results[0].score, 100);
  });

  it("matches prefix", () => {
    const results = searchTools("mcp_github", tools);
    assert.ok(results.length >= 2);
    assert.strictEqual(results[0].score, 80);
    assert.ok(results.some(r => r.item.name === "mcp_github_repos_list"), "Should include github_repos_list");
  });

  it("matches substring", () => {
    const results = searchTools("repos", tools);
    assert.ok(results.some(r => r.item.name === "mcp_github_repos_list"));
  });

  it("finds typo 'guthu' -> 'github'", () => {
    const results = searchTools("mcp_guthu_repos_list", tools);
    assert.ok(results.length > 0, "Should find github with typo");
    assert.strictEqual(results[0].item.name, "mcp_github_repos_list");
    assert.ok(results[0].score > 0, "Should have positive score");
  });

  it("returns empty for no match", () => {
    const results = searchTools("nonexistent_tool_xyz", tools);
    assert.strictEqual(results.length, 0);
  });

  it("returns results sorted by score descending", () => {
    const results = searchTools("github", tools);
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score);
    }
  });

  it("handles empty query string", () => {
    const results = searchTools("", tools);
    assert.ok(Array.isArray(results));
  });

  it("handles tools with empty/undefined name", () => {
    const toolsWithEmpty = [
      { name: "", description: "Empty name tool" },
      { name: "valid_tool", description: "Valid tool" },
    ];
    const results = searchTools("valid_tool", toolsWithEmpty);
    assert.ok(results.length >= 1);
  });

  it("handles Levenshtein boundary at relative = 0.5", () => {
    const tools = [
      { name: "abcdefghij", description: "Long name" },
    ];
    const farQuery = "xyz";
    const results = searchTools(farQuery, tools);
    assert.strictEqual(results.length, 0, "Should not match when relative > 0.5");
  });
});