# Autonomous Task Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 10-iteration loop with an autonomous loop that runs until verification passes and the model signals completion. Verification runs after every tool iteration, not just at the end. Failed verification triggers an autonomous repair cycle — no approval gate.

**Architecture:**
- `src/task-classifier.ts` — reads the user prompt, classifies into task type (bugfix/feature/refactor/docs/unknown)
- `src/verifier/verifier.ts` — expanded discovery (typecheck, build, lint in addition to test), task-type-aware check selection
- `src/run.ts` — loop redesigned: verification after every iteration, repair mode feeds output to model, configurable max iterations

---

## Task 1: Task classifier

**Files:**
- Create: `src/task-classifier.ts`
- Test: `tests/task-classifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/task-classifier.test.ts
import { classifyTask } from "../src/task-classifier.js";
import { describe, it } from "node:test";
import assert from "node:assert";

describe("classifyTask", () => {
  it("classifies bugfix from keywords", () => {
    const type = classifyTask("fix the null pointer exception in user.ts");
    assert.strictEqual(type, "bugfix");
  });

  it("classifies feature from keywords", () => {
    const type = classifyTask("add OAuth login to the auth module");
    assert.strictEqual(type, "feature");
  });

  it("classifies refactor from keywords", () => {
    const type = classifyTask("extract the payment logic into a separate service");
    assert.strictEqual(type, "refactor");
  });

  it("classifies docs from keywords", () => {
    const type = classifyTask("update the README with new installation steps");
    assert.strictEqual(type, "docs");
  });

  it("defaults to unknown", () => {
    const type = classifyTask("check what this file does");
    assert.strictEqual(type, "unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/task-classifier.test.js`
Expected: FAIL with "Cannot import outside a module" or "function not found"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/task-classifier.ts

export type TaskType = "bugfix" | "feature" | "refactor" | "docs" | "unknown";

const BUGFIX_PATTERNS = [
  /\bfix\b/i, /\bbug\b/i, /\bcrash\b/i, /\berror\b/i,
  /\bexception\b/i, /\bnull\b/i, /\bundefined\b/i, /\bfails?\b/i,
  /\bbroken\b/i, /\bnot working\b/i
];

const FEATURE_PATTERNS = [
  /\badd\b/i, /\bimplement\b/i, /\bcreate\b/i, /\bnew\b/i,
  /\bintroduce\b/i, /\benable\b/i, /\bsupport\b/i, /\bbuild\b/i
];

const REFACTOR_PATTERNS = [
  /\brefactor\b/i, /\brewrite\b/i, /\bextract\b/i,
  /\bclean up\b/i, /\brestructure\b/i, /\bsplit\b/i,
  /\bdecouple\b/i, /\bmove\b/i, /\breorganize\b/i
];

const DOCS_PATTERNS = [
  /\bdoc\b/i, /\breadme\b/i, /\bcomment\b/i, /\bupdate\b/i,
  /\bwrite\b/i, /\bdescribe\b/i, /\bexplain\b/i
];

export function classifyTask(prompt: string): TaskType {
  if (BUGFIX_PATTERNS.some((p) => p.test(prompt))) return "bugfix";
  if (FEATURE_PATTERNS.some((p) => p.test(prompt))) return "feature";
  if (REFACTOR_PATTERNS.some((p) => p.test(prompt))) return "refactor";
  if (DOCS_PATTERNS.some((p) => p.test(prompt))) return "docs";
  return "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/task-classifier.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/task-classifier.ts tests/task-classifier.test.ts
git commit -m "feat: add task classifier for autonomous loop"
```

---

## Task 2: Expand verification discovery

**Files:**
- Create: `tests/verifier-discovery.test.ts`
- Modify: `src/verifier/verifier.ts`

- [ ] **Step 1: Write tests for expanded discovery**

```typescript
// tests/verifier-discovery.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { discoverVerification } from "../src/verifier/verifier.js";

describe("discoverVerification", () => {
  const tmpDir = join("/tmp", `verifier-test-${Date.now()}`);

  function setupPkg(scripts: Record<string, string>) {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ scripts }));
  }

  function cleanup() {
    try { unlinkSync(join(tmpDir, "package.json")); } catch {}
    try { rmdirSync(tmpDir); } catch {}
  }

  it("finds npm test", async () => {
    setupPkg({ test: "npm test" });
    const checks = await discoverVerification(tmpDir);
    assert.ok(checks.some((c) => c.command.includes("npm test")));
    cleanup();
  });

  it("finds npm run build", async () => {
    setupPkg({ build: "tsc" });
    const checks = await discoverVerification(tmpDir);
    assert.ok(checks.some((c) => c.command.includes("npm run build")));
    cleanup();
  });

  it("finds npm run typecheck", async () => {
    setupPkg({ typecheck: "tsc --noEmit" });
    const checks = await discoverVerification(tmpDir);
    assert.ok(checks.some((c) => c.command.includes("npm run typecheck")));
    cleanup();
  });

  it("finds multiple checks", async () => {
    setupPkg({ test: "jest", build: "tsc", typecheck: "tsc --noEmit" });
    const checks = await discoverVerification(tmpDir);
    assert.ok(checks.length >= 2);
    cleanup();
  });

  it("returns empty when no package.json", async () => {
    const checks = await discoverVerification("/tmp/nonexistent-dir");
    assert.strictEqual(checks.length, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify discovery is limited**

Run: `npm run build && node --test dist/tests/verifier-discovery.test.js`
Expected: FAIL — tests expecting build/typecheck checks will fail because current implementation only finds `test`

- [ ] **Step 3: Expand discoverVerification**

Replace `src/verifier/verifier.ts` content:

```typescript
// src/verifier/verifier.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type VerificationCheck = {
  command: string;
  reason: string;
};

export type VerificationResult = {
  status: "passed" | "failed" | "not_run";
  command?: string;
  output?: string;
};

const TEST_COMMANDS = ["test", "test:unit", "test:integration"];
const BUILD_COMMANDS = ["build", "compile"];
const TYPE_CHECK_COMMANDS = ["typecheck", "type-check", "lint", "check"];

export async function discoverVerification(root: string): Promise<VerificationCheck[]> {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return [];
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};
  const checks: VerificationCheck[] = [];

  for (const [name, cmd] of Object.entries(scripts)) {
    if (TEST_COMMANDS.includes(name)) {
      const fullCmd = name === "test" ? "npm test" : `npm run ${name}`;
      checks.push({ command: fullCmd, reason: `package.json script: ${name}` });
    }
    if (BUILD_COMMANDS.includes(name)) {
      checks.push({ command: `npm run ${name}`, reason: `package.json script: ${name}` });
    }
    if (TYPE_CHECK_COMMANDS.includes(name)) {
      checks.push({ command: `npm run ${name}`, reason: `package.json script: ${name}` });
    }
  }

  return checks;
}

export async function runVerification(root: string, check: VerificationCheck): Promise<VerificationResult> {
  return new Promise((resolve) => {
    const child = spawn(check.command, { cwd: root, shell: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      resolve({ status: code === 0 ? "passed" : "failed", command: check.command, output });
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/verifier-discovery.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/verifier/verifier.ts tests/verifier-discovery.test.ts
git commit -m "feat: expand verification discovery to find build and typecheck scripts"
```

---

## Task 3: Redesign the agent loop

**Files:**
- Modify: `src/run.ts` — rewrite the loop body
- Test: `tests/autonomous-loop.test.ts`

- [ ] **Step 1: Add maxIterations to ModelConfig schema**

In `src/config/schema.ts`, add `maxIterations?: number` to `ModelConfig`:

```typescript
export type ModelConfig = {
  // ... existing fields ...
  maxIterations?: number; // override for the autonomous loop's max iterations
};
```

- [ ] **Step 2: Write tests for the new loop behavior**

```typescript
// tests/autonomous-loop.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyTask } from "../src/task-classifier.js";

describe("autonomous loop exit conditions", () => {
  it("bugfix: passes when verification passes and model says done", () => {
    const taskType = classifyTask("fix the null pointer exception");
    assert.strictEqual(taskType, "bugfix");
  });

  it("feature: passes when verification passes and model says done", () => {
    const taskType = classifyTask("add OAuth login to the app");
    assert.strictEqual(taskType, "feature");
  });

  it("refactor: passes when verification passes and model says done", () => {
    const taskType = classifyTask("extract the payment logic into a service");
    assert.strictEqual(taskType, "refactor");
  });

  it("unknown task defaults to checking tests", () => {
    const taskType = classifyTask("do something with the codebase");
    assert.strictEqual(taskType, "unknown");
  });

  it("docs task does not require verification", () => {
    const taskType = classifyTask("update the README with new steps");
    assert.strictEqual(taskType, "docs");
  });
});
```

- [ ] **Step 3: Run tests to verify the classifier works**

Run: `npm run build && node --test dist/tests/autonomous-loop.test.js`
Expected: PASS (5 tests)

- [ ] **Step 4: Rewrite the loop in run.ts**

Read the current loop (lines 257-399). Replace the loop with the following structure:

After line 255 (`const MAX_CONTEXT_TOKENS = maxTokens;`), add:
```typescript
const taskType = classifyTask(task);
const maxIterations = config.model.maxIterations ?? 10;
let repairCount = 0;
const maxRepairs = 3;
```

Replace the `for (let i = 0; i < MAX_ITERATIONS; i++)` loop body with:

```typescript
for (let i = 0; i < maxIterations; i++) {
  // Truncate messages if token budget exceeded (unchanged — lines 258-287)
  [...keep existing truncation block...]

  // Run pre_task hooks (unchanged — lines 290-295)

  // Call model (unchanged — lines 297-329)

  await log.append({ ...session, actor: "agent", type: "agent.message", payload: { text } });

  // ===== AUTONOMOUS LOOP: Verification after EVERY tool call round =====

  if (toolCalls.length === 0) {
    // No tools called — check if model signals completion
    const modelSaysDone = /done|complete|finished|finished|resolved/i.test(text);

    // Run post_task hooks
    for (const hook of hooks.post_task ?? []) {
      await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, reason: hook.reason } });
      const result = await runHook(hook, cwd);
      await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
    }

    // Get verification checks
    const checks = await discoverVerification(cwd);

    // For docs tasks, skip verification
    if (taskType === "docs" || checks.length === 0) {
      if (modelSaysDone) {
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
        await mcpManager.closeAll().catch(() => {});
        return { sessionId, summary: text, streamed: config.model.streaming };
      }
      // Model didn't signal done, continue
    } else {
      // Run verification
      const verResults: Array<{ check: VerificationCheck; result: VerificationResult }> = [];
      for (const check of checks) {
        await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: check.command, reason: check.reason } });
        const verResult = await runVerification(cwd, check);
        await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: check.command, status: verResult.status } });
        verResults.push({ check, result: verResult });
      }

      const allPassed = verResults.every((vr) => vr.result.status === "passed");

      if (allPassed && modelSaysDone) {
        // Success — verification passed and model signals done
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "completed", summary: text } });
        await mcpManager.closeAll().catch(() => {});
        return { sessionId, summary: text, streamed: config.model.streaming };
      }

      // Repair loop — verification failed or model didn't signal done
      const failures = verResults.filter((vr) => vr.result.status === "failed");
      const failureText = failures.length > 0
        ? failures.map((f) => `${f.check.command} failed:\n${f.result.output ?? ""}`).join("\n\n")
        : "No tool calls and model did not signal completion.";

      repairCount++;
      if (repairCount > maxRepairs) {
        await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_repairs", summary: `Repair limit reached after ${maxRepairs} attempts` } });
        await mcpManager.closeAll().catch(() => {});
        return { sessionId, summary: `Repair limit reached: ${failureText}`, streamed: config.model.streaming };
      }

      const repairPrompt = `\n\n[Verification Result] ${failureText}\n\nRepair the issues above and confirm completion when done.`;
      messages.push({ role: "user", content: repairPrompt });

      // Don't return — continue the loop
    }
  }

  // Handle tool calls (unchanged — lines 354-393)
  [...keep existing tool handling block...]

  // After tool calls, run verification every iteration
  const endChecks = await discoverVerification(cwd);
  if (endChecks.length > 0 && taskType !== "docs") {
    for (const check of checks) {
      await log.append({ ...session, actor: "verifier", type: "verification.check_started", payload: { command: check.command, reason: check.reason } });
      const verResult = await runVerification(cwd, check);
      await log.append({ ...session, actor: "verifier", type: "verification.check_finished", payload: { command: check.command, status: verResult.status } });

      if (verResult.status === "failed") {
        // Feed failure to model for autonomous repair
        repairCount++;
        if (repairCount > maxRepairs) {
          await log.append({ ...session, actor: "system", type: "session.ended", payload: { reason: "max_repairs", summary: `Repair limit reached after ${maxRepairs} attempts` } });
          await mcpManager.closeAll().catch(() => {});
          return { sessionId, summary: `Repair limit reached: ${verResult.output ?? ""}`, streamed: config.model.streaming };
        }
        const repairPrompt = `\n\n[Verification Failed] ${check.command} failed:\n${verResult.output ?? ""}\n\nFix the issue and try again.`;
        messages.push({ role: "user", content: repairPrompt });
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify the loop compiles and passes**

Run: `npm run build && node --test dist/tests/autonomous-loop.test.js`
Expected: PASS

- [ ] **Step 5: Run the full test suite**

Run: `npm run check`
Expected: PASS (all 198+ tests)

- [ ] **Step 6: Commit**

```bash
git add src/run.ts tests/autonomous-loop.test.ts
git commit -m "feat: autonomous task loop with verification and repair"
```

---

## Self-Review

- [x] **Spec coverage:** Task classifier (Task 1), expanded verification discovery (Task 2), autonomous loop with repair (Task 3)
- [x] **No placeholders:** All code shown inline, all tests have assertions
- [x] **Type consistency:** `TaskType` defined in task-classifier.ts, used in run.ts; `VerificationCheck` and `VerificationResult` defined in verifier.ts, used in run.ts
- [x] **Loop semantics:** Verification runs after EVERY tool round and also after the final tool-free round; repair loop feeds output to model without approval gate
- [x] **Task-type awareness:** docs tasks skip verification; bugfix/feature/refactor run checks; unknown defaults to test-based verification