import { describe, expect, it } from "vitest";
import { McpToolDeferral } from "../../src/mcp/tool-deferral.js";

describe("MCP model tool handles", () => {
  const tools = [
    { fullName: "a_b/c", serverName: "a_b", toolName: "c", description: "First", inputSchema: { type: "object", properties: {} } },
    { fullName: "a/b_c", serverName: "a", toolName: "b_c", description: "Second", inputSchema: { type: "object", properties: {} } },
  ];
  const registry = {
    listTools: () => tools,
    getTool: (name: string) => tools.find((tool) => tool.fullName === name),
  };

  it("issues distinct opaque mcp__ handles for names that formerly collided", () => {
    const deferral = new McpToolDeferral(registry as never);
    const entries = deferral.buildIndex();
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toMatch(/^mcp__[A-Za-z0-9_-]+$/);
    expect(entries[1].name).toMatch(/^mcp__[A-Za-z0-9_-]+$/);
    expect(entries[0].name).not.toBe(entries[1].name);
    expect(entries.map((entry) => entry.name)).toEqual(new McpToolDeferral(registry as never).buildIndex().map((entry) => entry.name));
  });

  it("resolves only a registered opaque handle", () => {
    const deferral = new McpToolDeferral(registry as never);
    const entries = deferral.buildIndex();
    expect(deferral.resolve(entries[0].name)?.description).toContain("First");
    expect(deferral.resolve("mcp_a_b_c")).toBeUndefined();
    expect(deferral.resolve(entries[0].execName)).toBeUndefined();
  });
});
