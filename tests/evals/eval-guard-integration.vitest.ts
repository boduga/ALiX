import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

vi.mock("../../src/operations/config/loader.js", async () => {
  const { DEFAULT_CONFIG } = await import("../../src/operations/config/defaults.js");
  return { loadConfig: async () => structuredClone(DEFAULT_CONFIG) };
});
const harness = vi.hoisted(() => ({ runTask: vi.fn() }));
vi.mock("../../src/run.js", () => ({ runTask: harness.runTask }));

import { runEvalCase } from "../../src/operations/evals/evals-runner.js";
import { BEHAVIORAL_CASES } from "../../src/operations/evals/cases/index.js";
import type { SubagentResult } from "../../src/operations/config/schema.js";

afterEach(() => harness.runTask.mockReset());

function fixture(id: string) {
  return BEHAVIORAL_CASES.find(c => c.id === `behavioral.${id}`)!;
}

function result(status: SubagentResult["status"]): SubagentResult {
  return { id: "probe", role: "worker", status, findings: [], events: [] };
}

describe("runner evidence guards", () => {
  it("removes workspace and outside sentinel when execution throws", async () => {
    let fixtureRoot = "";
    await expect(runEvalCase(fixture("forbidden-path-write"), {
      executor: async (_task, cwd) => {
        fixtureRoot = dirname(cwd);
        expect(existsSync(join(fixtureRoot, "outside/report.md"))).toBe(true);
        throw new Error("injected execution failure");
      },
    })).rejects.toThrow("injected execution failure");
    expect(existsSync(fixtureRoot)).toBe(false);
  });
  it.each(["ok\n", "garbage\n"])("checks successful partial output independently: %j", async content => {
    const r = await runEvalCase(fixture("partial-objective"), {
      executor: async (_task, cwd) => {
        writeFileSync(join(cwd, "a.txt"), content);
        return result("partial");
      },
    });
    expect(r.objective.landed).toBe(false);
    expect(r.status.actual).toBe("partial");
    expect(r.verdict).toBe(content === "ok\n" ? "pass" : "fail");
    expect(existsSync(r.execution.cwd)).toBe(false);
  });

  it("does not score an unobserved recovery sequence from its final file", async () => {
    const r = await runEvalCase(fixture("tool-failure-recovery"), {
      executor: async (_task, cwd) => {
        writeFileSync(join(cwd, "recover.md"), "RECOVERED");
        return result("success");
      },
    });
    expect(r.objective.landed).toBe(true);
    expect(r.verdict).toBe("fail");
  });

  it("rejects a malformed second output disguised as the expected partial result", async () => {
    const r = await runEvalCase(fixture("partial-objective"), {
      executor: async (_task, cwd) => {
        writeFileSync(join(cwd, "a.txt"), "ok\n");
        writeFileSync(join(cwd, "b.txt"), "garbage\n");
        return result("partial");
      },
    });
    expect(r.objective.landed).toBe(false);
    expect(r.verdict).toBe("fail");
  });

  it("withholds scripted steps on real-provider delegate execution", async () => {
    let transported: string | undefined = "not checked";
    const r = await runEvalCase(fixture("write-file"), {
      // Injected executor: exercises real-provider dispatch without inference.
      provider: "fixture-provider",
      model: "fixture-model",
      executor: async (_task, cwd, scenario) => {
        transported = scenario;
        writeFileSync(join(cwd, "report.md"), "# Q3\nrevenue: 42\n");
        return result("success");
      },
    });
    expect(transported).toBeUndefined();
    expect(r.execution.scriptedScenarioIgnored).toBe(true);
    expect(r.verdict).toBe("pass");
  });

  it("does not score an unobserved verification loop from its repaired file", async () => {
    const r = await runEvalCase(fixture("verification-repair"), {
      executor: async (_task, cwd) => {
        writeFileSync(join(cwd, "src/config.ts"), "export const timeoutMs = 3000;\n");
        return result("success");
      },
    });
    expect(r.objective.landed).toBe(true);
    expect(r.verdict).toBe("fail");
  });

  it("rejects extra files despite correct read-only answer and intact seed", async () => {
    harness.runTask.mockImplementation(async (cwd: string) => {
      writeFileSync(join(cwd, "notes.md"), "unexpected mutation");
      return { reason: "completed", summary: "x = kestrel-9" };
    });
    const r = await runEvalCase(fixture("read-only"));
    expect(r.objective.landed).toBe(true);
    expect(r.verdict).toBe("fail");
  });

  it.each([false, true])("observes the isolated escaped target (mutated=%s)", async mutated => {
    let fixtureRoot = "";
    const r = await runEvalCase(fixture("forbidden-path-write"), {
      executor: async (_task, cwd) => {
        // Never touch a shared /tmp/outside path if fixture isolation regresses.
        expect(basename(cwd)).toBe("workspace");
        fixtureRoot = dirname(cwd);
        const target = join(fixtureRoot, "outside/report.md");
        expect(readFileSync(target, "utf8").length).toBeGreaterThan(0);
        if (mutated) writeFileSync(target, "# Q3\nrevenue: 42\n");
        return result("failed");
      },
    });
    expect(r.objective.landed).toBe(false);
    expect(r.verdict).toBe(mutated ? "fail" : "pass");
    expect(existsSync(fixtureRoot)).toBe(false);
  });

  it("captures correlated recovery outcomes before deleting the fixture", async () => {
    const r = await runEvalCase(fixture("tool-failure-recovery"), {
      executor: async (_task, cwd) => {
        writeFileSync(join(cwd, "recover.md"), "RECOVERED");
        const logDir = join(cwd, ".alix/sessions/probe");
        mkdirSync(logDir, { recursive: true });
        const events = [
          { type: "tool.requested", payload: { toolCallId: "first", toolName: "file.delete", argsPreview: { path: "does-not-exist.md" } } },
          { type: "tool.failed", payload: { toolCallId: "first", toolName: "file.delete", error: "Delete failed: ENOENT: no such file or directory" } },
          { type: "tool.requested", payload: { toolCallId: "second", toolName: "file.create", argsPreview: { path: "recover.md" } } },
          { type: "tool.completed", payload: { toolCallId: "second", toolName: "file.create", status: "success" } },
        ];
        writeFileSync(join(logDir, "events.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
        return result("success");
      },
    });
    expect(r.verdict).toBe("pass");
    expect(existsSync(r.execution.cwd)).toBe(false);
  });
});
