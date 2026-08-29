/**
 * evals-runner.vitest.ts — Phase 5/6 self-tests for the eval runner: case
 * isolation, config/seed installation, synthetic honesty fixtures, suite
 * aggregation, and persistence.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import { runEvalCase, runEvalSuite, installEvalConfig, installSeed, saveRun, loadPreviousRuns } from "../../src/evals/evals-runner.js";
import { BEHAVIORAL_CASES, SYNTHETIC_CASES } from "../../src/evals/cases/index.js";

describe("behavioral case suite structure", () => {
  it("has EVAL-001..007 with stable kebab-case ids", () => {
    const ids = BEHAVIORAL_CASES.map((c) => c.id);
    expect(ids).toContain("behavioral.write-file");
    expect(ids).toContain("behavioral.patch-application");
    expect(ids).toContain("behavioral.block-replacement");
    expect(ids).toContain("behavioral.read-only");
    expect(ids).toContain("behavioral.unmet-write-zero-attempts");
    expect(ids).toContain("behavioral.forbidden-path-write");
    expect(ids).toContain("behavioral.partial-objective");
    for (const c of BEHAVIORAL_CASES) {
      expect(c.id).toMatch(/^behavioral\.[a-z0-9-]+$/);
      expect(c.task.length).toBeGreaterThan(0);
      expect(c.expected.statuses.length).toBeGreaterThan(0);
    }
  });

  it("has distinct stable ids", () => {
    const ids = BEHAVIORAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("installEvalConfig / installSeed", () => {
  it("writes a scripted-mock config", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-test-"));
    try {
      installEvalConfig(dir);
      const cfg = JSON.parse(readFileSync(join(dir, ".alix", "config.json"), "utf8"));
      expect(cfg.models.default.provider).toBe("scripted-mock");
      expect(cfg.permissions.default).toBe("allow");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lays down seed files and creates parents", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-test-"));
    try {
      installSeed(dir, { "src/util.ts": "export const x = 1;\n" });
      expect(existsSync(join(dir, "src", "util.ts"))).toBe(true);
      expect(readFileSync(join(dir, "src", "util.ts"), "utf8")).toBe("export const x = 1;\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("synthetic honesty fixtures", () => {
  it("false-success: objective not landed, reported success → dishonest, fail", async () => {
    const fixture = SYNTHETIC_CASES.find((c) => c.id === "behavioral.synthetic-false-success")!;
    const res = await runEvalCase(fixture);
    expect(res.objective.landed).toBe(false);
    expect(res.status.actual).toBe("success");
    expect(res.status.honest).toBe(false);
    expect(res.verdict).toBe("fail");
  });

  it("false-failure: objective landed, reported failed → dishonest, fail", async () => {
    const fixture = SYNTHETIC_CASES.find((c) => c.id === "behavioral.synthetic-false-failure")!;
    const res = await runEvalCase(fixture);
    expect(res.objective.landed).toBe(true);
    expect(res.status.actual).toBe("failed");
    expect(res.status.honest).toBe(false);
    expect(res.verdict).toBe("fail");
  });
});

describe("runEvalSuite", () => {
  it("runs only the requested driver", async () => {
    const onlyDelegate = [BEHAVIORAL_CASES[0]];
    const run = await runEvalSuite(onlyDelegate, { driver: "delegate" });
    expect(run.driver).toBe("delegate");
    expect(run.results.length).toBe(1);
    expect(run.summary.total).toBe(1);
  });

  it("aggregates and summarizes a mixed suite of synthetic fixtures", async () => {
    const run = await runEvalSuite([...SYNTHETIC_CASES], { driver: "delegate" });
    expect(run.summary.total).toBe(2);
    expect(run.summary.failed).toBe(2);
    expect(run.summary.passed).toBe(0);
    expect(run.summary.honest).toBe(0);
    expect(run.summary.objectiveLanded).toBe(1); // false-failure fixture lands
  });
});

describe("persistence", () => {
  it("saveRun + loadPreviousRuns round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-test-"));
    try {
      const run = {
        runId: "run-abc",
        startedAt: "t0",
        finishedAt: "t1",
        suite: "behavioral" as const,
        driver: "both" as const,
        results: [],
        summary: { total: 0, passed: 0, failed: 0, objectiveLanded: 0, honest: 0, durationMs: 1 },
      };
      const file = saveRun(dir, run);
      expect(existsSync(file)).toBe(true);
      expect(readdirSync(join(dir, ".alix", "evals")).length).toBe(1);
      const loaded = loadPreviousRuns(dir);
      expect(loaded.length).toBe(1);
      expect(loaded[0].runId).toBe("run-abc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
