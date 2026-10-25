/**
 * attention-metrics.vitest.ts — pins which attention measures an agent can derive
 * and which it must refuse.
 *
 * THE LINE THIS MODULE DRAWS
 *
 * M-2..M-5 are counts over durable records: an agent can compute them. M-1 is
 * human reading/comparing/deciding time: no agent can observe it. Substituting
 * agent runtime for review minutes would report machine time as review time, and
 * would look like a measurement while being a different quantity.
 *
 * There is no parameter for review minutes anywhere in this API, so the
 * substitution cannot be made by mistake.
 */

import { describe, it, expect } from "vitest";
import { deriveAttentionMeasures, loadCollectionRows } from "../../src/operations/evals/attention-metrics.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const COLLECTION = join(here, "..", "..", "benchmark", "evidence", "eval-runs", "collection-2026-10-24-final");

function row(over: Record<string, unknown> = {}) {
  return {
    verifiedSuccess: true,
    unobserved: [],
    operatorInterventions: 0,
    operatorCancellations: 0,
    ...over,
  };
}

function byId(report: ReturnType<typeof deriveAttentionMeasures>, id: string) {
  return report.measures.find(m => m.id === id)!;
}

describe("M-1 is human-required and always null", () => {
  it("never produces a number, even with rich run data", () => {
    const report = deriveAttentionMeasures([row(), row(), row()]);
    const m1 = byId(report, "M-1");
    expect(m1.value).toBeNull();
    expect(m1.provenance).toBe("human-required");
    // The refusal must state why, so nobody reads null as "not computed yet".
    expect(m1.reason).toMatch(/human/i);
    expect(m1.reason).toMatch(/machine time|different quantity/i);
  });

  it("exposes no argument through which agent runtime could be passed", () => {
    // The signature takes rows only. If someone adds a `reviewMinutes` parameter,
    // this test is where that decision gets argued rather than slipped in.
    expect(deriveAttentionMeasures.length).toBe(1);
  });
});

describe("M-3 approval touches", () => {
  it("sums operatorInterventions across runs", () => {
    const report = deriveAttentionMeasures([
      row({ operatorInterventions: 2 }),
      row({ operatorInterventions: 1 }),
      row({ operatorInterventions: 0 }),
    ]);
    expect(byId(report, "M-3").value).toBe(3);
    expect(byId(report, "M-3").observed).toBe(3);
  });

  it("is null when a run's count is unobserved, not zero", () => {
    const report = deriveAttentionMeasures([
      row({ operatorInterventions: 1 }),
      row({ operatorInterventions: null }),
    ]);
    const m3 = byId(report, "M-3");
    expect(m3.value).toBeNull();
    expect(m3.unobserved).toBe(1);
  });
});

describe("M-2 interruptions", () => {
  it("counts cancellations as observed suspensions", () => {
    const report = deriveAttentionMeasures([
      row({ operatorCancellations: 1 }),
      row({ operatorCancellations: 0 }),
    ]);
    expect(byId(report, "M-2").value).toBe(1);
  });
});

describe("M-5 reversals", () => {
  it("stays null because rows do not record reversals", () => {
    const report = deriveAttentionMeasures([row(), row()]);
    const m5 = byId(report, "M-5");
    expect(m5.value).toBeNull();
    expect(m5.reason).toMatch(/reversal/i);
  });
});

describe("M-4 refuses to report a degenerate measure", () => {
  it("returns null when every verified run shares the same structural gap", () => {
    // The real collection shape: one identical gap on all 45 rows. "Pass with a
    // gap" then equals the verified count and measures nothing.
    const shared = ["provider retries are not emitted by the event vocabulary"];
    const report = deriveAttentionMeasures([row({ unobserved: shared }), row({ unobserved: shared })]);
    const m4 = byId(report, "M-4");
    expect(m4.value).toBeNull();
    expect(m4.reason).toMatch(/structural gap|no signal/i);
  });

  it("counts when gaps differ between runs", () => {
    const report = deriveAttentionMeasures([
      row({ unobserved: ["provider retries are not emitted by the event vocabulary"] }),
      row({ unobserved: [] }),
      row({ unobserved: [] }),
    ]);
    const m4 = byId(report, "M-4");
    expect(m4.value).toBe(1);
    expect(m4.reason).toBeUndefined();
  });

  it("ignores an attention gap so it cannot inflate the measure", () => {
    // "review minutes unobserved" is the normal state of every automated run.
    // Counting it as missed evidence would make M-4 equal the run count forever.
    const report = deriveAttentionMeasures([
      row({ unobserved: ["operator active review minutes require human observation"] }),
      row({ unobserved: ["operator active review minutes require human observation"] }),
    ]);
    expect(byId(report, "M-4").value).toBe(0);
  });

  it("is null when there are no verified successes to assess", () => {
    const report = deriveAttentionMeasures([row({ verifiedSuccess: false })]);
    expect(byId(report, "M-4").value).toBeNull();
  });
});

describe("the real collection", () => {
  it("derives M-2..M-5 from committed evidence and leaves M-1 null", () => {
    const rows = loadCollectionRows(COLLECTION);
    expect(rows.length).toBeGreaterThan(0);
    const report = deriveAttentionMeasures(rows);
    expect(report.runs).toBe(45);
    expect(report.verifiedSuccesses).toBe(36);
    expect(byId(report, "M-1").value).toBeNull();
    // Zero approvals is a measured zero here: the eval config runs with
    // permissions.default = allow, so no approval path is exercised at all.
    expect(byId(report, "M-3").value).toBe(0);
    expect(byId(report, "M-3").observed).toBe(45);
    // M-4 degenerates on this data and must say so rather than report 36.
    expect(byId(report, "M-4").value).toBeNull();
  });

  it("returns an empty report rather than throwing on a missing directory", () => {
    const report = deriveAttentionMeasures(loadCollectionRows(join(here, "does-not-exist")));
    expect(report.runs).toBe(0);
    expect(report.measures.every(m => m.value === null)).toBe(true);
  });
});
