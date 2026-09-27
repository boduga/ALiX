/**
 * Tests for T1a/T1b tool scoping + relevance filter (§2).
 *
 * CORE_TOOL_NAMES are always admitted. Extended tools are admitted
 * when their name/description/server matches task keywords. When
 * no extended tools match and non-core tools exist, fallbackFull
 * admits everything and flags true.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { CORE_TOOL_NAMES, scopeToolsByTask } from "../../src/config/tool-scoping.js";
import type { ToolDef } from "../../src/providers/types.js";
import type { DeferredToolEntry } from "../../src/mcp/tool-deferral.js";

function tool(name: string, description: string): ToolDef {
  return { name, description, input_schema: { type: "object", properties: {} } };
}

function mcpHandle(name: string): string {
  return `mcp__${createHash("sha256").update(name).digest("base64url")}`;
}

function mcpTool(
  name: string,
  description: string,
  serverName: string,
): DeferredToolEntry {
  return { name: mcpHandle(name), searchName: name, description, input_schema: { type: "object", properties: {} }, serverName, toolName: name, execName: `mcp.${serverName}.${name}` };
}

describe("CORE_TOOL_NAMES", () => {
  it("includes core tools and bound worker collaboration tools", () => {
    expect(CORE_TOOL_NAMES.has("alix_shell_run")).toBe(true);
    expect(CORE_TOOL_NAMES.has("alix_file_read")).toBe(true);
    expect(CORE_TOOL_NAMES.has("alix_patch_apply")).toBe(true);
    expect(CORE_TOOL_NAMES.has("alix_patch_create")).toBe(false);
    expect(CORE_TOOL_NAMES.has("alix_done")).toBe(true);
    // `file.write` is not an executable tool — no `alix_file_write` in core.
    expect(CORE_TOOL_NAMES.has("alix_file_write")).toBe(false);
    expect(CORE_TOOL_NAMES.has("alix_collaboration_publish_finding")).toBe(true);
    expect(CORE_TOOL_NAMES.size).toBe(10);
  });
});

describe("scopeToolsByTask provenance", () => {
  const relevanceTool = tool("alix_coordination_run", "Run coordinated workers toward a goal");
  const irrelevantTool = tool("alix_web_search", "Search the public web");

  it("records why each tool was admitted, with stable machine-readable reasons", () => {
    const scoped = scopeToolsByTask(
      [tool("alix_file_read", "Read a file"), relevanceTool, irrelevantTool],
      [],
      "Run four coordinated workers",
    );
    const admitted = new Map(scoped.provenance.admitted.map((entry) => [entry.tool, entry.reasons]));
    expect(admitted.get("alix_file_read")).toEqual(["core"]);
    expect(admitted.get("alix_coordination_run")).toEqual(["relevance_match"]);
    expect(scoped.provenance.excluded).toEqual([{ tool: "alix_web_search", reasons: ["not_relevant"] }]);
    expect(scoped.provenance.fallbackFull).toBe(false);
  });

  it("marks every non-core admission as fallback_full and excludes nothing", () => {
    const scoped = scopeToolsByTask(
      [tool("alix_file_read", "Read a file"), tool("alix_web_search", "Search the public web")],
      [],
      "zzz",
    );
    expect(scoped.provenance.fallbackFull).toBe(true);
    expect(scoped.provenance.admitted.find((entry) => entry.tool === "alix_web_search")?.reasons)
      .toEqual(["fallback_full"]);
    expect(scoped.provenance.excluded).toEqual([]);
  });

  it("keeps provenance in step with the returned partitions", () => {
    const scoped = scopeToolsByTask([tool("alix_file_read", "Read a file"), relevanceTool], [], "coordinated workers");
    const admittedNames = scoped.provenance.admitted.map((entry) => entry.tool).sort();
    expect(admittedNames).toEqual([...scoped.core, ...scoped.extended].map((entry) => entry.name).sort());
  });

  it("ranks admitted tools by overlapping-token count, excluding the dropped ones", () => {
    const scoped = scopeToolsByTask(
      [
        tool("alix_file_read", "Read a file"),
        tool("alix_coordination_run", "Run coordinated workers toward a goal"),
        tool("alix_web_search", "Search the public web"),
      ],
      [],
      "Run coordinated workers to write a file",
    );
    const ranked = scoped.provenance.ranking;
    // coordination tool matches "coordination"? no — "coordinated" is a distinct
    // token, so only the tools whose signals overlap the task score above zero.
    const topScore = Math.max(...ranked.map((entry) => entry.score));
    expect(topScore).toBeGreaterThan(0);
    expect(ranked[0].score).toBe(topScore);
    // Ranking is descending and never mentions a tool that was not admitted.
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    const offered = [...scoped.core, ...scoped.extended].map((entry) => entry.name);
    for (const entry of ranked) expect(offered).toContain(entry.tool);
  });

  it("scores core tools by relevance too, so membership alone does not outrank a match", () => {
    const scoped = scopeToolsByTask(
      [tool("alix_file_read", "Read a file"), tool("alix_coordination_run", "Run coordinated workers")],
      [],
      "coordinated workers",
    );
    const ranked = new Map(scoped.provenance.ranking.map((entry) => [entry.tool, entry.score]));
    expect(ranked.get("alix_coordination_run")).toBeGreaterThan(ranked.get("alix_file_read") ?? 0);
  });
});

describe("scopeToolsByTask", () => {
  it("returns core tools regardless of task", () => {
    const result = scopeToolsByTask(
      [tool("alix_shell_run", "run shell commands"), tool("alix_file_read", "read files")],
      [],
      "any task",
    );
    expect(result.core.map((t) => t.name)).toEqual(["alix_shell_run", "alix_file_read"]);
    expect(result.extended).toEqual([]);
    expect(result.fallbackFull).toBe(false);
  });

  it("admits extended provider tool when description matches task", () => {
    const result = scopeToolsByTask(
      [],
      [],
      "schedule a meeting for tomorrow",
    );
    // No tools at all — extended empty, fallbackFull false (no non-core existed)
    expect(result.extended).toEqual([]);
    expect(result.fallbackFull).toBe(false);
  });

  it("admits extended provider tool when description matches task", () => {
    const { extended } = scopeToolsByTask(
      [tool("alix_shell_run", "run shell commands"), tool("alix_schedule_meeting", "schedule cron jobs and meetings")],
      [],
      "schedule a meeting for tomorrow",
    );
    expect(extended.map((t) => t.name)).toContain("alix_schedule_meeting");
    expect(extended.map((t) => t.name)).not.toContain("alix_shell_run");
  });

  it("admits MCP tool when server name matches task", () => {
    const { extended } = scopeToolsByTask(
      [],
      [mcpTool("github_repos_list", "list repos on github", "github")],
      "list my github repos",
    );
    expect(extended.map((t) => t.name)).toContain(mcpHandle("github_repos_list"));
  });

  it("admits MCP tool when description matches task", () => {
    const { extended } = scopeToolsByTask(
      [],
      [mcpTool("github_repos_list", "list repos on github", "github")],
      "list my github repos",
    );
    expect(extended.map((t) => t.name)).toContain(mcpHandle("github_repos_list"));
  });

  it("admits MCP tool when tool name matches task", () => {
    const { extended } = scopeToolsByTask(
      [],
      [mcpTool("customer_records_export", "operates plugin", "service")],
      "export customer records",
    );
    expect(extended.map((t) => t.name)).toContain(mcpHandle("customer_records_export"));
    expect(scopeToolsByTask([], [mcpTool("customer_records_export", "operates plugin", "service")], "export customer records").fallbackFull).toBe(false);
  });

  it("excludes non-matching MCP tools", () => {
    const { extended } = scopeToolsByTask(
      [],
      [mcpTool("github_repos_list", "list repos on github", "github"), mcpTool("slack_send_message", "send messages on slack", "slack")],
      "list my github repos",
    );
    expect(extended.map((t) => t.name)).toContain(mcpHandle("github_repos_list"));
    expect(extended.map((t) => t.name)).not.toContain(mcpHandle("slack_send_message"));
  });

  it("triggers fallbackFull when no extended match but non-core tools exist", () => {
    const result = scopeToolsByTask(
      [tool("alix_shell_run", "run shell commands"), tool("alix_schedule_meeting", "schedule things")],
      [mcpTool("github_repos_list", "list repos on github", "github")],
      "completely unrelated task with no keyword matches at all",
    );
    expect(result.fallbackFull).toBe(true);
    // In fallback mode, extended includes ALL non-core tools
    expect(result.extended.map((t) => t.name)).toContain("alix_schedule_meeting");
    expect(result.extended.map((t) => t.name)).toContain(mcpHandle("github_repos_list"));
    expect(result.extended.map((t) => t.name)).not.toContain("alix_shell_run");
  });

  it("does not trigger fallbackFull when no non-core tools exist", () => {
    const result = scopeToolsByTask(
      [tool("alix_shell_run", "run shell commands")],
      [],
      "completely unrelated task",
    );
    expect(result.fallbackFull).toBe(false);
    expect(result.extended).toEqual([]);
  });

  it("flattens MCP tools to ToolDef shape in extended", () => {
    const { extended } = scopeToolsByTask(
      [],
      [mcpTool("github_repos_list", "list repos on github", "github")],
      "list my github repos",
    );
    expect(extended.length).toBe(1);
    expect(extended[0]!.name).toBe(mcpHandle("github_repos_list"));
    expect(extended[0]!.description).toBe("list repos on github");
    expect(extended[0]!.input_schema).toEqual({ type: "object", properties: {} });
  });
});
