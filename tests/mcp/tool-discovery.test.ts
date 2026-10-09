import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ToolDiscovery } from "../../src/capabilities/mcp/tool-discovery.js";
import type { DeferredToolEntry } from "../../src/capabilities/mcp/tool-deferral.js";

function makeTool(name: string, description: string): DeferredToolEntry {
  const handle = createHash("sha256").update(JSON.stringify(["github", name])).digest("base64url");
  return {
    name: `mcp__${handle}`,
    searchName: `github_${name.replace(/\./g, "_")}`,
    execName: `mcp.github.${name}`,
    serverName: "github",
    toolName: name,
    description,
    input_schema: { type: "object" as const, properties: {} },
  };
}

describe("ToolDiscovery", () => {
  const tools: DeferredToolEntry[] = [
    makeTool("repos.list", "List repositories"),
    makeTool("repos.create", "Create a repository"),
    makeTool("issues.list", "List issues"),
    makeTool("filesystem.read", "Read files"),
  ];

  it("returns matching tools for a query", async () => {
    const discovery = new ToolDiscovery(tools);
    const result = await discovery.search("github repos");
    assert.ok(result.kind === "success");
    assert.ok(result.output!.includes("repos"));
    assert.ok(!result.output!.includes("filesystem"));
    assert.ok(result.output!.includes(tools[0]!.name));
    assert.ok(!result.output!.includes("Use as: mcp.github."));
  });

  it("returns all tools when query is empty", async () => {
    const discovery = new ToolDiscovery(tools);
    const result = await discovery.search("");
    assert.ok(result.kind === "success");
    assert.ok(result.output!.includes("4 MCP tools"));
  });

  it("returns a helpful message when no matches", async () => {
    const discovery = new ToolDiscovery(tools);
    const result = await discovery.search("xyznonexistent123");
    assert.ok(result.kind === "success");
    assert.ok(result.output!.includes("No tools found"));
  });
});
