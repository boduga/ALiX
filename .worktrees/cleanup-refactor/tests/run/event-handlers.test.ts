import test from "node:test";
import assert from "node:assert/strict";
import {
  handleMcpToolSearch,
  handleScopeExpansion,
  buildScopeDenialMessage,
  buildScopeRejectionSummary,
  handleToolCall,
  type EventHandlerDeps,
} from "../../src/run/event-handlers.js";
import type { ToolCall } from "../../src/providers/types.js";
import { ScopeTracker } from "../../src/autonomy/scope-tracker.js";

// Mock dependencies for testing
function createMockDeps(): EventHandlerDeps {
  const scope = new ScopeTracker();
  scope.setInitialScope({ goal: "test", files: ["/test/file.ts"] });

  return {
    executor: {
      execute: async () => ({ kind: "success" as const, output: "mock result" }),
    } as any,
    mcpManager: null,
    mcpDiscovery: null,
    scope,
    session: { sessionId: "test-session", actor: "system" },
    sessionState: { created: new Set(), changed: new Set(), deleted: new Set(), pendingScopeExpansion: false, fatalErrors: [] } as any,
    log: {
      append: async () => {},
    } as any,
    selectedTools: [],
    mcpToolIndex: [],
    config: { permissions: {} },
  };
}

// Helper to extract string content from message
function getContentAsString(content: string | any[]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => typeof part === "string" ? part : (part.text ?? "")).join("");
  }
  return String(content);
}

// Test buildScopeDenialMessage
test("buildScopeDenialMessage returns formatted message", () => {
  const message = buildScopeDenialMessage("call-123", ["/path/a.ts", "/path/b.ts"]);
  assert.equal(message.role, "user");
  const content = getContentAsString(message.content);
  assert.ok(content.includes("call-123"));
  assert.ok(content.includes("path/a.ts"));
  assert.ok(content.includes("path/b.ts"));
});

// Test buildScopeRejectionSummary
test("buildScopeRejectionSummary formats paths", () => {
  const summary = buildScopeRejectionSummary(["/path/a.ts", "/path/b.ts"]);
  assert.ok(summary.includes("path/a.ts"));
  assert.ok(summary.includes("path/b.ts"));
  assert.ok(summary.includes("non-TTY ask mode"));
});

// Test handleScopeExpansion for non-mutation tools
test("handleScopeExpansion returns not handled for read tools", async () => {
  const deps = createMockDeps();
  const toolCall: ToolCall = {
    id: "call-1",
    name: "alix_file_read",
    args: { path: "/test/file.ts" },
  };

  const result = await handleScopeExpansion(toolCall, deps);
  assert.equal(result.handled, false);
});

// Test handleScopeExpansion for mutation tools
test("handleScopeExpansion handles mutation on allowed path", async () => {
  const deps = createMockDeps();
  const toolCall: ToolCall = {
    id: "call-1",
    name: "alix_file_write",
    args: { path: "/test/file.ts" },
  };

  const result = await handleScopeExpansion(toolCall, deps);
  // Allowed path is in scope, so not handled
  assert.equal(result.handled, false);
});

// Test handleScopeExpansion for denied paths
test("handleScopeExpansion returns denied for blocked paths", async () => {
  const deps = createMockDeps();
  deps.scope.denyScope("/denied/file.ts");

  const toolCall: ToolCall = {
    id: "call-1",
    name: "alix_file_write",
    args: { path: "/denied/file.ts" },
  };

  const result = await handleScopeExpansion(toolCall, deps);
  assert.equal(result.handled, true);
  assert.equal(result.denied, true);
  assert.equal(result.continue, false);
});

// Test handleScopeExpansion auto-approve in auto mode
test("handleScopeExpansion auto-approves in auto mode", async () => {
  const deps = createMockDeps();
  deps.config.permissions.sessionMode = "auto";

  const toolCall: ToolCall = {
    id: "call-1",
    name: "alix_file_write",
    args: { path: "/new/file.ts" },
  };

  const result = await handleScopeExpansion(toolCall, deps);
  assert.equal(result.handled, true);
  assert.equal(result.continue, true);
  assert.equal(result.denied, false);
});

// Test handleScopeExpansion auto-approve in bypass mode
test("handleScopeExpansion auto-approves in bypass mode", async () => {
  const deps = createMockDeps();
  deps.config.permissions.sessionMode = "bypass";

  const toolCall: ToolCall = {
    id: "call-1",
    name: "alix_file_write",
    args: { path: "/new/file.ts" },
  };

  const result = await handleScopeExpansion(toolCall, deps);
  assert.equal(result.handled, true);
  assert.equal(result.continue, true);
  assert.equal(result.denied, false);
});

// Test handleMcpToolSearch for non-MCP tool
test("handleMcpToolSearch returns not handled for regular tools", async () => {
  const deps = createMockDeps();
  const toolCall: ToolCall = {
    id: "call-1",
    name: "alix_file_read",
    args: { path: "/test/file.ts" },
  };

  const result = await handleMcpToolSearch(toolCall, deps);
  assert.equal(result.handled, false);
});

// Test handleMcpToolSearch when no discovery
test("handleMcpToolSearch handles missing discovery", async () => {
  const deps = createMockDeps();
  const toolCall: ToolCall = {
    id: "call-1",
    name: "alix_mcp_search_tools",
    args: { query: "test" },
  };

  const result = await handleMcpToolSearch(toolCall, deps);
  assert.equal(result.handled, true);
  assert.ok(result.message);
  const content = getContentAsString(result.message.content);
  assert.ok(content.includes("not configured"));
});

// Test handleToolCall success
test("handleToolCall returns message on success", async () => {
  const deps = createMockDeps();
  deps.executor.execute = async () => ({ kind: "success" as const, output: "test output" });

  const toolCall: ToolCall = {
    id: "call-1",
    name: "alix_file_read",
    args: { path: "/test/file.ts" },
  };

  const result = await handleToolCall(toolCall, deps, [], []);
  assert.ok(result.message);
  const content = getContentAsString(result.message.content);
  assert.ok(content.includes("test output"));
});

// Test handleToolCall error
test("handleToolCall tracks failed tools on error", async () => {
  const deps = createMockDeps();
  deps.executor.execute = async () => ({ kind: "error" as const, message: "test error" });

  const toolCall: ToolCall = {
    id: "call-1",
    name: "alix_file_read",
    args: { path: "/test/file.ts" },
  };

  const failedTools: string[] = [];
  const fatalErrors: string[] = [];

  const result = await handleToolCall(toolCall, deps, failedTools, fatalErrors);
  assert.ok(result.message);
  assert.ok(failedTools.includes("file.read"));
});

// Test handleToolCall tracks fatal errors
test("handleToolCall tracks fatal errors for non-retryable failures", async () => {
  const deps = createMockDeps();
  deps.executor.execute = async () => ({ kind: "error" as const, message: "fatal", retryable: false });

  const toolCall: ToolCall = {
    id: "call-1",
    name: "alix_file_read",
    args: { path: "/test/file.ts" },
  };

  const failedTools: string[] = [];
  const fatalErrors: string[] = [];

  const result = await handleToolCall(toolCall, deps, failedTools, fatalErrors);
  assert.ok(fatalErrors.includes("file.read"));
});