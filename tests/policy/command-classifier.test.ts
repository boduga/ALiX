import { describe, it } from "node:test";
import assert from "node:assert";
import { CommandClassifier, type CommandRisk } from "../../src/policy/command-classifier.js";

describe("CommandClassifier", () => {
  const classifier = new CommandClassifier();

  it("classifies safe read-only commands", () => {
    const result = classifier.classify("cat src/index.ts");
    assert.equal(result.risk, "low");
    assert.ok(result.safe);
  });

  it("classifies git commands", () => {
    const result = classifier.classify("git status");
    assert.equal(result.risk, "medium");
    assert.ok(!result.safe);
  });

  it("classifies destructive commands", () => {
    const result = classifier.classify("rm -rf node_modules");
    assert.equal(result.risk, "high");
    assert.ok(!result.safe);
    assert.ok(result.tags.includes("destructive") || result.tags.includes("file-modification"));
  });

  it("extracts file paths from commands", () => {
    const result = classifier.classify("git add src/*.ts");
    assert.ok(result.paths.some(p => p.includes("src")));
  });

  it("classifies network commands", () => {
    const result = classifier.classify("curl https://api.example.com");
    assert.ok(result.networkDestination);
    assert.equal(result.networkDestination, "api.example.com");
  });

  it("classifies npm/yarn commands", () => {
    const result = classifier.classify("npm install");
    assert.equal(result.risk, "medium");
    assert.ok(result.tags.includes("dependency"));
  });

  it("classifies shell operators", () => {
    const result = classifier.classify("echo 'hi' && ls");
    assert.ok(result.hasChain);
  });
});
