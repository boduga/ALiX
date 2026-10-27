/**
 * command-classifier.test.ts
 *
 * ⚠ SCOPE OF WHAT THIS SUITE PROVES
 *
 * `CommandClassifier` classifies a shell command (risk level, category, tags,
 * paths, network destination). It does NOT deny, dispatch, or write anything.
 *
 * As of 2026-10-25 it has NO production consumer: `classifyCommand` and
 * `CommandClassifier` are re-exported from `policy/index.ts` and called only by
 * tests. `PolicyGate` enforces denies through `denyCommands`, the shell
 * whitelist, `BLOCKED_COMMANDS` and evasion patterns — none of which consult this
 * classifier. GitNexus reports `risk: UNKNOWN` for `classifyCommand` (no
 * resolvable callers); a text search confirms only the barrel re-export.
 *
 * The independent Gate E review named these tests under "VACUOUS ASSERTIONS:
 * classification is repeatedly presented as execution evidence". The finding is
 * correct about the EVIDENCE, not about the code: the tests accurately test
 * classification. What was wrong was citing them as proof that denied actions
 * are denied. That proof lives in tests/policy/policy-gate.test.ts and
 * tests/executor.test.ts.
 *
 * Do not cite this file as denied-action enforcement evidence. If the classifier
 * ever gains a production consumer, add a test that fails when that consumer
 * stops consulting it — the same mutation standard as the rest of the gate.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { CommandClassifier, type CommandRisk } from "../../src/governance/policy/command-classifier.js";

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
