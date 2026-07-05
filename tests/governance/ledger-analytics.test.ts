// tests/governance/ledger-analytics.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeAnalytics,
  computePeriodRollups,
  detectTrend,
} from "../../src/governance/ledger-analytics.js";
import type { LedgerEntry } from "../../src/governance/run-ledger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<LedgerEntry> & { timestamp: string }): LedgerEntry {
  return {
    runId: "run-001",
    issueId: "issue-001",
    policyResult: { decision: "allow", reason: "ok", matchedPolicies: [], requiredApprovals: [] },
    riskScore: { level: "low", score: 10, factors: [] },
    approvals: [],
    filesChanged: ["src/main.ts"],
    verificationResults: [{ command: "build", status: "passed" }],
    outcome: "completed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeAnalytics tests
// ---------------------------------------------------------------------------

describe("computeAnalytics", () => {
  it("empty ledger returns zero-safe analytics", () => {
    const result = computeAnalytics([], 30);
    assert.strictEqual(result.totalRuns, 0);
    assert.deepStrictEqual(result.byOutcome, { completed: 0, failed: 0, cancelled: 0, denied: 0 });
    assert.deepStrictEqual(result.byRiskLevel, { low: 0, medium: 0, high: 0, critical: 0 });
    assert.strictEqual(result.approvalRate, 0);
    assert.strictEqual(result.averageRiskScore, 0);
    assert.strictEqual(result.timeframeDays, 30);
    assert.strictEqual(result.trendDirection, "stable");
  });

  it("counts byOutcome correctly", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", outcome: "completed" }),
      makeEntry({ timestamp: "2026-07-01T01:00:00.000Z", outcome: "completed", runId: "run-002" }),
      makeEntry({ timestamp: "2026-07-01T02:00:00.000Z", outcome: "failed", runId: "run-003" }),
      makeEntry({ timestamp: "2026-07-01T03:00:00.000Z", outcome: "denied", runId: "run-004" }),
      makeEntry({ timestamp: "2026-07-01T04:00:00.000Z", outcome: "cancelled", runId: "run-005" }),
    ];
    const result = computeAnalytics(entries, 30);
    assert.strictEqual(result.totalRuns, 5);
    assert.strictEqual(result.byOutcome.completed, 2);
    assert.strictEqual(result.byOutcome.failed, 1);
    assert.strictEqual(result.byOutcome.denied, 1);
    assert.strictEqual(result.byOutcome.cancelled, 1);
  });

  it("counts byRiskLevel correctly", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", riskScore: { level: "low", score: 10, factors: [] } }),
      makeEntry({ timestamp: "2026-07-01T01:00:00.000Z", riskScore: { level: "low", score: 10, factors: [] }, runId: "run-002" }),
      makeEntry({ timestamp: "2026-07-01T02:00:00.000Z", riskScore: { level: "medium", score: 40, factors: [] }, runId: "run-003" }),
      makeEntry({ timestamp: "2026-07-01T03:00:00.000Z", riskScore: { level: "high", score: 70, factors: [] }, runId: "run-004" }),
      makeEntry({ timestamp: "2026-07-01T04:00:00.000Z", riskScore: { level: "critical", score: 95, factors: [] }, runId: "run-005" }),
    ];
    const result = computeAnalytics(entries, 30);
    assert.strictEqual(result.byRiskLevel.low, 2);
    assert.strictEqual(result.byRiskLevel.medium, 1);
    assert.strictEqual(result.byRiskLevel.high, 1);
    assert.strictEqual(result.byRiskLevel.critical, 1);
  });

  it("decreasing failure rate and risk -> improving", () => {
    // 6 entries, mid = ceil(6/2) = 3
    // firstHalf [0,1,2]: 2 bad (failed, denied), 1 completed, riskAvg ~66.7
    // secondHalf [3,4,5]: 0 bad, all completed, riskAvg 40
    // badRateDecreased (0 < 2/3), riskAvgIncrease = 40 - 66.7 = -26.7 <= 5
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", outcome: "failed", riskScore: { level: "high", score: 80, factors: [] } }),
      makeEntry({ timestamp: "2026-07-01T01:00:00.000Z", outcome: "denied", riskScore: { level: "high", score: 80, factors: [] }, runId: "run-002" }),
      makeEntry({ timestamp: "2026-07-01T02:00:00.000Z", outcome: "completed", riskScore: { level: "low", score: 40, factors: [] }, runId: "run-003" }),
      makeEntry({ timestamp: "2026-07-02T00:00:00.000Z", outcome: "completed", riskScore: { level: "low", score: 40, factors: [] }, runId: "run-004" }),
      makeEntry({ timestamp: "2026-07-02T01:00:00.000Z", outcome: "completed", riskScore: { level: "low", score: 40, factors: [] }, runId: "run-005" }),
      makeEntry({ timestamp: "2026-07-02T02:00:00.000Z", outcome: "completed", riskScore: { level: "low", score: 40, factors: [] }, runId: "run-006" }),
    ];
    const result = computeAnalytics(entries, 30);
    assert.strictEqual(result.trendDirection, "improving");
  });

  it("computes timeframeDays as max of windowDays and date span", () => {
    // span of 5 days (July 1 -> July 6)
    const entries5: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z" }),
      makeEntry({ timestamp: "2026-07-06T00:00:00.000Z", runId: "run-002" }),
    ];
    let result = computeAnalytics(entries5, 30);
    assert.strictEqual(result.timeframeDays, 30); // max(30, 5) = 30

    result = computeAnalytics(entries5, 7);
    assert.strictEqual(result.timeframeDays, 7); // max(7, 5) = 7

    // span of 14 days (July 1 -> July 15)
    const entries14: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z" }),
      makeEntry({ timestamp: "2026-07-15T00:00:00.000Z", runId: "run-002" }),
    ];
    result = computeAnalytics(entries14, 7);
    assert.strictEqual(result.timeframeDays, 14); // max(7, 14) = 14
  });

  it("no approvals yields zero approvalRate", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", approvals: [] }),
      makeEntry({ timestamp: "2026-07-02T00:00:00.000Z", approvals: [], runId: "run-002" }),
    ];
    const result = computeAnalytics(entries, 30);
    assert.strictEqual(result.approvalRate, 0);
  });

  it("100% approvalRate when all entries fully approved", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", approvals: [{ gate: "verification", status: "approved", approvedBy: "tester" }] }),
      makeEntry({ timestamp: "2026-07-02T00:00:00.000Z", approvals: [{ gate: "verification", status: "approved", approvedBy: "tester" }], runId: "run-002" }),
    ];
    const result = computeAnalytics(entries, 30);
    assert.strictEqual(result.approvalRate, 1);
  });

  it("50% approvalRate when half denied", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", approvals: [{ gate: "verification", status: "approved", approvedBy: "tester" }] }),
      makeEntry({ timestamp: "2026-07-02T00:00:00.000Z", approvals: [{ gate: "verification", status: "denied", approvedBy: "tester" }], runId: "run-002" }),
    ];
    const result = computeAnalytics(entries, 30);
    assert.strictEqual(result.approvalRate, 0.5);
  });

  it("fewer than 4 entries yields stable trend", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", outcome: "failed" }),
      makeEntry({ timestamp: "2026-07-02T00:00:00.000Z", outcome: "completed", runId: "run-002" }),
      makeEntry({ timestamp: "2026-07-03T00:00:00.000Z", outcome: "completed", runId: "run-003" }),
    ];
    const result = computeAnalytics(entries, 30);
    assert.strictEqual(result.trendDirection, "stable");
  });

  it("increasing failure rate -> degrading", () => {
    // 6 entries, mid = ceil(6/2) = 3
    // firstHalf [0,1,2]: 0 bad (all completed)
    // secondHalf [3,4,5]: 2 bad (failed, failed), 1 completed
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", outcome: "completed" }),
      makeEntry({ timestamp: "2026-07-01T01:00:00.000Z", outcome: "completed", runId: "run-002" }),
      makeEntry({ timestamp: "2026-07-01T02:00:00.000Z", outcome: "completed", runId: "run-003" }),
      makeEntry({ timestamp: "2026-07-02T00:00:00.000Z", outcome: "failed", runId: "run-004" }),
      makeEntry({ timestamp: "2026-07-02T01:00:00.000Z", outcome: "failed", runId: "run-005" }),
      makeEntry({ timestamp: "2026-07-02T02:00:00.000Z", outcome: "completed", runId: "run-006" }),
    ];
    const result = computeAnalytics(entries, 30);
    assert.strictEqual(result.trendDirection, "degrading");
  });

  it("increased bad rate and risk increase >5 -> degrading", () => {
    // 6 entries, mid = ceil(6/2) = 3
    // firstHalf [0,1,2]: 0 bad, riskAvg = 10
    // secondHalf [3,4,5]: 1 bad, riskAvg = 15.7 => increase 5.7 > 5
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", outcome: "completed", riskScore: { level: "low", score: 10, factors: [] } }),
      makeEntry({ timestamp: "2026-07-01T01:00:00.000Z", outcome: "completed", riskScore: { level: "low", score: 10, factors: [] }, runId: "run-002" }),
      makeEntry({ timestamp: "2026-07-01T02:00:00.000Z", outcome: "completed", riskScore: { level: "low", score: 10, factors: [] }, runId: "run-003" }),
      makeEntry({ timestamp: "2026-07-02T00:00:00.000Z", outcome: "failed", riskScore: { level: "medium", score: 15.7, factors: [] }, runId: "run-004" }),
      makeEntry({ timestamp: "2026-07-02T01:00:00.000Z", outcome: "completed", riskScore: { level: "medium", score: 15.7, factors: [] }, runId: "run-005" }),
      makeEntry({ timestamp: "2026-07-02T02:00:00.000Z", outcome: "completed", riskScore: { level: "medium", score: 15.7, factors: [] }, runId: "run-006" }),
    ];
    const result = computeAnalytics(entries, 30);
    assert.strictEqual(result.trendDirection, "degrading");
  });

  it("is deterministic for identical input", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", outcome: "completed" }),
      makeEntry({ timestamp: "2026-07-02T00:00:00.000Z", outcome: "failed", runId: "run-002" }),
      makeEntry({ timestamp: "2026-07-03T00:00:00.000Z", outcome: "completed", runId: "run-003" }),
    ];
    const r1 = computeAnalytics(entries, 30);
    const r2 = computeAnalytics(entries, 30);
    assert.deepStrictEqual(r1, r2);
  });
});

// ---------------------------------------------------------------------------
// computePeriodRollups tests
// ---------------------------------------------------------------------------

describe("computePeriodRollups", () => {
  it("empty input returns empty array", () => {
    const result = computePeriodRollups([]);
    assert.deepStrictEqual(result, []);
  });

  it("groups entries by date", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T10:00:00.000Z" }),
      makeEntry({ timestamp: "2026-07-01T12:00:00.000Z", runId: "run-002" }),
      makeEntry({ timestamp: "2026-07-02T10:00:00.000Z", runId: "run-003" }),
    ];
    const result = computePeriodRollups(entries);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].date, "2026-07-01");
    assert.strictEqual(result[0].runs, 2);
    assert.strictEqual(result[1].date, "2026-07-02");
    assert.strictEqual(result[1].runs, 1);
  });

  it("counts failures and denied per day", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T10:00:00.000Z", outcome: "completed" }),
      makeEntry({ timestamp: "2026-07-01T11:00:00.000Z", outcome: "failed", runId: "run-002" }),
      makeEntry({ timestamp: "2026-07-01T12:00:00.000Z", outcome: "denied", runId: "run-003" }),
    ];
    const result = computePeriodRollups(entries);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].runs, 3);
    assert.strictEqual(result[0].failures, 1);
    assert.strictEqual(result[0].denied, 1);
  });

  it("computes avgRiskScore per day", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-01T10:00:00.000Z", riskScore: { level: "low", score: 10, factors: [] } }),
      makeEntry({ timestamp: "2026-07-01T12:00:00.000Z", riskScore: { level: "low", score: 20, factors: [] }, runId: "run-002" }),
    ];
    const result = computePeriodRollups(entries);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].avgRiskScore, 15);
  });

  it("returns entries sorted chronologically", () => {
    const entries: LedgerEntry[] = [
      makeEntry({ timestamp: "2026-07-02T00:00:00.000Z" }),
      makeEntry({ timestamp: "2026-07-01T00:00:00.000Z", runId: "run-002" }),
      makeEntry({ timestamp: "2026-07-03T00:00:00.000Z", runId: "run-003" }),
    ];
    const result = computePeriodRollups(entries);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].date, "2026-07-01");
    assert.strictEqual(result[1].date, "2026-07-02");
    assert.strictEqual(result[2].date, "2026-07-03");
  });
});
