/**
 * main-loop-driver.vitest.ts — Phase 4 self-tests for main-loop-driver
 * normalization (§25 main-loop-driver matrix).
 */

import { describe, it, expect } from "vitest";
import { runMainLoopCase, normalizeRunResult } from "../../src/evals/drivers/main-loop-driver.js";
import type { RunResult } from "../../src/run.js";
import type { EvalCase } from "../../src/evals/evals-types.js";

const baseCase: EvalCase = {
  id: "behavioral.read-only",
  description: "read-only task",
  driver: "main-loop",
  task: "describe the repo",
  objective: { kind: "file", path: "report.md", exists: false },
  expected: { objectiveLanded: true, statuses: ["completed"] },
};

function fakeResult(reason: RunResult["reason"]): RunResult {
  return { sessionId: "sess-1", summary: "done", reason };
}

function fakeExecutor(result: RunResult) {
  return async (_cwd: string, task: string): Promise<RunResult> => {
    expect(task).toBe(baseCase.task);
    return result;
  };
}

describe("main-loop-driver — normalization", () => {
  it("RunResult.completed → normalized reason=completed", async () => {
    const res = await runMainLoopCase(baseCase, "/tmp/x", fakeExecutor(fakeResult("completed")));
    expect(res.driver).toBe("main-loop");
    expect(res.reason).toBe("completed");
    expect(res.cwd).toBe("/tmp/x");
  });

  it("RunResult.completed_unverified → normalized reason=completed_unverified", async () => {
    const res = await runMainLoopCase(baseCase, "/tmp/x", fakeExecutor(fakeResult("completed_unverified")));
    expect(res.reason).toBe("completed_unverified");
  });

  it("RunResult.max_repairs → normalized reason=max_repairs", async () => {
    const res = await runMainLoopCase(baseCase, "/tmp/x", fakeExecutor(fakeResult("max_repairs")));
    expect(res.reason).toBe("max_repairs");
  });

  it("preserves sessionId, summary, runId", async () => {
    const res = await runMainLoopCase(baseCase, "/tmp/x", fakeExecutor({ sessionId: "s", summary: "sum", reason: "completed", runId: "r-1" }));
    expect(res.sessionId).toBe("s");
    expect(res.summary).toBe("sum");
    expect(res.runId).toBe("r-1");
  });

  it("normalizeRunResult is a pure function", () => {
    const r = normalizeRunResult({ sessionId: "s", summary: "sum", reason: "max_repairs" }, "/cwd");
    expect(r).toEqual({ driver: "main-loop", cwd: "/cwd", reason: "max_repairs", summary: "sum", sessionId: "s", runId: undefined });
  });
});
