import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FileToolRouter,
  ShellToolRouter,
  PatchToolRouter,
  McpToolRouter,
  DelegateToolRouter,
  CompositeToolRouter,
} from "../../src/tools/tool-router.js";
import type { ToolResult } from "../../src/tools/types.js";

test("ToolRouter interface exists", () => {
  const router = new CompositeToolRouter([]);
  assert.strictEqual(typeof router.canHandle, "function");
  assert.strictEqual(typeof router.execute, "function");
});

test("CompositeToolRouter finds matching router and delegates", async () => {
  const fileRouter = new FileToolRouter("/tmp");
  const shellRouter = new ShellToolRouter();
  const composite = new CompositeToolRouter([fileRouter, shellRouter]);

  // Create a temp file to test file.read works
  await writeFile("/tmp/test-router-delegate.txt", "hello");
  const request = { toolCallId: "1", name: "file.read", args: { path: "test-router-delegate.txt" } };
  const result = await composite.execute(request);
  assert.strictEqual(result.kind, "success");
  assert.strictEqual(result.content, "hello");
  await rm("/tmp/test-router-delegate.txt", { force: true });
});

test("CompositeToolRouter returns error when no router handles tool", async () => {
  const composite = new CompositeToolRouter([]);
  const request = { toolCallId: "1", name: "unknown.tool", args: {} };
  const result = await composite.execute(request);
  assert.strictEqual(result.kind, "error");
  assert.ok(result.message.includes("No router found for tool: unknown.tool"));
});

test("FileToolRouter.canHandle returns true for file tools", () => {
  const router = new FileToolRouter();
  assert.strictEqual(router.canHandle("file.read"), true);
  assert.strictEqual(router.canHandle("file.create"), true);
  assert.strictEqual(router.canHandle("file.delete"), true);
  assert.strictEqual(router.canHandle("file.exists"), true);
  assert.strictEqual(router.canHandle("dir.search"), true);
});

test("FileToolRouter.canHandle returns false for others", () => {
  const router = new FileToolRouter();
  assert.strictEqual(router.canHandle("shell.run"), false);
  assert.strictEqual(router.canHandle("patch.apply"), false);
  assert.strictEqual(router.canHandle("mcp.some"), false);
  assert.strictEqual(router.canHandle("delegate"), false);
});

test("ShellToolRouter.canHandle returns true for shell.run", () => {
  const router = new ShellToolRouter();
  assert.strictEqual(router.canHandle("shell.run"), true);
});

test("ShellToolRouter.canHandle returns false for others", () => {
  const router = new ShellToolRouter();
  assert.strictEqual(router.canHandle("file.read"), false);
  assert.strictEqual(router.canHandle("patch.apply"), false);
  assert.strictEqual(router.canHandle("mcp.some"), false);
  assert.strictEqual(router.canHandle("delegate"), false);
});

test("PatchToolRouter.canHandle returns true for patch.apply", () => {
  const router = new PatchToolRouter("/tmp", { version: 1, model: { provider: "anthropic", name: "claude" }, permissions: { default: "ask", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] }, context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] }, runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] }, ui: { enabled: false, host: "localhost", port: 8080, transport: "sse" } });
  assert.strictEqual(router.canHandle("patch.apply"), true);
});

test("PatchToolRouter.canHandle returns false for others", () => {
  const router = new PatchToolRouter("/tmp", { version: 1, model: { provider: "anthropic", name: "claude" }, permissions: { default: "ask", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] }, context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] }, runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] }, ui: { enabled: false, host: "localhost", port: 8080, transport: "sse" } });
  assert.strictEqual(router.canHandle("file.read"), false);
  assert.strictEqual(router.canHandle("shell.run"), false);
  assert.strictEqual(router.canHandle("mcp.some"), false);
  assert.strictEqual(router.canHandle("delegate"), false);
});

test("McpToolRouter.canHandle returns true for mcp.* tools", () => {
  const router = new McpToolRouter({ callTool: async () => ({ kind: "success", output: "" }) } as any);
  assert.strictEqual(router.canHandle("mcp.some"), true);
  assert.strictEqual(router.canHandle("mcp.github-mcp__list_issues"), true);
  assert.strictEqual(router.canHandle("mcp.filesystem.read"), true);
});

test("McpToolRouter.canHandle returns false for non-mcp tools", () => {
  const router = new McpToolRouter({ callTool: async () => ({ kind: "success", output: "" }) } as any);
  assert.strictEqual(router.canHandle("file.read"), false);
  assert.strictEqual(router.canHandle("shell.run"), false);
  assert.strictEqual(router.canHandle("patch.apply"), false);
  assert.strictEqual(router.canHandle("delegate"), false);
});

test("DelegateToolRouter.canHandle returns true for delegate", () => {
  const router = new DelegateToolRouter();
  assert.strictEqual(router.canHandle("delegate"), true);
});

test("DelegateToolRouter.canHandle returns false for others", () => {
  const router = new DelegateToolRouter();
  assert.strictEqual(router.canHandle("file.read"), false);
  assert.strictEqual(router.canHandle("shell.run"), false);
  assert.strictEqual(router.canHandle("patch.apply"), false);
  assert.strictEqual(router.canHandle("mcp.some"), false);
});

test("CompositeToolRouter selects first matching router by order", async () => {
  // Create mock routers with overlapping capabilities to test ordering
  const firstRouterCanHandle = new (class {
    canHandle(name: string): boolean {
      return name === "file.read";
    }
    async execute(_request: any): Promise<any> {
      return { kind: "success", value: "first-router-handled" };
    }
  })();

  const secondRouterCanHandle = new (class {
    canHandle(name: string): boolean {
      return name === "file.read"; // Same capability as first
    }
    async execute(_request: any): Promise<any> {
      return { kind: "success", value: "second-router-handled" };
    }
  })();

  // First router comes first - it should handle the request
  const composite = new CompositeToolRouter([firstRouterCanHandle, secondRouterCanHandle]);
  const request = { toolCallId: "1", name: "file.read", args: {} };
  const result = await composite.execute(request);
  assert.strictEqual(result.kind, "success");
  assert.strictEqual(result.value, "first-router-handled");
});

test("CompositeToolRouter delegates to correct router when order is reversed", async () => {
  // Create mock routers with overlapping capabilities
  const mockRouterA = {
    canHandle(name: string): boolean {
      return name === "file.read";
    },
    execute(_request: any): Promise<any> {
      return Promise.resolve({ kind: "success", value: "router-A-handled" });
    }
  };

  const mockRouterB = {
    canHandle(name: string): boolean {
      return name === "file.read"; // Same capability as A
    },
    execute(_request: any): Promise<any> {
      return Promise.resolve({ kind: "success", value: "router-B-handled" });
    }
  };

  // B comes first - it should handle the request
  const composite = new CompositeToolRouter([mockRouterB, mockRouterA]);
  const request = { toolCallId: "1", name: "file.read", args: {} };
  const result = await composite.execute(request);
  assert.strictEqual(result.kind, "success");
  assert.strictEqual(result.value, "router-B-handled");
});

test("CompositeToolRouter prioritizes FileToolRouter over ShellToolRouter for file.read", async () => {
  const fileRouter = new FileToolRouter("/tmp");
  const shellRouter = new ShellToolRouter();

  // Create a temp file to test file.read works
  await writeFile("/tmp/test-priority.txt", "priority-test");
  const composite = new CompositeToolRouter([fileRouter, shellRouter]);
  const request = { toolCallId: "1", name: "file.read", args: { path: "test-priority.txt" } };

  const result = await composite.execute(request);
  assert.strictEqual(result.kind, "success");
  assert.strictEqual(result.content, "priority-test");
  await rm("/tmp/test-priority.txt", { force: true });
});

test("FileToolRouter.execute handles file.read", async () => {
  const router = new FileToolRouter("/tmp");
  await writeFile("/tmp/test-read-file.txt", "file read content");
  const result = await router.execute({
    toolCallId: "1",
    name: "file.read",
    args: { path: "test-read-file.txt" },
  });
  assert.strictEqual(result.kind, "success");
  assert.strictEqual(result.content, "file read content");
  await rm("/tmp/test-read-file.txt", { force: true });
});

test("FileToolRouter.execute handles dir.search", async () => {
  const searchRoot = await mkdtemp(join(tmpdir(), "tool-router-search-"));
  const router = new FileToolRouter(searchRoot);
  await mkdir(join(searchRoot, "sub"), { recursive: true });
  await writeFile(join(searchRoot, "sub", "test.txt"), "search keyword unique xyz");
  const result = await router.execute({
    toolCallId: "1",
    name: "dir.search",
    args: { pattern: "search keyword unique xyz", extensions: [] },
  });
  assert.strictEqual(result.kind, "success");
  assert.ok(result.matches && result.matches.length > 0);
  // Verify the match path ends with our test file
  assert.ok(result.matches![0].path.endsWith(join("sub", "test.txt")));
  await rm(searchRoot, { recursive: true, force: true });
});

test("FileToolRouter.execute handles file.create", async () => {
  const router = new FileToolRouter("/tmp");
  const result = await router.execute({
    toolCallId: "1",
    name: "file.create",
    args: { path: "new-file.txt", content: "new content" },
  });
  assert.strictEqual(result.kind, "success");
  assert.strictEqual(result.createdPath, "new-file.txt");
  // Verify file was created
  const readResult = await router.execute({
    toolCallId: "2",
    name: "file.read",
    args: { path: "new-file.txt" },
  });
  assert.strictEqual(readResult.kind, "success");
  assert.strictEqual(readResult.content, "new content");
  await rm("/tmp/new-file.txt", { force: true });
});

test("FileToolRouter.execute handles file.exists", async () => {
  const router = new FileToolRouter("/tmp");
  await writeFile("/tmp/exists-test.txt", "exists");
  const existsResult = await router.execute({
    toolCallId: "1",
    name: "file.exists",
    args: { path: "exists-test.txt" },
  });
  assert.strictEqual(existsResult.kind, "success");
  assert.strictEqual(existsResult.exists, true);

  const notExistsResult = await router.execute({
    toolCallId: "2",
    name: "file.exists",
    args: { path: "nonexistent-file.txt" },
  });
  assert.strictEqual(notExistsResult.kind, "success");
  assert.strictEqual(notExistsResult.exists, false);
  await rm("/tmp/exists-test.txt", { force: true });
});

test("ShellToolRouter.execute handles shell.run with echo", async () => {
  const router = new ShellToolRouter("/tmp");
  const result = await router.execute({
    toolCallId: "1",
    name: "shell.run",
    args: { command: "echo hello" },
  });
  assert.strictEqual(result.kind, "success");
  assert.ok(result.output?.includes("hello"));
});

test("ShellToolRouter.execute returns error for missing command", async () => {
  const router = new ShellToolRouter("/tmp");
  const result = await router.execute({
    toolCallId: "1",
    name: "shell.run",
    args: {},
  });
  assert.strictEqual(result.kind, "error");
  assert.strictEqual(result.message, "shell.run requires command");
});

test("FileToolRouter.execute blocks path traversal on file.create", async () => {
  const router = new FileToolRouter("/tmp");
  const result = await router.execute({
    toolCallId: "1",
    name: "file.create",
    args: { path: "../../etc/passwd", content: "malicious content" },
  });
  assert.strictEqual(result.kind, "error");
  assert.strictEqual(result.message, "Path is outside workspace");
  assert.strictEqual(result.retryable, false);
});

test("PatchToolRouter.execute returns error for missing format", async () => {
  const router = new PatchToolRouter("/tmp", { version: 1, model: { provider: "anthropic", name: "claude" }, permissions: { default: "ask", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] }, context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] }, runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] }, ui: { enabled: false, host: "localhost", port: 8080, transport: "sse" } });
  const result = await router.execute({
    toolCallId: "1",
    name: "patch.apply",
    args: { patchText: "some patch" },
  });
  assert.strictEqual(result.kind, "error");
  assert.ok(result.message.includes("patch.apply requires format and patchText"));
});

test("PatchToolRouter.execute returns error for missing patchText", async () => {
  const router = new PatchToolRouter("/tmp", { version: 1, model: { provider: "anthropic", name: "claude" }, permissions: { default: "ask", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] }, context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] }, runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] }, ui: { enabled: false, host: "localhost", port: 8080, transport: "sse" } });
  const result = await router.execute({
    toolCallId: "1",
    name: "patch.apply",
    args: { format: "search_replace" },
  });
  assert.strictEqual(result.kind, "error");
  assert.ok(result.message.includes("patch.apply requires format and patchText"));
});

test("PatchToolRouter.execute rejects disallowed format", async () => {
  const router = new PatchToolRouter(
    "/tmp",
    { version: 1, model: { provider: "anthropic", name: "claude" }, permissions: { default: "ask", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] }, context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] }, runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] }, ui: { enabled: false, host: "localhost", port: 8080, transport: "sse" } },
    { provider: "anthropic", preferred: "structured_patch", allowed: ["structured_patch"], fullFileRewrite: "deny" }
  );
  const result = await router.execute({
    toolCallId: "1",
    name: "patch.apply",
    args: { format: "search_replace", patchText: "some patch" },
  });
  assert.strictEqual(result.kind, "error");
  assert.ok(result.message.includes('Patch format "search_replace" is not allowed'));
  assert.strictEqual(result.retryable, false);
});

test("McpToolRouter.execute delegates to mcpManager.callTool", async () => {
  const mockMcpManager = {
    callTool: async (fullName: string, args: Record<string, unknown>): Promise<ToolResult> => {
      assert.strictEqual(fullName, "github/repos_list");
      assert.deepStrictEqual(args, { owner: "test", page: 1 });
      return { kind: "success", output: "mock response" };
    },
  };

  const router = new McpToolRouter(mockMcpManager as any);
  const result = await router.execute({
    toolCallId: "1",
    name: "mcp.github.repos.list",
    args: { owner: "test", page: 1 },
  });

  assert.strictEqual(result.kind, "success");
  assert.strictEqual(result.output, "mock response");
});

test("McpToolRouter.execute parses tool name correctly", async () => {
  let receivedFullName = "";
  const mockMcpManager = {
    callTool: async (fullName: string, _args: Record<string, unknown>): Promise<ToolResult> => {
      receivedFullName = fullName;
      return { kind: "success", output: "ok" };
    },
  };

  const router = new McpToolRouter(mockMcpManager as any);

  // mcp.github.repos.list -> github/repos_list
  await router.execute({
    toolCallId: "1",
    name: "mcp.github.repos.list",
    args: {},
  });

  assert.strictEqual(receivedFullName, "github/repos_list");
});

test("DelegateToolRouter.execute calls the delegate handler", async () => {
  const mockResult: ToolResult = { kind: "success", output: "delegated result" };
  const handlers = {
    delegate: async (_args: Record<string, unknown>): Promise<ToolResult> => {
      return mockResult;
    },
  };

  const router = new DelegateToolRouter(handlers);
  const result = await router.execute({
    toolCallId: "1",
    name: "delegate",
    args: { arg1: "value1" },
  });

  assert.strictEqual(result.kind, "success");
  assert.strictEqual(result.output, "delegated result");
});

test("DelegateToolRouter.execute passes args to handler", async () => {
  let receivedArgs: Record<string, unknown> = {};
  const handlers = {
    delegate: async (args: Record<string, unknown>): Promise<ToolResult> => {
      receivedArgs = args;
      return { kind: "success", output: "ok" };
    },
  };

  const router = new DelegateToolRouter(handlers);
  await router.execute({
    toolCallId: "1",
    name: "delegate",
    args: { custom: "args", number: 42 },
  });

  assert.deepStrictEqual(receivedArgs, { custom: "args", number: 42 });
});

test("DelegateToolRouter.execute returns error if handler not initialized", async () => {
  const router = new DelegateToolRouter();
  const result = await router.execute({
    toolCallId: "1",
    name: "delegate",
    args: {},
  });

  assert.strictEqual(result.kind, "error");
  assert.strictEqual(result.message, "Delegate handler not initialized");
  assert.strictEqual(result.retryable, false);
});

test("McpToolRouter.execute returns error for invalid tool name (too few parts)", async () => {
  const router = new McpToolRouter({ callTool: async () => ({ kind: "success", output: "" }) } as any);

  const result = await router.execute({
    toolCallId: "1",
    name: "mcp.github",
    args: {},
  });

  assert.strictEqual(result.kind, "error");
  assert.ok(result.message.includes("Invalid MCP tool name: mcp.github"));
  assert.strictEqual(result.retryable, false);
});

test("McpToolRouter.execute returns error for empty server name", async () => {
  const router = new McpToolRouter({ callTool: async () => ({ kind: "success", output: "" }) } as any);

  const result = await router.execute({
    toolCallId: "1",
    name: "mcp..tool",
    args: {},
  });

  assert.strictEqual(result.kind, "error");
  assert.ok(result.message.includes("Invalid MCP tool name"));
  assert.strictEqual(result.retryable, false);
});

test("McpToolRouter.execute returns error for empty tool name", async () => {
  const router = new McpToolRouter({ callTool: async () => ({ kind: "success", output: "" }) } as any);

  const result = await router.execute({
    toolCallId: "1",
    name: "mcp.github.",
    args: {},
  });

  assert.strictEqual(result.kind, "error");
  assert.ok(result.message.includes("Invalid MCP tool name"));
  assert.strictEqual(result.retryable, false);
});

test("McpToolRouter.execute handles callTool errors gracefully", async () => {
  const mockMcpManager = {
    callTool: async (): Promise<ToolResult> => {
      throw new Error("Connection failed");
    },
  };

  const router = new McpToolRouter(mockMcpManager as any);
  const result = await router.execute({
    toolCallId: "1",
    name: "mcp.github.repos.list",
    args: {},
  });

  assert.strictEqual(result.kind, "error");
  assert.strictEqual(result.message, "Connection failed");
});

test("DelegateToolRouter.execute handles handler errors gracefully", async () => {
  const handlers = {
    delegate: async (): Promise<ToolResult> => {
      throw new Error("Handler crashed");
    },
  };

  const router = new DelegateToolRouter(handlers);
  const result = await router.execute({
    toolCallId: "1",
    name: "delegate",
    args: {},
  });

  assert.strictEqual(result.kind, "error");
  assert.strictEqual(result.message, "Handler crashed");
});