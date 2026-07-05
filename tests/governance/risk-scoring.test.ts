// tests/governance/risk-scoring.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeRiskScore,
  scoreFileScope,
  scoreFileCount,
  scoreActionType,
  scoreVerification,
  scoreLabels,
  parseRiskScoreArgs,
  type ScoringInput,
  type RiskLevel,
} from "../../src/governance/risk-scoring.js";

// ---------------------------------------------------------------------------
// scoreFileScope
// ---------------------------------------------------------------------------

describe("scoreFileScope", () => {
  it("docs-only → low", () => {
    const r = scoreFileScope(["docs/README.md", "docs/guides/setup.md"]);
    assert.strictEqual(r.level, "low");
    assert.strictEqual(r.score, 10);
    assert.ok(r.description.includes("docs"));
  });

  it("tests-only → low", () => {
    const r = scoreFileScope(["tests/governance/foo.test.ts"]);
    assert.strictEqual(r.level, "low");
  });

  it("source files → medium", () => {
    const r = scoreFileScope(["src/main.ts", "src/utils/helper.ts"]);
    assert.strictEqual(r.level, "medium");
    assert.strictEqual(r.score, 40);
  });

  it("security paths → high", () => {
    const r = scoreFileScope(["src/security/auth.ts"]);
    assert.strictEqual(r.level, "high");
    assert.strictEqual(r.score, 70);
  });

  it("secrets paths → critical", () => {
    const r = scoreFileScope([".env", "infra/prod.yaml", "deploy/config.yml"]);
    assert.strictEqual(r.level, "critical");
    assert.strictEqual(r.score, 90);
  });

  it("empty files → low (no files)", () => {
    const r = scoreFileScope([]);
    assert.strictEqual(r.level, "low");
    assert.strictEqual(r.score, 0);
  });

  it("tighter .env matching — does not match src/env.ts", () => {
    const r = scoreFileScope(["src/env.ts"]);
    assert.strictEqual(r.level, "medium"); // source path, not secrets
  });
});

// ---------------------------------------------------------------------------
// scoreFileCount
// ---------------------------------------------------------------------------

describe("scoreFileCount", () => {
  it("1-3 files → low", () => {
    assert.strictEqual(scoreFileCount(1).level, "low");
    assert.strictEqual(scoreFileCount(3).level, "low");
  });
  it("4-6 files → medium", () => {
    assert.strictEqual(scoreFileCount(4).level, "medium");
    assert.strictEqual(scoreFileCount(6).level, "medium");
  });
  it("7-10 files → high", () => {
    assert.strictEqual(scoreFileCount(7).level, "high");
    assert.strictEqual(scoreFileCount(10).level, "high");
  });
  it("11+ files → critical", () => {
    assert.strictEqual(scoreFileCount(11).level, "critical");
    assert.strictEqual(scoreFileCount(50).level, "critical");
    assert.strictEqual(scoreFileCount(0).level, "low");
  });
});

// ---------------------------------------------------------------------------
// scoreActionType
// ---------------------------------------------------------------------------

describe("scoreActionType", () => {
  it("read → low", () => {
    const r = scoreActionType("read");
    assert.strictEqual(r.level, "low");
    assert.strictEqual(r.score, 5);
  });
  it("proposal → low", () => {
    assert.strictEqual(scoreActionType("proposal").level, "low");
  });
  it("edit → medium", () => {
    const r = scoreActionType("edit");
    assert.strictEqual(r.level, "medium");
    assert.strictEqual(r.score, 40);
  });
  it("create → high", () => {
    assert.strictEqual(scoreActionType("create").level, "high");
  });
  it("delete → high", () => {
    assert.strictEqual(scoreActionType("delete").level, "high");
  });
  it("destructive → critical", () => {
    const r = scoreActionType("destructive");
    assert.strictEqual(r.level, "critical");
    assert.strictEqual(r.score, 90);
  });
  it("release → critical", () => {
    assert.strictEqual(scoreActionType("release").level, "critical");
  });
});

// ---------------------------------------------------------------------------
// scoreVerification
// ---------------------------------------------------------------------------

describe("scoreVerification", () => {
  it("passed → low", () => {
    const r = scoreVerification("passed");
    assert.strictEqual(r.level, "low");
    assert.strictEqual(r.score, 5);
  });
  it("typecheck → medium", () => {
    const r = scoreVerification("typecheck");
    assert.strictEqual(r.level, "medium");
    assert.strictEqual(r.score, 35);
  });
  it("none → high", () => {
    const r = scoreVerification("none");
    assert.strictEqual(r.level, "high");
    assert.strictEqual(r.score, 65);
  });
  it("failed → critical", () => {
    const r = scoreVerification("failed");
    assert.strictEqual(r.level, "critical");
    assert.strictEqual(r.score, 90);
  });
});

// ---------------------------------------------------------------------------
// scoreLabels
// ---------------------------------------------------------------------------

describe("scoreLabels", () => {
  it("docs → low", () => {
    const r = scoreLabels(["docs"]);
    assert.strictEqual(r.level, "low");
    assert.strictEqual(r.score, 10);
  });
  it("test → low", () => {
    assert.strictEqual(scoreLabels(["test"]).level, "low");
  });
  it("bug → medium", () => {
    const r = scoreLabels(["bug"]);
    assert.strictEqual(r.level, "medium");
    assert.strictEqual(r.score, 35);
  });
  it("chore → medium", () => {
    assert.strictEqual(scoreLabels(["chore"]).level, "medium");
  });
  it("feature → high", () => {
    const r = scoreLabels(["feature"]);
    assert.strictEqual(r.level, "high");
    assert.strictEqual(r.score, 65);
  });
  it("enhancement → high", () => {
    assert.strictEqual(scoreLabels(["enhancement"]).level, "high");
  });
  it("security → critical", () => {
    const r = scoreLabels(["security"]);
    assert.strictEqual(r.level, "critical");
    assert.strictEqual(r.score, 85);
  });
  it("infra → critical", () => {
    assert.strictEqual(scoreLabels(["infra"]).level, "critical");
  });

  it("empty labels → low", () => {
    const r = scoreLabels([]);
    assert.strictEqual(r.level, "low");
  });

  it("unrecognised label → low", () => {
    const r = scoreLabels(["unknown-label"]);
    assert.strictEqual(r.level, "low");
  });

  it("multiple labels picks highest", () => {
    const r = scoreLabels(["docs", "security", "bug"]);
    assert.strictEqual(r.level, "critical"); // security dominates
    assert.strictEqual(r.score, 85);
  });
});

// ---------------------------------------------------------------------------
// computeRiskScore (integration)
// ---------------------------------------------------------------------------

describe("computeRiskScore", () => {
  it("docs-only input + read → low", () => {
    const r = computeRiskScore({
      files: ["docs/README.md", "docs/guide.md"],
      actionType: "read",
      verificationStatus: "passed",
      labels: ["docs"],
    });
    assert.strictEqual(r.level, "low");
    assert.ok(r.factors.length >= 4);
  });

  it("source change + no verification → high (max=none)", () => {
    const r = computeRiskScore({
      files: ["src/main.ts"],
      actionType: "edit",
      verificationStatus: "none",
      labels: ["feature"],
    });
    assert.strictEqual(r.level, "high");
  });

  it("security paths + edit + typecheck → high", () => {
    const r = computeRiskScore({
      files: ["src/security/auth.ts"],
      actionType: "edit",
      verificationStatus: "typecheck",
      labels: ["bug"],
    });
    assert.strictEqual(r.level, "high");
  });

  it("secrets paths → critical", () => {
    const r = computeRiskScore({
      files: [".env"],
      actionType: "edit",
      verificationStatus: "passed",
      labels: ["chore"],
    });
    assert.strictEqual(r.level, "critical");
  });

  it("large file count → critical", () => {
    const r = computeRiskScore({
      files: Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`),
      actionType: "edit",
      verificationStatus: "passed",
      labels: [],
    });
    assert.strictEqual(r.level, "critical");
    const countFactor = r.factors.find((f) => f.name === "File count");
    assert.ok(countFactor);
    assert.strictEqual(countFactor!.level, "critical");
  });

  it("failed verification → critical regardless of other factors", () => {
    const r = computeRiskScore({
      files: ["docs/README.md"],
      actionType: "read",
      verificationStatus: "failed",
      labels: ["docs"],
    });
    assert.strictEqual(r.level, "critical");
  });

  it("security label → critical", () => {
    const r = computeRiskScore({
      files: ["docs/README.md"],
      actionType: "read",
      verificationStatus: "passed",
      labels: ["security"],
    });
    assert.strictEqual(r.level, "critical");
  });

  it("deterministic: same input → same output", () => {
    const input: ScoringInput = {
      files: ["src/main.ts"],
      actionType: "edit",
      verificationStatus: "typecheck",
      labels: ["feature"],
    };
    const r1 = computeRiskScore(input);
    const r2 = computeRiskScore(input);
    assert.deepStrictEqual(r1, r2);
  });

  it("all factors low → overall low", () => {
    const r = computeRiskScore({
      files: ["docs/README.md"],
      actionType: "read",
      verificationStatus: "passed",
      labels: ["docs"],
    });
    assert.strictEqual(r.level, "low");
  });

  it("no approval workflow coupling — pure scoring only", () => {
    const r = computeRiskScore({
      files: [],
      actionType: "read",
      verificationStatus: "passed",
      labels: [],
    });
    assert.ok(r.level);
  });
});

// ---------------------------------------------------------------------------
// parseRiskScoreArgs
// ---------------------------------------------------------------------------

describe("parseRiskScoreArgs", () => {
  it("does not treat flag values as files", () => {
    const opts = parseRiskScoreArgs([
      "docs/README.md",
      "--action", "edit",
      "--verification", "passed",
      "--labels", "docs",
    ]);
    assert.deepStrictEqual(opts.files, ["docs/README.md"]);
    assert.strictEqual(opts.action, "edit");
    assert.strictEqual(opts.verification, "passed");
    assert.deepStrictEqual(opts.labels, ["docs"]);
  });

  it("handles --json flag", () => {
    const opts = parseRiskScoreArgs(["--json", "file.ts"]);
    assert.strictEqual(opts.json, true);
    assert.deepStrictEqual(opts.files, ["file.ts"]);
  });

  it("empty args returns defaults", () => {
    const opts = parseRiskScoreArgs([]);
    assert.strictEqual(opts.action, "read");
    assert.strictEqual(opts.verification, "none");
    assert.deepStrictEqual(opts.labels, []);
    assert.strictEqual(opts.json, false);
  });

  it("parses --files flag and consumes subsequent tokens", () => {
    const opts = parseRiskScoreArgs([
      "--files", "src/main.ts", "src/utils.ts",
      "--action", "edit",
    ]);
    assert.deepStrictEqual(opts.files, ["src/main.ts", "src/utils.ts"]);
    assert.strictEqual(opts.action, "edit");
  });

  it("positional args also treated as files", () => {
    const opts = parseRiskScoreArgs(["src/main.ts", "--json"]);
    assert.deepStrictEqual(opts.files, ["src/main.ts"]);
    assert.strictEqual(opts.json, true);
  });
});
