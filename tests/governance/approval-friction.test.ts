import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeFrictionReport,
  computeFrictionScore,
} from "../../src/governance/approval-friction.js";
import type { LedgerEntry } from "../../src/governance/run-ledger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  overrides: Partial<LedgerEntry> & { timestamp: string },
): LedgerEntry {
  return {
    runId: "run-001",
    issueId: "issue-001",
    policyResult: {
      decision: "allow",
      reason: "ok",
      matchedPolicies: [],
      requiredApprovals: [],
    },
    riskScore: { level: "low", score: 10, factors: [] },
    approvals: [],
    filesChanged: [],
    verificationResults: [],
    outcome: "completed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeFrictionScore", () => {
  it("returns 0 when totalOccurrences is 0 (division-safe)", () => {
    const gate = {
      gate: "proposal" as const,
      totalOccurrences: 0,
      deniedCount: 0,
      pendingCount: 0,
      approvedCount: 0,
      averageTimeToApprove: null,
      frictionScore: 0,
    };
    assert.strictEqual(computeFrictionScore(gate), 0);
  });

  it("computes score as denyRate*0.6 + pendingRate*0.4, rounded", () => {
    // 3 denied, 2 pending, 10 total -> denyRate=0.3, pendingRate=0.2
    // 0.3*0.6 + 0.2*0.4 = 0.18 + 0.08 = 0.26
    const gate = {
      gate: "proposal" as const,
      totalOccurrences: 10,
      deniedCount: 3,
      pendingCount: 2,
      approvedCount: 5,
      averageTimeToApprove: null,
      frictionScore: 0,
    };
    assert.strictEqual(computeFrictionScore(gate), 0.26);
  });

  it("produces score 0 when all are approved", () => {
    const gate = {
      gate: "merge" as const,
      totalOccurrences: 5,
      deniedCount: 0,
      pendingCount: 0,
      approvedCount: 5,
      averageTimeToApprove: null,
      frictionScore: 0,
    };
    assert.strictEqual(computeFrictionScore(gate), 0);
  });
});

describe("computeFrictionReport", () => {
  // 1. Empty ledger
  it("returns zero-safe report for empty ledger (all 5 gates with zero counts)", () => {
    const report = computeFrictionReport([]);
    // All 5 gates appear with zero counts; tie-broken by name gives file_scope first
    assert.strictEqual(report.gates.length, 5);
    for (const gate of report.gates) {
      assert.strictEqual(gate.totalOccurrences, 0);
      assert.strictEqual(gate.frictionScore, 0);
    }
    assert.strictEqual(report.highestFrictionGate, "file_scope");
    assert.strictEqual(report.totalApprovalsRequested, 0);
    assert.strictEqual(report.overallFrictionScore, 0);
  });

  // 2. Entries with no approvals
  it("returns zero-safe report when entries have no approvals", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-01-01T00:00:00Z" }),
      makeEntry({ timestamp: "2026-01-02T00:00:00Z" }),
    ];
    const report = computeFrictionReport(entries);
    assert.strictEqual(report.gates.length, 5);
    for (const gate of report.gates) {
      assert.strictEqual(gate.totalOccurrences, 0);
      assert.strictEqual(gate.frictionScore, 0);
    }
    assert.strictEqual(report.highestFrictionGate, "file_scope");
    assert.strictEqual(report.totalApprovalsRequested, 0);
    assert.strictEqual(report.overallFrictionScore, 0);
  });

  // 3. Groups approvals by gate correctly
  it("groups approvals by gate name", () => {
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "proposal", status: "approved" },
          { gate: "file_scope", status: "approved" },
          { gate: "verification", status: "approved" },
          { gate: "pr", status: "approved" },
          { gate: "merge", status: "approved" },
        ],
      }),
      makeEntry({
        timestamp: "2026-01-02T00:00:00Z",
        approvals: [
          { gate: "proposal", status: "approved" },
          { gate: "file_scope", status: "denied" },
        ],
      }),
    ];
    const report = computeFrictionReport(entries);
    assert.strictEqual(report.gates.length, 5);

    // proposal: 2 approved
    const proposal = report.gates.find((g) => g.gate === "proposal")!;
    assert.strictEqual(proposal.totalOccurrences, 2);
    assert.strictEqual(proposal.approvedCount, 2);

    // file_scope: 1 approved, 1 denied
    const fileScope = report.gates.find((g) => g.gate === "file_scope")!;
    assert.strictEqual(fileScope.totalOccurrences, 2);
    assert.strictEqual(fileScope.approvedCount, 1);
    assert.strictEqual(fileScope.deniedCount, 1);
  });

  // 4. Counts approved/denied/pending correctly per gate
  it("counts approved, denied, and pending statuses correctly", () => {
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "verification", status: "approved" },
          { gate: "verification", status: "denied" },
          { gate: "verification", status: "pending" },
        ],
      }),
    ];
    const report = computeFrictionReport(entries);
    const verif = report.gates.find((g) => g.gate === "verification")!;
    assert.strictEqual(verif.totalOccurrences, 3);
    assert.strictEqual(verif.approvedCount, 1);
    assert.strictEqual(verif.deniedCount, 1);
    assert.strictEqual(verif.pendingCount, 1);
  });

  // 5. frictionScore = denyRate*0.6 + pendingRate*0.4
  it("computes per-gate frictionScore using weighted formula", () => {
    // 4 denied, 1 pending, 2 approved = 7 total
    // denyRate = 4/7 ≈ 0.5714, pendingRate = 1/7 ≈ 0.1429
    // score = 0.5714*0.6 + 0.1429*0.4 ≈ 0.3429 + 0.0571 ≈ 0.40
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "pr", status: "denied" },
          { gate: "pr", status: "denied" },
          { gate: "pr", status: "denied" },
          { gate: "pr", status: "denied" },
          { gate: "pr", status: "pending" },
          { gate: "pr", status: "approved" },
          { gate: "pr", status: "approved" },
        ],
      }),
    ];
    const report = computeFrictionReport(entries);
    const pr = report.gates.find((g) => g.gate === "pr")!;
    // rounds to 2 decimals: 0.40
    assert.strictEqual(pr.frictionScore, 0.4);
  });

  // 6. Division-safe: zero occurrences
  it("produces score 0 for gate with zero occurrences (division-safe)", () => {
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "proposal", status: "approved" },
        ],
      }),
    ];
    const report = computeFrictionReport(entries);
    // merge gate has zero occurrences
    const merge = report.gates.find((g) => g.gate === "merge")!;
    assert.strictEqual(merge.totalOccurrences, 0);
    assert.strictEqual(merge.frictionScore, 0);
    assert.strictEqual(Number.isNaN(merge.frictionScore), false);
  });

  // 7. highestFrictionGate picks highest score
  it("picks highestFrictionGate as the gate with highest frictionScore", () => {
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "proposal", status: "denied" },  // 1/1 = 1.0 *0.6 = 0.6
          { gate: "file_scope", status: "approved" },  // 0/1 = 0
        ],
      }),
    ];
    const report = computeFrictionReport(entries);
    assert.strictEqual(report.highestFrictionGate, "proposal");
  });

  // 8. Tie-breaks deterministically by gate name when scores equal
  it("tie-breaks highestFrictionGate by gate name when scores equal", () => {
    // Two gates with identical friction — name alphabetically first wins
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "merge", status: "denied" },     // 1/1 → 0.6
          { gate: "proposal", status: "denied" },  // 1/1 → 0.6
        ],
      }),
    ];
    const report = computeFrictionReport(entries);
    // Both have score 0.6, "merge" < "proposal" alphabetically
    assert.strictEqual(report.highestFrictionGate, "merge");
  });

  // 9. overallFrictionScore is occurrence-weighted (not plain mean)
  it("computes overallFrictionScore as occurrence-weighted totalDenied/total*0.6 + totalPending/total*0.4", () => {
    // proposal: 1 denied out of 1 → gate score 0.6
    // merge:    1 denied out of 1 → gate score 0.6
    // file_scope/verification/pr: 0 occurrences → gate score 0
    //
    // Occurrence-weighted:
    //   totalDenied = 2, totalApprovalsRequested = 2
    //   denyRate = 2/2 = 1, pendingRate = 0/2 = 0
    //   overallFrictionScore = 1 * 0.6 + 0 * 0.4 = 0.6
    //
    // Plain mean of gate scores would be: (0.6 + 0 + 0 + 0 + 0.6) / 5 = 0.24
    // This test asserts the OCCURRENCE-WEIGHTED value (0.6), NOT the plain mean (0.24).
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "proposal", status: "denied" },
          { gate: "merge", status: "denied" },
        ],
      }),
    ];
    const report = computeFrictionReport(entries);
    assert.strictEqual(report.overallFrictionScore, 0.6);
  });

  // 10. overallFrictionScore = 0 when totalApprovalsRequested = 0
  it("returns overallFrictionScore 0 when no approvals requested", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-01-01T00:00:00Z" }),
      makeEntry({ timestamp: "2026-01-02T00:00:00Z" }),
    ];
    const report = computeFrictionReport(entries);
    assert.strictEqual(report.overallFrictionScore, 0);
  });

  // 11. averageTimeToApprove is always null
  it("always sets averageTimeToApprove to null for every gate", () => {
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "proposal", status: "approved" },
          { gate: "merge", status: "denied" },
        ],
      }),
    ];
    const report = computeFrictionReport(entries);
    for (const gate of report.gates) {
      assert.strictEqual(gate.averageTimeToApprove, null);
    }
  });

  // 12. Deterministic: identical input → identical output
  it("produces deterministic output for identical input", () => {
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "proposal", status: "approved" },
          { gate: "verification", status: "denied" },
        ],
      }),
    ];
    const a = computeFrictionReport(entries);
    const b = computeFrictionReport(entries);
    assert.deepStrictEqual(a, b);
  });

  // 13. All 5 gate names present in output even if zero occurrences
  it("always includes all 5 gate names in output", () => {
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "proposal", status: "approved" },
        ],
      }),
    ];
    const report = computeFrictionReport(entries);
    const names = report.gates.map((g) => g.gate).sort();
    assert.deepStrictEqual(names, [
      "file_scope",
      "merge",
      "pr",
      "proposal",
      "verification",
    ]);
  });

  // 14. Gate with denied=0, pending=0, approved=5 → frictionScore=0
  it("returns frictionScore=0 for gate with only approvals", () => {
    const entries: LedgerEntry[] = [
      makeEntry({
        timestamp: "2026-01-01T00:00:00Z",
        approvals: [
          { gate: "file_scope", status: "approved" },
          { gate: "file_scope", status: "approved" },
          { gate: "file_scope", status: "approved" },
          { gate: "file_scope", status: "approved" },
          { gate: "file_scope", status: "approved" },
        ],
      }),
    ];
    const report = computeFrictionReport(entries);
    const fileScope = report.gates.find((g) => g.gate === "file_scope")!;
    assert.strictEqual(fileScope.deniedCount, 0);
    assert.strictEqual(fileScope.pendingCount, 0);
    assert.strictEqual(fileScope.approvedCount, 5);
    assert.strictEqual(fileScope.frictionScore, 0);
  });
});
