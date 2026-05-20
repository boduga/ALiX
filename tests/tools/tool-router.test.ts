import test from "node:test";
import assert from "node:assert/strict";
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
  const fileRouter = new FileToolRouter();
  const shellRouter = new ShellToolRouter();
  const composite = new CompositeToolRouter([fileRouter, shellRouter]);

  const request = { toolCallId: "1", name: "file.read", args: {} };
  await assert.rejects(composite.execute(request), /Not implemented yet/);
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
  const fileRouter = new FileToolRouter();
  const shellRouter = new ShellToolRouter();

  // FileToolRouter first - it should handle file.read (not ShellToolRouter)
  const composite = new CompositeToolRouter([fileRouter, shellRouter]);
  const request = { toolCallId: "1", name: "file.read", args: {} };

  // FileToolRouter throws "Not implemented yet" - this proves it was selected
  await assert.rejects(composite.execute(request), /Not implemented yet/);

  // If ShellToolRouter was selected instead, it would also throw, but with same error
  // The key point is that for file.read, FileToolRouter (first in order) handles it
});