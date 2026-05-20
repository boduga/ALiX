import { describe, it } from "node:test";
import assert from "node:assert";
import { ContextStage, ContextPipeline } from "../../src/repomap/context-pipeline.js";

describe("ContextPipeline", () => {
  it("has a run method", () => {
    const pipeline = new ContextPipeline([]);
    assert.equal(typeof pipeline.run, "function");
  });

  it("runs empty pipeline", async () => {
    const pipeline = new ContextPipeline([]);
    const result = await pipeline.run("input");
    assert.equal(result, "input");
  });

  it("runs stages in order", async () => {
    const log: string[] = [];
    const pipeline = new ContextPipeline([
      { name: "first", process: async (i) => { log.push("first"); return `${i}-first`; } },
      { name: "second", process: async (i) => { log.push("second"); return `${i}-second`; } },
    ]);
    const result = await pipeline.run("start");
    assert.equal(result, "start-first-second");
    assert.deepEqual(log, ["first", "second"]);
  });

  it("stageNames returns names", () => {
    const pipeline = new ContextPipeline([
      { name: "one", process: async () => {} },
      { name: "two", process: async () => {} },
    ]);
    assert.deepEqual(pipeline.stageNames, ["one", "two"]);
  });
});