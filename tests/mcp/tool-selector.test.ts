import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolSelector } from "../../src/mcp/tool-selector.js";
import type { DeferredToolEntry } from "../../src/mcp/tool-deferral.js";

function makeTool(name: string, description: string, server = "test-server"): DeferredToolEntry {
  return {
    name: `mcp_${server}_${name.replace(/\./g, "_")}`,
    execName: `mcp.${server}.${name}`,
    serverName: server,
    toolName: name,
    description,
    input_schema: { type: "object" as const, properties: {} },
  };
}

describe("ToolSelector", () => {
  const tools: DeferredToolEntry[] = [
    makeTool("repos.list", "List GitHub repositories"),
    makeTool("repos.create", "Create a GitHub repository"),
    makeTool("issues.list", "List GitHub issues"),
    makeTool("issues.create", "Create a GitHub issue"),
    makeTool("pr.review", "Review a pull request"),
    makeTool("filesystem.read", "Read files from disk"),
    makeTool("filesystem.write", "Write files to disk"),
    makeTool("fetch.get", "Fetch HTTP URLs"),
    makeTool("calendar.events.list", "List calendar events"),
    makeTool("calendar.events.create", "Create calendar events"),
  ];

  it("returns all tools when task is broad and budget is large", () => {
    const selector = new ToolSelector(tools, { maxTools: 100, tokenBudget: 50000 });
    const selected = selector.select("do everything");
    assert.strictEqual(selected.length, tools.length);
  });

  it("filters to github tools for a github task", () => {
    const selector = new ToolSelector(tools, { maxTools: 5, tokenBudget: 50000 });
    const selected = selector.select("list GitHub repositories and issues");
    assert.ok(selected.length < tools.length, "should filter");
    assert.ok(selected.every(t => t.serverName === "test-server"), "all same server");
    const names = selected.map(t => t.name);
    assert.ok(names.includes("mcp_test-server_repos_list"), "should include repos.list");
    assert.ok(names.includes("mcp_test-server_issues_list"), "should include issues.list");
  });

  it("respects maxTools limit", () => {
    const selector = new ToolSelector(tools, { maxTools: 3, tokenBudget: 50000 });
    const selected = selector.select("github repos issues");
    assert.strictEqual(selected.length, 3);
  });

  it("respects token budget by estimating tokens", () => {
    const manyTools: DeferredToolEntry[] = Array.from({ length: 50 }, (_, i) =>
      makeTool(`tool${i}`, `Description for tool number ${i} with some extra words`)
    );
    const selector = new ToolSelector(manyTools, { maxTools: 100, tokenBudget: 100 });
    const selected = selector.select("something");
    assert.ok(selected.length < manyTools.length, "should limit by budget");
  });

  it("always includes a safe fallback tool (filesystem.read) when no match", () => {
    const selector = new ToolSelector(tools, { maxTools: 3, tokenBudget: 50000 });
    const selected = selector.select("random gibberish xyz123");
    const names = selected.map(t => t.name);
    assert.ok(names.includes("mcp_test-server_filesystem_read"), "should include filesystem.read as fallback");
  });

  it("includes tools matching task keywords in name or description", () => {
    const selector = new ToolSelector(tools, { maxTools: 10, tokenBudget: 50000 });
    const selected = selector.select("calendar scheduling meeting");
    const names = selected.map(t => t.name);
    assert.ok(names.some(n => n.includes("calendar")), "should include calendar tools");
  });
});