import { classifyTask } from "../src/task-classifier.js";
import { describe, it } from "node:test";
import assert from "node:assert";

describe("classifyTask", () => {
  it("classifies bugfix from keywords", () => {
    const type = classifyTask("fix the null pointer exception in user.ts");
    assert.strictEqual(type, "bugfix");
  });

  it("classifies feature from keywords", () => {
    const type = classifyTask("add OAuth login to the auth module");
    assert.strictEqual(type, "feature");
  });

  it("classifies refactor from keywords", () => {
    const type = classifyTask("extract the payment logic into a separate service");
    assert.strictEqual(type, "refactor");
  });

  it("classifies docs from keywords", () => {
    const type = classifyTask("update the README with new installation steps");
    assert.strictEqual(type, "docs");
  });

  it("defaults to unknown", () => {
    const type = classifyTask("check what this file does");
    assert.strictEqual(type, "unknown");
  });
});