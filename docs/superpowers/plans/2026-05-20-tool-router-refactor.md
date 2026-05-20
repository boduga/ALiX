# ToolRouter Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 300+ line `ToolExecutor.execute()` switch with a `ToolRouter` interface and concrete router adapters per tool family.

**Architecture:** Introduce a `ToolRouter` interface. Each tool family (file, shell, patch, MCP, delegate) gets a concrete router. `ToolExecutor` becomes a thin dispatcher that routes to the appropriate adapter. Event logging stays in `ToolExecutor` — routers return results, executor handles logging.

**Tech Stack:** TypeScript, existing test infrastructure (node:test), no new dependencies.

---

### Task 1: Define ToolRouter Interface and Types

**Files:**
- Create: `src/tools/tool-router.ts`
- Test: `tests/tools/tool-router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/tools/tool-router.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";

describe("ToolRouter interface", () => {
  it("FileToolRouter handles file.read", async () => {
    const router = new FileToolRouter({ root: "/tmp" });
    const result = await router.execute({ toolCallId: "call_1", name: "file.read", args: { path: "test.txt" } });
    assert.equal(result.kind, "success");
  });

  it("ShellToolRouter handles shell.run", async () => {
    const router = new ShellToolRouter({ root: "/tmp" });
    const result = await router.execute({ toolCallId: "call_2", name: "shell.run", args: { command: "echo hello" } });
    assert.equal(result.kind, "success");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tools/tool-router.test.ts`
Expected: FAIL with "Cannot find module FileToolRouter"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/tools/tool-router.ts
import type { ToolResult } from "./types.js";

export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
};

export interface ToolRouter {
  canHandle(name: string): boolean;
  execute(request: ToolCallRequest): Promise<ToolResult>;
}

export class FileToolRouter implements ToolRouter {
  constructor(private root: string) {}

  canHandle(name: string): boolean {
    return ["file.read", "file.create", "file.delete", "file.exists", "dir.search"].includes(name);
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    // Delegates to existing file-tools
    throw new Error("Not implemented yet");
  }
}

export class ShellToolRouter implements ToolRouter {
  constructor(private root: string) {}

  canHandle(name: string): boolean {
    return name === "shell.run";
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    // Delegates to existing shell-tool
    throw new Error("Not implemented yet");
  }
}

export class PatchToolRouter implements ToolRouter {
  canHandle(name: string): boolean {
    return name === "patch.apply";
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    throw new Error("Not implemented yet");
  }
}

export class McpToolRouter implements ToolRouter {
  constructor(private mcpManager: import("../mcp/manager.js").McpManager) {}

  canHandle(name: string): boolean {
    return name.startsWith("mcp.");
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    throw new Error("Not implemented yet");
  }
}

export class CompositeToolRouter implements ToolRouter {
  constructor(private routers: ToolRouter[]) {}

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const router = this.routers.find(r => r.canHandle(request.name));
    if (!router) {
      return { kind: "error", message: `Unknown tool: ${request.name}`, retryable: false };
    }
    return router.execute(request);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tools/tool-router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-router.ts tests/tools/tool-router.test.ts
git commit -m "feat(tool-router): define ToolRouter interface and basic types"
```

---

### Task 2: Implement FileToolRouter

**Files:**
- Modify: `src/tools/tool-router.ts`
- Test: `tests/tools/tool-router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("FileToolRouter.read returns file content", async () => {
  await writeFile("/tmp/test-router-file.txt", "hello world", "utf8");
  const router = new FileToolRouter({ root: "/tmp" });
  const result = await router.execute({
    toolCallId: "call_read_1",
    name: "file.read",
    args: { path: "test-router-file.txt" }
  });
  assert.equal(result.kind, "success");
  assert.equal(result.content, "hello world");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tools/tool-router.test.ts`
Expected: FAIL — not implemented

- [ ] **Step 3: Write the implementation**

```typescript
// FileToolRouter.execute() — add after canHandle():
async execute(request: ToolCallRequest): Promise<ToolResult> {
  const { path } = request.args as { root?: string; path?: string; pattern?: string; extensions?: string[]; content?: string };

  switch (request.name) {
    case "file.read": {
      const { root: r, path: p } = request.args as { root?: string; path?: string };
      if (!p) return { kind: "error", message: "file.read requires path" };
      return readFile({ root: r ?? this.root, path: p });
    }
    case "dir.search": {
      const { root: r, pattern, extensions } = request.args as { root?: string; pattern: string; extensions?: string[] };
      return searchDir({ root: r ?? this.root, pattern, extensions: extensions ?? [] });
    }
    case "file.create": {
      const { root: r, path: p, content } = request.args as { root?: string; path?: string; content?: string };
      if (!p || content === undefined) return { kind: "error", message: "file.create requires path and content" };
      const { existsSync } = await import("node:fs");
      if (existsSync(p)) return { kind: "error", message: "File already exists", retryable: false };
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
      return { kind: "success", output: `File created: ${p}`, createdPath: p, changedFiles: [p] };
    }
    case "file.exists": {
      const { path: p } = request.args as { path: string };
      if (!p) return { kind: "error", message: "file.exists requires path" };
      return { kind: "success", output: existsSync(p) ? "exists" : "not found", exists: existsSync(p) };
    }
    default:
      return { kind: "error", message: `Unhandled: ${request.name}`, retryable: false };
  }
}
```

Import `readFile`, `searchDir`, `writeFile`, `mkdir`, `dirname`, `existsSync` from existing modules.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tools/tool-router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-router.ts tests/tools/tool-router.test.ts
git commit -m "feat(tool-router): implement FileToolRouter with file.read, dir.search, file.create, file.exists"
```

---

### Task 3: Implement ShellToolRouter

**Files:**
- Modify: `src/tools/tool-router.ts`
- Test: `tests/tools/tool-router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("ShellToolRouter executes command", async () => {
  const router = new ShellToolRouter({ root: "/tmp" });
  const result = await router.execute({
    toolCallId: "call_shell_1",
    name: "shell.run",
    args: { command: "echo 'shell test'" }
  });
  assert.equal(result.kind, "success");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tools/tool-router.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// ShellToolRouter.execute():
async execute(request: ToolCallRequest): Promise<ToolResult> {
  const { command, cwd, timeoutMs } = request.args as { command: string; cwd?: string; timeoutMs?: number };
  if (!command) return { kind: "error", message: "shell.run requires command" };
  return runCommand({ command, cwd: cwd ?? this.root, timeoutMs });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tools/tool-router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-router.ts tests/tools/tool-router.test.ts
git commit -m "feat(tool-router): implement ShellToolRouter"
```

---

### Task 4: Implement PatchToolRouter

**Files:**
- Modify: `src/tools/tool-router.ts`
- Test: `tests/tools/tool-router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("PatchToolRouter validates format before applying", async () => {
  const router = new PatchToolRouter({
    root: "/tmp",
    config: { model: { provider: "anthropic" } },
    editFormatPolicy: buildEditFormatPolicy({ provider: "anthropic" }),
  });
  const result = await router.execute({
    toolCallId: "call_patch_1",
    name: "patch.apply",
    args: { format: "unknown_format", patchText: "test" }
  });
  assert.equal(result.kind, "error");
  assert.ok(result.message.includes("not allowed"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tools/tool-router.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// PatchToolRouter — constructor and execute:
export class PatchToolRouter implements ToolRouter {
  constructor(
    private root: string,
    private config: AlixConfig,
    private editFormatPolicy?: EditFormatPolicy,
    private checkpointManager?: CheckpointManager,
    private eventLog?: EventLog,
    private sessionId?: string
  ) {}

  canHandle(name: string): boolean { return name === "patch.apply"; }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const { format, patchText, root: r } = request.args as { root?: string; format: string; patchText: string };
    const patchRoot = r ?? this.root;
    const policy = this.editFormatPolicy ?? buildEditFormatPolicy({ provider: this.config.model.provider });

    if (!policy.allowed.includes(format as EditFormat)) {
      return { kind: "error", message: `Format "${format}" not allowed`, retryable: false };
    }

    const changedFiles = extractPatchPaths(format as EditFormat, patchText);
    const patchResult = await applyPatch(patchRoot, format as any, patchText, {
      eventLog: this.eventLog,
      sessionId: this.sessionId,
      checkpointManager: this.checkpointManager,
    });

    return patchResult.status === "applied"
      ? { kind: "success", changedFiles: patchResult.changedFiles }
      : { kind: "error", message: "Patch invalid" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tools/tool-router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-router.ts tests/tools/tool-router.test.ts
git commit -m "feat(tool-router): implement PatchToolRouter with format validation"
```

---

### Task 5: Implement McpToolRouter and DelegateToolRouter

**Files:**
- Modify: `src/tools/tool-router.ts`
- Test: `tests/tools/tool-router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("McpToolRouter delegates to mcpManager", async () => {
  const mockMcpManager = { callTool: async () => ({ kind: "success", output: "mcp result" }) };
  const router = new McpToolRouter(mockMcpManager as any);
  const result = await router.execute({
    toolCallId: "call_mcp_1",
    name: "mcp.github.repos.list",
    args: {}
  });
  assert.equal(result.kind, "success");
  assert.equal(result.output, "mcp result");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tools/tool-router.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementations**

```typescript
export class McpToolRouter implements ToolRouter {
  constructor(private mcpManager: McpManager) {}

  canHandle(name: string): boolean { return name.startsWith("mcp."); }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const parts = request.name.split(".");
    const serverName = parts[1];
    const toolName = parts.slice(2).join("_");
    return this.mcpManager.callTool(`${serverName}/${toolName}`, request.args);
  }
}

export class DelegateToolRouter implements ToolRouter {
  constructor(private handlers?: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>>) {}

  canHandle(name: string): boolean { return name === "delegate"; }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const handler = this.handlers?.delegate;
    if (!handler) return { kind: "error", message: "Delegate handler not initialized", retryable: false };
    return handler(request.args);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/tools/tool-router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/tool-router.ts tests/tools/tool-router.test.ts
git commit -m "feat(tool-router): implement McpToolRouter and DelegateToolRouter"
```

---

### Task 6: Refactor ToolExecutor to Use CompositeToolRouter

**Files:**
- Modify: `src/tools/executor.ts`
- Test: Existing executor tests

- [ ] **Step 1: Verify existing tests still pass**

Run: `node --test dist/tests/tools/executor.test.js 2>&1 | tail -20`
Expected: All pass (or identify what breaks)

- [ ] **Step 2: Refactor execute() method**

Replace the switch statement with:
```typescript
private router: CompositeToolRouter;

async execute(request: ToolCallRequest): Promise<ExecuteResult> {
  // Policy check (remains in executor)
  const policyDecision = decidePolicy(this.config, {
    toolCallId: request.toolCallId,
    capability: inferCapability(request.name),
    ...request.args as { path?: string; command?: string }
  });

  if (policyDecision.decision === "deny") {
    await this.logEvent(TOOL_EVENT_TYPES.FAILED, { toolCallId: request.toolCallId, toolName: request.name, error: policyDecision.reason });
    return { kind: "denied", reason: policyDecision.reason };
  }

  // Logging wrapper — log BEFORE and AFTER, but delegate execution
  await this.logEvent(TOOL_EVENT_TYPES.REQUESTED, { toolCallId: request.toolCallId, toolName: request.name, argsPreview: sanitizeArgs(request.args) });
  await this.logEvent(TOOL_EVENT_TYPES.STARTED, { toolCallId: request.toolCallId, toolName: request.name });

  const result = await this.router.execute(request);

  // Log completion (unchanged)
  if (result.kind === "success") {
    await this.logEvent(TOOL_EVENT_TYPES.COMPLETED, { toolCallId: request.toolCallId, toolName: request.name, status: "success", durationMs: Date.now() - parseInt(request.toolCallId.split("_")[1]) });
  } else {
    await this.logEvent(TOOL_EVENT_TYPES.FAILED, { toolCallId: request.toolCallId, toolName: request.name, error: result.message });
  }

  return result;
}
```

- [ ] **Step 3: Constructor update**

```typescript
constructor(
  private config: AlixConfig,
  private log: EventLog,
  private root: string,
  private mcpManager?: McpManager,
  private editFormatPolicy?: EditFormatPolicy,
  private extraHandlers?: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>>,
  private checkpointManager?: CheckpointManager
) {
  this.router = new CompositeToolRouter([
    new FileToolRouter(root),
    new ShellToolRouter(root),
    new PatchToolRouter(root, config, editFormatPolicy, checkpointManager, log, this.sessionId()),
    new McpToolRouter(mcpManager!),
    new DelegateToolRouter(extraHandlers),
  ]);
}
```

- [ ] **Step 4: Run tests**

Run: `node --test dist/tests/tools/executor.test.js 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/tools/executor.ts
git commit -m "refactor(tool-executor): delegate to CompositeToolRouter"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -15`
Expected: All tests pass

- [ ] **Step 2: Manual smoke test**

```bash
npx alix run "echo test" --mode=auto --no-stream 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: verify all tool-router refactor tests pass"
```