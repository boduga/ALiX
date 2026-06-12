import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileToolRouter } from "../../src/tools/tool-router.js";
import { WorkspacePathResolver } from "../../src/runtime/workspace-path.js";
import type { ToolCallRequest } from "../../src/tools/types.js";

const ROOT = "/home/user/project";
const resolver = new WorkspacePathResolver(ROOT, [".git/**", ".env"]);

function request(name: string, args: Record<string, unknown>): ToolCallRequest {
  return { toolCallId: "test-1", name, args };
}

describe("FileToolRouter path validation", () => {
  const router = new FileToolRouter(ROOT, undefined, undefined, resolver);

  it("allows reading a normal workspace file", async () => {
    const result = await router.execute(request("file.read", { path: "src/index.ts" }));
    assert.equal(result.kind, "error");
    assert.ok(!result.message.includes("Access denied"), "normal files must not be blocked");
  });

  it("blocks reading .alix/config.json", async () => {
    const result = await router.execute(request("file.read", { path: ".alix/config.json" }));
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive"), "must reject .alix as sensitive");
  });

  it("blocks reading .git/config", async () => {
    const result = await router.execute(request("file.read", { path: ".git/config" }));
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive") || result.message.includes("protected"), "must reject .git");
  });

  it("blocks writing to .env", async () => {
    const result = await router.execute(request("file.create", { path: ".env", content: "SECRET=leak" }));
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("protected"), "must reject .env as protected");
  });

  it("blocks deleting .git/HEAD", async () => {
    const result = await router.execute(request("file.delete", { path: ".git/HEAD" }));
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive") || result.message.includes("protected"), "must reject .git");
  });

  it("works without resolver (backward compatible)", async () => {
    const basicRouter = new FileToolRouter(ROOT);
    const result = await basicRouter.execute(request("file.read", { path: ".alix/config.json" }));
    assert.equal(result.kind, "error");
    assert.ok(!result.message.includes("sensitive"), "without resolver, must NOT block .alix");
  });
});
