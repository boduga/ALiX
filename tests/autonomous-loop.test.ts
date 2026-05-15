import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyTask } from "../src/task-classifier.js";

describe("autonomous loop exit conditions", () => {
  it("bugfix: uses classifyTask for task type", () => {
    const taskType = classifyTask("fix the null pointer exception");
    assert.strictEqual(taskType, "bugfix");
  });

  it("feature: uses classifyTask for task type", () => {
    const taskType = classifyTask("add OAuth login to the app");
    assert.strictEqual(taskType, "feature");
  });

  it("refactor: uses classifyTask for task type", () => {
    const taskType = classifyTask("extract the payment logic into a service");
    assert.strictEqual(taskType, "refactor");
  });

  it("unknown task defaults to checking tests", () => {
    const taskType = classifyTask("do something with the codebase");
    assert.strictEqual(taskType, "unknown");
  });

  it("docs task skips verification", () => {
    const taskType = classifyTask("update the README with new steps");
    assert.strictEqual(taskType, "docs");
  });
});