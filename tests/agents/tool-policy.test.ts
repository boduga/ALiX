import test from "node:test";
import assert from "node:assert/strict";
import { getToolPolicy, filterTools } from "../../src/agents/tool-policy.js";
import type { ToolDef } from "../../src/providers/types.js";

test("getToolPolicy returns read-only for explorer role", () => {
  const policy = getToolPolicy("explorer");
  assert.deepEqual(policy.allowedCategories, ["read"]);
  assert.equal(policy.maxIterations, 5);
});

test("getToolPolicy returns write access for worker role", () => {
  const policy = getToolPolicy("worker");
  assert.deepEqual(policy.allowedCategories, ["read", "write", "mcp"]);
  assert.equal(policy.maxIterations, 5);
});

test("getToolPolicy returns read-only for reviewer", () => {
  const policy = getToolPolicy("reviewer");
  assert.deepEqual(policy.allowedCategories, ["read"]);
});

test("getToolPolicy returns read-only for test_investigator", () => {
  const policy = getToolPolicy("test_investigator");
  assert.deepEqual(policy.allowedCategories, ["read"]);
});

test("getToolPolicy returns read-only for docs_researcher", () => {
  const policy = getToolPolicy("docs_researcher");
  assert.deepEqual(policy.allowedCategories, ["read"]);
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

test("filterTools blocks MCP tools for read-only roles", () => {
  const tools: ToolDef[] = [
    { name: "mcp_github_search", description: "github", input_schema: { type: "object", properties: {} } },
  ];
  const policy = getToolPolicy("explorer");
  const filtered = filterTools(tools, policy);
  assert.equal(filtered.length, 0, "MCP tools should be blocked for read-only roles");
});

test("filterTools always allows alix_done", () => {
  const tools: ToolDef[] = [
    { name: "alix_done", description: "", input_schema: { type: "object", properties: {} } },
  ];
  const policy = getToolPolicy("explorer");
  const filtered = filterTools(tools, policy);
  assert.equal(filtered.length, 1);
});

test("filterTools allows mcp_search_tools only when MCP tools allowed", () => {
  const tools = [{ name: "mcp_search_tools", description: "", input_schema: { type: "object", properties: {} } }];
  const explorerPolicy = getToolPolicy("explorer");
  const workerPolicy = getToolPolicy("worker");
  assert.equal(filterTools(tools, explorerPolicy).length, 0, "blocked for explorer");
  assert.equal(filterTools(tools, workerPolicy).length, 1, "allowed for worker");
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