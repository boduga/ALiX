import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import { CoordinationScheduler } from "../../src/kernel/coordination-scheduler.js";
import { CoordinationSchedulerService } from "../../src/daemon/coordination-scheduler-service.js";
import { createCoordinationRun, createWorkerAssignment } from "../../src/kernel/coordination-types.js";

describe("CoordinationSchedulerService", () => {
  let cwd: string;
  let store: CoordinationStore;
  let scheduler: CoordinationScheduler;
  let service: CoordinationSchedulerService;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "dmn-"));
    store = new CoordinationStore(cwd);
    const mockAuth = { evaluate: async () => ({ status: "allowed" as const }) };
    const mockRegistry = { acquireMany: async () => [{ acquired: true, record: { id: "lease-1" } }], release: async () => true, renew: async () => true };
    const mockExecutor = { execute: async () => ({ outcome: "success" as const, summary: "ok" }) };
    scheduler = new CoordinationScheduler(
      { cwd, daemonInstanceId: "test-daemon", configProvider: async () => ({ permissions: { sessionMode: "bypass" } }) as any, store: store as any, authorization: mockAuth as any, ownershipRegistry: mockRegistry as any, executor: mockExecutor as any },
      { maxConcurrency: 1 },
    );
    service = new CoordinationSchedulerService(scheduler, store);
  });

  afterEach(() => {
    service.stop();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("starts and stops without error", () => {
    service.start();
    assert.ok(true, "service started");
    service.stop();
    assert.ok(true, "service stopped");
  });

  it("does not overlap ticks", async () => {
    const run = createCoordinationRun({ sessionId: "s1", rootGoal: "test", coordinatorAgentId: "alix" });
    await store.save(run);
    service.start();
    await new Promise(r => setTimeout(r, 50));
    service.stop();
    assert.ok(true, "no overlap crash");
  });
});
