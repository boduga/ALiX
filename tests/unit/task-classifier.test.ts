import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyTask, detectResearchDepth } from "../../src/task-classifier.js";

describe("classifyTask", () => {
  it("returns research for research patterns", () => {
    assert.strictEqual(classifyTask("research auth tokens"), "research");
    assert.strictEqual(classifyTask("investigate memory leak"), "research");
    assert.strictEqual(classifyTask("analyze database schema"), "research");
  });

  it("returns research for search patterns", () => {
    assert.strictEqual(classifyTask("search for all JWT usages"), "research");
    assert.strictEqual(classifyTask("find all places using cache"), "research");
  });

  it("returns research for analyze patterns", () => {
    assert.strictEqual(classifyTask("compare auth strategies"), "research");
    assert.strictEqual(classifyTask("evaluate caching approaches"), "research");
  });

  it("still classifies other types correctly", () => {
    assert.strictEqual(classifyTask("fix the login bug"), "bugfix");
    assert.strictEqual(classifyTask("add user profile"), "feature");
    assert.strictEqual(classifyTask("refactor the auth module"), "refactor");
    assert.strictEqual(classifyTask("update the readme"), "docs");
    assert.strictEqual(classifyTask("random text"), "unknown");
  });
});

describe("detectResearchDepth", () => {
  it("detects deep research", () => {
    assert.strictEqual(detectResearchDepth("deep research on auth"), "deep");
    assert.strictEqual(detectResearchDepth("analyze auth architecture"), "deep");
    assert.strictEqual(detectResearchDepth("compare microservices strategies"), "deep");
    assert.strictEqual(detectResearchDepth("comprehensive review of security"), "deep");
  });

  it("defaults to quick", () => {
    assert.strictEqual(detectResearchDepth("research auth tokens"), "quick");
    assert.strictEqual(detectResearchDepth("find all JWT usages"), "quick");
    assert.strictEqual(detectResearchDepth("search for docs"), "quick");
  });
});