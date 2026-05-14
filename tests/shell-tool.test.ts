import test from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "../src/tools/shell-tool.js";

test("runCommand returns output and exit code 0", async () => {
  const result = await runCommand({ command: "echo hello", cwd: "/tmp", timeoutMs: 5000 });
  assert.equal(result.kind, "success");
  assert.ok(result.output?.includes("hello"));
  assert.equal(result.exitCode, 0);
});

test("runCommand captures non-zero exit code", async () => {
  const result = await runCommand({ command: "exit 1", cwd: "/tmp", timeoutMs: 5000 });
  assert.equal(result.kind, "success");
  assert.equal(result.exitCode, 1);
});

test("runCommand respects timeout", async () => {
  const result = await runCommand({ command: "sleep 10", cwd: "/tmp", timeoutMs: 500 });
  assert.equal(result.kind, "error");
  assert.ok(result.message?.includes("timed out") || result.message?.includes("SIGKILL"));
});

test("runCommand rejects empty command string", async () => {
  const result = await runCommand({ command: "", cwd: "/tmp", timeoutMs: 5000 });
  assert.equal(result.kind, "error");
  assert.ok(result.message?.includes("non-empty"));
});

test("runCommand rejects whitespace-only command", async () => {
  const result = await runCommand({ command: "   ", cwd: "/tmp", timeoutMs: 5000 });
  assert.equal(result.kind, "error");
  assert.ok(result.message?.includes("non-empty"));
});

test("runCommand rejects null-like command", async () => {
  const result = await runCommand({ command: "  ", cwd: "/tmp", timeoutMs: 5000 });
  assert.equal(result.kind, "error");
});