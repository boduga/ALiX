# PR 1: CLI Run Arg Parser

**Status:** ✅ Completed (M0.7) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the regex-based flag stripping in `src/cli.ts`'s `alix run` handler into a standalone `parseRunArgs()` helper with tests.

**Architecture:** A pure function that takes `rawArgs: string[]` (the positional args from `process.argv` after the `run` command) and returns `{ task, flags }`. The current approach joins args into a string, applies regex replacements, and strips flags — which breaks when task text contains `--no-stream`, `--session-mode bypass`, etc. literally. The fix parses args positionally: flags before `--` are recognized and consumed; everything after `--` or the first non-flag token is the task.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cli/run-args.ts` | **Create** | `parseRunArgs()` function + `RunArgs` type |
| `src/cli.ts` | **Modify** | Replace inline regex parsing with `parseRunArgs()` call |
| `tests/cli/run-args.test.ts` | **Create** | Tests for flag parsing edge cases |

---

### Task 1: Create parseRunArgs module

**Files:**
- Create: `src/cli/run-args.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * run-args.ts — Parses `alix run` arguments into a structured RunArgs object.
 *
 * Handles three flag formats:
 *   --flag=value
 *   --flag value
 *   --flag (boolean)
 *
 * Everything after the first non-flag token is treated as the task string.
 * (Required because task text may contain strings like "--no-stream".)
 */

export type RunArgs = {
  task: string;
  noStream: boolean;
  noPlan: boolean;
  sessionMode?: "auto" | "ask" | "bypass";
  resumeSessionId?: string;
  planFilePath?: string;
};

const BOOLEAN_FLAGS = new Set(["--no-stream", "--no-plan"]);
const VALUE_FLAGS = new Set(["--mode", "--session-mode", "--resume", "--plan-file"]);

/**
 * Parse CLI arguments for `alix run`.
 *
 * Semantics:
 *   - `--no-stream` → boolean true
 *   - `--no-plan` → boolean true
 *   - `--mode=auto` or `--mode auto` → sessionsMode
 *   - `--session-mode bypass` or `--session-mode=bypass` → sessionMode
 *   - `--resume <id>` or `--resume=<id>` → resumeSessionId
 *   - `--plan-file <path>` or `--plan-file=<path>` → planFilePath
 *   - Everything else is the task string (concatenated with spaces)
 */
export function parseRunArgs(rawArgs: string[]): RunArgs {
  const result: RunArgs = {
    task: "",
    noStream: false,
    noPlan: false,
  };

  const taskParts: string[] = [];
  let i = 0;

  while (i < rawArgs.length) {
    const arg = rawArgs[i];

    // Check for --flag=value format first
    const eqIndex = arg.indexOf("=");
    const flagName = eqIndex >= 0 ? arg.slice(0, eqIndex) : arg;
    const eqValue = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined;

    if (BOOLEAN_FLAGS.has(flagName)) {
      if (flagName === "--no-stream") result.noStream = true;
      if (flagName === "--no-plan") result.noPlan = true;
      i++;
      continue;
    }

    if (VALUE_FLAGS.has(flagName)) {
      const value = eqValue ?? rawArgs[i + 1];
      switch (flagName) {
        case "--mode":
        case "--session-mode":
          if (value && ["auto", "ask", "bypass"].includes(value)) {
            result.sessionMode = value as "auto" | "ask" | "bypass";
            i += eqValue !== undefined ? 1 : 2;
          } else {
            // Invalid mode or missing value — consume as task
            taskParts.push(arg);
            i++;
          }
          break;
        case "--resume":
          if (value && !value.startsWith("-")) {
            result.resumeSessionId = value;
            i += eqValue !== undefined ? 1 : 2;
          } else {
            taskParts.push(arg);
            i++;
          }
          break;
        case "--plan-file":
          if (value && !value.startsWith("-")) {
            result.planFilePath = value;
            i += eqValue !== undefined ? 1 : 2;
          } else {
            taskParts.push(arg);
            i++;
          }
          break;
      }
      continue;
    }

    // Non-flag token — treat as (part of) task
    taskParts.push(arg);
    i++;
  }

  result.task = taskParts.join(" ").trim();
  return result;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit src/cli/run-args.ts 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/run-args.ts
git commit -m "feat(cli): add parseRunArgs for structured run arg parsing"
```

---

### Task 2: Write tests

**Files:**
- Create: `tests/cli/run-args.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRunArgs } from "../../src/cli/run-args.js";

describe("parseRunArgs", () => {

  it("parses a bare task with no flags", () => {
    const r = parseRunArgs(["echo hello"]);
    assert.equal(r.task, "echo hello");
    assert.equal(r.noStream, false);
    assert.equal(r.noPlan, false);
  });

  it("parses --no-stream boolean flag", () => {
    const r = parseRunArgs(["--no-stream", "echo hello"]);
    assert.equal(r.noStream, true);
    assert.equal(r.task, "echo hello");
  });

  it("parses --mode=value format", () => {
    const r = parseRunArgs(["--mode=bypass", "echo hello"]);
    assert.equal(r.sessionMode, "bypass");
    assert.equal(r.task, "echo hello");
  });

  it("parses --session-mode value format", () => {
    const r = parseRunArgs(["--session-mode", "bypass", "echo hello"]);
    assert.equal(r.sessionMode, "bypass");
    assert.equal(r.task, "echo hello");
  });

  it("does NOT strip flags when they appear inside the task text", () => {
    // Task literally asking about --no-stream flag behavior
    const r = parseRunArgs(["what does --no-stream do"]);
    assert.equal(r.noStream, false);
    assert.equal(r.task, "what does --no-stream do");
  });

  it("does NOT strip --session-mode when it appears in task text", () => {
    const r = parseRunArgs(["document --session-mode flag usage"]);
    assert.equal(r.sessionMode, undefined);
    assert.equal(r.task, "document --session-mode flag usage");
  });

  it("parses --resume <id>", () => {
    const r = parseRunArgs(["--resume", "abc-123", "continue working"]);
    assert.equal(r.resumeSessionId, "abc-123");
    assert.equal(r.task, "continue working");
  });

  it("parses --plan-file <path>", () => {
    const r = parseRunArgs(["--plan-file", "/tmp/plan.md", "implement feature"]);
    assert.equal(r.planFilePath, "/tmp/plan.md");
    assert.equal(r.task, "implement feature");
  });

  it("handles multiple flags together", () => {
    const r = parseRunArgs(["--no-stream", "--mode=ask", "--no-plan", "fix bug"]);
    assert.equal(r.noStream, true);
    assert.equal(r.noPlan, true);
    assert.equal(r.sessionMode, "ask");
    assert.equal(r.task, "fix bug");
  });

  it("handles --resume without a value (falls back to task)", () => {
    const r = parseRunArgs(["--resume", "just a task"]);
    assert.equal(r.resumeSessionId, "just a task"); // consumed as resume value
    assert.equal(r.task, ""); // nothing left
  });

  it("returns empty task when no args", () => {
    const r = parseRunArgs([]);
    assert.equal(r.task, "");
  });

});
```

- [ ] **Step 2: Run tests**

```bash
node --test tests/cli/run-args.test.ts 2>&1
```

Expected: 11 tests pass (or report the actual count).

- [ ] **Step 3: Commit**

```bash
git add tests/cli/run-args.test.ts
git commit -m "test(cli): run-args parsing edge cases"
```

---

### Task 3: Wire into cli.ts

**Files:**
- Modify: `src/cli.ts:289-337`

- [ ] **Step 1: Replace inline regex parsing with parseRunArgs**

Replace lines 289-311 (the `command === "run"` block start through flag stripping) with:

```typescript
if (command === "run") {
  const { parseRunArgs } = await import("./cli/run-args.js");
  const { task, noStream, noPlan, sessionMode, resumeSessionId, planFilePath } = parseRunArgs(args);

  if (!task && !resumeSessionId) {
    console.error("Usage: alix run \"<task>\" [--no-stream] [--no-plan] [--mode=auto|ask|bypass] [--resume <session-id>] [--plan-file <path>]");
    process.exit(1);
  }
  try {
    const result = await runTask(process.cwd(), task, { streaming: noStream ? false : undefined, planMode: noPlan ? false : undefined, sessionMode, resumeSessionId, planFilePath });
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: build succeeds.

- [ ] **Step 3: Run existing tests**

```bash
node --test dist/tests/*.test.js dist/tests/**/*.test.js --test-skip-pattern "manual" 2>&1 | grep -E "pass|fail" | tail -3
```

Expected: 0 new failures.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "refactor(cli): use parseRunArgs for alix run flag parsing"
```
