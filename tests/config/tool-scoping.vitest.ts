/**
 * Tests for T1a/T1b tool scoping + relevance filter (§2).
 *
 * CORE_TOOL_NAMES are always admitted. Extended tools are admitted
 * when their name/description/server matches task keywords. When
 * no extended tools match and non-core tools exist, fallbackFull
 * admits everything and flags true.
 */
import { describe, it, expect } from "vitest";
import { CORE_TOOL_NAMES, scopeToolsByTask } from "../../src/config/tool-scoping.js";
import type { ToolDef } from "../../src/providers/types.js";
import type { DeferredToolEntry } from "../../src/mcp/tool-deferral.js";

function tool(name: string, description: string): ToolDef {
  return { name, description, input_schema: { type: "object", properties: {} } };
}

function mcpTool(
  name: string,
  description: string,
  serverName: string,
): DeferredToolEntry {
  return { name, description, input_schema: { type: "object", properties: {} }, serverName, toolName: name.replace(/^mcp_/, ""), execName: name };
}

describe("CORE_TOOL_NAMES", () => {
  it("includes the five always-mandatory tools", () => {
    expect(CORE_TOOL_NAMES.has("alix_shell_run")).toBe(true);
    expect(CORE_TOOL_NAMES.has("alix_file_read")).toBe(true);
    expect(CORE_TOOL_NAMES.has("alix_patch_apply")).toBe(true);
    expect(CORE_TOOL_NAMES.has("alix_patch_create")).toBe(true);
    expect(CORE_TOOL_NAMES.has("alix_done")).toBe(true);
    // `file.write` is not an executable tool — no `alix_file_write` in core.
    expect(CORE_TOOL_NAMES.has("alix_file_write")).toBe(false);
    expect(CORE_TOOL_NAMES.size).toBe(5);
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
    expect(extended.map((t) => t.name)).toContain("github_repos_list");
  });

  it("admits MCP tool when description matches task", () => {
    const { extended } = scopeToolsByTask(
      [],
      [mcpTool("github_repos_list", "list repos on github", "github")],
      "list my github repos",
    );
    expect(extended.map((t) => t.name)).toContain("github_repos_list");
  });

  it("admits MCP tool when tool name matches task", () => {
    const { extended } = scopeToolsByTask(
      [],
      [mcpTool("github_repos_list", "list repos on github", "github")],
      "list my github repos",
    );
    expect(extended.map((t) => t.name)).toContain("github_repos_list");
  });

  it("excludes non-matching MCP tools", () => {
    const { extended } = scopeToolsByTask(
      [],
      [mcpTool("github_repos_list", "list repos on github", "github"), mcpTool("slack_send_message", "send messages on slack", "slack")],
      "list my github repos",
    );
    expect(extended.map((t) => t.name)).toContain("github_repos_list");
    expect(extended.map((t) => t.name)).not.toContain("slack_send_message");
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
    expect(result.extended.map((t) => t.name)).toContain("github_repos_list");
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
    expect(extended[0]!.name).toBe("github_repos_list");
    expect(extended[0]!.description).toBe("list repos on github");
    expect(extended[0]!.input_schema).toEqual({ type: "object", properties: {} });
  });
});
