// tests/governance/failure-clustering.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeFailureAnalysis,
  computeTimeframeDays,
  extractWords,
  failureSeverityForType,
} from "../../src/governance/failure-clustering.js";
import type { FailureRecord } from "../../src/governance/failure-memory.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  overrides: Partial<FailureRecord> & { timestamp: string },
): FailureRecord {
  return {
    runId: "run-001",
    issueId: "issue-001",
    failureType: "test_failure",
    detail: "Some failure detail",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// failureSeverityForType
// ---------------------------------------------------------------------------

describe("failureSeverityForType", () => {
  it("approval_denied returns high", () => {
    assert.strictEqual(failureSeverityForType("approval_denied"), "high");
  });

  it("pr_rejected returns high", () => {
    assert.strictEqual(failureSeverityForType("pr_rejected"), "high");
  });

  it("medium severity types return medium", () => {
    assert.strictEqual(failureSeverityForType("policy_denied"), "medium");
    assert.strictEqual(
      failureSeverityForType("file_scope_violation"),
      "medium",
    );
    assert.strictEqual(failureSeverityForType("blocked_command"), "medium");
  });

  it("low severity types return low", () => {
    assert.strictEqual(
      failureSeverityForType("verification_timeout"),
      "low",
    );
    assert.strictEqual(failureSeverityForType("test_failure"), "low");
  });
});

// ---------------------------------------------------------------------------
// computeTimeframeDays
// ---------------------------------------------------------------------------

describe("computeTimeframeDays", () => {
  it("returns 0 for empty records", () => {
    assert.strictEqual(computeTimeframeDays([]), 0);
  });

  it("returns 0 for a single record", () => {
    const records = [makeRecord({ timestamp: "2026-07-04T12:00:00Z" })];
    assert.strictEqual(computeTimeframeDays(records), 0);
  });

  it("returns 0 for two records on the same day", () => {
    const records = [
      makeRecord({ timestamp: "2026-07-04T10:00:00Z" }),
      makeRecord({ timestamp: "2026-07-04T12:00:00Z" }),
    ];
    assert.strictEqual(computeTimeframeDays(records), 0);
  });

  it("returns 3 for records 3 days apart", () => {
    const records = [
      makeRecord({ timestamp: "2026-07-01T12:00:00Z" }),
      makeRecord({ timestamp: "2026-07-04T12:00:00Z" }),
    ];
    assert.strictEqual(computeTimeframeDays(records), 3);
  });

  it("returns 10 for records 10 days apart", () => {
    const records = [
      makeRecord({ timestamp: "2026-06-24T12:00:00Z" }),
      makeRecord({ timestamp: "2026-07-04T12:00:00Z" }),
    ];
    assert.strictEqual(computeTimeframeDays(records), 10);
  });

  it("handles unsorted timestamps", () => {
    const records = [
      makeRecord({ timestamp: "2026-07-10T12:00:00Z" }),
      makeRecord({ timestamp: "2026-07-01T12:00:00Z" }),
      makeRecord({ timestamp: "2026-07-05T12:00:00Z" }),
    ];
    assert.strictEqual(computeTimeframeDays(records), 9);
  });
});

// ---------------------------------------------------------------------------
// extractWords
// ---------------------------------------------------------------------------

describe("extractWords", () => {
  it("returns empty array for empty details", () => {
    assert.deepStrictEqual(extractWords([]), []);
  });

  it("returns empty array for only stop words and short words", () => {
    assert.deepStrictEqual(extractWords(["the fox is in the box"]), []);
  });

  it("extracts keywords sorted by frequency descending", () => {
    const result = extractWords([
      "failed to connect to database server",
      "connection timeout on database server",
    ]);
    assert.deepStrictEqual(result, [
      "database",
      "server",
      "connect",
      "connection",
      "failed",
    ]);
  });

  it("sorts tie-breaking keywords alphabetically", () => {
    const result = extractWords(["apple banana cherry date"]);
    assert.deepStrictEqual(result, ["apple", "banana", "cherry", "date"]);
  });

  it("filters words shorter than 4 characters", () => {
    const result = extractWords([
      "a an the is it of to in on at be he we",
    ]);
    assert.deepStrictEqual(result, []);
  });

  it("limits output to top 5 keywords", () => {
    const result = extractWords([
      "one two three four five six seven eight nine ten",
    ]);
    assert.strictEqual(result.length, 5);
  });

  it("filters stop words from output", () => {
    const result = extractWords([
      "this file could not be found about that",
    ]);
    // "file", "this", "could", "about", "that" are all stop words
    // "found" is >= 4 chars and not a stop word
    assert.deepStrictEqual(result, ["found"]);
  });
});

// ---------------------------------------------------------------------------
// computeFailureAnalysis
// ---------------------------------------------------------------------------

describe("computeFailureAnalysis", () => {
  it("returns empty analysis for no records", () => {
    const analysis = computeFailureAnalysis([]);
    assert.strictEqual(analysis.total, 0);
    assert.deepStrictEqual(analysis.clusters, []);
    assert.strictEqual(analysis.dominantType, null);
    assert.deepStrictEqual(analysis.recurringFilePaths, []);
    assert.deepStrictEqual(analysis.recurringFilePathCounts, {});
    assert.strictEqual(analysis.timeframeDays, 0);
  });

  it("produces one cluster for a single record", () => {
    const records = [makeRecord({ timestamp: "2026-07-04T12:00:00Z" })];
    const analysis = computeFailureAnalysis(records);
    assert.strictEqual(analysis.total, 1);
    assert.strictEqual(analysis.clusters.length, 1);
    assert.strictEqual(analysis.clusters[0].count, 1);
    assert.strictEqual(analysis.clusters[0].failureType, "test_failure");
    assert.strictEqual(analysis.dominantType, "test_failure");
  });

  it("groups records by failureType", () => {
    const records = [
      makeRecord({
        failureType: "policy_denied" as const,
        detail: "Policy blocked",
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        detail: "Test assertion failed",
        timestamp: "2026-07-02T12:00:00Z",
      }),
      makeRecord({
        failureType: "policy_denied" as const,
        detail: "Policy blocked again",
        timestamp: "2026-07-03T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    assert.strictEqual(analysis.total, 3);
    assert.strictEqual(analysis.clusters.length, 2);

    const types = analysis.clusters.map((c) => c.failureType);
    assert.ok(types.includes("policy_denied"));
    assert.ok(types.includes("test_failure"));
  });

  it("counts per cluster are correct", () => {
    const records = [
      makeRecord({
        failureType: "approval_denied" as const,
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "approval_denied" as const,
        timestamp: "2026-07-02T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        timestamp: "2026-07-03T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        timestamp: "2026-07-04T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        timestamp: "2026-07-05T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    assert.strictEqual(analysis.total, 5);

    const clusterMap = new Map(
      analysis.clusters.map((c) => [c.failureType, c.count]),
    );
    assert.strictEqual(clusterMap.get("approval_denied"), 2);
    assert.strictEqual(clusterMap.get("test_failure"), 3);
  });

  it("dominantType is the largest cluster", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        timestamp: "2026-07-02T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        timestamp: "2026-07-03T12:00:00Z",
      }),
      makeRecord({
        failureType: "policy_denied" as const,
        timestamp: "2026-07-04T12:00:00Z",
      }),
      makeRecord({
        failureType: "approval_denied" as const,
        timestamp: "2026-07-05T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    assert.strictEqual(analysis.dominantType, "test_failure");
  });

  it("dominantType tie-breaks alphabetically when counts equal", () => {
    const records = [
      makeRecord({
        failureType: "policy_denied" as const,
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        timestamp: "2026-07-02T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    // Both have count 1, alphabetically "policy_denied" < "test_failure"
    assert.strictEqual(analysis.dominantType, "policy_denied");
  });

  it("clusters with equal counts sort alphabetically by failureType", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "approval_denied" as const,
        timestamp: "2026-07-02T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    assert.strictEqual(analysis.clusters.length, 2);
    // Both have count 1, so sorted alphabetically
    assert.strictEqual(analysis.clusters[0].failureType, "approval_denied");
    assert.strictEqual(analysis.clusters[1].failureType, "test_failure");
  });

  it("records recentTimestamp as the maximum timestamp in cluster", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        detail: "First failure",
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        detail: "Second failure",
        timestamp: "2026-07-10T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    assert.strictEqual(analysis.clusters.length, 1);
    assert.strictEqual(
      analysis.clusters[0].recentTimestamp,
      "2026-07-10T12:00:00Z",
    );
  });

  it("extracts commonDetailKeywords per cluster", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        detail: "database connection timeout",
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        detail: "database server timeout",
        timestamp: "2026-07-02T12:00:00Z",
      }),
      makeRecord({
        failureType: "policy_denied" as const,
        detail: "policy scope violation detected",
        timestamp: "2026-07-03T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);

    const tfCluster = analysis.clusters.find(
      (c) => c.failureType === "test_failure",
    );
    assert.ok(tfCluster);
    assert.ok(tfCluster.commonDetailKeywords.includes("database"));
    assert.ok(tfCluster.commonDetailKeywords.includes("timeout"));

    const pdCluster = analysis.clusters.find(
      (c) => c.failureType === "policy_denied",
    );
    assert.ok(pdCluster);
    assert.ok(pdCluster.commonDetailKeywords.includes("policy"));
    assert.ok(pdCluster.commonDetailKeywords.includes("scope"));
    assert.ok(pdCluster.commonDetailKeywords.includes("violation"));
    assert.ok(pdCluster.commonDetailKeywords.includes("detected"));
  });

  it("collects commonFilePaths per cluster sorted by frequency then alphabetically", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: ["src/auth/login.ts", "src/db/query.ts"],
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: ["src/auth/login.ts"],
        timestamp: "2026-07-02T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    const cluster = analysis.clusters[0];
    // "src/auth/login.ts" appears 2 times, "src/db/query.ts" appears 1 time
    // Sorted by desc freq: login.ts first, then query.ts
    assert.strictEqual(cluster.commonFilePaths[0], "src/auth/login.ts");
    assert.strictEqual(cluster.commonFilePaths[1], "src/db/query.ts");
  });

  it("collects associatedPolicyIds deduplicated and sorted alphabetically", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        policyIds: ["p3", "p1"],
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        policyIds: ["p2", "p1"],
        timestamp: "2026-07-02T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    const cluster = analysis.clusters[0];
    assert.deepStrictEqual(cluster.associatedPolicyIds, ["p1", "p2", "p3"]);
  });

  it("detects recurringFilePaths across all records (count >= 2)", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: ["src/auth/login.ts"],
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "policy_denied" as const,
        filePaths: ["src/auth/login.ts"],
        timestamp: "2026-07-02T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: ["src/db/query.ts"],
        timestamp: "2026-07-03T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    assert.ok(analysis.recurringFilePaths.includes("src/auth/login.ts"));
    assert.ok(!analysis.recurringFilePaths.includes("src/db/query.ts"));
  });

  it("recurringFilePathCounts reflects correct counts", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: ["src/auth/login.ts", "src/db/query.ts"],
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "policy_denied" as const,
        filePaths: ["src/auth/login.ts"],
        timestamp: "2026-07-02T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: ["src/db/query.ts"],
        timestamp: "2026-07-03T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    assert.strictEqual(
      analysis.recurringFilePathCounts["src/auth/login.ts"],
      2,
    );
    assert.strictEqual(analysis.recurringFilePathCounts["src/db/query.ts"], 2);
  });

  it("recurringFilePaths sorted by desc count then alphabetically", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "policy_denied" as const,
        filePaths: ["src/a.ts"],
        timestamp: "2026-07-02T12:00:00Z",
      }),
      makeRecord({
        failureType: "approval_denied" as const,
        filePaths: ["src/b.ts"],
        timestamp: "2026-07-03T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    // a.ts appears 2 times, b.ts 2 times, c.ts 1 time
    // a.ts and b.ts both have count 2, so sorted alphabetically
    // c.ts has count 1, so not recurring
    assert.deepStrictEqual(analysis.recurringFilePaths, [
      "src/a.ts",
      "src/b.ts",
    ]);
    assert.strictEqual(analysis.recurringFilePathCounts["src/a.ts"], 2);
    assert.strictEqual(analysis.recurringFilePathCounts["src/b.ts"], 2);
  });

  it("produces 7 clusters when all failure types present", () => {
    const failureTypes: FailureRecord["failureType"][] = [
      "policy_denied",
      "file_scope_violation",
      "blocked_command",
      "verification_timeout",
      "test_failure",
      "approval_denied",
      "pr_rejected",
    ];
    const records = failureTypes.map((ft, i) =>
      makeRecord({
        failureType: ft,
        timestamp: `2026-07-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
      }),
    );
    const analysis = computeFailureAnalysis(records);
    assert.strictEqual(analysis.clusters.length, 7);
    assert.strictEqual(analysis.total, 7);
  });

  it("deterministic output for identical input", () => {
    const records = [
      makeRecord({
        failureType: "policy_denied" as const,
        detail: "blocked",
        filePaths: ["src/x.ts"],
        policyIds: ["p1"],
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        detail: "failed",
        filePaths: ["src/y.ts"],
        policyIds: ["p2"],
        timestamp: "2026-07-02T12:00:00Z",
      }),
    ];

    const first = computeFailureAnalysis(records);
    const second = computeFailureAnalysis(records);
    assert.deepStrictEqual(first, second);
  });

  it("returns empty clusters for records with empty filePaths and policyIds", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: [],
        policyIds: [],
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: [],
        policyIds: [],
        timestamp: "2026-07-02T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    const cluster = analysis.clusters[0];
    assert.deepStrictEqual(cluster.commonFilePaths, []);
    assert.deepStrictEqual(cluster.associatedPolicyIds, []);
    assert.deepStrictEqual(analysis.recurringFilePaths, []);
  });

  it("handles undefined filePaths and policyIds gracefully", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        timestamp: "2026-07-01T12:00:00Z",
        // filePaths and policyIds intentionally undefined
      }),
      makeRecord({
        failureType: "test_failure" as const,
        timestamp: "2026-07-02T12:00:00Z",
        // filePaths and policyIds intentionally undefined
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    const cluster = analysis.clusters[0];
    assert.deepStrictEqual(cluster.commonFilePaths, []);
    assert.deepStrictEqual(cluster.associatedPolicyIds, []);
    assert.deepStrictEqual(analysis.recurringFilePaths, []);
  });

  it("filters empty strings from filePaths and policyIds", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: [""],
        policyIds: [""],
        timestamp: "2026-07-01T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    const cluster = analysis.clusters[0];
    assert.deepStrictEqual(cluster.commonFilePaths, []);
    assert.deepStrictEqual(cluster.associatedPolicyIds, []);
  });

  it("computeTimeframeDays is consistent with analysis timeframeDays", () => {
    const records = [
      makeRecord({ timestamp: "2026-06-20T12:00:00Z" }),
      makeRecord({ timestamp: "2026-07-04T12:00:00Z" }),
    ];
    const analysis = computeFailureAnalysis(records);
    const direct = computeTimeframeDays(records);
    assert.strictEqual(analysis.timeframeDays, direct);
    assert.strictEqual(analysis.timeframeDays, 14);
  });

  it("commonFilePaths caps at top 5", () => {
    const records = [
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: [
          "src/a.ts",
          "src/b.ts",
          "src/c.ts",
          "src/d.ts",
          "src/e.ts",
          "src/f.ts",
        ],
        timestamp: "2026-07-01T12:00:00Z",
      }),
      makeRecord({
        failureType: "test_failure" as const,
        filePaths: [
          "src/a.ts",
          "src/b.ts",
          "src/c.ts",
          "src/d.ts",
          "src/e.ts",
          "src/f.ts",
        ],
        timestamp: "2026-07-02T12:00:00Z",
      }),
    ];
    const analysis = computeFailureAnalysis(records);
    const cluster = analysis.clusters[0];
    assert.strictEqual(cluster.commonFilePaths.length, 5);
  });
});
