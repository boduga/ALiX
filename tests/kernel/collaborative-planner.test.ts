import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCapability,
  matchCapabilities,
} from "../../src/kernel/collaborative-planner.js";

// ─── normalizeCapability ──────────────────────────────────────────────

describe("normalizeCapability", () => {
  it("passes canonical IDs through unchanged", () => {
    assert.equal(normalizeCapability("filesystem.read"), "filesystem.read");
    assert.equal(normalizeCapability("filesystem.write"), "filesystem.write");
  });

  it("maps alias 'read' to 'filesystem.read'", () => {
    assert.equal(normalizeCapability("read"), "filesystem.read");
  });

  it("maps alias 'write' to 'filesystem.write'", () => {
    assert.equal(normalizeCapability("write"), "filesystem.write");
  });

  it("maps alias 'filesystem_read' to 'filesystem.read'", () => {
    assert.equal(normalizeCapability("filesystem_read"), "filesystem.read");
  });

  it("maps alias 'filesystem_write' to 'filesystem.write'", () => {
    assert.equal(normalizeCapability("filesystem_write"), "filesystem.write");
  });

  it("lowercases input before lookup", () => {
    assert.equal(normalizeCapability("Read"), "filesystem.read");
    assert.equal(normalizeCapability("FILESYSTEM_READ"), "filesystem.read");
    assert.equal(normalizeCapability("FILESYSTEM.READ"), "filesystem.read");
  });

  it("trims whitespace before lookup", () => {
    assert.equal(normalizeCapability("  read  "), "filesystem.read");
    assert.equal(normalizeCapability("\twrite\n"), "filesystem.write");
  });

  it("strips invalid characters", () => {
    assert.equal(normalizeCapability("file_system!read@"), "file_systemread");
    // The stripped form doesn't match any alias, so it's returned as-is.
  });

  it("returns normalized string as-is when not in alias registry", () => {
    assert.equal(normalizeCapability("custom.capability"), "custom.capability");
    assert.equal(normalizeCapability("file.create"), "file.create");
    assert.equal(normalizeCapability("unknown"), "unknown");
  });

  it("handles empty string", () => {
    assert.equal(normalizeCapability(""), "");
  });
});

// ─── matchCapabilities ────────────────────────────────────────────────

describe("matchCapabilities", () => {
  it("exact match returns score 1 with no unmatched", () => {
    const result = matchCapabilities(["filesystem.read"], ["filesystem.read"]);
    assert.deepEqual(result, { matched: ["filesystem.read"], unmatched: [], score: 1 });
  });

  it("canonical alias match resolves through registry", () => {
    const result = matchCapabilities(["read"], ["filesystem.read"]);
    assert.deepEqual(result, { matched: ["read"], unmatched: [], score: 1 });
  });

  it("multiple aliases all resolve to canonical", () => {
    const result = matchCapabilities(["read", "write"], ["filesystem.read", "filesystem.write"]);
    assert.deepEqual(result, { matched: ["read", "write"], unmatched: [], score: 1 });
  });

  it("no match returns score 0 with all unmatched", () => {
    const result = matchCapabilities(["filesystem.read"], ["network.http"]);
    assert.deepEqual(result, { matched: [], unmatched: ["filesystem.read"], score: 0 });
  });

  it("partial match returns correct ratio", () => {
    const result = matchCapabilities(
      ["filesystem.read", "network.http"],
      ["filesystem.read"],
    );
    assert.deepEqual(result, {
      matched: ["filesystem.read"],
      unmatched: ["network.http"],
      score: 0.5,
    });
  });

  it("2 of 3 match returns score 2/3", () => {
    const result = matchCapabilities(
      ["filesystem.read", "filesystem.write", "network.http"],
      ["filesystem.read", "filesystem.write"],
    );
    assert.deepEqual(result, {
      matched: ["filesystem.read", "filesystem.write"],
      unmatched: ["network.http"],
      score: 2 / 3,
    });
  });

  it("empty required returns score 0", () => {
    const result = matchCapabilities([], ["filesystem.read"]);
    assert.deepEqual(result, { matched: [], unmatched: [], score: 0 });
  });

  it("empty agent capabilities returns score 0", () => {
    const result = matchCapabilities(["filesystem.read"], []);
    assert.deepEqual(result, { matched: [], unmatched: ["filesystem.read"], score: 0 });
  });

  it("both empty returns score 0", () => {
    const result = matchCapabilities([], []);
    assert.deepEqual(result, { matched: [], unmatched: [], score: 0 });
  });

  describe("substring is NOT a match (exact canonical equality only)", () => {
    it("'filesystem' does not match 'filesystem.read'", () => {
      const result = matchCapabilities(["filesystem"], ["filesystem.read"]);
      assert.deepEqual(result, { matched: [], unmatched: ["filesystem"], score: 0 });
    });

    it("'filesystem.' does not match 'filesystem.read'", () => {
      const result = matchCapabilities(["filesystem."], ["filesystem.read"]);
      assert.deepEqual(result, { matched: [], unmatched: ["filesystem."], score: 0 });
    });

    it("'read' without alias does not match 'filesystem.read'", () => {
      // 'read' maps to 'filesystem.read' via alias, so this WOULD match.
      // This test confirms that a non-aliased substring prefix does NOT match.
      const result = matchCapabilities(["filesystem.rea"], ["filesystem.read"]);
      assert.deepEqual(result, { matched: [], unmatched: ["filesystem.rea"], score: 0 });
    });
  });

  describe("case insensitivity", () => {
    it("uppercase required matches lowercase agent capability", () => {
      const result = matchCapabilities(["READ"], ["filesystem.read"]);
      assert.deepEqual(result, { matched: ["READ"], unmatched: [], score: 1 });
    });

    it("mixed case required matches agent capability", () => {
      const result = matchCapabilities(["FileSystem.Read"], ["filesystem.read"]);
      assert.deepEqual(result, { matched: ["FileSystem.Read"], unmatched: [], score: 1 });
    });

    it("uppercase agent capability matches lowercase required", () => {
      const result = matchCapabilities(["filesystem.read"], ["FILESYSTEM.READ"]);
      assert.deepEqual(result, { matched: ["filesystem.read"], unmatched: [], score: 1 });
    });
  });

  it("duplicates in required are preserved in matched/unmatched", () => {
    const result = matchCapabilities(
      ["filesystem.read", "filesystem.read"],
      ["filesystem.read"],
    );
    assert.deepEqual(result, {
      matched: ["filesystem.read", "filesystem.read"],
      unmatched: [],
      score: 1,
    });
  });

  it("duplicates in agent capabilities are deduped (Set behavior)", () => {
    const result = matchCapabilities(
      ["filesystem.read"],
      ["filesystem.read", "filesystem.read"],
    );
    assert.deepEqual(result, { matched: ["filesystem.read"], unmatched: [], score: 1 });
  });
});

// ─── CollaborativePlanner ───────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CollaborativePlanner } from "../../src/kernel/collaborative-planner.js";
import { CoordinationStore } from "../../src/kernel/coordination-store.js";
import type { CoordinationPlanner, CoordinationPlanResult } from "../../src/kernel/coordination-planner.js";
import type { CoordinationRun, PlanningRound, WorkerAssignment } from "../../src/kernel/coordination-types.js";
import type { CollaborativePlannerOptions, CollaborativePlanResult } from "../../src/kernel/collaborative-planner.js";

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Create a minimal WorkerAssignment for testing.
 */
function makeWorker(id: string, overrides: Partial<WorkerAssignment> = {}): WorkerAssignment {
  const now = new Date().toISOString();
  return {
    id,
    coordinationRunId: "test_run",
    agentId: "coordinator",
    taskLabel: `Task ${id}`,
    goalPrompt: `Goal for ${id}`,
    dependencies: [],
    ownershipScopes: [],
    status: "pending",
    requiredCapabilities: [],
    attempt: 0,
    maxAttempts: 3,
    ownershipClaims: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock CoordinationPlanner that returns a given result.
 */
function mockPlanner(result: CoordinationPlanResult): CoordinationPlanner {
  return {
    plan: async () => result,
  } as unknown as CoordinationPlanner;
}

/**
 * Create a valid CoordinationPlanResult with the given workers.
 */
function validPlanResult(workers: WorkerAssignment[]): CoordinationPlanResult {
  const now = new Date().toISOString();
  const run: CoordinationRun = {
    id: `coord_${randomUUID()}`,
    sessionId: "test_session",
    rootGoal: "test goal",
    status: "planning",
    coordinatorAgentId: "coordinator",
    workers,
    planRevision: 0,
    schemaVersion: "1.0",
    createdAt: now,
    updatedAt: now,
  };
  return { run, graph: null, valid: true, errors: [] };
}

/**
 * Create an invalid CoordinationPlanResult.
 */
function invalidPlanResult(errors: string[] = ["base planner failed"]): CoordinationPlanResult {
  return { run: null, graph: null, valid: false, errors };
}

/**
 * Helper: create a CollaborativePlanner instance with a temp store directory.
 */
function createPlanner(
  basePlanner: CoordinationPlanner,
  options: Partial<CollaborativePlannerOptions> = {},
): { planner: CollaborativePlanner; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "collaborative-planner-test-"));
  const store = new CoordinationStore(dir);
  const planner = new CollaborativePlanner(basePlanner, store, {
    agentPool: [],
    ...options,
  });
  return {
    planner,
    cleanup: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

// ─── CollaborativePlanner.plan() ────────────────────────────────────────

describe("CollaborativePlanner.plan()", () => {
  describe("happy path", () => {
    it("returns a valid collaborative plan with proposals from workers", async () => {
      const workers = [
        makeWorker("w1", {
          taskLabel: "Write tests",
          goalPrompt: "Write tests for module X",
          requiredCapabilities: ["filesystem.read", "filesystem.write"],
        }),
        makeWorker("w2", {
          taskLabel: "Run tests",
          goalPrompt: "Run the test suite",
          requiredCapabilities: ["filesystem.read"],
        }),
      ];
      const { planner, cleanup } = createPlanner(mockPlanner(validPlanResult(workers)));
      try {
        const result = await planner.plan("test goal", "coordinator", "test_session");
        assert.ok(result.valid);
        assert.ok(result.run);
        assert.equal(result.errors.length, 0);

        // Planning rounds populated
        assert.ok(result.planningRounds);
        assert.equal(result.planningRounds.length, 1);

        const round = result.planningRounds[0];
        assert.equal(round.status, "draft");
        assert.equal(round.proposals.length, 2);

        // Proposals mirror workers
        assert.equal(round.proposals[0].taskLabel, "Write tests");
        assert.equal(round.proposals[1].taskLabel, "Run tests");

        // planningRounds attached to run
        assert.ok(result.run!.planningRounds);
        assert.equal(result.run!.planningRounds!.length, 1);

        // planRevision set
        assert.equal(result.run!.planRevision, 0);
      } finally {
        cleanup();
      }
    });
  });

  describe("bidding round", () => {
    it("creates proposals from draft workers", async () => {
      const workers = [
        makeWorker("w1", { taskLabel: "Task A", requiredCapabilities: ["filesystem.read"] }),
        makeWorker("w2", { taskLabel: "Task B", requiredCapabilities: ["filesystem.write"] }),
      ];
      const { planner, cleanup } = createPlanner(mockPlanner(validPlanResult(workers)), {
        agentPool: ["agent-1", "agent-2"],
        enableBidding: true,
      });
      try {
        const result = await planner.plan("test", "coordinator", "test_session");
        assert.ok(result.valid);
        assert.ok(result.planningRounds[0]);
        assert.equal(result.planningRounds[0].proposals.length, 2);

        // Each proposal has an id matching the pattern
        for (const proposal of result.planningRounds[0].proposals) {
          assert.ok(proposal.id.startsWith("proposal_"));
        }
      } finally {
        cleanup();
      }
    });

    it("generates bids for each proposal/agent combination", async () => {
      const workers = [
        makeWorker("w1", { requiredCapabilities: ["filesystem.read"] }),
        makeWorker("w2", { requiredCapabilities: ["filesystem.write"] }),
      ];
      const { planner, cleanup } = createPlanner(mockPlanner(validPlanResult(workers)), {
        agentPool: ["agent-fs", "agent-net"],
        agentCapabilities: {
          "agent-fs": ["filesystem.read", "filesystem.write"],
          "agent-net": ["network.http"],
        },
        enableBidding: true,
      });
      try {
        const result = await planner.plan("test", "coordinator", "test_session");
        const round = result.planningRounds[0];
        // 2 proposals * 2 agents = 4 bids
        assert.equal(round.bids.length, 4);

        // Check bid structure
        for (const bid of round.bids) {
          assert.ok(bid.id.startsWith("bid_"));
          assert.ok(bid.proposalId);
          assert.ok(bid.agentId);
          assert.equal(typeof bid.confidence, "number");
          assert.ok(Array.isArray(bid.matchedCapabilities));
          assert.ok(Array.isArray(bid.unmatchedCapabilities));
          assert.ok(bid.createdAt);
        }
      } finally {
        cleanup();
      }
    });
  });

  describe("best-matching agent selection", () => {
    it("assigns the best-matching agent to each proposal based on capability score", async () => {
      const workers = [
        makeWorker("w1", {
          taskLabel: "FS task",
          requiredCapabilities: ["filesystem.read", "filesystem.write"],
        }),
        makeWorker("w2", {
          taskLabel: "Net task",
          requiredCapabilities: ["network.http"],
        }),
      ];
      const { planner, cleanup } = createPlanner(mockPlanner(validPlanResult(workers)), {
        agentPool: ["agent-fs", "agent-net"],
        agentCapabilities: {
          "agent-fs": ["filesystem.read", "filesystem.write"],
          "agent-net": ["network.http"],
        },
        enableBidding: true,
      });
      try {
        const result = await planner.plan("test", "coordinator", "test_session");
        assert.ok(result.run);
        const fsWorker = result.run.workers.find((w) => w.taskLabel === "FS task")!;
        const netWorker = result.run.workers.find((w) => w.taskLabel === "Net task")!;

        // FS task should be assigned to agent-fs (score 1)
        assert.equal(fsWorker.agentId, "agent-fs");
        // Net task should be assigned to agent-net (score 1)
        assert.equal(netWorker.agentId, "agent-net");
      } finally {
        cleanup();
      }
    });
  });

  describe("round-robin fallback", () => {
    it("assigns agents round-robin when bidding is disabled", async () => {
      const workers = [
        makeWorker("w1", { taskLabel: "Task A" }),
        makeWorker("w2", { taskLabel: "Task B" }),
        makeWorker("w3", { taskLabel: "Task C" }),
      ];
      const { planner, cleanup } = createPlanner(mockPlanner(validPlanResult(workers)), {
        agentPool: ["agent-1", "agent-2"],
        enableBidding: false,
      });
      try {
        const result = await planner.plan("test", "coordinator", "test_session");
        assert.ok(result.run);
        // 3 workers, 2 agents round-robin: agent-1, agent-2, agent-1
        assert.equal(result.run.workers[0].agentId, "agent-1");
        assert.equal(result.run.workers[1].agentId, "agent-2");
        assert.equal(result.run.workers[2].agentId, "agent-1");
      } finally {
        cleanup();
      }
    });
  });

  describe("empty agent pool", () => {
    it("falls back to coordinator when agent pool is empty and bidding is enabled", async () => {
      const workers = [
        makeWorker("w1", { taskLabel: "Task A" }),
        makeWorker("w2", { taskLabel: "Task B" }),
      ];
      const { planner, cleanup } = createPlanner(mockPlanner(validPlanResult(workers)), {
        agentPool: [],
        enableBidding: true,
      });
      try {
        const result = await planner.plan("test", "coordinator", "test_session");
        assert.ok(result.run);
        // Empty pool falls back to coordinator for all workers
        assert.equal(result.run.workers[0].agentId, "coordinator");
        assert.equal(result.run.workers[1].agentId, "coordinator");
      } finally {
        cleanup();
      }
    });
  });

  describe("invalid base plan", () => {
    it("returns errors immediately when base planner result is invalid", async () => {
      const { planner, cleanup } = createPlanner(
        mockPlanner(invalidPlanResult(["planning failed"])),
      );
      try {
        const result = await planner.plan("bad goal", "coordinator", "test_session");
        assert.ok(!result.valid);
        assert.equal(result.run, null);
        assert.ok(result.errors.includes("planning failed"));
        assert.equal(result.planningRounds.length, 0);
      } finally {
        cleanup();
      }
    });

    it("returns errors immediately when base planner returns null run", async () => {
      const { planner, cleanup } = createPlanner(
        mockPlanner({ run: null, graph: null, valid: false, errors: ["no run"] }),
      );
      try {
        const result = await planner.plan("bad goal", "coordinator", "test_session");
        assert.ok(!result.valid);
        assert.equal(result.run, null);
        assert.equal(result.planningRounds.length, 0);
      } finally {
        cleanup();
      }
    });
  });

  describe("planningRounds attached", () => {
    it("populates planningRounds on the returned run", async () => {
      const workers = [makeWorker("w1")];
      const { planner, cleanup } = createPlanner(mockPlanner(validPlanResult(workers)));
      try {
        const result = await planner.plan("test", "coordinator", "test_session");
        assert.ok(result.run);
        assert.ok(result.run.planningRounds);
        assert.equal(result.run.planningRounds.length, 1);
        assert.equal(result.run.planningRounds[0].proposals.length, 1);
      } finally {
        cleanup();
      }
    });
  });
});
