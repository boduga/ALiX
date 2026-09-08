import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileToolRouter } from "../../src/tools/tool-router.js";
import { WorkspacePathResolver } from "../../src/runtime/workspace-path.js";
import type { ToolCallRequest } from "../../src/tools/types.js";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

  it("constructs a safe default resolver when none is supplied", async () => {
    const basicRouter = new FileToolRouter(ROOT);
    const result = await basicRouter.execute(request("file.read", { path: ".alix/config.json" }));
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive"), "default resolver must block .alix");
  });

  it("rejects a model-controlled root outside the workspace", async () => {
    const result = await router.execute(request("file.read", { root: "/etc", path: "hostname" }));
    assert.equal(result.kind, "error");
    assert.match(result.message, /root override|outside workspace/);
  });

  it("rejects symlinks that resolve outside the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "alix-path-root-"));
    const outside = await mkdtemp(join(tmpdir(), "alix-path-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "secret");
      await symlink(outside, join(root, "escape"));
      const guarded = new FileToolRouter(root, undefined, undefined, new WorkspacePathResolver(root));
      const result = await guarded.execute(request("file.read", { path: "escape/secret.txt" }));
      assert.equal(result.kind, "error");
      assert.match(result.message, /outside workspace/);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
