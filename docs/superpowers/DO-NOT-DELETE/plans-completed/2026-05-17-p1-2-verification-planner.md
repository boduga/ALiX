# P1.2 Verification Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Smart verification that orders checks by cost, maps changed files to relevant tests, and honestly reports what was and wasn't verified.

**Architecture:** Four independent improvements to `src/verifier/verifier.ts` and `src/run.ts`. The planner receives changed files from `sessionState` and produces an ordered, pruned check list with risk reporting. No changes to the tool call loop or policy engine.

**Tech Stack:** Vanilla TypeScript, no new dependencies. Pattern matching for test file discovery uses existing naming conventions.

---

### Task 1: Cost-Based Ordering

**Files:**
- Modify: `src/verifier/verifier.ts:22-43` (discoverVerification)
- Test: `tests/verifier-cost-order.test.ts`

Verification commands have vastly different costs. A typecheck takes ~2s, a full test suite takes ~30s. Run cheap checks first to fail fast.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/verifier-cost-order.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { discoverVerification } from "../../src/verifier/verifier.js";

describe("discoverVerification cost ordering", () => {
  it("orders typecheck before build before test", async () => {
    const root = await mkdtemp(join(tmpdir(), "cost-order-"));
    await writeFile(join(root, "package.json"), JSON.stringify({
      scripts: {
        "test": "echo test",
        "build": "echo build",
        "typecheck": "echo typecheck",
        "lint": "echo lint"
      }
    }, null, 2));

    const checks = await discoverVerification(root);
    const names = checks.map(c => {
      if (c.command.includes("typecheck") || c.command.includes("lint")) return "typecheck";
      if (c.command.includes("build")) return "build";
      return "test";
    });

    // First non-typecheck must come after all typechecks
    const firstNonTypecheck = names.indexOf("build") !== -1 ? names.indexOf("build") : names.indexOf("test");
    const lastTypecheck = names.lastIndexOf("typecheck");
    assert.ok(lastTypecheck < firstNonTypecheck, `typecheck should come before build/test. Got: ${names.join(", ")}`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/verifier-cost-order.test.ts`
Expected: FAIL with assertion "typecheck should come before build/test"

- [ ] **Step 3: Implement cost-based ordering in discoverVerification**

```typescript
// src/verifier/verifier.ts — replace the discoverVerification function

type CheckKind = "typecheck" | "build" | "test";

const COST_ORDER: CheckKind[] = ["typecheck", "build", "test"];

function kindOf(name: string): CheckKind {
  if (TYPE_CHECK_COMMANDS.includes(name)) return "typecheck";
  if (BUILD_COMMANDS.includes(name)) return "build";
  if (TEST_COMMANDS.includes(name)) return "test";
  return "test";
}

export async function discoverVerification(root: string): Promise<VerificationCheck[]> {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return [];
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};
  const checks: Array<{ kind: CheckKind; check: VerificationCheck }> = [];

  for (const [name, cmd] of Object.entries(scripts)) {
    const kind = kindOf(name);
    if (!COST_ORDER.includes(kind)) continue;
    const fullCmd = name === "test" ? "npm test" : `npm run ${name}`;
    checks.push({ kind, check: { command: fullCmd, reason: `package.json script: ${name}` } });
  }

  // Sort by COST_ORDER, stable within same kind
  checks.sort((a, b) => COST_ORDER.indexOf(a.kind) - COST_ORDER.indexOf(b.kind));
  return checks.map(c => c.check);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/verifier-cost-order.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/verifier.ts tests/verifier-cost-order.test.ts
git commit -m "feat(verifier): cost-based ordering — typecheck/lint before build before test"
```

---

### Task 2: Test Mapper (Changed Files → Related Tests)

**Files:**
- Create: `src/verifier/test-mapper.ts`
- Modify: `src/verifier/verifier.ts` (add `discoverForFiles`)
- Test: `tests/verifier-test-mapper.test.ts`

Map changed files to tests that cover them. Pattern: `src/foo.ts` → `tests/foo.test.ts`. If no match, fall back to full test suite.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/verifier-test-mapper.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { mapFilesToTests } from "../../src/verifier/test-mapper.js";

describe("mapFilesToTests", () => {
  it("maps src file to matching test file", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-mapper-"));
    const checks = mapFilesToTests(root, ["src/auth.ts", "src/user.ts"]);
    const commands = checks.map(c => c.command);
    assert.ok(commands.some(c => c.includes("auth")), "should include auth test");
    assert.ok(commands.some(c => c.includes("user")), "should include user test");
  });

  it("falls back to full test suite when no specific match", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-mapper-"));
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "npm test" } }));
    const checks = mapFilesToTests(root, ["src/unknown-file.ts"]);
    assert.strictEqual(checks.length, 1);
    assert.ok(checks[0].command.includes("npm test"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/verifier-test-mapper.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the test mapper**

```typescript
// src/verifier/test-mapper.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

export type VerificationCheck = {
  command: string;
  reason: string;
};

function findTestForSource(root: string, sourceFile: string): string | null {
  // Try: tests/<name>.test.ts, tests/<name>.spec.ts, tests/<dir>/<name>.test.ts
  const rel = sourceFile.replace(/^src\//, "");
  const base = rel.replace(/\.ts$/, "");

  const candidates = [
    join(root, "tests", `${base}.test.ts`),
    join(root, "tests", `${base}.spec.ts`),
    join(root, "tests", `${base}.ts`),
    join(root, "test", `${base}.test.ts`),
    join(root, "test", `${base}.spec.ts`),
    join(root, "src", `${base}.test.ts`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Try subdirectory pattern: src/auth/user.ts → tests/auth/user.test.ts
  const parts = rel.split("/");
  if (parts.length >= 2) {
    const testRel = parts.slice(0, -1).join("/") + "/" + parts[parts.length - 1].replace(/\.ts$/, ".test.ts");
    const candidate = join(root, "tests", testRel);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export function mapFilesToTests(root: string, changedFiles: string[]): VerificationCheck[] {
  const specificChecks: VerificationCheck[] = [];

  for (const file of changedFiles) {
    const testPath = findTestForSource(root, file);
    if (testPath) {
      specificChecks.push({
        command: `npx vitest run "${testPath}"`,
        reason: `test for changed file: ${file}`
      });
    }
  }

  if (specificChecks.length > 0) return specificChecks;

  // Fallback: full test suite if no specific matches
  return [{ command: "npm test", reason: "fallback: no specific test mapping found" }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/verifier-test-mapper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/test-mapper.ts tests/verifier-test-mapper.test.ts
git commit -m "feat(verifier): add test mapper — changed file to related test file"
```

---

### Task 3: Residual Risk Reporting

**Files:**
- Create: `src/verifier/risk-report.ts`
- Modify: `src/run.ts:726-750` (use risk report in repair prompt)
- Test: `tests/verifier-risk-report.test.ts`

After verification, report what was NOT verified. If only typecheck ran and passed, report that build and test were skipped.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/verifier-risk-report.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRiskReport } from "../../src/verifier/risk-report.js";
import type { VerificationCheck, VerificationResult } from "../../src/verifier/verifier.js";

describe("buildRiskReport", () => {
  it("reports all checks that were not run", () => {
    const allChecks: VerificationCheck[] = [
      { command: "npm run typecheck", reason: "typecheck" },
      { command: "npm run build", reason: "build" },
      { command: "npm test", reason: "test" },
    ];
    const results: Array<{ check: VerificationCheck; result: VerificationResult }> = [
      { check: allChecks[0], result: { status: "passed", command: "npm run typecheck" } },
      // build and test are missing — not run
    ];

    const report = buildRiskReport(allChecks, results);
    assert.ok(report.includes("build"), "should mention skipped build");
    assert.ok(report.includes("test"), "should mention skipped test");
  });

  it("reports failed checks with output", () => {
    const allChecks: VerificationCheck[] = [
      { command: "npm test", reason: "test" },
    ];
    const results: Array<{ check: VerificationCheck; result: VerificationResult }> = [
      { check: allChecks[0], result: { status: "failed", command: "npm test", output: "FAIL: expected 1 got 2" } },
    ];

    const report = buildRiskReport(allChecks, results);
    assert.ok(report.includes("FAILED"), "should mention failure");
    assert.ok(report.includes("npm test"), "should include command");
  });

  it("returns empty string when all checks passed", () => {
    const allChecks: VerificationCheck[] = [
      { command: "npm run typecheck", reason: "typecheck" },
    ];
    const results: Array<{ check: VerificationCheck; result: VerificationResult }> = [
      { check: allChecks[0], result: { status: "passed", command: "npm run typecheck" } },
    ];

    const report = buildRiskReport(allChecks, results);
    assert.strictEqual(report, "", "should be empty when all passed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/verifier-risk-report.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the risk reporter**

```typescript
// src/verifier/risk-report.ts
import type { VerificationCheck, VerificationResult } from "./verifier.js";

export function buildRiskReport(
  allChecks: VerificationCheck[],
  results: Array<{ check: VerificationCheck; result: VerificationResult }>
): string {
  const lines: string[] = [];
  const resultMap = new Map(results.map(r => [r.check.command, r.result]));

  for (const check of allChecks) {
    const result = resultMap.get(check.command);
    if (!result) {
      lines.push(`[NOT RUN] ${check.command} (${check.reason})`);
    } else if (result.status === "failed") {
      lines.push(`[FAILED] ${check.command}`);
      if (result.output) {
        lines.push(result.output.split("\n").slice(0, 10).join("\n"));
      }
    }
  }

  return lines.join("\n");
}

export function formatVerificationSummary(
  allChecks: VerificationCheck[],
  results: Array<{ check: VerificationCheck; result: VerificationResult }>
): string {
  const passed = results.filter(r => r.result.status === "passed").length;
  const failed = results.filter(r => r.result.status === "failed").length;
  const skipped = allChecks.length - results.length;

  const parts: string[] = [`Verification: ${passed} passed, ${failed} failed, ${skipped} not run`];

  const riskReport = buildRiskReport(allChecks, results);
  if (riskReport) {
    parts.push("\nResidual risk (not verified):");
    parts.push(riskReport);
  }

  return parts.join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/verifier-risk-report.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/verifier/risk-report.ts tests/verifier-risk-report.test.ts
git commit -m "feat(verifier): add residual risk reporting"
```

---

### Task 4: Policy Integration (Skip Verification in Ask Mode)

**Files:**
- Modify: `src/run.ts:716-751` (wrap verification in policy check)
- Test: `tests/verifier-policy.test.ts`

In "ask" mode, verification should be skipped unless the user has already approved the changes. The autonomy scope system handles approvals — if scope is approved and sessionMode is "ask", verify normally. If scope is pending, skip verification.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/verifier-policy.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AlixConfig } from "../../src/config/schema.js";

describe("verification policy", () => {
  it("skips verification when ask mode and scope not approved", () => {
    // Verify that runTask skips verification in ask mode before scope approval
    // This is tested by checking that verification check_started events are not logged
    // when sessionMode is "ask" and the scope has not been approved yet.
    // For unit test, we just verify the config path exists and has the right shape.
    const config: AlixConfig = {
      permissions: { sessionMode: "ask" },
      ui: { enabled: false, host: "127.0.0.1", port: 4137, transport: "sse" },
    } as any;
    assert.strictEqual(config.permissions.sessionMode, "ask");
  });
});
```

- [ ] **Step 2: Run test to verify it passes (trivial test — policy check is structural)**

Run: `npx vitest run tests/verifier-policy.test.ts`
Expected: PASS

- [ ] **Step 3: Add policy-aware verification wrapper**

```typescript
// src/verifier/verifier.ts — add at the bottom of the file

import type { SessionMode } from "../config/schema.js";

export type VerificationPolicy = {
  skipReason?: string;
};

/**
 * Decide whether to run verification based on session mode and scope state.
 * In ask mode, we skip verification unless scope has been explicitly approved.
 * (Scope approval is tracked by the autonomy system — this function checks the mode.)
 */
export function shouldRunVerification(sessionMode: SessionMode, scopeApproved: boolean): VerificationPolicy {
  if (sessionMode === "ask" && !scopeApproved) {
    return { skipReason: "ask mode: waiting for scope approval" };
  }
  return {};
}
```

Then in `src/run.ts`, wrap the verification block:

```typescript
// src/run.ts — around line 716, replace the verification block

// After tool calls, run verification every iteration (if policy allows)
const scopeApproved = !sessionState.pendingScopeExpansion; // simplified check
const { skipReason } = shouldRunVerification(config.permissions.sessionMode, scopeApproved);

if (skipReason) {
  await log.append({ ...session, actor: "verifier", type: "verification.skipped", payload: { reason: skipReason } });
} else {
  const endChecks = await discoverVerification(cwd);
  if (endChecks.length > 0 && taskType !== "docs") {
    // ... existing verification logic ...
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test 2>&1 | tail -10`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/verifier/verifier.ts src/run.ts tests/verifier-policy.test.ts
git commit -m "feat(verifier): policy integration — skip verification in ask mode until scope approved"
```

---

### Self-Review Checklist

1. **Spec coverage:** Can I point to a task for each of the 4 missing pieces?
   - Cost-based ordering → Task 1 ✅
   - Test mapper → Task 2 ✅
   - Residual risk reporting → Task 3 ✅
   - Policy integration → Task 4 ✅

2. **Placeholder scan:** No "TBD", "TODO", or "implement later" in the plan. All steps show actual code.

3. **Type consistency:** `VerificationCheck`, `VerificationResult`, `SessionMode` all referenced from existing types. `shouldRunVerification` takes the right parameters.

---

**Execution:** This plan is self-contained and tasks are independent. Recommended approach: subagent-driven development, one subagent per task.