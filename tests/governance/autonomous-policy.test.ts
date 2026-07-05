// tests/governance/policy-engine.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGovernancePolicies,
  pathMatches,
  governanceMatch,
  type GovernancePolicyRule,
  type GovernanceActionContext,
} from "../../src/governance/autonomous-policy.js";

// ---------------------------------------------------------------------------
// pathMatches
// ---------------------------------------------------------------------------

describe("pathMatches", () => {
  it("exact match", () => {
    assert.strictEqual(pathMatches(".env", ".env"), true);
  });

  it("prefix with **", () => {
    assert.strictEqual(pathMatches("src/security/auth.ts", "src/security/**"), true);
    assert.strictEqual(pathMatches("deploy/prod.yaml", "deploy/**"), true);
  });

  it("non-matching prefix", () => {
    assert.strictEqual(pathMatches("src/main.ts", "deploy/**"), false);
  });

  it("**/ prefix match", () => {
    assert.strictEqual(pathMatches("some/deep/path/secrets/key.txt", "**/secrets/**"), true);
  });
});

// ---------------------------------------------------------------------------
// governanceMatch
// ---------------------------------------------------------------------------

describe("governanceMatch", () => {
  it("matches on action type", () => {
    const policy: GovernancePolicyRule = { id: "t1", description: "x", match: { actionTypes: ["issue.run"] }, decision: "deny" };
    assert.strictEqual(governanceMatch(policy, { actionType: "issue.run" }), true);
    assert.strictEqual(governanceMatch(policy, { actionType: "issue.pr" }), false);
  });

  it("matches on labels", () => {
    const policy: GovernancePolicyRule = { id: "t2", description: "x", match: { labels: ["security"] }, decision: "deny" };
    assert.strictEqual(governanceMatch(policy, { actionType: "x", labels: ["bug", "security"] }), true);
    assert.strictEqual(governanceMatch(policy, { actionType: "x", labels: ["bug"] }), false);
  });

  it("matches on repo", () => {
    const policy: GovernancePolicyRule = { id: "t3", description: "x", match: { repos: ["boduga/ALiX"] }, decision: "deny" };
    assert.strictEqual(governanceMatch(policy, { actionType: "x", repo: "boduga/ALiX" }), true);
    assert.strictEqual(governanceMatch(policy, { actionType: "x", repo: "other/repo" }), false);
  });

  it("matches on paths", () => {
    const policy: GovernancePolicyRule = { id: "t4", description: "x", match: { paths: ["src/security/**"] }, decision: "deny" };
    assert.strictEqual(governanceMatch(policy, { actionType: "x", files: ["src/security/auth.ts"] }), true);
    assert.strictEqual(governanceMatch(policy, { actionType: "x", files: ["src/main.ts"] }), false);
  });

  it("matches on maxFiles exceeding limit", () => {
    const policy: GovernancePolicyRule = { id: "t5", description: "x", match: { maxFiles: 10 }, decision: "ask" };
    assert.strictEqual(governanceMatch(policy, { actionType: "x", files: Array.from({ length: 15 }, (_, i) => `f${i}.ts`) }), true);
    assert.strictEqual(governanceMatch(policy, { actionType: "x", files: ["a.ts", "b.ts"] }), false);
  });
});

// ---------------------------------------------------------------------------
// evaluateGovernancePolicies
// ---------------------------------------------------------------------------

describe("evaluateGovernancePolicies", () => {
  const policies: GovernancePolicyRule[] = [
    { id: "deny-security", description: "Security paths denied", match: { paths: ["src/security/**"] }, decision: "deny" },
    { id: "approve-source", description: "Source changes need approval", match: { paths: ["src/**"] }, decision: "ask" },
    { id: "allow-others", description: "Default allow", match: {}, decision: "allow" },
  ];

  it("allows when only allow policy matches", () => {
    const result = evaluateGovernancePolicies({ actionType: "issue.run", files: ["README.md"] }, policies);
    assert.strictEqual(result.decision, "allow");
    assert.ok(result.matchedPolicies.includes("allow-others"));
  });

  it("denies when deny policy matches", () => {
    const result = evaluateGovernancePolicies({ actionType: "issue.run", files: ["src/security/auth.ts"] }, policies);
    assert.strictEqual(result.decision, "deny");
    assert.ok(result.reason.includes("Security"));
  });

  it("requires_approval when approval policy matches", () => {
    const result = evaluateGovernancePolicies({ actionType: "issue.run", files: ["src/main.ts"] }, policies);
    assert.strictEqual(result.decision, "requires_approval");
  });

  it("deny beats requires_approval", () => {
    const result = evaluateGovernancePolicies({ actionType: "issue.run", files: ["src/security/auth.ts", "src/main.ts"] }, policies);
    assert.strictEqual(result.decision, "deny");
    assert.ok(result.reason.includes("Security"));
  });

  it("requires_approval beats allow", () => {
    const result = evaluateGovernancePolicies({ actionType: "issue.run", files: ["src/main.ts", "README.md"] }, policies);
    assert.strictEqual(result.decision, "requires_approval");
  });

  it("no policy matched falls back to requires_approval (conservative)", () => {
    const result = evaluateGovernancePolicies({ actionType: "unknown.action" }, []);
    assert.strictEqual(result.decision, "requires_approval");
    assert.strictEqual(result.matchedPolicies.length, 0);
  });

  it("includes required approval roles when configured", () => {
    const policiesWithRole: GovernancePolicyRule[] = [
      { id: "p1", description: "Needs admin", match: {}, decision: "ask", approvalRole: "admin" },
    ];
    const result = evaluateGovernancePolicies({ actionType: "x" }, policiesWithRole);
    assert.strictEqual(result.decision, "requires_approval");
    assert.deepStrictEqual(result.requiredApprovals, ["admin"]);
  });

  it("maxFiles policy triggers on large changes", () => {
    const policies: GovernancePolicyRule[] = [
      { id: "max-files", description: "Large change needs approval", match: { maxFiles: 5 }, decision: "ask" },
      { id: "default-allow", description: "Default allow", match: {}, decision: "allow" },
    ];
    const result = evaluateGovernancePolicies({ actionType: "x", files: Array.from({ length: 10 }, (_, i) => `f${i}.ts`) }, policies);
    assert.strictEqual(result.decision, "requires_approval");
    assert.ok(result.reason.includes("Large"));
  });

  it("label-based deny policy", () => {
    const policies: GovernancePolicyRule[] = [
      { id: "deny-security-label", description: "Security labeled issues denied", match: { labels: ["security"] }, decision: "deny" },
      { id: "allow-others", description: "Default allow", match: {}, decision: "allow" },
    ];
    const result = evaluateGovernancePolicies({ actionType: "issue.run", labels: ["security"] }, policies);
    assert.strictEqual(result.decision, "deny");
    assert.strictEqual(result.requiredApprovals.length, 0);
  });
});
