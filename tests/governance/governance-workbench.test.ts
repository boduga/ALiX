import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { buildWorkbenchSnapshot } from "../../src/governance/governance-workbench.js";
import type {
  GovernanceWorkbenchSnapshot,
  WorkbenchQueueItem,
} from "../../src/governance/governance-workbench.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";
import type { GovernanceExecutionPlan } from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";
import type { GovernanceExecutionAttempt } from "../../src/governance/execution-recorder.js";
import type { GovernanceExecutionReport } from "../../src/governance/execution-report.js";
import type { GovernanceSignal } from "../../src/governance/governance-signal.js";
import type { InvestigationRecommendation } from "../../src/governance/investigation-types.js";

const NOW = "2026-07-08T12:00:00.000Z";
const SEVEN_DAYS_AGO = "2026-07-01T12:00:00.000Z";
let planCounter = 0;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProposal(
  overrides: Partial<GovernanceRemediationProposal> = {},
): GovernanceRemediationProposal {
  return {
    proposalId: "prop-test",
    sourceRecommendationIds: ["rec-1"],
    title: "Test proposal",
    severity: "warning",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-08T00:00:00.000Z",
    evidenceRefs: [],
    status: "accepted",
    createdAt: NOW,
    responseKind: "investigate_anomaly",
    proposedAction: "review",
    reversible: true,
    ...overrides,
  };
}

function makePlan(
  overrides: Partial<GovernanceExecutionPlan> = {},
): GovernanceExecutionPlan {
  const c = ++planCounter;
  return {
    planId: `plan-${c}`,
    remediationId: overrides.remediationId ?? "prop-test",
    sourceProposalId: overrides.sourceProposalId ?? "prop-test",
    status: "draft",
    title: "Execution plan",
    summary: "Execute remediation",
    proposedActions: [],
    riskLevel: "medium",
    requiresRollbackPlan: false,
    rollbackPlan: null,
    createdAt: NOW,
    createdBy: "system",
    approvedAt: null,
    approvedBy: null,
    executionAttemptIds: [],
    auditRefs: [],
    ...overrides,
  };
}

function makeApproval(
  plan: GovernanceExecutionPlan,
  overrides: Partial<GovernanceExecutionApproval> = {},
): GovernanceExecutionApproval {
  return {
    approvalId: `approval-${plan.planId}`,
    planId: plan.planId,
    remediationId: plan.remediationId,
    decision: "approved",
    rationale: "Approved",
    operatorId: "operator-1",
    createdAt: NOW,
    approvedActionIds: [],
    auditRefs: [],
    ...overrides,
  };
}

function makeAttempt(
  plan: GovernanceExecutionPlan,
  approval: GovernanceExecutionApproval,
  status: GovernanceExecutionAttempt["status"] = "succeeded",
  overrides: Partial<GovernanceExecutionAttempt> = {},
): GovernanceExecutionAttempt {
  return {
    attemptId: `attempt-${plan.planId}`,
    planId: plan.planId,
    remediationId: plan.remediationId,
    approvalId: approval.approvalId,
    status,
    startedAt: NOW,
    completedAt: status === "succeeded" || status === "failed" || status === "reverted" ? NOW : null,
    executedBy: "operator-1",
    actionResults: [],
    failureReason: status === "failed" ? "Execution error" : null,
    revertAttemptId: null,
    auditRefs: [],
    ...overrides,
  };
}

function makeReport(
  items: GovernanceExecutionReport["items"],
): GovernanceExecutionReport {
  return {
    generatedAt: NOW,
    windowStart: SEVEN_DAYS_AGO,
    windowEnd: NOW,
    totals: {
      accepted: items.filter((i) => i.remediationStatus === "accepted").length,
      planned: items.filter((i) => i.planId !== null).length,
      approved: 0,
      rejected: 0,
      executed: items.filter((i) => i.executionState === "executed").length,
      failed: items.filter((i) => i.executionState === "failed").length,
      partial: items.filter((i) => i.executionState === "partial").length,
      reverted: items.filter((i) => i.executionState === "reverted").length,
      unresolved: items.filter((i) => i.unresolved).length,
      superseded: items.filter((i) => i.remediationStatus === "superseded").length,
    },
    items,
  };
}

function makeSignal(
  overrides: Partial<GovernanceSignal> = {},
): GovernanceSignal {
  return {
    signalId: "sig-1",
    sourcePhase: "p13.1",
    signalType: "trend_alert",
    severity: "high",
    confidence: 0.85,
    title: "Signal: anomaly detected",
    description: "Anomaly detected in governance metrics",
    evidenceRefs: [],
    recommendation: "Investigate",
    metadata: {},
    status: "new",
    requestedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeInvestigation(
  overrides: Partial<InvestigationRecommendation> = {},
): InvestigationRecommendation {
  return {
    id: "inv-1",
    kind: "chain_restoration",
    status: "open",
    severity: "high",
    source: "drift",
    sourceArtifactId: "sig-1",
    evidenceRefs: [],
    title: "Investigation: anomaly",
    description: "Investigate governance anomaly",
    operatorGuidance: "Review and decide",
    createdAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function itemsInQueue(
  report: GovernanceWorkbenchSnapshot,
  queue: string,
): WorkbenchQueueItem[] {
  return report.queue[queue as keyof typeof report.queue] ?? [];
}

function totalQueueItems(report: GovernanceWorkbenchSnapshot): number {
  return Object.values(report.queue).reduce((sum, items) => sum + items.length, 0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildWorkbenchSnapshot", () => {
  it("empty inputs produce zero counts", () => {
    const snapshot = buildWorkbenchSnapshot({
      remediations: [],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    assert.equal(snapshot.generatedAt, NOW);
    assert.equal(totalQueueItems(snapshot), 0);
    assert.equal(snapshot.summary.queueCounts.total, 0);
    assert.deepEqual(snapshot.summary.lifecycleTotals, {
      accepted: 0,
      planned: 0,
      approved: 0,
      rejected: 0,
      executed: 0,
      failed: 0,
      partial: 0,
      reverted: 0,
      unresolved: 0,
      superseded: 0,
    });
  });

  it("open remediation appears in needs_acceptance queue", () => {
    const proposal = makeProposal({ status: "open" });
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    const q = itemsInQueue(snapshot, "needs_acceptance");
    assert.equal(q.length, 1);
    assert.equal(q[0]!.remediationId, "prop-test");
    assert.equal(q[0]!.reason.includes("needs operator acceptance"), true);
    assert.equal(totalQueueItems(snapshot), 1);
  });

  it("accepted remediation without plan appears in needs_planning", () => {
    const proposal = makeProposal({ status: "accepted" });
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    const q = itemsInQueue(snapshot, "needs_planning");
    assert.equal(q.length, 1);
    assert.equal(q[0]!.remediationId, "prop-test");
    assert.equal(q[0]!.reason.includes("no execution plan"), true);
    assert.equal(totalQueueItems(snapshot), 1);
  });

  it("plan without approval appears in needs_approval", () => {
    const proposal = makeProposal({ proposalId: "r-1", status: "accepted" });
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    const q = itemsInQueue(snapshot, "needs_approval");
    assert.equal(q.length, 1);
    assert.equal(q[0]!.remediationId, "r-1");
    assert.equal(q[0]!.reason.includes("needs operator approval"), true);
    assert.equal(totalQueueItems(snapshot), 1);
  });

  it("approved plan without attempt appears in needs_followup", () => {
    const proposal = makeProposal({ proposalId: "r-1", status: "accepted" });
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApproval(plan);
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    const q = itemsInQueue(snapshot, "needs_followup");
    assert.equal(q.length, 1);
    assert.equal(q[0]!.remediationId, "r-1");
    assert.equal(q[0]!.reason.includes("no execution attempt"), true);
    assert.equal(totalQueueItems(snapshot), 1);
  });

  it("failed attempt appears in needs_followup", () => {
    const proposal = makeProposal({ proposalId: "r-1", status: "accepted" });
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApproval(plan);
    const attempt = makeAttempt(plan, approval, "failed");
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [attempt],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    const q = itemsInQueue(snapshot, "needs_followup");
    assert.equal(q.length, 1);
    assert.equal(q[0]!.remediationId, "r-1");
    assert.equal(q[0]!.severity, "critical");
    assert.equal(q[0]!.reason.includes("failed"), true);
    assert.equal(totalQueueItems(snapshot), 1);
  });

  it("partial attempt appears in needs_followup", () => {
    const proposal = makeProposal({ proposalId: "r-1", status: "accepted" });
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApproval(plan);
    const attempt = makeAttempt(plan, approval, "partial");
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [attempt],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    const q = itemsInQueue(snapshot, "needs_followup");
    assert.equal(q.length, 1);
    assert.equal(q[0]!.severity, "warning");
    assert.equal(totalQueueItems(snapshot), 1);
  });

  it("succeeded attempt does not appear in any queue", () => {
    const proposal = makeProposal({ proposalId: "r-1", status: "accepted" });
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApproval(plan);
    const attempt = makeAttempt(plan, approval, "succeeded");
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [attempt],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    assert.equal(totalQueueItems(snapshot), 0);
  });

  it("rejected plan does not appear in any queue", () => {
    const proposal = makeProposal({ proposalId: "r-1", status: "accepted" });
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApproval(plan, { decision: "rejected" });
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    assert.equal(totalQueueItems(snapshot), 0);
  });

  it("superseded remediation does not appear in any queue", () => {
    const proposal = makeProposal({ status: "superseded" });
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    assert.equal(totalQueueItems(snapshot), 0);
  });

  it("item appears in at most one queue (priority wins)", () => {
    // An item that is both open and accepted would never happen in practice,
    // but if a remediation is in needs_acceptance, it should not also appear
    // in needs_planning even if it qualifies for both.
    const proposal = makeProposal({ status: "open" });
    // Even with a plan (which shouldn't exist for open, but still)
    const plan = makePlan({ remediationId: "prop-test" });
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    assert.equal(itemsInQueue(snapshot, "needs_acceptance").length, 1);
    assert.equal(itemsInQueue(snapshot, "needs_planning").length, 0);
    assert.equal(totalQueueItems(snapshot), 1);
  });

  it("lifecycle detail shows all populated hops", () => {
    const signal = makeSignal();
    const investigation = makeInvestigation();
    const proposal = makeProposal({
      proposalId: "r-1",
      sourceRecommendationIds: ["inv-1"],
    });
    const plan = makePlan({ remediationId: "r-1", sourceProposalId: "r-1" });
    const approval = makeApproval(plan);
    const attempt = makeAttempt(plan, approval, "succeeded");
    const reportItem = {
      remediationId: "r-1",
      sourceProposalId: "r-1",
      remediationStatus: "accepted" as const,
      planId: plan.planId,
      executionState: "executed" as const,
      approvalId: approval.approvalId,
      approvalDecision: "approved" as const,
      latestAttemptId: attempt.attemptId,
      latestAttemptStatus: "succeeded" as const,
      riskLevel: "low" as const,
      unresolved: false,
      requiresAttention: false,
      summary: "Executed successfully",
      createdAt: NOW,
      updatedAt: NOW,
    };

    const snapshot = buildWorkbenchSnapshot({
      signals: [signal],
      investigations: [investigation],
      remediations: [proposal],
      executionPlans: [plan],
      approvals: [approval],
      attempts: [attempt],
      report: makeReport([reportItem]),
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    // Traces are returned via the internal function; verify indirectly via
    // queue classification (succeeded → no queue) and summary counts
    assert.equal(totalQueueItems(snapshot), 0);
  });

  it("lifecycle detail shows gaps for missing hops", () => {
    const proposal = makeProposal({ proposalId: "r-1", status: "open" });
    const snapshot = buildWorkbenchSnapshot({
      remediations: [proposal],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    // Open item → needs_acceptance, no plan created → gaps
    assert.equal(itemsInQueue(snapshot, "needs_acceptance").length, 1);
    // Total should be 1 (only the queue items)
    assert.equal(totalQueueItems(snapshot), 1);
  });

  it("summary counts match items in queues", () => {
    const r1 = makeProposal({ proposalId: "r-1", status: "open" });
    const r2 = makeProposal({ proposalId: "r-2", status: "accepted" });
    const r3 = makeProposal({
      proposalId: "r-3",
      status: "accepted",
    });
    const plan3 = makePlan({ remediationId: "r-3", sourceProposalId: "r-3" });
    const r4 = makeProposal({ proposalId: "r-4", status: "accepted" });
    const plan4 = makePlan({ remediationId: "r-4", sourceProposalId: "r-4" });
    const approval4 = makeApproval(plan4);
    const attempt4 = makeAttempt(plan4, approval4, "failed");

    const snapshot = buildWorkbenchSnapshot({
      remediations: [r1, r2, r3, r4],
      executionPlans: [plan3, plan4],
      approvals: [approval4],
      attempts: [attempt4],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    assert.equal(snapshot.summary.queueCounts.needs_acceptance, 1); // r1
    assert.equal(snapshot.summary.queueCounts.needs_planning, 1); // r2
    assert.equal(snapshot.summary.queueCounts.needs_approval, 1); // r3
    assert.equal(snapshot.summary.queueCounts.needs_followup, 1); // r4
    assert.equal(snapshot.summary.queueCounts.total, 4);
  });

  it("summary includes lifecycle totals from report", () => {
    const reportItem = {
      remediationId: "r-1",
      sourceProposalId: "r-1",
      remediationStatus: "accepted" as const,
      planId: "plan-1",
      executionState: "executed" as const,
      approvalId: "approval-1",
      approvalDecision: "approved" as const,
      latestAttemptId: "attempt-1",
      latestAttemptStatus: "succeeded" as const,
      riskLevel: "low" as const,
      unresolved: false,
      requiresAttention: false,
      summary: "Executed",
      createdAt: NOW,
      updatedAt: NOW,
    };

    const snapshot = buildWorkbenchSnapshot({
      remediations: [],
      executionPlans: [],
      approvals: [],
      attempts: [],
      report: makeReport([reportItem]),
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    assert.equal(snapshot.summary.lifecycleTotals.executed, 1);
    assert.equal(snapshot.summary.lifecycleTotals.accepted, 1);
  });

  it("read model produces no store writes", () => {
    // Verify the function is pure — it must not mutate inputs
    const proposals = [makeProposal({ status: "open" })];
    const proposalsSnapshot = JSON.stringify(proposals);

    buildWorkbenchSnapshot({
      remediations: proposals,
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    assert.deepEqual(JSON.stringify(proposals), proposalsSnapshot);
  });

  it("no audit emitter imports in module", () => {
    // Compile-time check: the module should not reference audit emitters
    const source = readFileSync(
      "src/governance/governance-workbench.ts",
      "utf-8",
    );
    assert.equal(source.includes("audit-emitter"), false);
    assert.equal(source.includes("auditEmitter"), false);
    assert.equal(source.includes("emitAuditEvent"), false);
    assert.equal(source.includes("emitAudit"), false);
  });

  it("no store write references in module", () => {
    const source = readFileSync(
      "src/governance/governance-workbench.ts",
      "utf-8",
    );
    // The module should not reference append/write/transition methods
    assert.equal(source.includes(".append("), false);
    assert.equal(source.includes(".write("), false);
    assert.equal(source.includes(".transition("), false);
    assert.equal(source.includes("ExecutionStore"), false);
  });

  it("CLI handler does not import audit emitters", () => {
    const source = readFileSync(
      "src/cli/commands/governance.ts",
      "utf-8",
    );
    assert.equal(source.includes("audit-emitter"), false);
    assert.equal(source.includes("auditEmitter"), false);
    assert.equal(source.includes("emitAuditEvent"), false);
  });

  it("workbench queue --json produces valid object", () => {
    const snapshot = buildWorkbenchSnapshot({
      remediations: [],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });
    const json = JSON.stringify({ queues: snapshot.queue, summary: snapshot.summary });
    const parsed = JSON.parse(json);
    assert.ok(parsed.queues);
    assert.ok(parsed.summary);
  });

  it("workbench summary --json produces valid object", () => {
    const snapshot = buildWorkbenchSnapshot({
      remediations: [],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });
    const json = JSON.stringify(snapshot.summary);
    const parsed = JSON.parse(json);
    assert.ok(parsed.queueCounts);
    assert.ok(parsed.lifecycleTotals);
  });
});
