/**
 * eval-sweep-row-fields.vitest.ts — pins the Gate B row contract of the real
 * provider sweep, in a suite CI actually runs.
 *
 * `benchmark/evidence/cost/sweep-guard-evidence.test.mjs` covers the same rows
 * under `node --test`, but no CI lane invokes that directory, so a regression
 * there would only surface when someone ran the sweep by hand. The contract is
 * worth a lane: a row that silently drops `providerRetries` or reports an
 * unobserved count as `0` deflates a Gate B metric without failing anything.
 *
 * Modules are imported dynamically on purpose. The sweep is an untyped `.mjs`
 * harness script and the case list comes from built output, so a static import
 * would pull `dist` declaration files into the compilation and make `tsc`
 * refuse to write its own output (`TS5055`). Requires a built `dist`.
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";

type SweepModule = {
  sweepCases: (ids: string[], opts: { provider: string; model: string }) => Promise<Record<string, unknown>[]>;
  percentile: (values: number[], p: number) => number | null;
  summarizeLatency: (results: Array<{ durationMs?: number | null }>) => unknown;
};
type CasesModule = { BEHAVIORAL_CASES: Array<Record<string, unknown>> };

/**
 * `import()` through a variable specifier, not a literal: `tsc` includes every
 * `tests/**` file and follows literal imports, so importing build output would
 * make it refuse to write that same output (`TS5055`).
 */
const importRuntime = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

const load = async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const sweep = (await importRuntime(
    pathToFileURL(join(root, "benchmark", "evidence", "cost", "eval-case-sweep.mjs")).href,
  )) as SweepModule;
  const cases = (await importRuntime(
    pathToFileURL(join(root, "dist", "src", "operations", "evals", "cases", "index.js")).href,
  )) as CasesModule;
  return { sweep, cases };
};

const GATE_B_COUNTS = [
  "toolCalls",
  "toolCallsCompleted",
  "toolCallsFailed",
  "rejectedCalls",
  "repeatedCalls",
  "toolRetries",
  "providerRetries",
  "driverReinvocations",
  "operatorInterventions",
  "operatorCancellations",
  "operatorActiveReviewMinutes",
] as const;

describe("sweep latency arithmetic", () => {
  it("uses nearest rank and stays null with no samples", async () => {
    const { sweep } = await load();
    expect(sweep.percentile([], 50)).toBeNull();
    expect(sweep.percentile([40], 50)).toBe(40);
    expect(sweep.percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(sweep.percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(sweep.percentile([Number.NaN, 10, Number.POSITIVE_INFINITY], 95)).toBe(10);
  });

  it("summarizes case durations and never a missing one", async () => {
    const { sweep } = await load();
    expect(sweep.summarizeLatency([{}, { durationMs: null }])).toEqual({
      observed: false,
      samples: 0,
      p50Ms: null,
      p95Ms: null,
      reason: "no case duration recorded",
    });
    expect(sweep.summarizeLatency([{ durationMs: 10 }, { durationMs: 30 }, { durationMs: 20 }])).toEqual({
      observed: true,
      samples: 3,
      p50Ms: 20,
      p95Ms: 30,
    });
  });
});

describe("sweep row Gate B fields", () => {
  it("carries null counts with reasons when no session log was observed", async () => {
    const { sweep, cases } = await load();
    const id = "behavioral.sweep-row-fields";
    const fixture = {
      id,
      description: "row field contract fixture",
      driver: "delegate",
      task: "Synthetic evaluator fixture.",
      syntheticStatus: "failed",
      objective: { kind: "file", path: "missing.md", exists: true },
      expected: { objectiveLanded: false, statuses: ["failed"] },
    };
    cases.BEHAVIORAL_CASES.push(fixture);
    try {
      const [row] = await sweep.sweepCases([id], { provider: "scripted-mock", model: "mock" });
      // A synthetic fixture runs no driver, so there is no session log. Every
      // Gate B count must be unknown, never a flattering zero.
      for (const field of GATE_B_COUNTS) {
        expect(row[field], field).toBeNull();
      }
      expect(Array.isArray(row.unobserved)).toBe(true);
      expect((row.unobserved as string[]).length).toBeGreaterThan(0);
      expect(typeof row.startedAt).toBe("string");
      expect(typeof row.finishedAt).toBe("string");
      expect(typeof row.durationMs).toBe("number");
      expect(row.durationMs as number).toBeGreaterThanOrEqual(0);
    } finally {
      const at = cases.BEHAVIORAL_CASES.indexOf(fixture);
      if (at >= 0) cases.BEHAVIORAL_CASES.splice(at, 1);
    }
  });
});
