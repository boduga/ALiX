import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recommendRole } from "../../src/agents/role-mapper.js";

describe("role-mapper", () => {
  it("maps bugfix to worker with high confidence", () => {
    const result = recommendRole("bugfix", "fix the null pointer exception");
    assert.equal(result.role, "worker");
    assert.equal(result.confidence, "high");
  });

  it("maps refactor to reviewer with high confidence", () => {
    const result = recommendRole("refactor", "refactor the auth module");
    assert.equal(result.role, "reviewer");
    assert.equal(result.confidence, "high");
  });

  it("maps docs to docs_researcher with high confidence", () => {
    const result = recommendRole("docs", "update the README");
    assert.equal(result.role, "docs_researcher");
    assert.equal(result.confidence, "high");
  });

  it("maps feature with files to worker with medium confidence", () => {
    const result = recommendRole("feature", "add login to src/auth/index.ts");
    assert.equal(result.role, "worker");
    assert.equal(result.confidence, "medium");
  });

  it("maps feature without files to explorer with medium confidence", () => {
    const result = recommendRole("feature", "add user authentication feature");
    assert.equal(result.role, "explorer");
    assert.equal(result.confidence, "medium");
  });

  it("maps unknown to explorer with low confidence", () => {
    const result = recommendRole("unknown", "explore the codebase");
    assert.equal(result.role, "explorer");
    assert.equal(result.confidence, "low");
  });
});