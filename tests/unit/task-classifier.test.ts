import { describe, it } from "node:test";
import assert from "node:assert";
import {
  classifyTask,
  detectResearchDepth,
  hasNaturalLanguageTail,
  isShellTask,
} from "../../src/task-classifier.js";

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
describe("isShellTask — command vs. prose", () => {
  const PROSE_IMPERATIVE =
    'Find every file under src/ that mentions "RunOutcome", read the three most\n' +
    "relevant, and tell me: which modules consume it and what would break if I\n" +
    "added a new required field. No edits.";

  it("still matches bare commands and argument tails", () => {
    assert.strictEqual(isShellTask("ls"), true);
    assert.strictEqual(isShellTask("pwd"), true);
    assert.strictEqual(isShellTask("cat package.json"), true);
    assert.strictEqual(isShellTask("grep foo src/"), true);
    assert.strictEqual(isShellTask("find . -name '*.ts'"), true);
    assert.strictEqual(isShellTask("du -sh ."), true);
    assert.strictEqual(isShellTask("ping -c 1 localhost"), true);
  });

  it("rejects an English imperative that merely opens with a command word", () => {
    assert.strictEqual(isShellTask(PROSE_IMPERATIVE), false);
    assert.strictEqual(isShellTask("Find all TODOs in src and summarize them"), false);
    assert.strictEqual(isShellTask("Sort the entries by creation date"), false);
  });

  it("treats flags, paths and globs as argument tokens, not prose", () => {
    assert.strictEqual(hasNaturalLanguageTail("ls -la src/"), false);
    assert.strictEqual(hasNaturalLanguageTail("cat package.json"), false);
    assert.strictEqual(hasNaturalLanguageTail("find . -name '*.ts'"), false);
    assert.strictEqual(hasNaturalLanguageTail("npm run build"), false);
  });

  it("flags three or more consecutive plain-English words", () => {
    assert.strictEqual(hasNaturalLanguageTail("echo hello"), false);
    assert.strictEqual(hasNaturalLanguageTail(PROSE_IMPERATIVE), true);
  });
});
