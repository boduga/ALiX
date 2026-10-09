/**
 * coordination-ownership.test.ts — Unit tests for ownership adapter.
 *
 * Tests acquire, release, renew, conflict detection, and invalid claims.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireWorkerOwnership,
  releaseWorkerLeases,
  releaseWorkerOwnership,
  renewWorkerOwnership,
} from "../../src/coordination/kernel/coordination-ownership.js";
import { OwnershipRegistry } from "../../src/coordination/ownership/ownership-registry.js";
import {
  createCoordinationRun,
  createWorkerAssignment,
} from "../../src/coordination/kernel/coordination-types.js";

describe("acquireWorkerOwnership", () => {
  let cwd: string;
  let registry: OwnershipRegistry;
  let run: ReturnType<typeof createCoordinationRun>;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "own-"));
    registry = new OwnershipRegistry(cwd, { sessionId: "s1" });
    run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("empty claims are no-op acquired", async () => {
    const worker = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "T",
      goalPrompt: "do it",
    });
    const result = await acquireWorkerOwnership(registry, run, worker, cwd, 60000);
    assert.equal(result.acquired, true);
    assert.deepEqual(result.leaseIds, []);
  });

  it("acquires for a single claim", async () => {
    const worker = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "T",
      goalPrompt: "do it",
      ownershipClaims: [
        { path: "src", recursive: true, sourcePattern: "src/**" },
      ],
    });
    const result = await acquireWorkerOwnership(registry, run, worker, cwd, 60000);
    assert.equal(result.acquired, true);
    assert.equal(result.leaseIds.length, 1);
  });

  it("conflict returns failure with conflict IDs", async () => {
    const worker1 = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "T1",
      goalPrompt: "do it",
      ownershipClaims: [
        { path: "src", recursive: true, sourcePattern: "src/**" },
      ],
    });
    const worker2 = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w2",
      taskLabel: "T2",
      goalPrompt: "do it",
      ownershipClaims: [
        { path: "src", recursive: true, sourcePattern: "src/**" },
      ],
    });

    // Acquire for worker1
    const r1 = await acquireWorkerOwnership(registry, run, worker1, cwd, 60000);
    assert.equal(r1.acquired, true);

    // Acquire for worker2 should conflict
    const r2 = await acquireWorkerOwnership(registry, run, worker2, cwd, 60000);
    assert.equal(r2.acquired, false);
    assert.ok(r2.reason.length > 0);
  });

  it("invalid claim fails closed", async () => {
    const worker = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "T",
      goalPrompt: "do it",
      ownershipClaims: [{ path: "../outside", recursive: false }],
    });
    const result = await acquireWorkerOwnership(registry, run, worker, cwd, 60000);
    assert.equal(result.acquired, false);
  });
});

describe("releaseWorkerOwnership", () => {
  let cwd: string;
  let registry: OwnershipRegistry;
  let run: ReturnType<typeof createCoordinationRun>;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "rel-"));
    registry = new OwnershipRegistry(cwd, { sessionId: "s1" });
    run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("releases acquired leases", async () => {
    const worker = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "T",
      goalPrompt: "do it",
      ownershipClaims: [
        { path: "src", recursive: true, sourcePattern: "src/**" },
      ],
    });
    const acquired = await acquireWorkerOwnership(registry, run, worker, cwd, 60000);
    assert.equal(acquired.acquired, true);

    const released = await releaseWorkerOwnership(registry, acquired.leaseIds);
    assert.equal(released.released.length, 1);
  });

  it("empty lease list returns empty", async () => {
    const result = await releaseWorkerOwnership(registry, []);
    assert.deepEqual(result, { released: [], failed: [] });
  });
});

describe("renewWorkerOwnership", () => {
  let cwd: string;
  let registry: OwnershipRegistry;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "rnw-"));
    registry = new OwnershipRegistry(cwd, { sessionId: "s1" });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("renews acquired leases", async () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "test",
      coordinatorAgentId: "alix",
    });
    const worker = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "T",
      goalPrompt: "do it",
      ownershipClaims: [
        { path: "src", recursive: true, sourcePattern: "src/**" },
      ],
    });
    const acquired = await acquireWorkerOwnership(registry, run, worker, cwd, 60000);
    assert.equal(acquired.acquired, true);

    const renewed = await renewWorkerOwnership(registry, acquired.leaseIds, 120000);
    assert.equal(renewed.renewed.length, 1);
  });
});

describe("releaseWorkerLeases (R3.4 lease-retention regression)", () => {
  it("retains failed lease ids instead of blanket-clearing the record", async () => {
    // A registry where "lease_b" cannot be released (already gone / error):
    // the failed id MUST stay on the record for a later retry, not be dropped.
    const registry = {
      release: async (id: string) => id !== "lease_b",
    } as unknown as OwnershipRegistry;
    const worker: { leaseIds?: string[] } = { leaseIds: ["lease_a", "lease_b"] };

    const result = await releaseWorkerLeases(registry, worker);

    assert.deepEqual(result.released, ["lease_a"]);
    assert.deepEqual(result.failed, ["lease_b"]);
    assert.deepEqual(worker.leaseIds, ["lease_b"]);
  });

  it("clears leaseIds only when every lease released", async () => {
    const registry = {
      release: async () => true,
    } as unknown as OwnershipRegistry;
    const worker: { leaseIds?: string[] } = { leaseIds: ["lease_a", "lease_b"] };

    const result = await releaseWorkerLeases(registry, worker);

    assert.deepEqual(result.released, ["lease_a", "lease_b"]);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(worker.leaseIds, []);
  });

  it("empty leaseIds is a no-op", async () => {
    const registry = {
      release: async () => true,
    } as unknown as OwnershipRegistry;
    const worker: { leaseIds?: string[] } = {};
    const result = await releaseWorkerLeases(registry, worker);
    assert.deepEqual(result, { released: [], failed: [] });
    assert.equal(worker.leaseIds, undefined);
  });
});

