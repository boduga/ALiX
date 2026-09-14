/**
 * failures.test.ts — #710: `alix failures` dispatched-path coverage.
 *
 * Seeds a live FileFailureMemoryStore through its own append API, then
 * exercises the wired handler (COMMAND_ROUTER["failures"]) for list, show,
 * and recall in --json mode.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleFailuresCommand } from "../../../src/cli/commands/failures.js";
import {
  FileFailureMemoryStore,
  createFailureRecord,
} from "../../../src/governance/failure-memory.js";

async function seedAsync(cwd: string): Promise<void> {
  const store = new FileFailureMemoryStore(join(cwd, ".alix", "governance"));
  const now = new Date().toISOString();
  await store.append(createFailureRecord(
    { runId: "run-1", issueId: "issue-1", failureType: "policy_denied", detail: "denied by policy" },
    now,
  ));
  await store.append(createFailureRecord(
    { runId: "run-1", issueId: "issue-2", failureType: "test_failure", detail: "test exploded" },
    now,
  ));
}

async function captureJson(args: string[]): Promise<unknown> {
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => lines.push(a.map(String).join(" "));
  try {
    await handleFailuresCommand(args);
  } finally {
    console.log = origLog;
  }
  return JSON.parse(lines.join("\n"));
}

describe("alix failures (wired dispatcher)", () => {
  let dir: string;
  let origCwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "failures-cli-"));
    origCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("list returns seeded records newest-first as JSON", async () => {
    await seedAsync(dir);
    const records = await captureJson(["list", "--json"]) as Array<{ runId: string }>;
    assert.equal(records.length, 2);
    assert.ok(records.every((r) => r.runId === "run-1"));
  });

  it("show --run filters by run", async () => {
    await seedAsync(dir);
    const records = await captureJson(["show", "--run", "run-1", "--json"]) as unknown[];
    assert.equal(records.length, 2);
    const empty = await captureJson(["show", "--run", "nope", "--json"]) as unknown[];
    assert.equal(empty.length, 0);
  });

  it("recall --type filters by failure type", async () => {
    await seedAsync(dir);
    const records = await captureJson(["recall", "--type", "test_failure", "--json"]) as Array<{ failureType: string }>;
    assert.equal(records.length, 1);
    assert.equal(records[0]!.failureType, "test_failure");
  });

  it("list on an empty store returns []", async () => {
    const records = await captureJson(["list", "--json"]) as unknown[];
    assert.deepEqual(records, []);
  });
});
