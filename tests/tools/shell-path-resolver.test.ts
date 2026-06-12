import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ShellToolRouter } from "../../src/tools/tool-router.js";
import { WorkspacePathResolver } from "../../src/runtime/workspace-path.js";

const ROOT = "/home/user/project";
const resolver = new WorkspacePathResolver(ROOT, [".git/**", ".env"]);

describe("ShellToolRouter path validation", () => {
  const router = new ShellToolRouter(ROOT, resolver);

  it("allows shell in normal workspace cwd", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "echo test", cwd: "src" },
    } as any);
    assert.notEqual(result.kind, "error", "normal paths must not be blocked");
  });

  it("blocks shell in .alix directory", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "ls", cwd: ".alix" },
    } as any);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive"), "must reject .alix as sensitive");
  });

  it("blocks shell in .ssh path via root arg", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "ls", root: "~/.ssh" },
    } as any);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive"), "must reject .ssh as sensitive");
  });

  it("blocks shell in .git via root arg", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "git status", root: ".git" },
    } as any);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive") || result.message.includes("protected"), "must reject .git");
  });

  it("works without resolver (backward compatible)", async () => {
    const basicRouter = new ShellToolRouter(ROOT);
    const result = await basicRouter.execute({
      name: "shell.run", args: { command: "echo test", cwd: ".alix" },
    } as any);
    assert.notEqual(result.kind, "error", "without resolver, .alix must not be blocked");
  });

  it("blocks command referencing .ssh path", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "cat ~/.ssh/id_rsa", cwd: "/tmp" },
    } as any);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive"), "must block commands referencing .ssh");
  });

  it("blocks command referencing .alix path in command", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "ls .alix/config.json", cwd: "/tmp" },
    } as any);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive"), "must block commands referencing .alix");
  });

});
