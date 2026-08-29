/**
 * delegate-driver.vitest.ts — Phase 4 self-tests for delegate-driver
 * normalization (§25 delegate-driver matrix).
 */

import { describe, it, expect } from "vitest";
import { runDelegateCase, normalizeSubagentResult } from "../../src/evals/drivers/delegate-driver.js";
import type { SubagentResult, SubagentTask } from "../../src/config/schema.js";
import type { EvalCase } from "../../src/evals/evals-types.js";

const baseCase: EvalCase = {
  id: "behavioral.write-file",
  description: "write a file",
  driver: "delegate",
  task: "create report.md",
  objective: { kind: "file", path: "report.md", exists: true },
  expected: { objectiveLanded: true, statuses: ["success"] },
};

function fakeResult(status: SubagentResult["status"]): SubagentResult {
  return { id: "sub-1", role: "worker", status, findings: [], events: [] };
}

function fakeExecutor(result: SubagentResult) {
  return async (task: SubagentTask, _cwd: string): Promise<SubagentResult> => {
    expect(task.prompt).toBe(baseCase.task);
    return result;
  };
}

describe("delegate-driver — normalization", () => {
  it("SubagentResult.success → normalized success", async () => {
    const res = await runDelegateCase(baseCase, "/tmp/x", fakeExecutor(fakeResult("success")));
    expect(res.driver).toBe("delegate");
    expect(res.status).toBe("success");
    expect(res.cwd).toBe("/tmp/x");
  });

  it("SubagentResult.failed → normalized failed", async () => {
    const res = await runDelegateCase(baseCase, "/tmp/x", fakeExecutor(fakeResult("failed")));
    expect(res.status).toBe("failed");
  });

  it("SubagentResult.partial → normalized partial", async () => {
    const res = await runDelegateCase(baseCase, "/tmp/x", fakeExecutor(fakeResult("partial")));
    expect(res.status).toBe("partial");
  });

  it("SubagentResult.rejected → normalized rejected", async () => {
    const res = await runDelegateCase(baseCase, "/tmp/x", fakeExecutor(fakeResult("rejected")));
    expect(res.status).toBe("rejected");
  });

  it("preserves error + session id", async () => {
    const res = await runDelegateCase(baseCase, "/tmp/x", fakeExecutor({ ...fakeResult("failed"), error: "boom" }));
    expect(res.error).toBe("boom");
    expect(res.sessionId).toBe("sub-1");
  });

  it("normalizeSubagentResult is a pure function", () => {
    const r = normalizeSubagentResult(fakeResult("partial"), "/cwd");
    expect(r).toEqual({ driver: "delegate", cwd: "/cwd", status: "partial", sessionId: "sub-1", findings: [], error: undefined });
  });
});
