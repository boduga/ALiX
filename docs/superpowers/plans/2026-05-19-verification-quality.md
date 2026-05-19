# Verification Quality Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ChangeClassifier, VerificationPlanner, and full VerificationResult with residual risk reporting per the research spec.

**Architecture:** Extend existing verifier module. ChangeClassifier analyzes file diffs to determine change type. VerificationPlanner builds a plan of checks ordered by cost. VerificationResult includes residual risk.

**Tech Stack:** TypeScript, existing verifier, event log

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/verifier/change-classifier.ts` | Classify file changes into types |
| `src/verifier/planner.ts` | Build verification plan from changes |
| `src/verifier/runner.ts` | Execute checks with cost tracking |
| `src/verifier/reporter.ts` | Generate residual risk report |
| `tests/verifier/change-classifier.test.ts` | Change classification tests |
| `tests/verifier/planner.test.ts` | Planning tests |

---

## Task 1: Add ChangeClassifier

**Files:**
- Create: `src/verifier/change-classifier.ts`
- Test: `tests/verifier/change-classifier.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyChanges, type ChangeType } from "../../src/verifier/change-classifier.js";

describe("ChangeClassifier", () => {
  it("classifies TypeScript file as code change", () => {
    const result = classifyChanges(["src/utils/helper.ts"]);
    assert.equal(result.primary, "code");
  });

  it("classifies test file as test change", () => {
    const result = classifyChanges(["tests/utils/helper.test.ts"]);
    assert.equal(result.primary, "test");
  });

  it("classifies .md file as docs change", () => {
    const result = classifyChanges(["docs/README.md"]);
    assert.equal(result.primary, "docs");
  });

  it("classifies package.json as config change", () => {
    const result = classifyChanges(["package.json"]);
    assert.equal(result.primary, "config");
  });

  it("classifies mixed changes as mixed", () => {
    const result = classifyChanges(["src/app.ts", "tests/app.test.ts", "README.md"]);
    assert.equal(result.primary, "mixed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verifier/change-classifier.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement ChangeClassifier**

```typescript
// src/verifier/change-classifier.ts

export type ChangeType = "code" | "test" | "docs" | "config" | "dependency" | "ui" | "schema" | "migration" | "mixed";

export type ChangeClassification = {
  primary: ChangeType;
  secondary: ChangeType[];
  files: string[];
};

const TEST_PATTERNS = [/\.test\.(ts|js|tsx|jsx)$/, /_test\.(ts|js)$/, /spec\.(ts|js)$/];
const DOC_PATTERNS = [/\.md$/, /\.mdx$/, /\.txt$/];
const CONFIG_PATTERNS = [/^package\.json$/, /^tsconfig\.json$/, /^\.eslint/, /^webpack\./, /vite\.config\./];
const DEPENDENCY_PATTERNS = [/^package-lock\.json$/, /^yarn\.lock$/, /^pnpm-lock\.yaml$/, /^requirements\.txt$/];
const UI_PATTERNS = [/\.css$/, /\.scss$/, /\.less$/, /\.html$/, /\.vue$/, /\.jsx$/, /\.tsx$/];
const SCHEMA_PATTERNS = [/schema/, /types/];
const MIGRATION_PATTERNS = [/migrate/, /migration/, /seed/];

export function classifyChanges(files: string[]): ChangeClassification {
  const types: ChangeType[] = [];

  for (const file of files) {
    const basename = file.split("/").pop() ?? file;
    const ext = basename.split(".").pop() ?? "";

    if (TEST_PATTERNS.some(p => p.test(basename))) {
      types.push("test");
    } else if (DOC_PATTERNS.some(p => p.test(basename))) {
      types.push("docs");
    } else if (CONFIG_PATTERNS.some(p => p.test(basename))) {
      types.push("config");
    } else if (DEPENDENCY_PATTERNS.some(p => p.test(basename))) {
      types.push("dependency");
    } else if (UI_PATTERNS.some(p => p.test(file))) {
      types.push("ui");
    } else if (SCHEMA_PATTERNS.some(p => p.test(file))) {
      types.push("schema");
    } else if (MIGRATION_PATTERNS.some(p => p.test(file))) {
      types.push("migration");
    } else if (["ts", "js", "tsx", "jsx", "py", "go", "rs", "java"].includes(ext)) {
      types.push("code");
    } else {
      types.push("config");
    }
  }

  const unique = [...new Set(types)];
  const primary = unique.length === 1 ? unique[0] : "mixed";

  return {
    primary,
    secondary: unique.filter(t => t !== primary),
    files,
  };
}

export function getSuggestedChecks(classification: ChangeClassification): string[] {
  const checks: string[] = [];

  if (classification.primary === "code" || classification.primary === "test" || classification.primary === "mixed") {
    checks.push("typecheck");
  }
  if (classification.primary === "test" || classification.primary === "code" || classification.primary === "mixed") {
    checks.push("test");
  }
  if (classification.primary === "config" || classification.primary === "dependency") {
    checks.push("build");
  }

  return checks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/verifier/change-classifier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/change-classifier.ts tests/verifier/change-classifier.test.ts
git commit -m "feat(verifier): add ChangeClassifier for change type detection"
```

---

## Task 2: Add VerificationPlanner

**Files:**
- Create: `src/verifier/planner.ts`
- Test: `tests/verifier/planner.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildVerificationPlan, type VerificationCheck } from "../../src/verifier/planner.js";

describe("VerificationPlanner", () => {
  it("builds plan with single check", () => {
    const checks: VerificationCheck[] = [
      { id: "1", command: "npm test", reason: "test file changed", cost: "expensive", required: true },
    ];
    const plan = buildVerificationPlan(checks);
    assert.equal(plan.checks.length, 1);
    assert.equal(plan.checks[0].command, "npm test");
  });

  it("orders checks by cost (cheap first)", () => {
    const checks: VerificationCheck[] = [
      { id: "1", command: "npm test", reason: "", cost: "expensive", required: false },
      { id: "2", command: "npm run typecheck", reason: "", cost: "cheap", required: true },
      { id: "3", command: "npm run build", reason: "", cost: "medium", required: false },
    ];
    const plan = buildVerificationPlan(checks);
    assert.equal(plan.checks[0].cost, "cheap");
    assert.equal(plan.checks[1].cost, "medium");
    assert.equal(plan.checks[2].cost, "expensive");
  });

  it("marks required checks", () => {
    const checks: VerificationCheck[] = [
      { id: "1", command: "npm run typecheck", reason: "", cost: "cheap", required: true },
      { id: "2", command: "npm test", reason: "", cost: "expensive", required: false },
    ];
    const plan = buildVerificationPlan(checks);
    assert.ok(plan.checks[0].required);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verifier/planner.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement VerificationPlanner**

```typescript
// src/verifier/planner.ts

export type CheckCost = "cheap" | "medium" | "expensive";

export type VerificationCheck = {
  id: string;
  command: string;
  reason: string;
  cost: CheckCost;
  required: boolean;
};

export type SkippedCheck = {
  command: string;
  reason: string;
};

export type VerificationPlan = {
  id: string;
  changedFiles: string[];
  checks: VerificationCheck[];
  skipped: SkippedCheck[];
};

const COST_ORDER: CheckCost[] = ["cheap", "medium", "expensive"];

export function buildVerificationPlan(checks: VerificationCheck[]): VerificationPlan {
  // Sort by cost order
  const sorted = [...checks].sort((a, b) => {
    const aIdx = COST_ORDER.indexOf(a.cost);
    const bIdx = COST_ORDER.indexOf(b.cost);
    if (aIdx !== bIdx) return aIdx - bIdx;
    // Required checks come first within same cost tier
    if (a.required !== b.required) return a.required ? -1 : 1;
    return 0;
  });

  return {
    id: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    changedFiles: [],
    checks: sorted,
    skipped: [],
  };
}

export function addSkippedCheck(plan: VerificationPlan, command: string, reason: string): VerificationPlan {
  return {
    ...plan,
    skipped: [...plan.skipped, { command, reason }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/verifier/planner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/planner.ts tests/verifier/planner.test.ts
git commit -m "feat(verifier): add VerificationPlanner for cost-ordered checks"
```

---

## Task 3: Extend VerificationResult with Residual Risk

**Files:**
- Modify: `src/verifier/verifier.ts`
- Create: `src/verifier/reporter.ts`
- Test: `tests/verifier/reporter.test.ts`

- [ ] **Step 1: Write failing test for reporter**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildRiskReport } from "../../src/verifier/reporter.js";
import type { VerificationPlan, VerificationResult } from "../../src/verifier/planner.js";

describe("RiskReporter", () => {
  it("reports all checks that were not run", () => {
    const plan: VerificationPlan = {
      id: "plan-1",
      changedFiles: ["src/app.ts"],
      checks: [
        { id: "1", command: "npm run typecheck", reason: "", cost: "cheap", required: true },
        { id: "2", command: "npm test", reason: "", cost: "expensive", required: false },
      ],
      skipped: [],
    };
    const results: VerificationResult[] = [];

    const report = buildRiskReport(plan, results);
    assert.ok(report.includes("npm test"));
  });

  it("reports failed checks", () => {
    const plan: VerificationPlan = {
      id: "plan-1",
      changedFiles: ["src/app.ts"],
      checks: [
        { id: "1", command: "npm run typecheck", reason: "", cost: "cheap", required: true },
      ],
      skipped: [],
    };
    const results: VerificationResult[] = [
      { planId: "plan-1", status: "failed", command: "npm run typecheck", reason: "type error" },
    ];

    const report = buildRiskReport(plan, results);
    assert.ok(report.toLowerCase().includes("failed"));
  });

  it("returns empty when all checks passed", () => {
    const plan: VerificationPlan = {
      id: "plan-1",
      changedFiles: ["src/app.ts"],
      checks: [
        { id: "1", command: "npm run typecheck", reason: "", cost: "cheap", required: true },
      ],
      skipped: [],
    };
    const results: VerificationResult[] = [
      { planId: "plan-1", status: "passed", command: "npm run typecheck" },
    ];

    const report = buildRiskReport(plan, results);
    assert.equal(report, "");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/verifier/reporter.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement reporter**

```typescript
// src/verifier/reporter.ts

import type { VerificationPlan } from "./planner.js";

export type CommandResult = {
  command: string;
  status: "passed" | "failed" | "not_run";
  output?: string;
  reason?: string;
};

export type VerificationResult = {
  planId: string;
  status: "passed" | "failed" | "partial" | "not_run";
  command?: string;
  output?: string;
  reason?: string;
  results?: CommandResult[];
  residualRisk: string[];
};

export function buildRiskReport(plan: VerificationPlan, results: VerificationResult[]): string {
  const lines: string[] = [];
  const passedCommands = new Set<string>();
  const failedCommands = new Set<string>();

  for (const result of results) {
    if (result.status === "passed" && result.command) {
      passedCommands.add(result.command);
    }
    if (result.status === "failed" && result.command) {
      failedCommands.add(result.command);
      if (result.reason) {
        lines.push(`FAILED: ${result.command} — ${result.reason}`);
      } else {
        lines.push(`FAILED: ${result.command}`);
      }
    }
  }

  // Report skipped checks
  for (const check of plan.checks) {
    if (!passedCommands.has(check.command) && !failedCommands.has(check.command)) {
      lines.push(`NOT RUN: ${check.command} — ${check.reason || "skipped"}`);
    }
  }

  if (failedCommands.size > 0) {
    lines.push("");
    lines.push("⚠️  Verification failed. Some changes may introduce bugs.");
  }

  return lines.join("\n");
}

export function aggregateResults(plan: VerificationPlan, results: CommandResult[]): VerificationResult {
  const passed = results.filter(r => r.status === "passed").length;
  const failed = results.filter(r => r.status === "failed").length;
  const notRun = results.filter(r => r.status === "not_run").length;

  let status: VerificationResult["status"];
  if (failed > 0) {
    status = "failed";
  } else if (notRun > 0) {
    status = "partial";
  } else {
    status = "passed";
  }

  return {
    planId: plan.id,
    status,
    results,
    residualRisk: buildResidualRisk(plan, results),
  };
}

function buildResidualRisk(plan: VerificationPlan, results: CommandResult[]): string[] {
  const risks: string[] = [];
  const runCommands = new Set(results.map(r => r.command));

  for (const check of plan.checks) {
    if (!runCommands.has(check.command)) {
      risks.push(`${check.command} was not run — ${check.reason}`);
    }
  }

  return risks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/verifier/reporter.test.ts`
Expected: PASS

- [ ] **Step 5: Update existing verifier.ts to use new types**

```typescript
// Add to src/verifier/verifier.ts
export type { VerificationPlan, VerificationCheck, CheckCost, SkippedCheck } from "./planner.js";
export type { VerificationResult as VerificationResult2, CommandResult } from "./reporter.js";
```

- [ ] **Step 6: Run all tests**

Run: `npm test -- tests/verifier/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/verifier/ tests/verifier/
git commit -m "feat(verifier): add VerificationPlanner and residual risk reporting"
```

---

## Verification

```bash
npm test -- tests/verifier/change-classifier.test.ts tests/verifier/planner.test.ts tests/verifier/reporter.test.ts
```

All tests should pass. Manual verification:
- [ ] ChangeClassifier correctly identifies file types
- [ ] VerificationPlanner orders checks by cost (cheap first)
- [ ] Risk report shows all checks that were not run
- [ ] Failed checks appear in risk report
- [ ] Residual risk list is populated for skipped checks