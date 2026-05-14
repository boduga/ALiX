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