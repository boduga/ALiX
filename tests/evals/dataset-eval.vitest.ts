/**
 * dataset-eval.vitest.ts — P4 self-tests for the dataset eval loop:
 * incident normalization, judge-score parsing, and the run/judge/skip flow
 * with stub providers (no network, no model).
 */

import { describe, it, expect } from "vitest";
import {
  runDatasetEval,
  normalizeIncident,
  parseJudgeScore,
  gateDatasetEval,
} from "../../src/evals/dataset-eval.js";
import type { ModelAdapter } from "../../src/providers/types.js";
import { stubProvider } from "../helpers/stub-provider.js";

describe("parseJudgeScore", () => {
  it("extracts the first 0..1 number and clamps", () => {
    expect(parseJudgeScore("0.85")).toBe(0.85);
    expect(parseJudgeScore("Score: 1")).toBe(1);
    expect(parseJudgeScore("I give it 0")).toBe(0);
    expect(parseJudgeScore("7 out of 10")).toBeNaN();
    expect(parseJudgeScore("no number here")).toBeNaN();
  });
});

describe("normalizeIncident", () => {
  it("accepts corpus mirror rows and plain incidents", () => {
    expect(normalizeIncident({
      datasetName: "d",
      input: { traceId: "t1", sessionId: "s", task: "fix it" },
      metadata: { errorNames: ["file.read"] },
    })).toEqual({ traceId: "t1", sessionId: "s", task: "fix it", errorNames: ["file.read"] });
    expect(normalizeIncident({ traceId: "t2", task: "do" })).toMatchObject({ traceId: "t2" });
  });

  it("rejects rows without traceId", () => {
    expect(normalizeIncident({})).toBeNull();
    expect(normalizeIncident(null)).toBeNull();
    expect(normalizeIncident({ input: {} })).toBeNull();
  });
});

describe("gateDatasetEval", () => {
  const m = (pairs: Array<[string, number]>) => new Map(pairs);
  it("promotes deltas at bar, blocks below, insufficient under count", () => {
    const base = m(Array.from({ length: 20 }, (_, i) => [`t${i}`, i % 2 === 0 ? 0.9 : 0.3]));
    const good = m(Array.from({ length: 20 }, (_, i) => [`t${i}`, i < 16 ? 0.95 : 0.3]));
    expect(gateDatasetEval(base, good).verdict).toBe("promote");
    expect(gateDatasetEval(good, base).verdict).toBe("block");
    expect(gateDatasetEval(m([["a", 1]]), m([["a", 1]])).verdict).toBe("insufficient");
  });
});
describe("runDatasetEval", () => {
  it("runs, judges, and emits score records", async () => {
    const provider = stubProvider(["fixed it"]);
    const judge = stubProvider(["0.9"]);
    const result = await runDatasetEval({
      incidents: [{ traceId: "t1", task: "fix login", errorNames: ["shell.run"] }],
      promptName: "cand",
      promptText: "You fix things.",
      provider,
      judgeProvider: judge,
    });
    expect(result.skipped).toEqual([]);
    expect(result.scores).toEqual([{ traceId: "t1", name: "eval:cand", value: 0.9 }]);
  });

  it("skips taskless incidents and unparseable judges", async () => {
    const provider = stubProvider(["answer"]);
    const judge = stubProvider(["absolutely"]);
    const result = await runDatasetEval({
      incidents: [
        { traceId: "no-task" },
        { traceId: "bad-judge", task: "do it" },
      ],
      promptName: "cand",
      promptText: "prompt",
      provider,
      judgeProvider: judge,
    });
    expect(result.scores).toEqual([]);
    expect(result.skipped.map((s) => s.traceId).sort()).toEqual(["bad-judge", "no-task"]);
  });

  it("skips on provider throw without aborting siblings", async () => {
    const flaky = {
      complete: async (req: { messages?: Array<{ content?: string }> }) => {
        if ((req.messages?.[0]?.content ?? "").includes("boom-task")) throw new Error("down");
        return { text: "ok" } as unknown as Awaited<ReturnType<ModelAdapter["complete"]>>;
      },
    } as unknown as ModelAdapter;
    const result = await runDatasetEval({
      incidents: [
        { traceId: "t-ok", task: "fine" },
        { traceId: "t-bad", task: "boom-task" },
      ],
      promptName: "cand",
      promptText: "prompt",
      provider: flaky,
      judgeProvider: stubProvider(["0.5"]),
    });
    expect(result.scores.map((s) => s.traceId)).toEqual(["t-ok"]);
    expect(result.skipped.map((s) => s.traceId)).toEqual(["t-bad"]);
  });
});
