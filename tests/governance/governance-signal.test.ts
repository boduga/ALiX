/**
 * Tests for P14.1 — Governance Signal Inbox.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup — prefer node:test matching P13 convention
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import {
  validateGovernanceSignal,
  FileSignalStore,
  dedupKey,
  isDuplicate,
  normalizeTrendAlerts,
  normalizeFailureClusters,
  normalizePolicySuggestions,
  normalizeFrictionAlerts,
  normalizeAllP13Outputs,
  type GovernanceSignal,
  type SignalStatus,
  type SignalType,
} from "../../src/governance/governance-signal.js";

import type { LedgerAnalytics, PeriodRollup } from "../../src/governance/ledger-analytics.js";
import type { FailureAnalysis, FailureCluster } from "../../src/governance/failure-clustering.js";
import type { PolicySuggestion } from "../../src/governance/policy-suggestions.js";
import type { FrictionReport, ApprovalFriction } from "../../src/governance/approval-friction.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = "2026-07-06T12:00:00.000Z";

function validSignal(overrides: Partial<GovernanceSignal> = {}): GovernanceSignal {
  return {
    signalId: "sig-test-1",
    sourcePhase: "p13.1",
    signalType: "trend_alert",
    severity: "medium",
    confidence: 0.7,
    title: "Test signal",
    description: "A test governance signal",
    evidenceRefs: [{ source: "ledger-analytics", id: "test-1", description: "Test evidence" }],
    recommendation: "Review and act",
    metadata: { key: "value" },
    status: "new",
    requestedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gov-signal-test-"));
  return dir;
}

function cleanupTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateGovernanceSignal", () => {
  it("accepts a valid signal", () => {
    const result = validateGovernanceSignal(validSignal());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects non-object", () => {
    const result = validateGovernanceSignal("not-an-object");
    assert.equal(result.valid, false);
  });

  it("rejects empty object", () => {
    const result = validateGovernanceSignal({});
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("rejects missing signalId", () => {
    const result = validateGovernanceSignal(validSignal({ signalId: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("signalId")));
  });

  it("rejects invalid sourcePhase", () => {
    const result = validateGovernanceSignal(validSignal({ sourcePhase: "p99" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("sourcePhase")));
  });

  it("rejects invalid signalType", () => {
    const result = validateGovernanceSignal(validSignal({ signalType: "bogus" as SignalType }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("signalType")));
  });

  it("rejects invalid severity", () => {
    const result = validateGovernanceSignal(validSignal({ severity: "severe" as "medium" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("severity")));
  });

  it("rejects confidence out of [0, 1]", () => {
    const result = validateGovernanceSignal(validSignal({ confidence: 1.5 }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("confidence")));
  });

  it("rejects empty title", () => {
    const result = validateGovernanceSignal(validSignal({ title: "" }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("title")));
  });

  it("rejects invalid status", () => {
    const result = validateGovernanceSignal(validSignal({ status: "unknown" as SignalStatus }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("status")));
  });

  it("accepts all valid source phases", () => {
    for (const phase of ["p13.1", "p13.2", "p13.3", "p13.4"]) {
      const result = validateGovernanceSignal(validSignal({ sourcePhase: phase }));
      assert.equal(result.valid, true, `phase ${phase} should be valid`);
    }
  });

  it("accepts all valid signal types", () => {
    for (const st of ["trend_alert", "failure_cluster", "policy_suggestion", "friction_alert"]) {
      const result = validateGovernanceSignal(validSignal({ signalType: st as SignalType }));
      assert.equal(result.valid, true, `type ${st} should be valid`);
    }
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

describe("FileSignalStore", () => {
  let dir: string;

  // Manual setup per test via helper
  function setupStore(): { store: FileSignalStore; cleanup: () => void } {
    const d = makeTempDir();
    return { store: new FileSignalStore(d), cleanup: () => cleanupTempDir(d) };
  }

  it("returns empty list from non-existent file", async () => {
    const { store } = setupStore();
    const signals = await store.list();
    assert.deepEqual(signals, []);
  });

  it("appends and lists signals newest-first", async () => {
    const { store } = setupStore();
    const s1 = validSignal({ signalId: "s1", createdAt: "2026-01-01T00:00:00Z" });
    const s2 = validSignal({ signalId: "s2", createdAt: "2026-06-01T00:00:00Z" });

    await store.append(s1);
    await store.append(s2);

    const all = await store.list();
    assert.equal(all.length, 2);
    assert.equal(all[0]!.signalId, "s2"); // newest first
    assert.equal(all[1]!.signalId, "s1");
  });

  it("appends and lists with limit", async () => {
    const { store } = setupStore();
    await store.append(validSignal({ signalId: "s1" }));
    await store.append(validSignal({ signalId: "s2" }));
    await store.append(validSignal({ signalId: "s3" }));

    const limited = await store.list(2);
    assert.equal(limited.length, 2);
  });

  it("getById returns matching signal", async () => {
    const { store } = setupStore();
    await store.append(validSignal({ signalId: "find-me" }));
    await store.append(validSignal({ signalId: "other" }));

    const found = await store.getById("find-me");
    assert.notEqual(found, null);
    assert.equal(found!.signalId, "find-me");
  });

  it("getById returns null for missing", async () => {
    const { store } = setupStore();
    const found = await store.getById("nonexistent");
    assert.equal(found, null);
  });

  it("query filters by status", async () => {
    const { store } = setupStore();
    await store.append(validSignal({ signalId: "s1", status: "new" }));
    await store.append(validSignal({ signalId: "s2", status: "dismissed" }));
    await store.append(validSignal({ signalId: "s3", status: "new" }));

    const newSignals = await store.query({ status: "new" });
    assert.equal(newSignals.length, 2);
    assert.ok(newSignals.every((s) => s.status === "new"));
  });

  it("query filters by source phase", async () => {
    const { store } = setupStore();
    await store.append(validSignal({ signalId: "s1", sourcePhase: "p13.1" }));
    await store.append(validSignal({ signalId: "s2", sourcePhase: "p13.2" }));

    const p132 = await store.query({ sourcePhase: "p13.2" });
    assert.equal(p132.length, 1);
    assert.equal(p132[0]!.signalId, "s2");
  });

  it("skips malformed JSON lines", async () => {
    const d = makeTempDir();
    const store = new FileSignalStore(d);
    const filePath = join(d, "governance-signals.jsonl");
    writeFileSync(filePath, "{invalid-json}\n" + JSON.stringify(validSignal({ signalId: "s1" })) + "\n", "utf8");

    const all = await store.list();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.signalId, "s1");
    cleanupTempDir(d);
  });

  it("rejects invalid signal on append", async () => {
    const { store } = setupStore();
    await assert.rejects(
      () => store.append({} as unknown as GovernanceSignal),
      /Invalid signal/,
    );
  });

  it("creates directory on first append", async () => {
    const nestedDir = join(makeTempDir(), "deep", "nested");
    const nestedStore = new FileSignalStore(nestedDir);
    await nestedStore.append(validSignal({ signalId: "s1" }));
    assert.ok(existsSync(join(nestedDir, "governance-signals.jsonl")));
    cleanupTempDir(nestedDir);
  });

  it("query handles partial filter (empty keys)", async () => {
    const { store } = setupStore();
    await store.append(validSignal({ signalId: "s1" }));
    const all = await store.query({});
    assert.equal(all.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

describe("dedupKey", () => {
  it("produces deterministic keys", () => {
    const a = validSignal({ sourcePhase: "p13.1", signalType: "trend_alert", title: "Test" });
    const b = validSignal({ sourcePhase: "p13.1", signalType: "trend_alert", title: "Test" });
    assert.equal(dedupKey(a), dedupKey(b));
  });

  it("differs when sourcePhase changes", () => {
    const a = validSignal({ sourcePhase: "p13.1", title: "Same" });
    const b = validSignal({ sourcePhase: "p13.2", title: "Same" });
    assert.notEqual(dedupKey(a), dedupKey(b));
  });

  it("differs when title changes", () => {
    const a = validSignal({ title: "One" });
    const b = validSignal({ title: "Two" });
    assert.notEqual(dedupKey(a), dedupKey(b));
  });
});

describe("isDuplicate", () => {
  it("returns true when duplicate exists with status new", () => {
    const existing = [validSignal({ signalId: "existing", status: "new" })];
    const candidate = validSignal({ signalId: "candidate" });
    assert.equal(isDuplicate(existing, candidate), true);
  });

  it("returns false when duplicate exists but is dismissed", () => {
    const existing = [validSignal({ signalId: "existing", status: "dismissed" })];
    const candidate = validSignal({ signalId: "candidate" });
    assert.equal(isDuplicate(existing, candidate), false);
  });

  it("returns false when no match exists", () => {
    const existing = [validSignal({ signalId: "existing", title: "Different" })];
    const candidate = validSignal({ signalId: "candidate", title: "Other" });
    assert.equal(isDuplicate(existing, candidate), false);
  });

  it("returns false on empty existing list", () => {
    assert.equal(isDuplicate([], validSignal()), false);
  });
});

// ---------------------------------------------------------------------------
// Normalisation: P13.1 trend alert
// ---------------------------------------------------------------------------

describe("normalizeTrendAlerts", () => {
  it("creates degrading alert when trend is degrading", () => {
    const analytics: LedgerAnalytics = {
      totalRuns: 100,
      byOutcome: { completed: 40, failed: 30, cancelled: 20, denied: 10 },
      byRiskLevel: { low: 20, medium: 40, high: 30, critical: 10 },
      approvalRate: 0.5,
      averageRiskScore: 45,
      timeframeDays: 90,
      trendDirection: "degrading",
    };
    const rollups: PeriodRollup[] = [];
    const signals = normalizeTrendAlerts(analytics, rollups, NOW);

    assert.ok(signals.some((s) => s.title.includes("degrading")));
  });

  it("does not create degrading alert when trend is stable", () => {
    const analytics: LedgerAnalytics = {
      totalRuns: 100,
      byOutcome: { completed: 50, failed: 20, cancelled: 20, denied: 10 },
      byRiskLevel: { low: 20, medium: 40, high: 30, critical: 10 },
      approvalRate: 0.7,
      averageRiskScore: 30,
      timeframeDays: 90,
      trendDirection: "stable",
    };
    const signals = normalizeTrendAlerts(analytics, [], NOW);
    // stable only creates other alerts (low approval rate, high risk) — not a trend alert
    const trendSignals = signals.filter((s) => s.title.includes("trend"));
    assert.equal(trendSignals.length, 0);
  });

  it("creates low approval rate alert when rate < 0.5", () => {
    const analytics: LedgerAnalytics = {
      totalRuns: 100,
      byOutcome: { completed: 20, failed: 30, cancelled: 20, denied: 30 },
      byRiskLevel: { low: 20, medium: 40, high: 30, critical: 10 },
      approvalRate: 0.3,
      averageRiskScore: 45,
      timeframeDays: 90,
      trendDirection: "stable",
    };
    const signals = normalizeTrendAlerts(analytics, [], NOW);

    assert.ok(signals.some((s) => s.title.includes("approval")));
  });

  it("does not create low approval alert when totalRuns is 0", () => {
    const analytics: LedgerAnalytics = {
      totalRuns: 0,
      byOutcome: { completed: 0, failed: 0, cancelled: 0, denied: 0 },
      byRiskLevel: { low: 0, medium: 0, high: 0, critical: 0 },
      approvalRate: 0,
      averageRiskScore: 0,
      timeframeDays: 0,
      trendDirection: "stable",
    };
    const signals = normalizeTrendAlerts(analytics, [], NOW);
    assert.equal(signals.length, 0);
  });

  it("creates high risk alert when averageRiskScore > 50", () => {
    const analytics: LedgerAnalytics = {
      totalRuns: 100,
      byOutcome: { completed: 50, failed: 20, cancelled: 20, denied: 10 },
      byRiskLevel: { low: 5, medium: 15, high: 50, critical: 30 },
      approvalRate: 0.7,
      averageRiskScore: 65,
      timeframeDays: 90,
      trendDirection: "stable",
    };
    const signals = normalizeTrendAlerts(analytics, [], NOW);

    assert.ok(signals.some((s) => s.title.includes("risk score")));
  });

  it("all signals have sourcePhase p13.1 and type trend_alert", () => {
    const analytics: LedgerAnalytics = {
      totalRuns: 100,
      byOutcome: { completed: 20, failed: 30, cancelled: 20, denied: 30 },
      byRiskLevel: { low: 5, medium: 15, high: 50, critical: 30 },
      approvalRate: 0.3,
      averageRiskScore: 65,
      timeframeDays: 90,
      trendDirection: "degrading",
    };
    const signals = normalizeTrendAlerts(analytics, [], NOW);

    assert.ok(signals.length >= 2);
    for (const s of signals) {
      assert.equal(s.sourcePhase, "p13.1");
      assert.equal(s.signalType, "trend_alert");
      assert.equal(s.status, "new");
    }
  });
});

// ---------------------------------------------------------------------------
// Normalisation: P13.2 failure clusters
// ---------------------------------------------------------------------------

describe("normalizeFailureClusters", () => {
  const baseAnalysis: FailureAnalysis = {
    total: 20,
    clusters: [
      {
        failureType: "approval_denied",
        count: 10,
        recentTimestamp: "2026-07-01T00:00:00Z",
        commonDetailKeywords: ["timeout", "denied"],
        commonFilePaths: ["src/auth.ts"],
        associatedPolicyIds: ["policy-1"],
      },
      {
        failureType: "test_failure",
        count: 6,
        recentTimestamp: "2026-06-15T00:00:00Z",
        commonDetailKeywords: ["assertion"],
        commonFilePaths: ["src/tests/"],
        associatedPolicyIds: [],
      },
    ],
    dominantType: "approval_denied",
    recurringFilePaths: ["src/auth.ts"],
    recurringFilePathCounts: { "src/auth.ts": 10 },
    timeframeDays: 30,
  };

  it("creates signals for clusters with severity >= medium", () => {
    const signals = normalizeFailureClusters(baseAnalysis, NOW);
    // approval_denied → high, test_failure → low (skipped)
    assert.equal(signals.length, 1);
    assert.equal(signals[0]!.signalType, "failure_cluster");
    assert.equal(signals[0]!.sourcePhase, "p13.2");
  });

  it("includes all clusters when severity is medium or high", () => {
    const analysis: FailureAnalysis = {
      ...baseAnalysis,
      clusters: [
        {
          failureType: "policy_denied",
          count: 8,
          recentTimestamp: "2026-07-01T00:00:00Z",
          commonDetailKeywords: ["denied"],
          commonFilePaths: [],
          associatedPolicyIds: [],
        },
        {
          failureType: "pr_rejected",
          count: 5,
          recentTimestamp: "2026-06-20T00:00:00Z",
          commonDetailKeywords: ["merge"],
          commonFilePaths: [],
          associatedPolicyIds: [],
        },
      ],
    };
    const signals = normalizeFailureClusters(analysis, NOW);
    // policy_denied → medium, pr_rejected → high
    assert.equal(signals.length, 2);
  });

  it("returns empty for low-severity-only clusters", () => {
    const analysis: FailureAnalysis = {
      ...baseAnalysis,
      clusters: [
        {
          failureType: "test_failure",
          count: 3,
          recentTimestamp: "2026-06-01T00:00:00Z",
          commonDetailKeywords: ["test"],
          commonFilePaths: [],
          associatedPolicyIds: [],
        },
      ],
    };
    const signals = normalizeFailureClusters(analysis, NOW);
    assert.equal(signals.length, 0);
  });

  it("clusters have correct signal type and source", () => {
    const signals = normalizeFailureClusters(baseAnalysis, NOW);
    for (const s of signals) {
      assert.equal(s.signalType, "failure_cluster");
      assert.equal(s.sourcePhase, "p13.2");
      assert.equal(s.status, "new");
    }
  });
});

// ---------------------------------------------------------------------------
// Normalisation: P13.3 policy suggestions
// ---------------------------------------------------------------------------

describe("normalizePolicySuggestions", () => {
  it("creates a signal per suggestion", () => {
    const suggestions: PolicySuggestion[] = [
      {
        type: "tighten",
        policyId: "pol-1",
        reason: "High deny rate suggests gap",
        evidence: { matchedCount: 10, deniedCount: 7, bypassedCount: 0, relatedFailureCount: 3 },
        confidence: 0.8,
        recommendation: "Tighten policy pol-1",
        sourceHeuristic: "H1",
      },
      {
        type: "loosen",
        policyId: "pol-2",
        reason: "Low relevance suggests loosen",
        evidence: { matchedCount: 8, deniedCount: 5, bypassedCount: 0, relatedFailureCount: 1 },
        confidence: 0.65,
        recommendation: "Loosen policy pol-2",
        sourceHeuristic: "H5",
      },
    ];

    const signals = normalizePolicySuggestions(suggestions, NOW);

    assert.equal(signals.length, 2);
    assert.equal(signals[0]!.signalType, "policy_suggestion");
    assert.equal(signals[0]!.sourcePhase, "p13.3");
    assert.equal(signals[0]!.confidence, 0.8);
    assert.ok(signals[0]!.title.includes("tighten"));
  });

  it("sets severity high for tighten and remove_rule", () => {
    const suggestions: PolicySuggestion[] = [
      {
        type: "remove_rule",
        policyId: "pol-1",
        reason: "Rule no longer needed",
        evidence: { matchedCount: 5, deniedCount: 5, bypassedCount: 0, relatedFailureCount: 0 },
        confidence: 0.9,
        recommendation: "Remove rule",
        sourceHeuristic: "H1",
      },
    ];
    const signals = normalizePolicySuggestions(suggestions, NOW);
    assert.equal(signals[0]!.severity, "high");
  });

  it("handles empty suggestions", () => {
    const signals = normalizePolicySuggestions([], NOW);
    assert.deepEqual(signals, []);
  });
});

// ---------------------------------------------------------------------------
// Normalisation: P13.4 approval friction
// ---------------------------------------------------------------------------

describe("normalizeFrictionAlerts", () => {
  const baseGates: ApprovalFriction[] = [
    { gate: "proposal", totalOccurrences: 50, deniedCount: 20, pendingCount: 10, approvedCount: 20, averageTimeToApprove: null, frictionScore: 0.6 },
    { gate: "file_scope", totalOccurrences: 30, deniedCount: 5, pendingCount: 3, approvedCount: 22, averageTimeToApprove: null, frictionScore: 0.18 },
    { gate: "verification", totalOccurrences: 5, deniedCount: 0, pendingCount: 0, approvedCount: 5, averageTimeToApprove: null, frictionScore: 0 },
    { gate: "pr", totalOccurrences: 40, deniedCount: 15, pendingCount: 10, approvedCount: 15, averageTimeToApprove: null, frictionScore: 0.55 },
    { gate: "merge", totalOccurrences: 10, deniedCount: 1, pendingCount: 0, approvedCount: 9, averageTimeToApprove: null, frictionScore: 0.06 },
  ];

  it("creates signals for gates with frictionScore > 0.3", () => {
    const report: FrictionReport = {
      gates: baseGates,
      highestFrictionGate: "proposal",
      totalApprovalsRequested: 135,
      overallFrictionScore: 0.4,
    };
    const signals = normalizeFrictionAlerts(report, NOW);
    // proposal (0.6), pr (0.55) — 2 per-gate signals + 1 overall = 3
    assert.equal(signals.length, 3);
    assert.ok(signals.every((s) => s.signalType === "friction_alert"));
    assert.ok(signals.every((s) => s.sourcePhase === "p13.4"));
  });

  it("skips gates with frictionScore <= 0.3", () => {
    const report: FrictionReport = {
      gates: [baseGates[1]!], // file_scope: 0.18
      highestFrictionGate: null,
      totalApprovalsRequested: 30,
      overallFrictionScore: 0.18,
    };
    const signals = normalizeFrictionAlerts(report, NOW);
    assert.equal(signals.length, 0);
  });

  it("creates overall alert when overallFrictionScore > 0.3", () => {
    const report: FrictionReport = {
      gates: baseGates,
      highestFrictionGate: "proposal",
      totalApprovalsRequested: 135,
      overallFrictionScore: 0.4,
    };
    const signals = normalizeFrictionAlerts(report, NOW);
    assert.ok(signals.some((s) => s.title.includes("Overall")));
  });

  it("sets severity critical when overall >= 0.6", () => {
    const report: FrictionReport = {
      gates: baseGates,
      highestFrictionGate: "proposal",
      totalApprovalsRequested: 100,
      overallFrictionScore: 0.65,
    };
    const signals = normalizeFrictionAlerts(report, NOW);
    const overall = signals.find((s) => s.title.includes("Overall"));
    assert.equal(overall?.severity, "critical");
  });
});

// ---------------------------------------------------------------------------
// Aggregate normalisation with dedup
// ---------------------------------------------------------------------------

describe("normalizeAllP13Outputs", () => {
  it("produces signals from all four P13 modules", () => {
    const analytics: LedgerAnalytics = {
      totalRuns: 100,
      byOutcome: { completed: 40, failed: 30, cancelled: 20, denied: 10 },
      byRiskLevel: { low: 20, medium: 40, high: 30, critical: 10 },
      approvalRate: 0.3,
      averageRiskScore: 65,
      timeframeDays: 90,
      trendDirection: "degrading",
    };
    const failureAnalysis: FailureAnalysis = {
      total: 10,
      clusters: [
        {
          failureType: "approval_denied",
          count: 6,
          recentTimestamp: "2026-07-01T00:00:00Z",
          commonDetailKeywords: ["denied"],
          commonFilePaths: [],
          associatedPolicyIds: [],
        },
      ],
      dominantType: "approval_denied",
      recurringFilePaths: [],
      recurringFilePathCounts: {},
      timeframeDays: 30,
    };

    const signals = normalizeAllP13Outputs(
      [],
      analytics,
      [],
      failureAnalysis,
      [],
      { gates: [], highestFrictionGate: null, totalApprovalsRequested: 0, overallFrictionScore: 0 },
      NOW,
    );

    assert.ok(signals.some((s) => s.sourcePhase === "p13.1"));
    assert.ok(signals.some((s) => s.sourcePhase === "p13.2"));
    assert.equal(signals.filter((s) => s.sourcePhase === "p13.3").length, 0); // no policy suggestions
    assert.equal(signals.filter((s) => s.sourcePhase === "p13.4").length, 0); // no friction alerts
  });

  it("deduplicates against existing signals", () => {
    const analytics: LedgerAnalytics = {
      totalRuns: 100,
      byOutcome: { completed: 50, failed: 20, cancelled: 20, denied: 10 },
      byRiskLevel: { low: 20, medium: 40, high: 30, critical: 10 },
      approvalRate: 0.7,
      averageRiskScore: 45,
      timeframeDays: 90,
      trendDirection: "improving",
    };

    // First run — signals created
    const firstRun = normalizeAllP13Outputs([], analytics, [], {
      total: 0, clusters: [], dominantType: null, recurringFilePaths: [], recurringFilePathCounts: {}, timeframeDays: 0,
    }, [], { gates: [], highestFrictionGate: null, totalApprovalsRequested: 0, overallFrictionScore: 0 }, NOW);

    assert.ok(firstRun.length > 0);
    const improvingSignal = firstRun.find((s) => s.title.includes("improving"));
    assert.ok(improvingSignal);

    // Second run with existing signals — dedup should prevent duplicates
    const secondRun = normalizeAllP13Outputs(
      firstRun, // existing
      analytics, [], {
        total: 0, clusters: [], dominantType: null, recurringFilePaths: [], recurringFilePathCounts: {}, timeframeDays: 0,
      }, [], { gates: [], highestFrictionGate: null, totalApprovalsRequested: 0, overallFrictionScore: 0 }, NOW,
    );

    // All new signals from second run should be unique (no duplicates of firstRun)
    for (const candidate of secondRun) {
      const dup = firstRun.some(
        (existing) =>
          existing.status === "new" &&
          dedupKey(existing) === dedupKey(candidate),
      );
      assert.equal(dup, false, `Signal should not be duplicate: ${candidate.title}`);
    }
  });
});
