import { describe, it, expect } from "vitest";
import { buildOutcomeReportId } from "../../src/executive/outcome-report-id.js";

describe("buildOutcomeReportId", () => {
  it("produces sanitized ID from planId and ISO timestamp", () => {
    expect(buildOutcomeReportId("plan-abc", "2026-06-25T12:00:00.000Z"))
      .toBe("outcome-plan-abc-20260625T120000000Z");
  });

  it("strips dashes, colons, and dots from the timestamp", () => {
    expect(buildOutcomeReportId("plan-1", "2026-01-01T00:00:00.000Z"))
      .toBe("outcome-plan-1-20260101T000000000Z");
  });

  it("preserves planId verbatim (assumes planIds are filesystem-safe)", () => {
    expect(buildOutcomeReportId("plan_with_underscores", "2026-06-25T12:00:00.000Z"))
      .toBe("outcome-plan_with_underscores-20260625T120000000Z");
  });
});
