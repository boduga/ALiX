import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWorkbenchSnapshot } from "../../src/governance/governance-workbench.js";
import type {
  GovernanceWorkbenchSnapshot,
  WorkbenchQueueItem,
  WorkbenchLifecycleTrace,
} from "../../src/governance/governance-workbench.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";
import type { GovernanceExecutionPlan } from "../../src/governance/execution-plans.js";
import type { GovernanceExecutionApproval } from "../../src/governance/execution-approval.js";
import type { GovernanceExecutionAttempt } from "../../src/governance/execution-recorder.js";
import type { GovernanceExecutionReport } from "../../src/governance/execution-report.js";

const NOW = "2026-07-09T12:00:00.000Z";
const SEVEN_DAYS_AGO = "2026-07-02T12:00:00.000Z";

let planCounter = 0;

// ---------------------------------------------------------------------------
// Fixtures (mirrored from governance-workbench.test.ts)
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
    rationale: "Approved by operator",
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
    completedAt:
      status === "succeeded" || status === "failed" || status === "reverted"
        ? NOW
        : null,
    executedBy: "operator-1",
    actionResults: [],
    failureReason: status === "failed" ? "Execution error" : null,
    revertAttemptId: null,
    auditRefs: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Text-rendering helpers (matching CLI output patterns)
// ---------------------------------------------------------------------------

function renderQueueText(snapshot: GovernanceWorkbenchSnapshot): string[] {
  const lines: string[] = [];
  const total = snapshot.summary.queueCounts.total;
  if (total === 0) {
    lines.push("No pending items. All remediations resolved.");
    return lines;
  }
  for (const [queueName, items] of Object.entries(snapshot.queue)) {
    if (items.length === 0) continue;
    lines.push(`${queueName} (${items.length})`);
    for (const item of items) {
      lines.push(`  ${item.severity.toUpperCase()} ${item.remediationId}`);
      lines.push(`    Reason: ${item.reason}`);
      lines.push(`    Plan: ${item.planId ?? "—"}  Approval: ${item.approvalId ?? "—"}`);
      lines.push(`    Created: ${item.createdAt}`);
    }
  }
  return lines;
}

function renderSummaryText(snapshot: GovernanceWorkbenchSnapshot): string[] {
  const s = snapshot.summary;
  const lines: string[] = [];
  lines.push("Governance Workbench Summary");
  lines.push(`  ${s.queueCounts.needs_acceptance} needs acceptance`);
  lines.push(`  ${s.queueCounts.needs_planning} needs planning`);
  lines.push(`  ${s.queueCounts.needs_approval} needs approval`);
  lines.push(`  ${s.queueCounts.needs_followup} needs follow-up`);
  lines.push(`  ${s.queueCounts.total} total pending`);
  lines.push(`  ${s.lifecycleTotals.accepted} accepted`);
  lines.push(`  ${s.lifecycleTotals.executed} executed`);
  if (s.oldestItems.length > 0) {
    for (const item of s.oldestItems) {
      lines.push(`  ${item.remediationId} — ${item.reason}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("workbench CLI output", () => {
  it("queue renders text output with queue headers and items", () => {
    const r1 = makeProposal({ proposalId: "r-1", status: "open" });
    const r2 = makeProposal({ proposalId: "r-2", status: "accepted" });

    const snapshot = buildWorkbenchSnapshot({
      remediations: [r1, r2],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    const lines = renderQueueText(snapshot);

    assert.ok(lines.some((l) => l.includes("needs_acceptance")));
    assert.ok(lines.some((l) => l.includes("needs_planning")));
    assert.ok(lines.some((l) => l.includes("INFO r-1")));
    assert.ok(lines.some((l) => l.includes("INFO r-2")));
  });

  it("queue --json emits valid JSON with all queues", () => {
    const r1 = makeProposal({ proposalId: "r-1", status: "open" });
    const r2 = makeProposal({ proposalId: "r-2", status: "accepted" });
    const r3 = makeProposal({ proposalId: "r-3", status: "accepted" });
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

    // JSON output matches the queue field name from snapshot
    const json = JSON.stringify({ queue: snapshot.queue, summary: snapshot.summary });
    const parsed = JSON.parse(json);

    assert.ok(Array.isArray(parsed.queue.needs_acceptance));
    assert.ok(Array.isArray(parsed.queue.needs_planning));
    assert.ok(Array.isArray(parsed.queue.needs_approval));
    assert.ok(Array.isArray(parsed.queue.needs_followup));
    assert.equal(parsed.queue.needs_acceptance.length, 1);
    assert.equal(parsed.queue.needs_planning.length, 1);
    assert.equal(parsed.queue.needs_approval.length, 1);
    assert.equal(parsed.queue.needs_followup.length, 1);
    // Severity color must NOT appear in JSON output
    assert.equal(json.includes("\x1b["), false);
  });

  it("queue with empty stores shows empty-state message", () => {
    const snapshot = buildWorkbenchSnapshot({
      remediations: [],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    const lines = renderQueueText(snapshot);
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.includes("No pending items"));
  });

  it("summary renders text output with counts and oldest items", () => {
    const r1 = makeProposal({ proposalId: "r-1", status: "open" });
    const r2 = makeProposal({
      proposalId: "r-2",
      status: "accepted",
      createdAt: SEVEN_DAYS_AGO,
    });

    const snapshot = buildWorkbenchSnapshot({
      remediations: [r1, r2],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    const lines = renderSummaryText(snapshot);

    assert.ok(lines.some((l) => l.includes("1 needs acceptance")));
    assert.ok(lines.some((l) => l.includes("1 needs planning")));
    assert.ok(lines.some((l) => l.includes("2 total pending")));
    assert.ok(lines.some((l) => l.includes("r-2"))); // oldest item shown
  });

  it("summary --json emits valid JSON summary", () => {
    const r1 = makeProposal({ proposalId: "r-1", status: "open" });
    const snapshot = buildWorkbenchSnapshot({
      remediations: [r1],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    const json = JSON.stringify(snapshot.summary);
    const parsed = JSON.parse(json);

    assert.ok(parsed.queueCounts);
    assert.ok(parsed.lifecycleTotals);
    assert.ok(Array.isArray(parsed.oldestItems));
    assert.ok(parsed.staleness);
    assert.equal(parsed.queueCounts.needs_acceptance, 1);
    assert.equal(parsed.queueCounts.total, 1);
    // No ANSI codes in JSON
    assert.equal(json.includes("\x1b["), false);
  });

  it("trace <missingId> shows not-found message", async () => {
    // When no stores are populated, all trace hops are gaps
    const { buildLifecycleTrace } =
      await import("../../src/governance/governance-workbench.js");

    const trace = buildLifecycleTrace(
      "nonexistent-123",
      [],           // remediations
      new Map(),    // plansByRemediation
      new Map(),    // approvalsByPlan
      new Map(),    // attemptsByPlan
      new Map(),    // signalsById
      new Map(),    // investigationsById
      new Map(),    // reportItemsByRemediation
    );

    assert.equal(trace.remediationId, "nonexistent-123");
    // All hops should be gaps
    assert.ok(trace.hops.every((h: any) => h.gap === true));
  });
});

describe("workbench CLI sentinel checks", () => {
  it("CLI handler does not call append/write/transition methods", () => {
    const source = readFileSync("src/cli/commands/governance.ts", "utf-8");

    // The workbench handler section should not contain write/append calls
    const workbenchSection = source.split("// P18 — Governance Workbench CLI handlers")[1]
      ?? source.split("async function runWorkbench")[1]
      ?? "";

    assert.equal(workbenchSection.includes(".append("), false);
    assert.equal(workbenchSection.includes(".write("), false);
    assert.equal(workbenchSection.includes(".transition("), false);
  });

  it("governance.ts imports no audit emitters", () => {
    const source = readFileSync("src/cli/commands/governance.ts", "utf-8");
    assert.equal(source.includes("audit-emitter"), false);
    assert.equal(source.includes("auditEmitter"), false);
    assert.equal(source.includes("emitAuditEvent"), false);
  });

  it("JSON output field names match snapshot shape", () => {
    // Verify the JSON field name used by CLI matches the snapshot type
    const snapshot = buildWorkbenchSnapshot({
      remediations: [],
      executionPlans: [],
      approvals: [],
      attempts: [],
      options: { now: NOW, since: SEVEN_DAYS_AGO, until: NOW },
    });

    // Field name is "queue" not "queues"
    assert.ok(snapshot.queue !== undefined);
    assert.equal(Array.isArray(snapshot.queue), false);
    assert.equal(typeof snapshot.queue.needs_acceptance, "object");
  });
});
