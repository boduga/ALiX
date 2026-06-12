import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ToolAwareRouter, FileToolRouter, CompositeToolRouter } from "../../src/tools/tool-router.js";

describe("ToolAwareRouter", () => {
  const downstream = new CompositeToolRouter([
    new FileToolRouter("/tmp"),
  ]);

  it("allows all tools when no intent is set", () => {
    const router = new ToolAwareRouter(downstream);
    assert.ok(router.canHandle("file.read"));
    assert.ok(router.canHandle("shell.run"));
    assert.ok(router.canHandle("file.create"));
  });

  it("filters tools to only those matching read intent", () => {
    const router = new ToolAwareRouter(downstream);
    // "read" tag matches file.read (has "read" tag) but not file.create ("write" tag)
    router.setIntent(["read"]);
    assert.ok(router.canHandle("file.read"), "file.read matches read intent");
    assert.ok(!router.canHandle("file.create"), "file.create does not match read intent");
    assert.ok(!router.canHandle("shell.run"), "shell.run does not match read intent");
  });

  it("always includes essential tools regardless of intent", () => {
    const router = new ToolAwareRouter(downstream);
    router.setIntent(["shell", "command"]);
    assert.ok(router.canHandle("file.read"), "file.read is essential");
    assert.ok(router.canHandle("shell.run"), "shell.run matches shell intent");
  });

  it("clears intent and allows all tools after clearIntent()", () => {
    const router = new ToolAwareRouter(downstream);
    router.setIntent(["read"]);
    assert.ok(!router.canHandle("file.delete"), "filtered out when read intent");

    router.clearIntent();
    assert.ok(router.canHandle("file.delete"), "allowed after clear");
    assert.ok(router.canHandle("shell.run"), "allowed after clear");
  });

  it("delegates execute to downstream router when no intent set", async () => {
    const router = new ToolAwareRouter(downstream);
    const result = await router.execute({ toolCallId: "test-1", name: "file.read", args: { path: "nonexistent.ts" } });
    assert.ok(result, "delegates execution to downstream when no intent");
  });

  it("blocks execution of tool not matching current intent", async () => {
    const router = new ToolAwareRouter(downstream);
    router.setIntent(["read"]);
    const result = await router.execute({ toolCallId: "test-2", name: "file.create", args: { path: "test.txt", content: "x" } });
    assert.equal(result.kind, "error");
    assert.ok((result as any).message?.includes("not available"), "must reject tool not matching intent");
  });

  it("includes file.create for write/create intent", () => {
    const router = new ToolAwareRouter(downstream);
    router.setIntent(["write", "create"]);
    assert.ok(router.canHandle("file.create"), "file.create matches write intent");
    assert.ok(!router.canHandle("file.delete"), "file.delete does not match");
  });

  it("does not filter essential file.read for any intent", () => {
    const router = new ToolAwareRouter(downstream);
    // dir.search, file.read, done are essential — always included
    router.setIntent(["delete"]);
    assert.ok(router.canHandle("file.read"), "file.read is essential — always included");
    assert.ok(router.canHandle("dir.search"), "dir.search is essential — always included");
  });
});
