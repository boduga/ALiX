import { describe, it, expect, vi } from "vitest";
import { runApprovalLoop } from "../../src/run/plan-approval.js";
import type { PlanApprovalIO, PlanDecision } from "../../src/run/plan-approval.js";

// ---------------------------------------------------------------------------
// Mock IO adapter — returns predefined decisions in sequence.
// ---------------------------------------------------------------------------
function mockIO(decisions: PlanDecision[]): {
  io: PlanApprovalIO;
  details: string[];
} {
  const details: string[] = [];
  let i = 0;
  return {
    io: {
      requestDecision: vi.fn(async () => decisions[i++] ?? "approve"),
      showPlanDetail: vi.fn(async (content: string) => {
        details.push(content);
      }),
    },
    details,
  };
}

describe("runApprovalLoop", () => {
  it("returns approved when io returns approve", async () => {
    const { io } = mockIO(["approve"]);
    const result = await runApprovalLoop(
      io,
      "/fake/plan.md",
      "# Test Plan\n\nSome plan content",
      "test-session",
      "/fake/plans",
      { write: vi.fn(), unlink: vi.fn() },
    );
    expect(result.action).toBe("approved");
    expect(result.planContent).toContain("Test Plan");
  });

  it("returns rejected when io returns reject", async () => {
    const { io } = mockIO(["reject"]);
    const result = await runApprovalLoop(
      io,
      "/fake/plan.md",
      "# Plan to reject",
      "test-session",
      "/fake/plans",
      { write: vi.fn(), unlink: vi.fn() },
    );
    expect(result.action).toBe("rejected");
  });

  it("calls showPlanDetail for detail decisions", async () => {
    const { io, details } = mockIO(["detail", "approve"]);
    await runApprovalLoop(
      io,
      "/fake/plan.md",
      "# Plan with details",
      "test-session",
      "/fake/plans",
      { write: vi.fn(), unlink: vi.fn() },
    );
    expect(details).toHaveLength(1);
    expect(details[0]).toContain("Plan with details");
  });

  it("returns rejected after 10 rounds without explicit approval", async () => {
    // 10 detail rounds exhaust the loop — no approve/reject
    const decisions: PlanDecision[] = Array(10).fill("detail");
    const { io } = mockIO(decisions);
    const result = await runApprovalLoop(
      io,
      "/fake/plan.md",
      "# Exhausted plan",
      "test-session",
      "/fake/plans",
      { write: vi.fn(), unlink: vi.fn() },
    );
    expect(result.action).toBe("rejected");
  });

  it("handles edit when editor returns null (editor not available)", async () => {
    const { io } = mockIO(["edit", "approve"]);
    // Editor will fail to launch (no $EDITOR set in test) → returns null
    // → logs error and re-loops → then gets approve
    const result = await runApprovalLoop(
      io,
      "/fake/plan.md",
      "# Editable plan",
      "test-session",
      "/fake/plans",
      { write: vi.fn(), unlink: vi.fn() },
    );
    // After edit → editor fails → re-loop → second round returns approve
    expect(result.action).toBe("approved");
  });
});
