/**
 * replan-impact-analyzer.test.ts — Unit tests for ReplanImpactAnalyzer.
 *
 * Covers:
 * - Capability matching and agent assignment
 * - No eligible agent handled gracefully
 * - Ownership conflict detection via real OwnershipRegistry
 * - Risk calculation (model hint can't lower)
 * - Policy decision evaluation
 * - Summary generation
 * - Protected scope violations
 *
 * All imports use .js extensions (NodeNext).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReplanImpactAnalyzer } from "../../src/kernel/replan-impact-analyzer.js";
import { OwnershipRegistry } from "../../src/ownership/ownership-registry.js";
import { createWorkerAssignment } from "../../src/kernel/coordination-types.js";
import type { PlanRevisionDraft, SimulatedGraph } from "../../src/kernel/replan-types.js";
import type { WorkerAssignment } from "../../src/kernel/coordination-types.js";

// ─── Constants ─────────────────────────────────────────────────────────────

const CAP_REGISTRY = {
  "agent-alpha": ["filesystem.read", "filesystem.write", "network.fetch", "code.analyze"],
  "agent-beta": ["filesystem.read", "code.analyze", "code.refactor"],
  "agent-gamma": ["network.fetch", "code.analyze", "code.review"],
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeWorker(overrides: Partial<WorkerAssignment> & { id: string }): WorkerAssignment {
  return createWorkerAssignment({
    coordinationRunId: "run_1",
    agentId: "agent-alpha",
    taskLabel: `Worker ${overrides.id}`,
    goalPrompt: `Do ${overrides.id}`,
    dependencies: [],
    requiredCapabilities: [],
    ownershipScopes: [],
    ownershipClaims: [],
    riskLevel: "low",
    approvalMode: "auto",
    attempt: 0,
    maxAttempts: 3,
    ...overrides,
  });
}

function validDraft(overrides: Partial<PlanRevisionDraft> = {}): PlanRevisionDraft {
  return {
    triggerKind: "worker_completed",
    triggerEvidence: {
      workerId: "w1",
      findingIds: [],
      conflictIds: [],
      reason: "Worker completed successfully",
    },
    workersToAdd: [],
    workersToReplace: [],
    workersToCancel: [],
    workersToModify: [],
    dependencyRewiring: [],
    expectedBenefit: "Improved workflow",
    confidence: 0.85,
    unresolvedConcerns: [],
    ...overrides,
  };
}

function emptySimulatedGraph(): SimulatedGraph {
  return {
    workers: [],
    edges: [],
    idMap: {},
    valid: true,
    errors: [],
    warnings: [],
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("ReplanImpactAnalyzer", () => {
  let dir: string;
  let registry: OwnershipRegistry;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "replan-impact-test-"));
    mkdirSync(join(dir, ".alix", "ownership"), { recursive: true });
    registry = new OwnershipRegistry(dir, { sessionId: "test-session" });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ── 1. Capability assignment ─────────────────────────────────────────

  it("assigns the best-matching agent to a new worker", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const draft = validDraft({
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "File reader",
          goalPrompt: "Read files",
          requiredCapabilities: ["filesystem.read", "filesystem.write"],
          dependencies: [],
          verificationRequirements: [],
        },
      ],
    });

    const result = await analyzer.analyze(draft, [], emptySimulatedGraph());
    const aa = result.agentAssignments["d1"];

    assert.ok(aa, "Expected an agent assignment for d1");
    assert.equal(aa.agentId, "agent-alpha", "agent-alpha has both read+write capabilities");
    assert.ok(aa.matched.includes("filesystem.read"), "Should match filesystem.read");
    assert.ok(aa.matched.includes("filesystem.write"), "Should match filesystem.write");
    assert.equal(aa.unmatched.length, 0, "All capabilities should be matched");
    assert.equal(aa.score, 1, "Perfect match score");
  });

  it("assigns agent with best partial match when no agent has all capabilities", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const draft = validDraft({
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "Code refactorer",
          goalPrompt: "Refactor code",
          requiredCapabilities: ["filesystem.read", "code.refactor", "filesystem.write"],
          dependencies: [],
          verificationRequirements: [],
        },
      ],
    });

    const result = await analyzer.analyze(draft, [], emptySimulatedGraph());
    const aa = result.agentAssignments["d1"];

    assert.ok(aa, "Expected an agent assignment");
    // Both agent-alpha (filesystem.read, filesystem.write) and agent-beta (filesystem.read, code.refactor)
    // match 2 of 3 capabilities — either is valid
    assert.ok(
      aa.agentId === "agent-alpha" || aa.agentId === "agent-beta",
      `Expected agent-alpha or agent-beta, got ${aa.agentId}`,
    );
    assert.ok(aa.matched.length >= 1, "Should have at least one match");
    assert.equal(aa.score, 2 / 3, "Should have score of 2/3");
  });

  // ── 2. No eligible agent ──────────────────────────────────────────────

  it("uses sentinel agentId when agent pool is empty", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: {},
      ownershipRegistry: registry,
      agentPool: [],
    });

    const draft = validDraft({
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "Orphan worker",
          goalPrompt: "Do work",
          requiredCapabilities: ["filesystem.read"],
          dependencies: [],
          verificationRequirements: [],
        },
      ],
    });

    const result = await analyzer.analyze(draft, [], emptySimulatedGraph());
    const aa = result.agentAssignments["d1"];

    assert.ok(aa, "Expected an agent assignment");
    assert.equal(aa.agentId, "__no_agent_available__");
    assert.equal(aa.score, 0);
    assert.deepEqual(aa.unmatched, ["filesystem.read"]);
  });

  it("uses round-robin fallback when bidding disabled and multiple workers share pool", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: { "agent-a": ["read"], "agent-b": ["write"] },
      ownershipRegistry: registry,
    });

    const draft = validDraft({
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "Worker 1",
          goalPrompt: "Read",
          requiredCapabilities: ["filesystem.read"],
          dependencies: [],
          verificationRequirements: [],
        },
        {
          draftWorkerId: "d2",
          taskLabel: "Worker 2",
          goalPrompt: "Write",
          requiredCapabilities: ["filesystem.write"],
          dependencies: [],
          verificationRequirements: [],
        },
      ],
    });

    const result = await analyzer.analyze(draft, [], emptySimulatedGraph());
    assert.ok(result.agentAssignments["d1"], "d1 assigned");
    assert.ok(result.agentAssignments["d2"], "d2 assigned");
    // Each picks best-match, so d1 -> agent-a and d2 -> agent-b
    assert.equal(result.agentAssignments["d1"].agentId, "agent-a");
    assert.equal(result.agentAssignments["d2"].agentId, "agent-b");
  });

  // ── 3. Ownership conflict detection ───────────────────────────────────

  it("detects ownership conflicts when replacement worker scope has active lease", async () => {
    // Acquire a lease in OwnershipRegistry first
    const acquireResult = await registry.acquire({
      agentId: "agent-gamma",
      scope: { kind: "path", root: join(dir, "src/shared"), recursive: true },
      mode: "exclusive-write",
    });
    assert.equal(acquireResult.acquired, true);

    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        agentId: "agent-alpha",
        ownershipScopes: [join(dir, "src/shared")],
      }),
    ];

    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Replacement",
            goalPrompt: "Replace",
            requiredCapabilities: ["filesystem.read"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Replacing failed worker",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());

    assert.ok(result.impactAnalysis.activeLeaseConflicts.length > 0, "Expected lease conflicts");
    const conflictStr = result.impactAnalysis.activeLeaseConflicts[0];
    assert.ok(conflictStr.includes("agent-gamma"), "Conflict should mention agent-gamma");
    assert.ok(conflictStr.includes("exclusive-write"), "Conflict should mention the mode");
  });

  it("does not flag conflict when scope does not overlap with any active lease", async () => {
    // Acquire a lease on a non-overlapping scope
    await registry.acquire({
      agentId: "agent-gamma",
      scope: { kind: "path", root: join(dir, "other"), recursive: true },
      mode: "exclusive-write",
    });

    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        agentId: "agent-alpha",
        ownershipScopes: [join(dir, "src/unrelated")],
      }),
    ];

    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Replacement",
            goalPrompt: "Replace",
            requiredCapabilities: ["filesystem.read"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Replacing failed worker",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());
    assert.equal(result.impactAnalysis.activeLeaseConflicts.length, 0, "No conflicts expected");
  });

  it("detects ownership conflicts via ownershipClaims", async () => {
    // Acquire a lease on a path that overlaps with an ownership claim
    await registry.acquire({
      agentId: "agent-gamma",
      scope: { kind: "path", root: join(dir, "src/domain"), recursive: true },
      mode: "exclusive-write",
    });

    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        agentId: "agent-alpha",
        ownershipClaims: [{ path: join(dir, "src/domain"), recursive: true }],
      }),
    ];

    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Replacement",
            goalPrompt: "Replace",
            requiredCapabilities: ["filesystem.read"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Replacing failed worker",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());

    assert.ok(result.impactAnalysis.activeLeaseConflicts.length > 0, "Expected lease conflicts via ownershipClaims");
    const conflictStr = result.impactAnalysis.activeLeaseConflicts[0];
    assert.ok(conflictStr.includes("agent-gamma"), "Conflict should mention agent-gamma");
    assert.ok(conflictStr.includes("Ownership claim"), "Conflict should mention ownership claim");
  });

  it("deduplicates active lease conflicts by scope path", async () => {
    // Two different workers each hold a lease on the same path
    await registry.acquire({
      agentId: "agent-gamma",
      scope: { kind: "path", root: join(dir, "src/shared"), recursive: true },
      mode: "exclusive-write",
    });

    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    // Two workers sharing the same ownershipScopes value — produce the same conflict
    const existing = [
      makeWorker({
        id: "w1",
        agentId: "agent-alpha",
        ownershipScopes: [join(dir, "src/shared")],
      }),
      makeWorker({
        id: "w2",
        agentId: "agent-beta",
        ownershipScopes: [join(dir, "src/shared")],
      }),
    ];

    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Rep1",
            goalPrompt: "Replace",
            requiredCapabilities: ["filesystem.read"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Replacing w1",
        },
        {
          targetWorkerId: "w2",
          replacement: {
            draftWorkerId: "d2",
            taskLabel: "Rep2",
            goalPrompt: "Replace",
            requiredCapabilities: ["filesystem.read"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Replacing w2",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());

    // Both replacements trigger the same conflict path vs agent-gamma
    // Without dedup this would produce 2 identical entries
    const gammaConflicts = result.impactAnalysis.activeLeaseConflicts.filter(
      (c) => c.includes("agent-gamma"),
    );
    assert.equal(gammaConflicts.length, 1, "Should deduplicate same scope+agent conflict");
  });

  // ── 4. Risk calculation ───────────────────────────────────────────────

  it("starts at low risk and raises to medium for new workers", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const draft = validDraft({
      confidence: 0.1, // Model's low confidence hint — should NOT lower risk below worker spec
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "New task",
          goalPrompt: "Do something",
          requiredCapabilities: ["filesystem.read"],
          dependencies: [],
          verificationRequirements: [],
        },
      ],
    });

    const result = await analyzer.analyze(draft, [], emptySimulatedGraph());
    // New workers default to "medium" risk — model confidence of 0.1 cannot lower it
    assert.equal(result.impactAnalysis.riskLevel, "medium");
  });

  it("raises risk when replacing a high-risk worker", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        riskLevel: "critical",
      }),
    ];

    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Replace critical",
            goalPrompt: "Do it",
            requiredCapabilities: ["filesystem.read"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Critical worker failed",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());
    assert.equal(result.impactAnalysis.riskLevel, "critical");
  });

  it("does not lower risk from model confidence hint", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        riskLevel: "high",
      }),
    ];

    const draft = validDraft({
      confidence: 0.95, // Model is very confident — should NOT lower risk
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Replace",
            goalPrompt: "Do it",
            requiredCapabilities: ["filesystem.read"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Replacement",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());
    // Risk should be "high" (from the worker's riskLevel), not lowered by model confidence
    assert.equal(result.impactAnalysis.riskLevel, "high");
  });

  it("raises risk when modifying a high-risk worker", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        riskLevel: "critical",
      }),
    ];

    const draft = validDraft({
      workersToModify: [
        {
          workerId: "w1",
          goalPrompt: "Updated prompt",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());
    assert.equal(result.impactAnalysis.riskLevel, "critical");
  });

  it("raises risk to highest among workersToAdd, workersToReplace, and workersToModify", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        riskLevel: "medium",
      }),
    ];

    const draft = validDraft({
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "Low risk add",
          goalPrompt: "Do something",
          requiredCapabilities: ["filesystem.read"],
          dependencies: [],
          verificationRequirements: [],
        },
      ],
      workersToModify: [
        {
          workerId: "w1",
          goalPrompt: "Updated prompt",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());
    // New workers default to "medium", modify inherits existing "medium" → overall "medium"
    assert.equal(result.impactAnalysis.riskLevel, "medium");
  });

  // ── 5. Policy decisions ───────────────────────────────────────────────

  it("flags manual-approval workers with ask decision", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        approvalMode: "manual",
      }),
    ];

    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Replace manual",
            goalPrompt: "Do it",
            requiredCapabilities: ["filesystem.read"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Manual worker needs replacement",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());

    const policyD1 = result.impactAnalysis.policyDecisions.find(
      (pd) => pd.workerRef === "d1",
    );
    assert.ok(policyD1, "Expected a policy decision for d1");
    assert.equal(policyD1!.decision, "ask");
    assert.ok(policyD1!.reason.includes("manual"));
  });

  it("allows auto-mode workers without policy violations", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        approvalMode: "auto",
      }),
    ];

    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Replace auto",
            goalPrompt: "Do it",
            requiredCapabilities: ["filesystem.read"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Auto worker needs replacement",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());

    const policyD1 = result.impactAnalysis.policyDecisions.find(
      (pd) => pd.workerRef === "d1",
    );
    assert.ok(policyD1, "Expected a policy decision for d1");
    assert.equal(policyD1!.decision, "allow");
  });

  it("asks for approval when cancelling a manual-approval worker", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        approvalMode: "manual",
      }),
    ];

    const draft = validDraft({
      workersToCancel: ["w1"],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());

    const policyW1 = result.impactAnalysis.policyDecisions.find(
      (pd) => pd.workerRef === "w1",
    );
    assert.ok(policyW1, "Expected a policy decision for w1");
    assert.equal(policyW1!.decision, "ask");
    assert.ok(result.impactAnalysis.requiresApproval, "Should require approval");
  });

  // ── 6. Capability diffing ─────────────────────────────────────────────

  it("tracks capabilities added and removed across replacements", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        requiredCapabilities: ["filesystem.read", "network.fetch"],
      }),
    ];

    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Replacement",
            goalPrompt: "Do it",
            requiredCapabilities: ["filesystem.read", "code.analyze"], // removed "network.fetch", added "code.analyze"
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Changing capabilities",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());

    assert.ok(result.impactAnalysis.capabilitiesAdded.includes("code.analyze"));
    assert.ok(result.impactAnalysis.capabilitiesRemoved.includes("network.fetch"));
    // filesystem.read is present in both — not added or removed
    assert.ok(!result.impactAnalysis.capabilitiesRemoved.includes("filesystem.read"));
  });

  it("tracks capabilities removed from cancelled workers", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const existing = [
      makeWorker({
        id: "w1",
        requiredCapabilities: ["filesystem.read", "filesystem.write"],
      }),
    ];

    const draft = validDraft({
      workersToCancel: ["w1"],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());

    assert.ok(result.impactAnalysis.capabilitiesRemoved.includes("filesystem.read"));
    assert.ok(result.impactAnalysis.capabilitiesRemoved.includes("filesystem.write"));
  });

  // ── 7. Summary generation ─────────────────────────────────────────────

  it("generates a non-empty summary string", async () => {
    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
    });

    const draft = validDraft({
      workersToAdd: [
        {
          draftWorkerId: "d1",
          taskLabel: "New worker",
          goalPrompt: "Do work",
          requiredCapabilities: ["filesystem.read"],
          dependencies: [],
          verificationRequirements: [],
        },
      ],
    });

    const result = await analyzer.analyze(draft, [], emptySimulatedGraph());

    assert.ok(typeof result.impactAnalysis.summary === "string");
    assert.ok(result.impactAnalysis.summary.length > 0);
    assert.ok(result.impactAnalysis.summary.includes("Risk level: medium"));
    assert.ok(result.impactAnalysis.summary.includes("Agents assigned: 1"));
  });

  it("includes conflict and violation info in summary when present", async () => {
    // Acquire a conflicting lease
    await registry.acquire({
      agentId: "agent-gamma",
      scope: { kind: "path", root: join(dir, "src/shared"), recursive: true },
      mode: "exclusive-write",
    });

    const analyzer = new ReplanImpactAnalyzer({
      capabilityRegistry: CAP_REGISTRY,
      ownershipRegistry: registry,
      protectedScopes: [join(dir, ".git/**")],
    });

    const existing = [
      makeWorker({
        id: "w1",
        agentId: "agent-alpha",
        ownershipScopes: [join(dir, "src/shared"), join(dir, ".git/config")],
        approvalMode: "manual",
      }),
    ];

    const draft = validDraft({
      workersToReplace: [
        {
          targetWorkerId: "w1",
          replacement: {
            draftWorkerId: "d1",
            taskLabel: "Replace",
            goalPrompt: "Do it",
            requiredCapabilities: ["filesystem.read"],
            dependencies: [],
            verificationRequirements: [],
          },
          reason: "Replacement",
        },
      ],
    });

    const result = await analyzer.analyze(draft, existing, emptySimulatedGraph());

    const summary = result.impactAnalysis.summary;
    assert.ok(summary.includes("Active lease conflicts"), "Summary should mention lease conflicts");
    assert.ok(summary.includes("Protected scope violations"), "Summary should mention protected scope violations");

    // The manual approval worker triggers "ask" policy
    assert.ok(result.impactAnalysis.requiresApproval, "Should require approval");
  });
});
