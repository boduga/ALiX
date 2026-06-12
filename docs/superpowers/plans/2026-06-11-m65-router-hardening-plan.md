# M0.65 Router Hardening & False-Positive Guardrails

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the M0.64 natural-language tool intent router so ALiX routes real file/tool operations correctly while avoiding false positives that should remain chat, agent, or clarification routes.

**Architecture:** Keep the existing `taskRouter()` priority order, but add stricter matching, path/content validation, ambiguity detection, and regression tests around natural-language file operations. No changes to ApprovalStore, PolicyGate, ContinuationManager, or IFÁ-MAS diagnostics.

**Tech Stack:** TypeScript, existing task-router, existing ToolExecutor/PolicyGate flow, `node:test`.

---

## File Structure

### Modify
- `src/runtime/task-router.ts` — add guardrail helpers + integrate into `matchNaturalFileOperation()`

### Create
- `tests/runtime/task-router-natural-file-hardening.test.ts` — false-positive regression tests

---

### Task 1: Harden natural-language file operation matching

**Files:**
- Modify: `src/runtime/task-router.ts`

- [ ] **Step 1: Add conceptual/help question detector**

Add after the existing pattern constants and before `matchNaturalFileOperation()`:

```typescript
/**
 * Detect conceptual/help questions about file operations that should
 * NOT be routed to shell execution. These are questions, not commands.
 */
function isConceptualFileQuestion(task: string): boolean {
  const normalized = task.trim().toLowerCase();
  return (
    normalized.startsWith("how ") ||
    normalized.startsWith("how do ") ||
    normalized.startsWith("how to ") ||
    normalized.startsWith("what ") ||
    normalized.startsWith("why ") ||
    normalized.startsWith("explain ") ||
    normalized.includes(" tutorial") ||
    normalized.includes(" example") ||
    normalized.includes(" examples")
  );
}
```

- [ ] **Step 2: Add file/path target validator**

```typescript
/**
 * Check if a value looks like a concrete file or path target.
 * Rejects vague targets that would cause false-positive shell execution.
 */
function looksLikeFileTarget(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  // Accept explicit relative/absolute paths
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("/") || trimmed.startsWith("~/")) {
    return true;
  }

  // Accept names with file extensions (e.g. test.txt, config.json, README.md, my file.txt)
  if (/^[\w .~/-]+\.[A-Za-z0-9]{1,12}$/.test(trimmed)) {
    return true;
  }

  // Accept quoted names that include a file extension or path separator
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const unquoted = stripOuterQuotes(trimmed);
    return unquoted.includes("/") || /[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,12}$/.test(unquoted);
  }

  return false;
}
```

- [ ] **Step 3: Add safe delete target validator**

```typescript
/**
 * Check if a delete/remove target is specific enough to act on.
 * Rejects vague targets like "this", "that", "the file", "the section".
 */
function looksLikeDeleteTarget(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;

  const vagueTargets = [
    "this", "that", "it",
    "the file", "the folder", "the directory",
    "this feature", "the feature",
    "this section", "the section",
  ];

  if (vagueTargets.includes(trimmed)) return false;

  return looksLikeFileTarget(value);
}
```

- [ ] **Step 4: Integrate guardrails into `matchNaturalFileOperation()`**

Find `matchNaturalFileOperation()` and add these checks at the top of the function, before any pattern matching:

```typescript
function matchNaturalFileOperation(task: string): string | null {
  const trimmed = task.trim();

  // Guard 1: Conceptual/help questions are not file operations
  if (isConceptualFileQuestion(trimmed)) {
    return null;
  }

  // ... rest of existing function ...
```

Then for each pattern match, validate the path target before generating a command:

For `FILE_WRITE_PATTERN`, `FILE_CREATE_WITH_CONTENT`, `FILE_APPEND_PATTERN`:
- Add `if (!looksLikeFileTarget(match[2].trim()) && !looksLikeFileTarget(match[1].trim())) return null;` before the return

For `FILE_READ_PATTERN`:
- Add `if (!looksLikeFileTarget(match[1].trim())) return null;`

For `FILE_DELETE_PATTERN`:
- Add `if (!looksLikeDeleteTarget(match[1].trim())) return null;`

For `FILE_DELETE_DIR_PATTERN`:
- Add `if (!looksLikeFileTarget(match[1].trim())) return null;`

The modified function should look like:

```typescript
function matchNaturalFileOperation(task: string): string | null {
  const trimmed = task.trim();

  // Guard 1: Conceptual/help questions are not file operations
  if (isConceptualFileQuestion(trimmed)) {
    return null;
  }

  const content = (s: string) => stripOuterQuotes(s.trim());

  // "write X to Y" → printf '%s\n' 'X' > 'Y'
  let match = trimmed.match(FILE_WRITE_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[2].trim())) return null;
    return `printf '%s\\n' ${shellQuote(content(match[1]))} > ${shellQuote(match[2].trim())}`;
  }

  // "create Y with X" → printf '%s\n' 'X' > 'Y'
  match = trimmed.match(FILE_CREATE_WITH_CONTENT);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `printf '%s\\n' ${shellQuote(content(match[2]))} > ${shellQuote(match[1].trim())}`;
  }

  // "append X to Y" → printf '%s\n' 'X' >> 'Y'
  match = trimmed.match(FILE_APPEND_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[2].trim())) return null;
    return `printf '%s\\n' ${shellQuote(content(match[1]))} >> ${shellQuote(match[2].trim())}`;
  }

  // "delete directory Y" → rm -rf -- 'Y'
  match = trimmed.match(FILE_DELETE_DIR_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `rm -rf -- ${shellQuote(match[1].trim())}`;
  }

  // "delete Y" / "remove Y" → rm -- 'Y'
  match = trimmed.match(FILE_DELETE_PATTERN);
  if (match) {
    if (!looksLikeDeleteTarget(match[1].trim())) return null;
    return `rm -- ${shellQuote(match[1].trim())}`;
  }

  // "show Y" / "read Y" → cat -- 'Y'
  match = trimmed.match(FILE_READ_PATTERN);
  if (match) {
    if (!looksLikeFileTarget(match[1].trim())) return null;
    return `cat -- ${shellQuote(match[1].trim())}`;
  }

  return null;
}
```

---

### Task 2: Add false-positive guard tests

**Files:**
- Create: `tests/runtime/task-router-natural-file-hardening.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskRouter } from "../../src/runtime/task-router.js";

describe("router hardening — false positives", () => {
  // --- Conceptual/help prompts must NOT route to tool ---

  it('"how to write a file" does not route to tool', () => {
    const route = taskRouter("how to write a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"explain how to delete a file" does not route to tool', () => {
    const route = taskRouter("explain how to delete a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"what is a file" does not route to tool', () => {
    const route = taskRouter("what is a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"why write to a file" does not route to tool', () => {
    const route = taskRouter("why write to a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"how do I create a file" does not route to tool', () => {
    const route = taskRouter("how do I create a file");
    assert.notEqual(route.kind, "tool");
  });

  // --- Vague/ambiguous prompts must not route to tool ---

  it('"add a new button to the dashboard" does not route to tool', () => {
    const route = taskRouter("add a new button to the dashboard");
    assert.notEqual(route.kind, "tool");
  });

  it('"remove this feature" does not route to tool', () => {
    const route = taskRouter("remove this feature");
    assert.notEqual(route.kind, "tool");
  });

  it('"delete the section" does not route to tool', () => {
    const route = taskRouter("delete the section");
    assert.notEqual(route.kind, "tool");
  });

  it('"delete it" does not route to tool', () => {
    const route = taskRouter("delete it");
    assert.notEqual(route.kind, "tool");
  });

  it('"remove the file" with no specific path does not route to tool', () => {
    const route = taskRouter("remove the file");
    assert.notEqual(route.kind, "tool");
  });

  // --- Real file operations still route to tool ---

  it('"write hello to test.txt" still routes to tool', () => {
    const route = taskRouter("write hello to test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"append hello to test.txt" still routes to tool', () => {
    const route = taskRouter("append hello to test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"read test.txt" still routes to tool', () => {
    const route = taskRouter("read test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"delete test.txt" still routes to tool', () => {
    const route = taskRouter("delete test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"show notes.txt" still routes to tool', () => {
    const route = taskRouter("show notes.txt");
    assert.equal(route.kind, "tool");
  });

  // --- Path variants ---

  it('"write hello to ./notes/test.txt" routes to tool', () => {
    const route = taskRouter("write hello to ./notes/test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"write hello to /tmp/output.txt" routes to tool', () => {
    const route = taskRouter("write hello to /tmp/output.txt");
    assert.equal(route.kind, "tool");
  });

  it("write with semicolon injection is shell-quoted, not executable", () => {
    const route = taskRouter('write hello to test.txt; rm -rf .');
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      const cmd = route.args.command;
      // The semicolon and following command must be inside quotes, not executed as shell syntax
      assert.ok(cmd.includes(".txt; rm -rf .'") || cmd.includes("'.txt;"), "semicolons must be inside shell quotes");
      assert.ok(!cmd.includes("> test.txt; rm -rf ."), "must not produce unquoted semicolon command separator");
      assert.ok(cmd.startsWith("printf"), "must use printf");
    }
  });

  it('"show my file.txt" routes to tool and shell-quotes the path', () => {
    const route = taskRouter("show my file.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(route.args.command.includes("'my file.txt'"), "must quote path with spaces");
    }
  });

  // --- Additional path/target variants ---

  it('"create README.md with hello" routes to tool', () => {
    const route = taskRouter("create README.md with hello");
    assert.equal(route.kind, "tool");
  });

  it('"delete directory ./tmp" routes to rm -rf with quoted path', () => {
    const route = taskRouter("delete directory ./tmp");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(route.args.command.includes("-rf"), "directory delete must use -rf");
      assert.ok(route.args.command.includes("'./tmp'"), "path must be quoted");
    }
  });

  it('"remove ./tmp/cache" routes to tool only with specific path', () => {
    const route = taskRouter("remove ./tmp/cache");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(route.args.command.startsWith("rm"), "must use rm");
      assert.ok(route.args.command.includes("'./tmp/cache'"), "path must be quoted");
    }
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm run build && node --test dist/tests/runtime/task-router-natural-file-hardening.test.js
```
Expected: 22/22 tests pass

---

### Task 3: Verify no regressions

- [ ] **Step 1: Run full test suite**

```bash
npm run build
node --test dist/tests/runtime/task-router-natural-file-hardening.test.js
node --test dist/tests/runtime/*.test.js
```

Expected: All tests pass, no regressions

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/runtime/task-router-natural-file-hardening.test.js` — 22/22 pass
3. `node --test dist/tests/runtime/task-router-natural-file.test.js` — existing 12 tests still pass
4. Full suite — no regressions
5. Git diff shows only the intended files
