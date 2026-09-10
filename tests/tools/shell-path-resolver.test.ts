import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ShellToolRouter } from "../../src/tools/tool-router.js";
import { validateShellNetworkCommand } from "../../src/tools/shell-network-policy.js";
import { WorkspacePathResolver } from "../../src/runtime/workspace-path.js";

const ROOT = process.cwd();
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
    assert.ok(result.message.includes("outside workspace") || result.message.includes("sensitive"), "must reject .ssh");
  });

  it("blocks shell in .git via root arg", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "git status", root: ".git" },
    } as any);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive") || result.message.includes("protected"), "must reject .git");
  });

  it("constructs a default resolver when one is not supplied", async () => {
    const basicRouter = new ShellToolRouter(ROOT);
    const result = await basicRouter.execute({
      name: "shell.run", args: { command: "echo test", cwd: ".alix" },
    } as any);
    assert.equal(result.kind, "error");
    assert.match(result.message, /sensitive/);
  });

  it("blocks command referencing .ssh path", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "cat ~/.ssh/id_rsa" },
    } as any);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive"), "must block commands referencing .ssh");
  });

  it("blocks command referencing .alix path in command", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "ls .alix/config.json" },
    } as any);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive"), "must block commands referencing .alix");
  });

  it("blocks relative traversal in a safe-shell file operand", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "cat ../package.json" },
    } as any);
    assert.equal(result.kind, "error");
    assert.match(result.message, /outside workspace/);
  });

  it("blocks an absolute path in a safe-shell file operand", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "cat /etc/passwd" },
    } as any);
    assert.equal(result.kind, "error");
    assert.match(result.message, /outside workspace/);
  });

  it("checks every safe-shell file operand", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: 'grep "name" package.json ../package.json' },
    } as any);
    assert.equal(result.kind, "error");
    assert.match(result.message, /outside workspace/);
  });

  it("blocks a safe-shell operand whose symlink resolves outside the workspace", async () => {
    const parent = await mkdtemp(join(tmpdir(), "alix-shell-path-"));
    const workspace = join(parent, "workspace");
    const outside = join(parent, "outside.txt");
    const { mkdir } = await import("node:fs/promises");
    try {
      await mkdir(workspace);
      await writeFile(outside, "outside");
      await symlink(outside, join(workspace, "escape.txt"));
      const result = await new ShellToolRouter(workspace).execute({
        name: "shell.run", args: { command: "cat escape.txt" },
      } as any);
      assert.equal(result.kind, "error");
      assert.match(result.message, /outside workspace/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("reports a failed safe-shell command as an error", async () => {
    const result = await new ShellToolRouter("/tmp").execute({
      name: "shell.run", args: { command: "cat alix-file-that-does-not-exist" },
    } as any);
    assert.equal(result.kind, "error");
    assert.match(result.message, /exited with code|No such file/);
  });

  it("blocks curl to loopback before launching the command", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "curl -s http://127.0.0.1:3000" },
    } as any);
    assert.equal(result.kind, "error");
    assert.match(result.message, /Private network destinations/);
  });

  it("blocks netcat to a private destination before launching the command", async () => {
    const result = await router.execute({
      name: "shell.run", args: { command: "nc -zv 127.0.0.1 3000" },
    } as any);
    assert.equal(result.kind, "error");
    assert.match(result.message, /Private network destinations/);
  });

  it("enforces the configured domain allowlist for shell URLs", async () => {
    const allowlisted = new ShellToolRouter(ROOT, resolver, undefined, ["example.org"], async () => ["93.184.216.34"]);
    const result = await allowlisted.execute({
      name: "shell.run", args: { command: "curl https://example.com" },
    } as any);
    assert.equal(result.kind, "error");
    assert.match(result.message, /Domain is not allowed/);
  });

  it("blocks a public hostname that resolves to a private address", async () => {
    const dnsGuarded = new ShellToolRouter(ROOT, resolver, undefined, [], async () => ["10.0.0.8"]);
    const result = await dnsGuarded.execute({
      name: "shell.run", args: { command: "curl https://internal.example" },
    } as any);
    assert.equal(result.kind, "error");
    assert.match(result.message, /Private network destinations/);
  });

  it("allows a public destination through network validation", async () => {
    await assert.doesNotReject(() =>
      validateShellNetworkCommand("curl https://example.com", ["example.com"], async () => ["93.184.216.34"])
    );
  });

});
