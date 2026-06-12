# M0.64 Natural-Language Tool Intent Routing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user types a natural-language file operation like `write "hello world" to test.txt`, ALiX classifies it as a tool intent and routes it through ToolExecutor → PolicyGate → approval prompt, instead of responding with chat text.

**Architecture:** Extend the task router's natural language mapping to recognize file read/write/append/delete/create patterns. Convert them into structured `shell.run` tool intents with the corresponding command. The existing PolicyGate + ApprovalStore + inline prompt already handles the rest.

**Tech Stack:** TypeScript, existing task-router, existing ToolExecutor/PolicyGate patterns, `node:test`.

---

## File Structure

### Modify
- `src/runtime/task-router.ts` — add natural-language file operation patterns

### Create
- `tests/runtime/task-router-natural-file.test.ts` — guard tests for file intent routing

---

### Task 1: Extend the natural language router with file operation patterns

**Files:**
- Modify: `src/runtime/task-router.ts`

**Approach:** Add a `matchNaturalFileOperation()` function that detects file write/append/create/delete/read patterns and returns structured tool commands. Insert it as step 2b in the classification priority (after natural shell phrases, before grounded chat).

- [ ] **Step 1: Add the file operation matcher**

After the `NATURAL_SHELL_MAP` (line 52) and before `normalizePhrase`, add:

```typescript
/**
 * Regex patterns for natural-language file operations.
 * These convert "write X to Y" / "create Y with X" / "delete Y" etc.
 * into shell commands that route through ToolExecutor → PolicyGate.
 * All paths and content are shell-quoted to prevent command injection.
 */

const FILE_WRITE_PATTERN = /^(?:write|put|save)\s+(.+?)\s+(?:to|into|in|as)\s+(.+)$/i;
const FILE_APPEND_PATTERN = /^(?:append|add)\s+(.+?)\s+(?:to|into)\s+(.+)$/i;
const FILE_DELETE_PATTERN = /^(?:delete|remove|rm)\s+(.+)$/i;
const FILE_READ_PATTERN = /^(?:show|read|cat|display|view|print|get)\s+(.+)$/i;
const FILE_CREATE_WITH_CONTENT = /^create\s+(.+?)\s+(?:with|containing|that says)\s+(.+)$/i;
const FILE_DELETE_DIR_PATTERN = /^(?:delete|remove)\s+(?:directory|folder|dir)\s+(.+)$/i;

/**
 * Shell-quote a string safely. Wraps in single quotes and escapes
 * any single quotes inside by ending the quote, inserting an escaped
 * quote, and resuming. Prevents command injection through paths or content.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Strip surrounding quotes if present (both single and double).
 * The regex captures the content inside, so we handle the case where
 * the user typed "hello world" with quotes and we want the inner text.
 */
function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Try to match a file operation from natural language.
 * Returns a shell command (with shell-quoted args) if matched, null otherwise.
 * All paths and content are quoted to prevent injection — the shell receives
 * exactly the intended string, never additional commands.
 */
function matchNaturalFileOperation(task: string): string | null {
  const trimmed = task.trim();

  // Strip outer quotes from content if present for better UX
  const content = (s: string) => stripOuterQuotes(s.trim());

  // "write X to Y" → printf '%s\n' 'X' > 'Y'
  let match = trimmed.match(FILE_WRITE_PATTERN);
  if (match) {
    return `printf '%s\\n' ${shellQuote(content(match[1]))} > ${shellQuote(match[2].trim())}`;
  }

  // "create Y with X" → printf '%s\n' 'X' > 'Y'
  match = trimmed.match(FILE_CREATE_WITH_CONTENT);
  if (match) {
    return `printf '%s\\n' ${shellQuote(content(match[2]))} > ${shellQuote(match[1].trim())}`;
  }

  // "append X to Y" → printf '%s\n' 'X' >> 'Y'
  match = trimmed.match(FILE_APPEND_PATTERN);
  if (match) {
    return `printf '%s\\n' ${shellQuote(content(match[1]))} >> ${shellQuote(match[2].trim())}`;
  }

  // "delete directory Y" / "remove folder Y" → rm -rf -- 'Y'
  match = trimmed.match(FILE_DELETE_DIR_PATTERN);
  if (match) {
    return `rm -rf -- ${shellQuote(match[1].trim())}`;
  }

  // "delete Y" / "remove Y" → rm -- 'Y' (rm -rf only for dir/folder)
  match = trimmed.match(FILE_DELETE_PATTERN);
  if (match) {
    return `rm -- ${shellQuote(match[1].trim())}`;
  }

  // "show Y" / "read Y" → cat -- 'Y' (safe, read-only)
  match = trimmed.match(FILE_READ_PATTERN);
  if (match) {
    return `cat -- ${shellQuote(match[1].trim())}`;
  }

  return null;
}
```

- [ ] **Step 2: Wire it into the classification priority**

In `taskRouter()`, add the file operation check after the natural shell phrase check (after line 98, before the grounded chat check):

```typescript
  // 2b. Natural-language file operations — route to shell.run tool
  const naturalFileCommand = matchNaturalFileOperation(task);
  if (naturalFileCommand) {
    return {
      kind: "tool",
      tool: "shell.run",
      args: { command: naturalFileCommand },
    };
  }
```

The full priority order becomes:
1. Shell tasks (exact commands) → tool
2. Natural shell phrases ("list files") → tool
3. **Natural file operations ("write X to Y") → tool** ← NEW
4. Grounded questions → grounded_chat
5. Research/docs → chat
6. Everything else → agent

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 2: Write tests

**Files:**
- Create: `tests/runtime/task-router-natural-file.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskRouter } from "../../src/runtime/task-router.js";

describe("natural-language file operation routing", () => {
  // --- File write ---

  it('"write hello to test.txt" routes to tool shell.run, not chat', () => {
    const route = taskRouter('write "hello world" to test.txt');
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "shell.run");
      assert.ok(typeof route.args.command === "string");
      assert.ok(route.args.command.includes("echo"));
      assert.ok(route.args.command.includes("test.txt"));
    }
  });

  it('"create test.txt with hello" routes to tool', () => {
    const route = taskRouter("create test.txt with hello world");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(route.args.command.includes("echo"));
      assert.ok(route.args.command.includes("test.txt"));
    }
  });

  it('"save X to Y" routes to tool', () => {
    const route = taskRouter("save data to output.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(route.args.command.includes("echo"));
      assert.ok(route.args.command.includes("output.txt"));
    }
  });

  it('"put X in Y" routes to tool', () => {
    const route = taskRouter("put hello in greeting.txt");
    assert.equal(route.kind, "tool");
  });

  // --- File append ---

  it('"append hello to test.txt" routes to tool', () => {
    const route = taskRouter("append hello to test.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(route.args.command.includes(">>"));
      assert.ok(route.args.command.includes("test.txt"));
    }
  });

  it('"add line to file" routes to tool', () => {
    const route = taskRouter("add goodbye to log.txt");
    assert.equal(route.kind, "tool");
  });

  // --- File delete ---

  it('"delete test.txt" routes to tool and requires approval', () => {
    const route = taskRouter("delete test.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(route.args.command.startsWith("rm"));
    }
  });

  it('"remove temp dir" routes to tool', () => {
    const route = taskRouter("remove temp");
    assert.equal(route.kind, "tool");
  });

  // --- File read ---

  it('"show test.txt" routes to tool (safe read path)', () => {
    const route = taskRouter("show test.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(route.args.command.startsWith("cat"));
    }
  });

  it('"read config.json" routes to tool', () => {
    const route = taskRouter("read config.json");
    assert.equal(route.kind, "tool");
  });

  it('"view file.txt" routes to tool', () => {
    const route = taskRouter("view file.txt");
    assert.equal(route.kind, "tool");
  });

  // --- Existing routes still work ---

  it('"list files" still routes to tool', () => {
    const route = taskRouter("list files");
    assert.equal(route.kind, "tool");
  });

  it('"how to write a file" does NOT route to tool (no file target)', () => {
    const route = taskRouter("how to write a file");
    // Should fall through to agent or chat, not tool
    assert.notEqual(route.kind, "tool");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run build && node --test dist/tests/runtime/task-router-natural-file.test.js`
Expected: 13/13 tests pass

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/runtime/task-router-natural-file.test.js` — 13/13 pass
3. `node --test dist/tests/runtime/*.test.js` — no regressions
4. Full suite — no regressions
5. Git diff shows only the intended files
