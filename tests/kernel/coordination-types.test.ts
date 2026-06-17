/**
 * coordination-types.test.ts -- Unit tests for coordination types,
 * constructors, and helper functions including replanning additions.
 *
 * Tests:
 * - CoordinationRunStatus accepts "replanning"
 * - createCoordinationRun sets planRevision: 0, revisionHistory absent
 * - recomputeRunStatus guard preserves "replanning"
 * - recomputeRunStatus still works for non-replanning runs
 * - PlanRevision / PlanDiffEntry construct correctly
 * - PlanningRound / PlanningProposal / PlanningBid / PlanningAcceptance
 * - PlanTriggerKind accepts all 5 variants
 * - PlanningRoundStatus accepts all 5 variants
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createCoordinationRun,
  createWorkerAssignment,
  transitionWorkerStatus,
  recomputeRunStatus,
} from "../../src/kernel/coordination-types.js";
import type {
  CoordinationRun,
  CoordinationRunStatus,
  PlanRevision,
  PlanDiffEntry,
  PlanningRound,
  PlanningProposal,
  PlanningBid,
  PlanningAcceptance,
  PlanTriggerKind,
  PlanningRoundStatus,
  WorkerOwnershipClaim,
} from "../../src/kernel/coordination-types.js";

// ─── CoordinationRunStatus: "replanning" ─────────────────────────────────

describe("CoordinationRunStatus", () => {
  it("accepts 'replanning' as a valid status value", () => {
    const status: CoordinationRunStatus = "replanning";
    assert.equal(status, "replanning");
  });

  it("accepts 'planning', 'running', 'blocked', 'completed', 'failed'", () => {
    const valid: CoordinationRunStatus[] = [
      "planning", "replanning", "running", "blocked", "completed", "failed",
    ];
    assert.equal(valid.length, 6);
  });
});

// ─── PlanTriggerKind ─────────────────────────────────────────────────────

describe("PlanTriggerKind", () => {
  it("accepts all 5 variants", () => {
    const kinds: PlanTriggerKind[] = [
      "worker_completed",
      "worker_failed",
      "conflict_detected",
      "finding_published",
      "manual",
    ];
    assert.equal(kinds.length, 5);
  });
});

// ─── PlanningRoundStatus ─────────────────────────────────────────────────

describe("PlanningRoundStatus", () => {
  it("accepts all 5 variants", () => {
    const statuses: PlanningRoundStatus[] = [
      "draft", "bidding", "finalizing", "finalized", "failed",
    ];
    assert.equal(statuses.length, 5);
  });
});

// ─── PlanDiffEntry / PlanRevision construction ───────────────────────────

describe("PlanDiffEntry", () => {
  it("constructs with 'added' change", () => {
    const entry: PlanDiffEntry = {
      workerId: "worker_abc",
      change: "added",
      taskLabel: "New task",
      goalPrompt: "Do the thing",
      reason: "replan after failure",
    };
    assert.equal(entry.workerId, "worker_abc");
    assert.equal(entry.change, "added");
    assert.equal(entry.taskLabel, "New task");
    assert.equal(entry.reason, "replan after failure");
  });

  it("constructs with 'removed' change (no optional fields)", () => {
    const entry: PlanDiffEntry = {
      workerId: "worker_xyz",
      change: "removed",
      reason: "task no longer needed",
    };
    assert.equal(entry.change, "removed");
    assert.equal(entry.taskLabel, undefined);
  });

  it("constructs with 'modified' change", () => {
    const entry: PlanDiffEntry = {
      workerId: "worker_123",
      change: "modified",
      goalPrompt: "Updated prompt",
      reason: "scope refined",
    };
    assert.equal(entry.change, "modified");
    assert.equal(entry.goalPrompt, "Updated prompt");
  });
});

describe("PlanRevision", () => {
  it("constructs with minimal fields", () => {
    const rev: PlanRevision = {
      revisionNumber: 1,
      timestamp: "2026-06-16T12:00:00.000Z",
      reason: "Worker failed",
      triggerKind: "worker_failed",
      diff: [],
    };
    assert.equal(rev.revisionNumber, 1);
    assert.equal(rev.triggerKind, "worker_failed");
    assert.equal(rev.diff.length, 0);
    assert.equal(rev.triggerWorkerId, undefined);
    assert.equal(rev.conflictIds, undefined);
  });

  it("constructs with conflict triggers", () => {
    const rev: PlanRevision = {
      revisionNumber: 2,
      timestamp: "2026-06-16T13:00:00.000Z",
      reason: "Conflict detected between workers",
      triggerKind: "conflict_detected",
      triggerWorkerId: "worker_a",
      conflictIds: ["conflict_001", "conflict_002"],
      diff: [
        { workerId: "worker_b", change: "added", taskLabel: "Resolver", reason: "resolve conflict_001" },
      ],
    };
    assert.equal(rev.revisionNumber, 2);
    assert.equal(rev.triggerKind, "conflict_detected");
    assert.equal(rev.triggerWorkerId, "worker_a");
    assert.equal(rev.conflictIds?.length, 2);
    assert.equal(rev.diff.length, 1);
  });

  it("constructs with all trigger kinds", () => {
    const triggerKinds: PlanTriggerKind[] = [
      "worker_completed", "worker_failed", "conflict_detected",
      "finding_published", "manual",
    ];
    for (const kind of triggerKinds) {
      const rev: PlanRevision = {
        revisionNumber: 1,
        timestamp: "2026-06-16T00:00:00.000Z",
        reason: `triggered by ${kind}`,
        triggerKind: kind,
        diff: [],
      };
      assert.equal(rev.triggerKind, kind);
    }
  });
});

// ─── PlanningProposal ────────────────────────────────────────────────────

describe("PlanningProposal", () => {
  it("constructs with required and optional fields", () => {
    const claim: WorkerOwnershipClaim = { path: "src/", recursive: true };
    const proposal: PlanningProposal = {
      id: "proposal_001",
      taskLabel: "Refactor module",
      goalPrompt: "Refactor the X module for testability",
      requiredCapabilities: ["typescript", "testing"],
      ownershipClaims: [claim],
      dependencies: [],
      riskLevel: "medium",
      approvalMode: "auto",
    };
    assert.equal(proposal.id, "proposal_001");
    assert.equal(proposal.requiredCapabilities.length, 2);
    assert.equal(proposal.ownershipClaims.length, 1);
    assert.equal(proposal.riskLevel, "medium");
  });

  it("allows missing optional fields", () => {
    const proposal: PlanningProposal = {
      id: "proposal_002",
      taskLabel: "Simple task",
      goalPrompt: "Do it",
      requiredCapabilities: [],
      ownershipClaims: [],
      dependencies: [],
    };
    assert.equal(proposal.riskLevel, undefined);
    assert.equal(proposal.approvalMode, undefined);
  });
});

// ─── PlanningBid ─────────────────────────────────────────────────────────

describe("PlanningBid", () => {
  it("constructs with full fields", () => {
    const bid: PlanningBid = {
      id: "bid_001",
      proposalId: "proposal_001",
      agentId: "agent-alpha",
      matchedCapabilities: ["typescript"],
      unmatchedCapabilities: ["testing"],
      confidence: 0.85,
      message: "I have strong TS skills",
      createdAt: "2026-06-16T12:00:00.000Z",
    };
    assert.equal(bid.agentId, "agent-alpha");
    assert.equal(bid.confidence, 0.85);
    assert.equal(bid.matchedCapabilities.length, 1);
    assert.equal(bid.unmatchedCapabilities.length, 1);
  });

  it("constructs with minimal fields", () => {
    const bid: PlanningBid = {
      id: "bid_002",
      proposalId: "proposal_002",
      agentId: "agent-beta",
      matchedCapabilities: [],
      unmatchedCapabilities: [],
      confidence: 0.0,
      createdAt: "2026-06-16T12:00:00.000Z",
    };
    assert.equal(bid.confidence, 0.0);
    assert.equal(bid.message, undefined);
  });
});

// ─── PlanningAcceptance ──────────────────────────────────────────────────

describe("PlanningAcceptance", () => {
  it("constructs with all required fields", () => {
    const acc: PlanningAcceptance = {
      proposalId: "proposal_001",
      agentId: "agent-alpha",
      assignedWorkerId: "worker_abc",
    };
    assert.equal(acc.proposalId, "proposal_001");
    assert.equal(acc.agentId, "agent-alpha");
    assert.equal(acc.assignedWorkerId, "worker_abc");
  });

  it("does not include status, reason, or other optional fields", () => {
    const acc: PlanningAcceptance = {
      proposalId: "proposal_002",
      agentId: "agent-beta",
      assignedWorkerId: "worker_def",
    };
    // The shape has no status or reason field
    assert.equal("status" in acc, false);
    assert.equal("reason" in acc, false);
  });
});

// ─── PlanningRound ───────────────────────────────────────────────────────

describe("PlanningRound", () => {
  it("constructs with all fields", () => {
    const round: PlanningRound = {
      id: "planround_1",
      coordinationRunId: "coord_abc",
      roundNumber: 1,
      status: "draft",
      proposals: [],
      bids: [],
      acceptances: [],
      createdAt: "2026-06-16T12:00:00.000Z",
      updatedAt: "2026-06-16T12:00:00.000Z",
    };
    assert.equal(round.roundNumber, 1);
    assert.equal(round.status, "draft");
  });

  it("transitions through statuses", () => {
    const statuses: PlanningRoundStatus[] = ["draft", "bidding", "finalizing", "finalized", "failed"];
    for (const s of statuses) {
      const round: PlanningRound = {
        id: "planround_x",
        coordinationRunId: "coord_abc",
        roundNumber: 1,
        status: s,
        proposals: [],
        bids: [],
        acceptances: [],
        createdAt: "2026-06-16T12:00:00.000Z",
        updatedAt: "2026-06-16T12:00:00.000Z",
      };
      assert.equal(round.status, s);
    }
  });
});

// ─── createCoordinationRun: planRevision ─────────────────────────────────

describe("createCoordinationRun", () => {
  it("sets planRevision to 0", () => {
    const run = createCoordinationRun({
      sessionId: "session-test",
      rootGoal: "Test goal",
      coordinatorAgentId: "alix",
    });
    assert.equal(run.planRevision, 0);
  });

  it("does not set revisionHistory by default", () => {
    const run = createCoordinationRun({
      sessionId: "session-test",
      rootGoal: "Test goal",
      coordinatorAgentId: "alix",
    });
    assert.equal(run.revisionHistory, undefined);
  });

  it("default status is planning (not replanning)", () => {
    const run = createCoordinationRun({
      sessionId: "session-test",
      rootGoal: "Test goal",
      coordinatorAgentId: "alix",
    });
    assert.equal(run.status, "planning");
    assert.notEqual(run.status, "replanning");
  });
});

// ─── recomputeRunStatus: replanning guard ────────────────────────────────

describe("recomputeRunStatus replanning guard", () => {
  it("returns 'replanning' when run.status is 'replanning'", () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "Test",
      coordinatorAgentId: "alix",
    });
    // Set status manually to replanning
    (run as { status: CoordinationRunStatus }).status = "replanning";
    assert.equal(recomputeRunStatus(run), "replanning");
  });

  it("returns 'replanning' even when all workers are completed", () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "Test",
      coordinatorAgentId: "alix",
    });
    const w1 = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "Task A",
      goalPrompt: "do it",
    });
    run.workers = [transitionWorkerStatus(w1, "completed")];
    (run as { status: CoordinationRunStatus }).status = "replanning";
    assert.equal(recomputeRunStatus(run), "replanning");
  });

  it("returns 'replanning' even when all workers failed", () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "Test",
      coordinatorAgentId: "alix",
    });
    const w1 = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "Task A",
      goalPrompt: "do it",
    });
    run.workers = [transitionWorkerStatus(w1, "failed", { error: "oops" })];
    (run as { status: CoordinationRunStatus }).status = "replanning";
    assert.equal(recomputeRunStatus(run), "replanning");
  });

  it("still returns 'completed' for non-replanning runs", () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "Test",
      coordinatorAgentId: "alix",
    });
    const w1 = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "Task A",
      goalPrompt: "do it",
    });
    run.workers = [transitionWorkerStatus(w1, "completed")];
    assert.equal(recomputeRunStatus(run), "completed");
  });

  it("still returns 'failed' for non-replanning runs", () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "Test",
      coordinatorAgentId: "alix",
    });
    const w1 = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "Task A",
      goalPrompt: "do it",
    });
    run.workers = [transitionWorkerStatus(w1, "failed", { error: "oops" })];
    assert.equal(recomputeRunStatus(run), "failed");
  });

  it("still returns 'running' when workers are mixed", () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "Test",
      coordinatorAgentId: "alix",
    });
    const w1 = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w1",
      taskLabel: "Task A",
      goalPrompt: "do it",
    });
    const w2 = createWorkerAssignment({
      coordinationRunId: run.id,
      agentId: "w2",
      taskLabel: "Task B",
      goalPrompt: "do it",
    });
    run.workers = [
      transitionWorkerStatus(w1, "running"),
      transitionWorkerStatus(w2, "completed"),
    ];
    assert.equal(recomputeRunStatus(run), "running");
  });
});

// ─── WorkerAssignment lineage fields: replacementFor/supersededBy ────────

describe("WorkerAssignment lineage fields", () => {
  it("sets replacementForWorkerId when provided", () => {
    const w = createWorkerAssignment({
      coordinationRunId: "coord_abc",
      agentId: "agent-a",
      taskLabel: "Task A",
      goalPrompt: "do it",
      replacementForWorkerId: "worker_old",
    });
    assert.equal(w.replacementForWorkerId, "worker_old");
  });

  it("sets supersededByWorkerId when provided", () => {
    const w = createWorkerAssignment({
      coordinationRunId: "coord_abc",
      agentId: "agent-a",
      taskLabel: "Task A",
      goalPrompt: "do it",
      supersededByWorkerId: "worker_new",
    });
    assert.equal(w.supersededByWorkerId, "worker_new");
  });

  it("defaults both fields to undefined when not provided", () => {
    const w = createWorkerAssignment({
      coordinationRunId: "coord_abc",
      agentId: "agent-a",
      taskLabel: "Task A",
      goalPrompt: "do it",
    });
    assert.equal(w.replacementForWorkerId, undefined);
    assert.equal(w.supersededByWorkerId, undefined);
  });

  it("can set both fields simultaneously", () => {
    const w = createWorkerAssignment({
      coordinationRunId: "coord_abc",
      agentId: "agent-a",
      taskLabel: "Task A",
      goalPrompt: "do it",
      replacementForWorkerId: "worker_old",
      supersededByWorkerId: "worker_new",
    });
    assert.equal(w.replacementForWorkerId, "worker_old");
    assert.equal(w.supersededByWorkerId, "worker_new");
  });
});

// ─── PlanningRounds on CoordinationRun ────────────────────────────────────

describe("CoordinationRun planningRounds", () => {
  it("can be set with PlanningRound[]", () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "Test planning rounds",
      coordinatorAgentId: "alix",
    });
    const round: PlanningRound = {
      id: "planround_1",
      coordinationRunId: run.id,
      roundNumber: 1,
      status: "draft",
      proposals: [],
      bids: [],
      acceptances: [],
      createdAt: "2026-06-16T12:00:00.000Z",
      updatedAt: "2026-06-16T12:00:00.000Z",
    };
    run.planningRounds = [round];
    assert.equal(run.planningRounds?.length, 1);
    assert.equal(run.planningRounds![0].id, "planround_1");
  });

  it("defaults to undefined when not set", () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "Test no rounds",
      coordinatorAgentId: "alix",
    });
    assert.equal(run.planningRounds, undefined);
  });
});

// ─── Lineage integration: revisionHistory on CoordinationRun ────────────

describe("CoordinationRun revision lineage", () => {
  it("can attach revisionHistory with multiple revisions", () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "Test with history",
      coordinatorAgentId: "alix",
    });

    const rev1: PlanRevision = {
      revisionNumber: 1,
      timestamp: "2026-06-16T12:00:00.000Z",
      reason: "initial plan",
      triggerKind: "manual",
      diff: [],
    };

    const rev2: PlanRevision = {
      revisionNumber: 2,
      timestamp: "2026-06-16T13:00:00.000Z",
      reason: "worker failed",
      triggerKind: "worker_failed",
      triggerWorkerId: "worker_abc",
      diff: [
        {
          workerId: "worker_abc",
          change: "removed",
          taskLabel: "Failed task",
          reason: "replaced after failure",
        },
        {
          workerId: "worker_def",
          change: "added",
          taskLabel: "Replacement task",
          goalPrompt: "Redo the work",
          reason: "replacement for worker_abc",
        },
      ],
    };

    run.planRevision = 2;
    run.revisionHistory = [rev1, rev2];

    assert.equal(run.planRevision, 2);
    assert.equal(run.revisionHistory.length, 2);
    assert.equal(run.revisionHistory[0].revisionNumber, 1);
    assert.equal(run.revisionHistory[1].revisionNumber, 2);
    assert.equal(run.revisionHistory[1].diff.length, 2);
    assert.equal(run.revisionHistory[1].triggerKind, "worker_failed");
  });

  it("revisionHistory is optional and can be absent", () => {
    const run = createCoordinationRun({
      sessionId: "s1",
      rootGoal: "No history",
      coordinatorAgentId: "alix",
    });
    assert.equal(run.revisionHistory, undefined);
  });
});
