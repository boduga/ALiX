import test from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "../src/tools/shell-tool.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("runCommand returns output and exit code 0", async () => {
  const result = await runCommand({ command: "echo hello", cwd: "/tmp", timeoutMs: 5000 });
  assert.equal(result.kind, "success");
  assert.ok(result.output?.includes("hello"));
  assert.ok(!result.output?.includes("--- stderr ---"));
  assert.equal(result.exitCode, 0);
});

test("runCommand captures non-zero exit code", async () => {
  const result = await runCommand({ command: "exit 1", cwd: "/tmp", timeoutMs: 5000 });
  assert.equal(result.kind, "error");
  assert.ok(result.message.includes("code 1"));
});

test("runCommand normalizes nullish, string, and zero timeouts", async () => {
  const nullTimeout = await runCommand({ command: "echo null-timeout", cwd: "/tmp", timeoutMs: null as any });
  const stringTimeout = await runCommand({ command: "echo string-timeout", cwd: "/tmp", timeoutMs: "5000" as any });
  const zeroTimeout = await runCommand({ command: "echo zero-timeout", cwd: "/tmp", timeoutMs: 0 });

  assert.equal(nullTimeout.kind, "success");
  assert.equal(stringTimeout.kind, "success");
  assert.equal(zeroTimeout.kind, "success");
});

test("runCommand normalizes string array commands", async () => {
  const result = await runCommand({ command: ["echo", "array-command"] as any, cwd: "/tmp", timeoutMs: 5000 });

  assert.equal(result.kind, "success");
  assert.ok(result.output?.includes("array-command"));
});

test("runCommand respects timeout", async () => {
  const result = await runCommand({ command: "sleep 10", cwd: "/tmp", timeoutMs: 500 });
  assert.equal(result.kind, "error");
  assert.ok(result.message?.includes("timed out") || result.message?.includes("SIGKILL"));
});

test("runCommand timeout kills detached descendants", async () => {
  if (process.platform === "win32") return;
  const dir = mkdtempSync(join(tmpdir(), "alix-shell-tree-"));
  const marker = join(dir, "orphaned");
  try {
    const result = await runCommand({
      command: `sh -c 'sleep 0.4; touch "${marker}"' & wait`, cwd: dir, timeoutMs: 50,
    });
    assert.equal(result.kind, "error");
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(existsSync(marker), false, "descendant survived the timeout");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runCommand exposes only allowlisted environment variables", async () => {
  process.env.ALIX_TEST_SECRET = "must-not-leak";
  try {
    const result = await runCommand({ command: "env", cwd: "/tmp", timeoutMs: 5000, envAllowlist: ["PATH"] });
    assert.equal(result.kind, "success");
    assert.doesNotMatch(result.output ?? "", /ALIX_TEST_SECRET/);
  } finally {
    delete process.env.ALIX_TEST_SECRET;
  }
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

test("runCommand truncates output at 80KB", async () => {
  const result = await runCommand({ command: "python3 -c \"import sys; sys.stdout.write('x' * 150000)\"", cwd: "/tmp", timeoutMs: 10000 });
  assert.equal(result.kind, "success");
  const output = result.output!;
  // The truncation notice is about 40 bytes, so the body should be under 80KB
  const bodyEnd = output.indexOf("[... ");
  const body = bodyEnd >= 0 ? output.slice(0, bodyEnd) : output;
  const bodyBytes = Buffer.byteLength(body, "utf8");
  assert.ok(bodyBytes <= 80_000, `Truncated body should be <= 80KB but was ${bodyBytes} bytes`);
  assert.ok(output.includes("[... "), "Output should contain truncation notice");
  assert.ok(output.includes(" lines truncated"), "Truncation notice should mention lines");
  assert.ok(output.includes(" bytes hidden"), "Truncation notice should mention bytes hidden");
});

test("runCommand includes stderr in output", async () => {
  const result = await runCommand({ command: "python3 -c \"import sys; sys.stdout.write('stdout here\\n'); sys.stderr.write('stderr here\\n')\"", cwd: "/tmp", timeoutMs: 10000 });
  assert.equal(result.kind, "success");
  const output = result.output!;
  assert.ok(output.includes("stdout here"), "Output should include stdout");
  assert.ok(output.includes("stderr here"), "Output should include stderr");
  assert.ok(output.includes("--- stderr ---"), "Output should have stderr divider");
});
