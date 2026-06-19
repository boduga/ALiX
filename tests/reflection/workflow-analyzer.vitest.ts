/**
 * P5.0c — WorkflowAnalyzer tests.
 *
 * Verifies that the WorkflowAnalyzer correctly detects stalls (entries older
 * than 24 hours) and state-level backlogs (>=3 entries in a bottleneck state).
 */

import { describe, it, expect } from "vitest";
import type { WorkflowStateEntry, WorkflowState } from "../../src/workflow/types.js";

// We import from the source file under test
import { WorkflowAnalyzer } from "../../src/reflection/workflow-analyzer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal coordinator stub exposing only the methods the analyzer calls. */
interface CoordinatorStub {
  listActive(): Promise<WorkflowStateEntry[]>;
}

function stubCoordinator(entries: WorkflowStateEntry[]): CoordinatorStub {
  return {
    listActive: async () => entries,
  };
}

function makeEntry(overrides: Partial<WorkflowStateEntry> = {}): WorkflowStateEntry {
  return {
    issueNumber: 1,
    state: "NEW" as WorkflowState,
    assignedAgent: null,
    evidenceFingerprints: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    humanGateRequired: false,
    ...overrides,
  };
}

/** Create an entry whose updatedAt is `hoursAgo` hours in the past. */
function agedEntry(
  hoursAgo: number,
  overrides: Partial<WorkflowStateEntry> = {},
): WorkflowStateEntry {
  return makeEntry({
    updatedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowAnalyzer", () => {
  // --- Empty / no-op cases ---

  it("returns empty result when no active entries exist", async () => {
    const analyzer = new WorkflowAnalyzer(stubCoordinator([]));
    const result = await analyzer.analyze();

    expect(result.observations).toEqual([]);
    expect(result.recommendations).toEqual([]);
  });

  it("does not report stall when all entries are recent", async () => {
    const entries = [
      agedEntry(1),                    // 1 hour ago
      agedEntry(5, { issueNumber: 2 }), // 5 hours ago
      agedEntry(10, { issueNumber: 3 }), // 10 hours ago
    ];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    const stallObs = result.observations.filter((o) => o.type === "workflow_stall");
    // No stall because none are over 24h and no state has >=3 entries
    expect(stallObs).toHaveLength(0);
  });

  // --- Stall detection (age > 24 hours) ---

  it("detects stall with high severity when >=3 entries are older than 24 hours", async () => {
    const entries = [
      agedEntry(25, { issueNumber: 1 }),
      agedEntry(30, { issueNumber: 2 }),
      agedEntry(48, { issueNumber: 3 }),
    ];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    const stallObs = result.observations.find(
      (o) => o.type === "workflow_stall" && o.severity === "high",
    );
    expect(stallObs).toBeDefined();
    expect(stallObs!.count).toBe(3);
    expect(stallObs!.source).toBe("WorkflowAnalyzer");
    expect(stallObs!.title).toContain("3 workflow(s) stalled");
    expect(stallObs!.detail).toContain("#1");
    expect(stallObs!.detail).toContain("#2");
    expect(stallObs!.detail).toContain("#3");
  });

  it("uses medium severity for 1-2 stalled entries", async () => {
    const entries = [
      agedEntry(25, { issueNumber: 10 }),
      agedEntry(26, { issueNumber: 20 }),
    ];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    const stallObs = result.observations.find(
      (o) => o.type === "workflow_stall" && o.severity === "medium",
    );
    expect(stallObs).toBeDefined();
    expect(stallObs!.count).toBe(2);
    expect(stallObs!.detail).toContain("#10");
    expect(stallObs!.detail).toContain("#20");
  });

  it("reports a single stalled entry with medium severity", async () => {
    const entries = [agedEntry(25, { issueNumber: 42 })];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    const stallObs = result.observations.find((o) => o.type === "workflow_stall");
    expect(stallObs).toBeDefined();
    expect(stallObs!.severity).toBe("medium");
    expect(stallObs!.count).toBe(1);
  });

  // --- State-level backlog ---

  it("detects backlog when >=3 entries are in BLOCKED state", async () => {
    const entries = [
      makeEntry({ issueNumber: 1, state: "BLOCKED" }),
      makeEntry({ issueNumber: 2, state: "BLOCKED" }),
      makeEntry({ issueNumber: 3, state: "BLOCKED" }),
    ];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    const backlogObs = result.observations.find(
      (o) => o.type === "workflow_stall" && o.detail.includes("BLOCKED"),
    );
    expect(backlogObs).toBeDefined();
    expect(backlogObs!.severity).toBe("medium");
    expect(backlogObs!.count).toBe(3);
    expect(backlogObs!.title).toContain("3 workflow(s) in BLOCKED");
  });

  it("detects backlog when >=3 entries are in EXECUTING state", async () => {
    const entries = [
      makeEntry({ issueNumber: 1, state: "EXECUTING" }),
      makeEntry({ issueNumber: 2, state: "EXECUTING" }),
      makeEntry({ issueNumber: 3, state: "EXECUTING" }),
      makeEntry({ issueNumber: 4, state: "EXECUTING" }),
    ];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    const backlogObs = result.observations.find(
      (o) => o.type === "workflow_stall" && o.detail.includes("EXECUTING"),
    );
    expect(backlogObs).toBeDefined();
    expect(backlogObs!.count).toBe(4);
  });

  it("detects backlog when >=3 entries are in UNDER_REVIEW state", async () => {
    const entries = [
      makeEntry({ issueNumber: 1, state: "UNDER_REVIEW" }),
      makeEntry({ issueNumber: 2, state: "UNDER_REVIEW" }),
      makeEntry({ issueNumber: 3, state: "UNDER_REVIEW" }),
    ];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    const backlogObs = result.observations.find(
      (o) => o.type === "workflow_stall" && o.detail.includes("UNDER_REVIEW"),
    );
    expect(backlogObs).toBeDefined();
    expect(backlogObs!.severity).toBe("medium");
  });

  it("does not report backlog when bottleneck states are below threshold", async () => {
    // 2 BLOCKED, 1 EXECUTING, 1 UNDER_REVIEW — all below 3
    const entries = [
      makeEntry({ issueNumber: 1, state: "BLOCKED" }),
      makeEntry({ issueNumber: 2, state: "BLOCKED" }),
      makeEntry({ issueNumber: 3, state: "EXECUTING" }),
      makeEntry({ issueNumber: 4, state: "UNDER_REVIEW" }),
    ];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    const backlogObs = result.observations.filter(
      (o) =>
        o.type === "workflow_stall" &&
        (o.detail.includes("BLOCKED") ||
          o.detail.includes("EXECUTING") ||
          o.detail.includes("UNDER_REVIEW")),
    );
    expect(backlogObs).toHaveLength(0);
  });

  // --- Combined detection ---

  it("detects both stall and backlog simultaneously", async () => {
    const entries = [
      // 3 stalled entries (all > 24h)
      agedEntry(30, { issueNumber: 1, state: "BLOCKED" }),
      agedEntry(36, { issueNumber: 2, state: "BLOCKED" }),
      agedEntry(48, { issueNumber: 3, state: "BLOCKED" }),
      // 3 more in BLOCKED (fresh, but adds to backlog count)
      makeEntry({ issueNumber: 4, state: "BLOCKED" }),
      makeEntry({ issueNumber: 5, state: "BLOCKED" }),
      makeEntry({ issueNumber: 6, state: "BLOCKED" }),
    ];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    // Should have a high-severity stall observation (>=3 stalled)
    const highStall = result.observations.find(
      (o) => o.type === "workflow_stall" && o.severity === "high",
    );
    expect(highStall).toBeDefined();
    expect(highStall!.count).toBe(3);

    // Should ALSO have a medium backlog observation for BLOCKED (6 total in BLOCKED)
    const backlogObs = result.observations.find(
      (o) =>
        o.type === "workflow_stall" &&
        o.severity === "medium" &&
        o.detail.includes("BLOCKED"),
    );
    expect(backlogObs).toBeDefined();
    expect(backlogObs!.count).toBe(6);

    // Total observations: 1 stall (high) + 1 backlog (medium) = 2
    expect(result.observations).toHaveLength(2);
  });

  // --- Non-bottleneck states ignored ---

  it("does not flag non-bottleneck states even with many entries", async () => {
    const entries = [
      makeEntry({ issueNumber: 1, state: "NEW" }),
      makeEntry({ issueNumber: 2, state: "NEW" }),
      makeEntry({ issueNumber: 3, state: "NEW" }),
      makeEntry({ issueNumber: 4, state: "NEW" }),
      makeEntry({ issueNumber: 5, state: "SELECTED" }),
      makeEntry({ issueNumber: 6, state: "SELECTED" }),
      makeEntry({ issueNumber: 7, state: "SELECTED" }),
    ];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    // No observations expected: NEW/SELECTED are not bottleneck states, and none stalled
    expect(result.observations).toHaveLength(0);
  });

  // --- Recommendations ---

  it("returns empty recommendations (placeholder for future enhancement)", async () => {
    const entries = [
      agedEntry(25, { issueNumber: 1 }),
      makeEntry({ issueNumber: 2, state: "BLOCKED" }),
      makeEntry({ issueNumber: 3, state: "BLOCKED" }),
      makeEntry({ issueNumber: 4, state: "BLOCKED" }),
    ];
    const analyzer = new WorkflowAnalyzer(stubCoordinator(entries));
    const result = await analyzer.analyze();

    expect(result.recommendations).toEqual([]);
  });
});
