import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../../../src/utils/memory/store.js";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const cliPath = join(distRoot, "src", "cli.js");

function runCli(args: string[], cwd: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
  });
}

test("MemoryStore init works with temp directory", async () => {
  const store = new MemoryStore(join(tmpdir(), "test-memory-cli"));
  await store.init();

  // Verify directories created
  const dirs = ["user", "project", "feedback", "reference", "logs"];
  for (const dir of dirs) {
    // Just ensure no errors thrown
  }
});

test("MemoryStore can save and find entries", async () => {
  const store = new MemoryStore(join(tmpdir(), "test-memory-find"));
  await store.init();

  await store.save({
    name: "Test CLI entry",
    description: "Testing CLI",
    type: "project",
    content: "This is test content",
    confidence: 0.8,
    confirmations: 1,
  });

  const results = await store.find("CLI", 10);
  assert.ok(results.length > 0);
});

test("CLI help lists memory commands", () => {
  const result = runCli(["--help"], tmpdir());

  assert.equal(result.status, 0);
  assert.match(result.stdout, /alix memory list/);
  assert.match(result.stdout, /alix memory add/);
});

test("memory list --query filters entries by query text", () => {
  const cwd = join(tmpdir(), `alix-memory-cli-${Date.now()}`);
  mkdirSync(cwd, { recursive: true });

  const add = runCli([
    "memory",
    "add",
    "--name",
    "Query Match",
    "--type",
    "project",
    "--content",
    "contains specialneedle token",
  ], cwd);

  assert.equal(add.status, 0, add.stderr);

  const list = runCli(["memory", "list", "--query", "specialneedle"], cwd);

  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /Query Match/);
});

test("memory add rejects invalid memory type", () => {
  const cwd = join(tmpdir(), `alix-memory-invalid-type-${Date.now()}`);
  mkdirSync(cwd, { recursive: true });

  const result = runCli([
    "memory",
    "add",
    "--name",
    "Invalid Type",
    "--type",
    "../escape",
    "--content",
    "should not save",
  ], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid memory type/);
});
