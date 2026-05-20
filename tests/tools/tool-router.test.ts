import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  FileToolRouter,
  ShellToolRouter,
  PatchToolRouter,
  McpToolRouter,
  DelegateToolRouter,
  CompositeToolRouter,
} from "../../src/tools/tool-router.js";

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
  const router = new PatchToolRouter();
  assert.strictEqual(router.canHandle("patch.apply"), true);
});

test("PatchToolRouter.canHandle returns false for others", () => {
  const router = new PatchToolRouter();
  assert.strictEqual(router.canHandle("file.read"), false);
  assert.strictEqual(router.canHandle("shell.run"), false);
  assert.strictEqual(router.canHandle("mcp.some"), false);
  assert.strictEqual(router.canHandle("delegate"), false);
});

test("McpToolRouter.canHandle returns true for mcp.* tools", () => {
  const router = new McpToolRouter();
  assert.strictEqual(router.canHandle("mcp.some"), true);
  assert.strictEqual(router.canHandle("mcp.github-mcp__list_issues"), true);
  assert.strictEqual(router.canHandle("mcp.filesystem.read"), true);
});

test("McpToolRouter.canHandle returns false for non-mcp tools", () => {
  const router = new McpToolRouter();
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
  const router = new FileToolRouter("/tmp");
  await mkdir("/tmp/test-search-dir", { recursive: true });
  await writeFile("/tmp/test-search-dir/test.txt", "search keyword unique xyz");
  const result = await router.execute({
    toolCallId: "1",
    name: "dir.search",
    args: { pattern: "search keyword unique xyz", extensions: [] },
  });
  assert.strictEqual(result.kind, "success");
  assert.ok(result.matches && result.matches.length > 0);
  // Verify the match path ends with our test file
  assert.ok(result.matches![0].path.endsWith("test-search-dir/test.txt"));
  await rm("/tmp/test-search-dir", { recursive: true, force: true });
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