import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CollaborationStore } from "../../src/kernel/collaboration-store.js";
import { ConflictRepository } from "../../src/kernel/collaboration-conflict-repository.js";

const CLI = join(process.cwd(), "dist", "src", "cli.js");
const RUN_ID = "run_cli_1";

function seedState(cwd: string): void {
  mkdirSync(join(cwd, ".alix", "coordination", "shared", RUN_ID), { recursive: true });
  writeFileSync(
    join(cwd, ".alix", "coordination", "shared", RUN_ID, "state.json"),
    JSON.stringify({
      schemaVersion: "1.0", runId: RUN_ID, revision: 0,
      findings: [], artifacts: [], conflicts: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }),
    "utf-8",
  );
}

async function seedConflict(cwd: string): Promise<string> {
  const store = new CollaborationStore(cwd, RUN_ID);
  const repo = new ConflictRepository(store);
  const r = await repo.upsertConflict(RUN_ID, {
    conflictFingerprint: "fp_cli_1",
    topicKey: "topic_cli",
    type: "contradiction",
    findingIds: ["fA", "fB"],
    claimComparisons: [],
    evidenceComparison: {
      ranking: [], confidence: "low", scoreMargin: 0,
      recommendation: "human_review", unresolvedReasons: [],
    },
    detectedBy: ["deterministic"],
    criticality: "warning",
    blocksDownstreamByPolicy: false,
  });
  return r.conflict.id;
}

describe("alix coordination conflict subcommands", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "conflict-cli-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("coordination conflicts --json lists conflicts (C1)", async () => {
    seedState(dir);
    const conflictId = await seedConflict(dir);
    const out = execFileSync(process.execPath, [
      CLI, "coordination", "conflicts", RUN_ID, "--json",
    ], { cwd: dir, encoding: "utf-8" });
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.length >= 1);
    assert.ok(parsed.some((c: any) => c.id === conflictId));
  });

  it("coordination conflict <id> --json shows full detail (C2)", async () => {
    seedState(dir);
    const conflictId = await seedConflict(dir);
    const out = execFileSync(process.execPath, [
      CLI, "coordination", "conflict", RUN_ID, conflictId, "--json",
    ], { cwd: dir, encoding: "utf-8" });
    const parsed = JSON.parse(out);
    assert.equal(parsed.id, conflictId);
    assert.equal(parsed.runId, RUN_ID);
    assert.equal(parsed.topicKey, "topic_cli");
  });

  it("--actor and --reason flag wiring on conflict-resolve", async () => {
    seedState(dir);
    const conflictId = await seedConflict(dir);
    const out = execFileSync(process.execPath, [
      CLI, "coordination", "conflict-resolve",
      RUN_ID, conflictId,
      "--actor", "alice",
      "--reason", "manual override",
    ], { cwd: dir, encoding: "utf-8" });
    assert.ok(out.includes("Resolved"));
    // Verify the resolution was recorded.
    const verify = execFileSync(process.execPath, [
      CLI, "coordination", "conflict", RUN_ID, conflictId, "--json",
    ], { cwd: dir, encoding: "utf-8" });
    const parsed = JSON.parse(verify);
    assert.equal(parsed.status, "resolved");
    assert.equal(parsed.resolution.decision, "manual override");
    assert.equal(parsed.resolution.resolver.id, "alice");
  });

  it("conflict-accept-divergence works", async () => {
    seedState(dir);
    const conflictId = await seedConflict(dir);
    const out = execFileSync(process.execPath, [
      CLI, "coordination", "conflict-accept-divergence",
      RUN_ID, conflictId,
      "--actor", "bob",
      "--reason", "we agreed to differ",
    ], { cwd: dir, encoding: "utf-8" });
    assert.ok(out.includes("Accepted divergence"));
    const verify = execFileSync(process.execPath, [
      CLI, "coordination", "conflict", RUN_ID, conflictId, "--json",
    ], { cwd: dir, encoding: "utf-8" });
    const parsed = JSON.parse(verify);
    assert.equal(parsed.status, "accepted_divergence");
  });

  it("coordination inspect includes conflict count", async () => {
    // Create a minimal coordination run file so inspect can find it.
    seedState(dir);
    await seedConflict(dir);
    mkdirSync(join(dir, ".alix", "coordination"), { recursive: true });
    const run = {
      id: RUN_ID,
      sessionId: "s1",
      rootGoal: "test",
      status: "running",
      coordinatorAgentId: "alix",
      workers: [],
      schemaVersion: "1.0",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(join(dir, ".alix", "coordination", `${RUN_ID}.json`), JSON.stringify(run, null, 2), "utf-8");
    const out = execFileSync(process.execPath, [
      CLI, "coordination", "inspect", RUN_ID,
    ], { cwd: dir, encoding: "utf-8" });
    assert.ok(out.includes("Unresolved conflicts:"));
    assert.ok(out.includes("contradiction"));
  });
});
