// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { runHorizons } from "../benchmark/harness.js";
import {
  syntheticRowToUniversal,
  realModelRowToUniversal,
  toUniversalRows,
  shadowReportToUniversal,
  compareUniversalRows,
  checkUniversalInvariants,
  assertLiveSendBar,
  renderUniversalTable,
} from "../benchmark/universal-row.js";
import type { SessionShadowReport } from "../benchmark/session-shadow.js";

function harnessRow(substrate: "A_full_history" | "B_summary_fixed" | "C_state" | "D_hybrid") {
  const report = runHorizons({ seed: 42, horizons: [10] });
  return report.rows.find((r) => r.substrate === substrate)!;
}

describe("benchmark universal-row — one schema for all harnesses", () => {
  it("converts synthetic rows, preserving accuracy and tokens", () => {
    const u = syntheticRowToUniversal(harnessRow("D_hybrid"));
    expect(u.source).toBe("synthetic");
    expect(u.subject).toContain("maintenance");
    expect(u.seed).toBe(42);
    expect(u.horizon).toBe(10);
    expect(u.substrate).toBe("D_hybrid");
    expect(u.model).toBeNull();
    expect(u.decisionAccuracy).toBe(1);
  });

  it("requires an explicit model label for real-model rows", () => {
    const u = realModelRowToUniversal(harnessRow("C_state"), "openrouter/test-model");
    expect(u.source).toBe("real-model");
    expect(u.model).toBe("openrouter/test-model");
  });

  it("converts whole reports via the emission point", () => {
    const report = runHorizons({ seed: 42, horizons: [10] });
    const rows = toUniversalRows(report);
    expect(rows).toHaveLength(report.rows.length);
    expect(rows.every((r) => r.source === "synthetic")).toBe(true);
    expect(toUniversalRows(report, "m")[0]?.source).toBe("real-model");
  });

  it("converts shadow reports with null accuracy (boundedness only)", () => {
    const shadow = {
      ok: true,
      sessionId: "sess-1",
      executionId: "sess-1",
      events: {
        totalEvents: 10,
        mappedEvents: 4,
        ignoredEvents: 6,
        proposedActions: 2,
        completedActions: 2,
        artifacts: 0,
      },
      state: {
        objective: "obj",
        status: "running",
        pendingActions: 0,
        activeCapabilities: 0,
        constraints: 0,
        artifacts: 0,
      },
      livePromptTokens: 5000,
      shadowPromptTokens: 200,
      deltaTokens: 4800,
      ratio: 0.04,
      bounded: true,
      sections: {
        stateChars: 400,
        observationChars: 100,
        evidenceChars: 80,
        evidenceAdmitted: 2,
        toolsCount: 0,
        historyIncluded: false,
      },
    } as SessionShadowReport;
    const u = shadowReportToUniversal(shadow);
    expect(u.source).toBe("live-session");
    expect(u.subject).toBe("sess-1");
    expect(u.seed).toBeNull();
    expect(u.decisionAccuracy).toBeNull();
    expect(u.promptTokens).toBe(200);
    expect(u.historyTokens).toBe(0);
  });

  it("compares two rows side by side, abstaining across sources", () => {
    const a = syntheticRowToUniversal(harnessRow("A_full_history"));
    const d = syntheticRowToUniversal(harnessRow("D_hybrid"));
    const cmp = compareUniversalRows(a, d);
    expect(cmp.promptRatio).toBeLessThan(1);
    expect(cmp.accuracyDelta).toBe(0);
    expect(cmp.candidateWins).toBe(true);

    const shadow = shadowReportToUniversal({
      sessionId: "s",
      shadowPromptTokens: 100,
      sections: null,
    } as unknown as SessionShadowReport);
    const cross = compareUniversalRows(a, shadow);
    expect(cross.promptRatio).toBeLessThan(1);
    expect(cross.accuracyDelta).toBeNull();
  });

  it("checks horizon-sweep invariants over mixed rows", () => {
    const report = runHorizons({ seed: 42, horizons: [10, 50, 100, 500] });
    const cRows = report.rows.filter((r) => r.substrate === "C_state").map((r) => syntheticRowToUniversal(r));
    expect(checkUniversalInvariants(cRows).bounded).toBe(true);
    const dRows = report.rows.filter((r) => r.substrate === "D_hybrid").map((r) => syntheticRowToUniversal(r));
    const inv = checkUniversalInvariants(dRows);
    expect(inv.bounded).toBe(true);
    expect(inv.accuracyFloor).toBe(true);
  });

  it("enforces the live-send parity bar, abstaining on unmeasured rows", () => {
    const a = syntheticRowToUniversal(harnessRow("A_full_history"));
    const d = syntheticRowToUniversal(harnessRow("D_hybrid"));
    expect(assertLiveSendBar(a, d).pass).toBe(true);
    const shadow = shadowReportToUniversal({
      sessionId: "s",
      shadowPromptTokens: 100,
      sections: null,
    } as unknown as SessionShadowReport);
    const abstain = assertLiveSendBar(a, shadow);
    expect(abstain.pass).toBe(false);
    expect(abstain.delta).toBeNull();
  });

  it("renders one markdown table with full columns", () => {
    const report = runHorizons({ seed: 42, horizons: [10] });
    const table = renderUniversalTable(toUniversalRows(report));
    expect(table).toContain("| source | subject |");
    expect(table).toContain("D_hybrid");
    expect(table).toContain("precision");
  });
});
