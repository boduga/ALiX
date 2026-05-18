import test from "node:test";
import assert from "node:assert/strict";
import { getToolPolicy, filterTools } from "../../src/agents/tool-policy.js";
import type { ToolDef } from "../../src/providers/types.js";

test("getToolPolicy returns read-only for explorer role", () => {
  const policy = getToolPolicy("explorer");
  assert.deepEqual(policy.allowedCategories, ["read", "mcp"]);
  assert.equal(policy.maxIterations, 5);
});

test("getToolPolicy returns write access for worker role", () => {
  const policy = getToolPolicy("worker");
  assert.deepEqual(policy.allowedCategories, ["read", "write", "mcp"]);
  assert.equal(policy.maxIterations, 5);
});

test("getToolPolicy returns read-only for reviewer", () => {
  const policy = getToolPolicy("reviewer");
  assert.deepEqual(policy.allowedCategories, ["read", "mcp"]);
});

test("getToolPolicy returns read-only for test_investigator", () => {
  const policy = getToolPolicy("test_investigator");
  assert.deepEqual(policy.allowedCategories, ["read", "mcp"]);
});

test("getToolPolicy returns read-only for docs_researcher", () => {
  const policy = getToolPolicy("docs_researcher");
  assert.deepEqual(policy.allowedCategories, ["read", "mcp"]);
});

test("filterTools removes write tools for read-only roles", () => {
  const tools: ToolDef[] = [
    { name: "alix_file_read", description: "read files", input_schema: { type: "object", properties: {} } },
    { name: "alix_file_write", description: "write files", input_schema: { type: "object", properties: {} } },
    { name: "alix_done", description: "done", input_schema: { type: "object", properties: {} } },
  ];
  const policy = getToolPolicy("explorer");
  const filtered = filterTools(tools, policy);
  const names = filtered.map(t => t.name);
  assert.ok(names.includes("alix_file_read"), "should include read tool");
  assert.ok(names.includes("alix_done"), "should include done tool");
  assert.ok(!names.includes("alix_file_write"), "should NOT include write tool");
});

test("filterTools includes write tools for worker role", () => {
  const tools: ToolDef[] = [
    { name: "alix_file_read", description: "read", input_schema: { type: "object", properties: {} } },
    { name: "alix_file_write", description: "write", input_schema: { type: "object", properties: {} } },
  ];
  const policy = getToolPolicy("worker");
  const filtered = filterTools(tools, policy);
  const names = filtered.map(t => t.name);
  assert.ok(names.includes("alix_file_read"));
  assert.ok(names.includes("alix_file_write"));
});

test("filterTools allows MCP tools when allowMcpTools is true", () => {
  const tools: ToolDef[] = [
    { name: "mcp_github_search", description: "github", input_schema: { type: "object", properties: {} } },
  ];
  const policy = getToolPolicy("explorer");
  const filtered = filterTools(tools, policy);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].name, "mcp_github_search");
});

test("filterTools always allows alix_done and mcp_search_tools", () => {
  const tools: ToolDef[] = [
    { name: "alix_done", description: "", input_schema: { type: "object", properties: {} } },
    { name: "mcp_search_tools", description: "", input_schema: { type: "object", properties: {} } },
  ];
  const policy = getToolPolicy("explorer");
  const filtered = filterTools(tools, policy);
  assert.equal(filtered.length, 2);
});

test("filterTools allows git and shell tools for read-only roles", () => {
  const tools: ToolDef[] = [
    { name: "alix_git_status", description: "", input_schema: { type: "object", properties: {} } },
    { name: "alix_shell_run", description: "", input_schema: { type: "object", properties: {} } },
  ];
  const policy = getToolPolicy("explorer");
  const filtered = filterTools(tools, policy);
  assert.equal(filtered.length, 2);
});