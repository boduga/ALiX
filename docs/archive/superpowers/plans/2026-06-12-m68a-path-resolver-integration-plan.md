# M0.68a — WorkspacePathResolver Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the WorkspacePathResolver (M0.68) into FileToolRouter so all file tools validate paths through the central resolver before executing.

**Architecture:** The `FileToolRouter` currently resolves paths directly using `path.resolve(root, path)`. The `ShellToolRouter` and `PatchToolRouter` have similar ad-hoc path handling. After this milestone, file operations go through `WorkspacePathResolver.check()` first — rejecting sensitive paths (`.alix/`, `.ssh/`, `.git/`) and protected paths before any file I/O occurs.

**Tech Stack:** TypeScript, existing `WorkspacePathResolver` from `workspace-path.ts`, existing `FileToolRouter`/`ShellToolRouter` from `tool-router.ts`, `node:test`.

---

## File Structure

### Modify
- `src/tools/tool-router.ts` — accept optional `WorkspacePathResolver` in FileToolRouter, add path validation before file operations

### Test
- `tests/tools/path-resolver-integration.test.ts` — 8+ tests

---

### Task 1: Wire WorkspacePathResolver into FileToolRouter

**Files:**
- Modify: `src/tools/tool-router.ts`

- [ ] **Step 1: Import the path resolver**

Add at the top:
```typescript
import { WorkspacePathResolver } from "../runtime/workspace-path.js";
```

- [ ] **Step 2: Add pathResolver parameter to FileToolRouter constructor**

Change:
```typescript
export class FileToolRouter implements ToolRouter {
  private static readonly SUPPORTED_TOOLS = [...];

  constructor(
    private readonly root: string = "",
    private eventLog?: EventLog,
    private sessionId?: string
  ) {}
```

To:
```typescript
export class FileToolRouter implements ToolRouter {
  private static readonly SUPPORTED_TOOLS = [...];

  constructor(
    private readonly root: string = "",
    private eventLog?: EventLog,
    private sessionId?: string,
    private pathResolver?: WorkspacePathResolver,
  ) {}
```

- [ ] **Step 3: Add path validation before file operations**

Add a helper method:
```typescript
  /** Validate a file path through the path resolver. Returns error result if blocked. */
  private checkPath(rawPath: string): ToolResult | null {
    if (!this.pathResolver) return null; // no resolver configured — allow
    const result = this.pathResolver.check(rawPath);
    if (result.sensitive) {
      return { kind: "error", message: `Access denied: path is sensitive (${result.absolute})` };
    }
    if (result.protected && result.insideWorkspace) {
      return { kind: "error", message: `Access denied: path is protected (${result.absolute})` };
    }
    return null;
  }
```

Then at the top of `execute()`, before any file I/O, validate each path argument:
```typescript
  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const args = request.args as any;

    // Path validation via WorkspacePathResolver
    if (args.path) {
      const blocked = this.checkPath(args.path);
      if (blocked) return blocked;
    }
    if (args.root) {
      const blocked = this.checkPath(args.root);
      if (blocked) return blocked;
    }

    // ... existing execute logic ...
```

- [ ] **Step 4: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 2: Write integration tests

**Files:**
- Create: `tests/tools/path-resolver-integration.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileToolRouter } from "../../src/tools/tool-router.js";
import { WorkspacePathResolver } from "../../src/runtime/workspace-path.js";
import type { ToolCallRequest } from "../../src/tools/types.js";

const ROOT = "/home/user/project";
const resolver = new WorkspacePathResolver(ROOT, [".git/**", ".env"]);

describe("FileToolRouter path validation", () => {
  const router = new FileToolRouter(ROOT, undefined, undefined, resolver);

  it("allows reading a normal workspace file", async () => {
    const result = await router.execute({
      name: "file.read",
      args: { path: "src/index.ts" },
    } as ToolCallRequest);
    // Should fail with file not found (valid path, file doesn't exist), not a path rejection
    assert.equal(result.kind, "error");
    assert.ok(!result.message.includes("Access denied"), "must not be a path rejection");
  });

  it("blocks reading .alix/config.json path", async () => {
    const result = await router.execute({
      name: "file.read",
      args: { path: ".alix/config.json" },
    } as ToolCallRequest);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive"), "must reject sensitive .alix path");
  });

  it("blocks reading .git/config path", async () => {
    const result = await router.execute({
      name: "file.read",
      args: { path: ".git/config" },
    } as ToolCallRequest);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive") || result.message.includes("protected"), "must reject .git path");
  });

  it("blocks writing to .env path", async () => {
    const result = await router.execute({
      name: "file.create",
      args: { path: ".env", content: "SECRET=leak" },
    } as ToolCallRequest);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("protected"), "must reject protected .env path");
  });

  it("blocks deleting .git/HEAD path", async () => {
    const result = await router.execute({
      name: "file.delete",
      args: { path: ".git/HEAD" },
    } as ToolCallRequest);
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("sensitive"), "must reject sensitive .git path");
  });

  it("allows file.exists on safe path", async () => {
    const result = await router.execute({
      name: "file.exists",
      args: { path: "src/index.ts" },
    } as ToolCallRequest);
    // Should be error (file not found) or success, not a path rejection
    assert.notEqual(result.kind, "error" || result.message?.includes("Access denied"));
  });

  it("works without a resolver (backward compatibility)", async () => {
    const basicRouter = new FileToolRouter(ROOT);
    const result = await basicRouter.execute({
      name: "file.read",
      args: { path: ".alix/config.json" },
    } as ToolCallRequest);
    // Without resolver, .alix paths should NOT be blocked (backward compat)
    assert.equal(result.kind, "error");
    assert.ok(!result.message.includes("sensitive"), "backward compat: no path rejection without resolver");
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm run build && node --test dist/tests/tools/path-resolver-integration.test.js
```

Expected: 7/7 tests pass

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tools/path-resolver-integration.test.js` — 7/7 pass
3. Full tool tests — no regressions
4. No changes to PolicyGate, ApprovalStore, or ToolExecutor
5. When resolver is not provided, behavior is identical to before (backward compatible)
