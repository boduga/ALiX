import { describe, expect, it } from "vitest";
import { ToolSelector } from "../../src/mcp/tool-selector.js";
import type { DeferredToolEntry } from "../../src/mcp/tool-deferral.js";

const entry = (name: string, searchName: string, description: string): DeferredToolEntry => ({
  name, searchName, description, serverName: "test", toolName: searchName,
  execName: `mcp.test.${searchName}`, input_schema: { type: "object", properties: {} },
});

describe("opaque MCP tool selection", () => {
  const tools = [
    entry("mcp__a", "github_repos_list", "List repositories"),
    entry("mcp__b", "calendar_events_create", "Create events"),
    entry("mcp__c", "filesystem_read", "Read workspace files"),
  ];

  it("ranks by readable registry identity, not opaque handle", () => {
    const selected = new ToolSelector(tools, { maxTools: 2, tokenBudget: 1000 }).select("list GitHub repos");
    expect(selected.map(tool => tool.name)).toContain("mcp__a");
  });

  it("retains safe fallback detection with opaque handles", () => {
    const selected = new ToolSelector(tools, { maxTools: 2, tokenBudget: 1000 }).select("calendar events");
    expect(selected.map(tool => tool.name)).toContain("mcp__c");
  });
});
