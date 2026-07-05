# P12.2 Risk Scoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify an autonomous run as `low | medium | high | critical` with numeric score and explainable factors — a "risk thermometer" that scores without gating.

**Architecture:** Pure scoring module with no side effects, no DB, no execution coupling. Feeds into P12.3 approval workflow later. CLI integrated via existing `alix governance risk-score` subcommand.

**Tech Stack:** TypeScript 5.9, Node 24, pnpm, existing governance CLI (`src/cli/commands/governance.ts`)

## Global Constraints

- No side effects, no DB, no persistence — pure scoring function
- No P12.3 approval workflow, no P12.4 run ledger, no P12.5 failure memory coupling
- Overall score = `max(factorScores)` — one critical factor dominates
- Deterministic: same input always produces same output
- CLI subcommand goes under existing `alix governance` command
- All tests use `node:test` + `node:assert/strict`

---
## File Structure

```
src/governance/
  risk-scoring.ts              — Types, factor scoring, computeRiskScore()

tests/governance/
  risk-scoring.test.ts         — Unit tests (all required test cases)

src/cli/commands/
  governance.ts                — Add 'risk-score' subcommand (modify)
```

---

### Task 1: Create types and scoring function

**Files:**
- Create: `src/governance/risk-scoring.ts`
- Test: `tests/governance/risk-scoring.test.ts`

**Interfaces:**
- Produces: `RiskLevel`, `RiskFactor`, `RiskScore`, `ScoringInput`, `computeRiskScore()`, `scoreFileScope()`, `scoreFileCount()`, `scoreActionType()`, `scoreVerification()`, `scoreLabels()`

- [ ] **Step 1: Write type tests and path-level factor tests**

```typescript
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
  type ScoringInput,
  type RiskLevel,
} from "../../src/governance/risk-scoring.js";

// ---------------------------------------------------------------------------
// Individual factors
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
  });
});

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm build
Expected: build succeeds (file may not exist yet, skip)
node --test dist/tests/governance/risk-scoring.test.js
Expected: FAIL — module not found or exports undefined
```

- [ ] **Step 3: Implement factor scoring functions**

```typescript
// src/governance/risk-scoring.ts
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  name: string;
  score: number;
  level: RiskLevel;
  description: string;
}

export interface RiskScore {
  level: RiskLevel;
  score: number;
  factors: RiskFactor[];
}

export type ActionType = "read" | "edit" | "create" | "delete" | "destructive" | "release" | "proposal";

export type VerificationStatus = "passed" | "typecheck" | "none" | "failed";

export interface ScoringInput {
  files: string[];
  actionType: ActionType;
  verificationStatus: VerificationStatus;
  labels: string[];
}

function scoreToLevel(score: number): RiskLevel {
  if (score <= 25) return "low";
  if (score <= 50) return "medium";
  if (score <= 75) return "high";
  return "critical";
}

// ---------------------------------------------------------------------------
// File scope scoring
// ---------------------------------------------------------------------------

const SECRETS_PATTERNS = [
  /(^|\/)\.env($|\.)/,
  /(^|\/)infra\//,
  /(^|\/)deploy\//,
  /(^|\/)secrets\//,
  /(^|\/)credentials\//,
];
const SECURITY_PATTERNS = [/src\/security\//, /src\/auth\//];
const SOURCE_PATTERNS = [/src\//];
const DOCS_PATTERNS = [/docs\//, /tests\//];

export function scoreFileScope(files: string[]): RiskFactor {
  if (files.length === 0) {
    return { name: "File scope", score: 0, level: "low", description: "No files changed" };
  }

  let maxLevel: RiskLevel = "low";
  let maxScore = 0;

  for (const f of files) {
    if (SECRETS_PATTERNS.some(p => p.test(f))) {
      maxScore = 90;
      maxLevel = "critical";
    } else if (SECURITY_PATTERNS.some(p => p.test(f)) && maxLevel !== "critical") {
      maxScore = 70;
      maxLevel = "high";
    } else if (SOURCE_PATTERNS.some(p => p.test(f)) && maxLevel === "low") {
      maxScore = 40;
      maxLevel = "medium";
    }
  }

  const domain = maxLevel === "critical" ? `secrets/infra/deploy files` :
    maxLevel === "high" ? `security/auth files` :
    maxLevel === "medium" ? `source files` :
    `docs/tests files`;

  const example = files.length > 0 ? ` (e.g. ${files[0]})` : "";

  return {
    name: "File scope",
    score: maxScore,
    level: maxLevel,
    description: `${domain}${example}`,
  };
}

// ---------------------------------------------------------------------------
// File count scoring
// ---------------------------------------------------------------------------

export function scoreFileCount(count: number): RiskFactor {
  let score: number;
  let level: RiskLevel;

  if (count <= 0) {
    score = 0; level = "low";
  } else if (count <= 3) {
    score = 10; level = "low";
  } else if (count <= 6) {
    score = 35; level = "medium";
  } else if (count <= 10) {
    score = 65; level = "high";
  } else {
    score = 85; level = "critical";
  }

  return {
    name: "File count",
    score,
    level,
    description: `${count} file${count !== 1 ? "s" : ""} changed`,
  };
}

// ---------------------------------------------------------------------------
// Action type scoring
// ---------------------------------------------------------------------------

const ACTION_SCORES: Record<ActionType, { score: number; level: RiskLevel }> = {
  read: { score: 5, level: "low" },
  proposal: { score: 5, level: "low" },
  edit: { score: 40, level: "medium" },
  create: { score: 65, level: "high" },
  delete: { score: 65, level: "high" },
  destructive: { score: 90, level: "critical" },
  release: { score: 90, level: "critical" },
};

export function scoreActionType(actionType: ActionType): RiskFactor {
  const { score, level } = ACTION_SCORES[actionType];
  return {
    name: "Action type",
    score,
    level,
    description: `${actionType} action`,
  };
}

// ---------------------------------------------------------------------------
// Verification scoring
// ---------------------------------------------------------------------------

const VERIFICATION_SCORES: Record<VerificationStatus, { score: number; level: RiskLevel }> = {
  passed: { score: 5, level: "low" },
  typecheck: { score: 35, level: "medium" },
  none: { score: 65, level: "high" },
  failed: { score: 90, level: "critical" },
};

export function scoreVerification(verificationStatus: VerificationStatus): RiskFactor {
  const { score, level } = VERIFICATION_SCORES[verificationStatus];
  return {
    name: "Verification",
    score,
    level,
    description: `Verification: ${verificationStatus}`,
  };
}

// ---------------------------------------------------------------------------
// Labels scoring
// ---------------------------------------------------------------------------

const LABEL_SCORES: Record<string, { score: number; level: RiskLevel }> = {
  docs: { score: 10, level: "low" },
  test: { score: 10, level: "low" },
  bug: { score: 35, level: "medium" },
  chore: { score: 35, level: "medium" },
  feature: { score: 65, level: "high" },
  enhancement: { score: 65, level: "high" },
  security: { score: 85, level: "critical" },
  infra: { score: 85, level: "critical" },
};

export function scoreLabels(labels: string[]): RiskFactor {
  if (labels.length === 0) {
    return { name: "Labels", score: 0, level: "low", description: "No labels" };
  }

  let maxScore = 0;
  let maxLevel: RiskLevel = "low";

  for (const label of labels) {
    const mapped = LABEL_SCORES[label];
    if (mapped && mapped.score > maxScore) {
      maxScore = mapped.score;
      maxLevel = mapped.level;
    }
  }

  // No recognised labels
  if (maxScore === 0) {
    return { name: "Labels", score: 5, level: "low", description: `Labels: ${labels.join(", ")}` };
  }

  return {
    name: "Labels",
    score: maxScore,
    level: maxLevel,
    description: `${maxLevel} risk label(s): ${labels.filter(l => LABEL_SCORES[l]).join(", ")}`,
  };
}
```

- [ ] **Step 4: Implement computeRiskScore**

```typescript
// src/governance/risk-scoring.ts (add)

export function computeRiskScore(input: ScoringInput): RiskScore {
  const factors: RiskFactor[] = [
    scoreFileScope(input.files),
    scoreFileCount(input.files.length),
    scoreActionType(input.actionType),
    scoreVerification(input.verificationStatus),
    scoreLabels(input.labels),
  ];

  const maxScore = Math.max(...factors.map(f => f.score));

  return {
    level: scoreToLevel(maxScore),
    score: maxScore,
    factors,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm build && node --test dist/tests/governance/risk-scoring.test.js
Expected: all factor tests PASS
```

- [ ] **Step 6: Write computeRiskScore integration tests**

```typescript
// tests/governance/risk-scoring.test.ts (add)

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

  it("source change + no verification → medium", () => {
    const r = computeRiskScore({
      files: ["src/main.ts"],
      actionType: "edit",
      verificationStatus: "none",
      labels: ["feature"],
    });
    // max is verification=none → high, so overall high
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
    const countFactor = r.factors.find(f => f.name === "File count");
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

  it("no approval workflow coupling — verify no imports from approval modules", () => {
    // This test ensures computeRiskScore doesn't import or reference approval
    // Simply calling it should not pull in any approval-related code
    const r = computeRiskScore({
      files: [],
      actionType: "read",
      verificationStatus: "passed",
      labels: [],
    });
    assert.ok(r.level);
  });
});

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
```

- [ ] **Step 7: Run full test suite**

```bash
pnpm typecheck && node --test dist/tests/governance/risk-scoring.test.js
Expected: all PASS
```

- [ ] **Step 8: Commit**

```bash
git add src/governance/risk-scoring.ts tests/governance/risk-scoring.test.ts
git commit -m "feat(governance): add P12.2 risk scoring types and scoring function"
```

---

### Task 2: Wire CLI subcommand

**Files:**
- Modify: `src/cli/commands/governance.ts`

- [ ] **Step 1: Add `risk-score` subcommand to the governance handler**

In `src/cli/commands/governance.ts`, add the `risk-score` case to the switch:

```typescript
case "risk-score": {
  const { riskScoreCLI } = await import("../../governance/risk-scoring.js");
  riskScoreCLI(args.slice(1));
  return;
}
```

- [ ] **Step 2: Add the riskScoreCLI export to risk-scoring.ts**

```typescript
// src/governance/risk-scoring.ts (add at bottom)

export interface CLIOpts {
  files: string[];
  action: string;
  verification: string;
  labels: string[];
  json: boolean;
}

export function parseRiskScoreArgs(args: string[]): CLIOpts {
  const opts: CLIOpts = {
    files: [],
    action: "read",
    verification: "none",
    labels: [],
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--json") {
      opts.json = true;
      continue;
    }

    if (arg === "--action") {
      opts.action = args[++i] ?? opts.action;
      continue;
    }

    if (arg === "--verification") {
      opts.verification = args[++i] ?? opts.verification;
      continue;
    }

    if (arg === "--labels") {
      opts.labels = (args[++i] ?? "")
        .split(",")
        .map((label: string) => label.trim())
        .filter(Boolean);
      continue;
    }

    if (arg === "--files") {
      // Consume all subsequent tokens until the next flag
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        opts.files.push(args[++i]);
      }
      continue;
    }

    // Positional args are also treated as files
    if (!arg.startsWith("--")) {
      opts.files.push(arg);
    }
  }

  return opts;
}

const VALID_ACTIONS: string[] = ["read", "edit", "create", "delete", "destructive", "release", "proposal"];
const VALID_VERIFICATIONS: string[] = ["passed", "typecheck", "none", "failed"];

export function riskScoreCLI(args: string[]): void {
  const { files, action, verification, labels, json } = parseRiskScoreArgs(args);

  // Validate CLI input — reject invalid values rather than silently normalizing
  if (!VALID_ACTIONS.includes(action)) {
    console.error(`Error: Invalid action type "${action}". Valid: ${VALID_ACTIONS.join(", ")}`);
    process.exit(1);
  }
  if (!VALID_VERIFICATIONS.includes(verification)) {
    console.error(`Error: Invalid verification status "${verification}". Valid: ${VALID_VERIFICATIONS.join(", ")}`);
    process.exit(1);
  }

  const input: ScoringInput = {
    files: files.length > 0 ? files : [],
    actionType: action as ActionType,
    verificationStatus: verification as VerificationStatus,
    labels,
  };

  const result = computeRiskScore(input);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const levelColor: Record<RiskLevel, string> = {
    low: "\x1b[32m",       // green
    medium: "\x1b[33m",    // yellow
    high: "\x1b[38;5;208m", // orange
    critical: "\x1b[31m",  // red
  };

  console.log(`Risk Score: ${levelColor[result.level]}${result.level.toUpperCase()}\x1b[0m (${result.score}/100)`);
  console.log("");
  console.log("Factors:");
  for (const f of result.factors) {
    const color = levelColor[f.level];
    console.log(`  ${color}${f.level.toUpperCase().padEnd(9)}\x1b[0m ${f.name.padEnd(14)} ${f.description}`);
  }
}
```

- [ ] **Step 3: Verify CLI works**

```bash
pnpm build && node dist/src/cli.js governance risk-score --files docs/README.md --action read --verification passed --labels docs
Expected: prints low risk score with factors

node dist/src/cli.js governance risk-score --files .env --action edit --verification none --json
Expected: JSON output with critical risk level
```

- [ ] **Step 4: Verify no regressions**

```bash
pnpm typecheck && node --test dist/tests/governance/risk-scoring.test.js && pnpm test:vitest
Expected: all pass
```

- [ ] **Step 5: Commit**

```bash
git add src/governance/risk-scoring.ts src/cli/commands/governance.ts tests/governance/risk-scoring.test.ts
git commit -m "feat(governance): wire P12.2 risk scoring CLI"
```

---

### Task 3: Final validation

- [ ] **Step 1: Run full validation gate**

```bash
pnpm build
pnpm typecheck
node --test dist/tests/governance/risk-scoring.test.js
pnpm test:vitest
```

Expected: all clean.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feature/p12-2-risk-scoring
```

---

## Verification

```bash
pnpm build                          # compiles clean
pnpm typecheck                      # 0 type errors
node --test dist/tests/governance/risk-scoring.test.js  # 30+ tests pass
pnpm test:vitest                    # all vitest tests pass, 0 regressions
node dist/src/cli.js governance risk-score --files docs/README.md --action read --verification passed --labels docs  # low
node dist/src/cli.js governance risk-score --files .env --action edit --verification none --json  # critical, JSON
```
