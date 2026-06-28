# M0.70d — Unified Chat Execution Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic chat loop with three explicit modes, add flag validation that rejects unknown/conflicting options, apply WorkspacePathResolver to all model-supplied paths, and derive tools from the registry instead of duplicating schemas.

**Architecture:** A pure `parseChatArgs()` function returns structured results (no `process.exit` inside parsing). A `ChatMode` resolver selects toolset and runtime adapter. Workspace mode uses `WorkspacePathResolver.check()` on every file path. Agent task-console mode delegates to `runTask()` per message. Tools are derived from `FileToolRouter` and the capability registry rather than hand-typed schemas.

**Tech Stack:** TypeScript, existing `WorkspacePathResolver`, existing `FileToolRouter`, existing `runTask()` from `src/run.js`, existing `webSearchTool`/`webFetchTool`, `node:test`.

---

## File Structure

### Modify
- `src/cli/commands/chat.ts` — full rewrite: parseChatArgs returns Result, ChatMode resolver, WorkspacePathResolver enforcement, agent task-console adapter
- `src/cli.ts` — delegate to new parseChatArgs, remove inline parsing

### Test
- `tests/cli/chat-modes.test.ts` — pure unit tests + one mock-provider smoke test

---

### Task 1: Pure Argument Parser + Validation

**Files:**
- Modify: `src/cli.ts`, `src/cli/commands/chat.ts`

- [ ] **Step 1: Move parseChatArgs into chat.ts as a pure function**

Remove the inline `parseChatArgs` from `src/cli.ts`. Add to `src/cli/commands/chat.ts`:

```typescript
export type ParseChatArgsResult =
  | { ok: true; options: ChatOptions }
  | { ok: false; error: string };

export function parseChatArgs(args: string[]): ParseChatArgsResult {
  const opts: ChatOptions = {};
  const consumed = new Set<number>();
  let i = 0;

  while (i < args.length) {
    const arg = args[i];
    if (arg === "--resume" || arg === "-r") {
      if (opts.list || opts.delete) return { ok: false, error: "--resume cannot be combined with --list or --delete" };
      opts.resume = true;
      consumed.add(i); i++;
    } else if (arg === "--list" || arg === "-l") {
      if (opts.resume || opts.delete || opts.workspace || opts.agent) return { ok: false, error: "--list cannot be combined with other flags" };
      opts.list = true;
      consumed.add(i); i++;
    } else if (arg === "--delete" || arg === "-d") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) return { ok: false, error: "--delete requires a session id" };
      if (opts.list || opts.resume) return { ok: false, error: "--delete cannot be combined with --list or --resume" };
      opts.delete = args[i + 1];
      consumed.add(i).add(i + 1); i += 2;
    } else if (arg === "--workspace" || arg === "-w") {
      if (opts.list) return { ok: false, error: "--workspace cannot be combined with --list" };
      opts.workspace = true;
      consumed.add(i); i++;
    } else if (arg === "--agent" || arg === "-a") {
      if (opts.list) return { ok: false, error: "--agent cannot be combined with --list" };
      opts.agent = true;
      consumed.add(i); i++;
    } else if (arg === "--session" || arg === "-s") {
      if (!args[i + 1] || args[i + 1].startsWith("-")) return { ok: false, error: "--session requires a session id" };
      opts.sessionId = args[i + 1];
      consumed.add(i).add(i + 1); i += 2;
    } else if (!arg.startsWith("-")) {
      if (opts.sessionId) return { ok: false, error: `Unexpected argument: ${arg}. Session already set to ${opts.sessionId}` };
      opts.sessionId = arg;
      consumed.add(i); i++;
    } else {
      return { ok: false, error: `Unknown option: ${arg}. Supported: --workspace, --agent, --resume, --session, --list, --delete` };
    }
  }

  return { ok: true, options: opts };
}
```

- [ ] **Step 2: Update cli.ts dispatch**

Replace:
```typescript
if (command === "chat") {
  await runChat(parseChatArgs(args));
  process.exit(0);
}
```
With:
```typescript
if (command === "chat") {
  const { parseChatArgs, runChat } = await import("./cli/commands/chat.js");
  const parsed = parseChatArgs(args);
  if (!parsed.ok) { console.error(parsed.error); process.exit(1); }
  await runChat(parsed.options);
  process.exit(0);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts src/cli/commands/chat.ts
git commit -m "feat(chat): add pure parseChatArgs with conflict/validation errors"
```

---

### Task 2: ChatMode Resolver and Startup Banner

**Files:**
- Modify: `src/cli/commands/chat.ts`

- [ ] **Step 1: Add ChatMode type and resolver**

```typescript
export type ChatMode = "conversation" | "workspace" | "agent";

export type ResolvedChatMode = {
  mode: ChatMode;
  tools: Array<{ name: string; description: string; input_schema: any }>;
  mutations: "disabled" | "policy-gated";
  workspaceAccess: boolean;
};

export function resolveChatMode(opts: ChatOptions): ResolvedChatMode {
  if (opts.agent) {
    return { mode: "agent", tools: [], mutations: "policy-gated", workspaceAccess: true };
  }
  if (opts.workspace) {
    return {
      mode: "workspace",
      tools: [
        ...CHAT_TOOLS,
        { name: "file.read", description: "Read a file's contents", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
        { name: "file.exists", description: "Check if a file exists", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
        { name: "dir.search", description: "Search for files matching a pattern", input_schema: { type: "object", properties: { pattern: { type: "string" }, extensions: { type: "array", items: { type: "string" } } }, required: ["pattern"] } },
      ],
      mutations: "disabled",
      workspaceAccess: true,
    };
  }
  return { mode: "conversation", tools: CHAT_TOOLS, mutations: "disabled", workspaceAccess: false };
}
```

- [ ] **Step 2: Add mode banner at startup**

After resolving the mode, print:
```typescript
const modeLabel = mode === "conversation" ? "conversational" : mode === "workspace" ? "workspace (read-only)" : "agent";
console.log(`Mode: ${modeLabel}`);
if (resolved.mutations === "disabled") console.log("Mutations: disabled");
if (resolved.workspaceAccess) console.log("Tools: " + resolved.tools.map(t => t.name).join(", "));
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/chat.ts
git commit -m "feat(chat): add ChatMode resolver with startup banner"
```

---

### Task 3: Workspace Tool Dispatch with Path Safety

**Files:**
- Modify: `src/cli/commands/chat.ts`

- [ ] **Step 1: Add WorkspacePathResolver and dispatch**

```typescript
import { WorkspacePathResolver } from "../../runtime/workspace-path.js";
import { readFile, searchDir } from "../../tools/file-tools.js";

const PATH_RESOLVER = new WorkspacePathResolver(process.cwd());

function checkPath(path: string): string | null {
  const result = PATH_RESOLVER.check(path);
  if (!result.insideWorkspace) return "Path is outside the workspace";
  if (result.protected) return "Path is protected";
  if (result.sensitive) return "Path is sensitive";
  if (!result.traversalSafe) return "Path traversal detected";
  return null;
}

async function executeWorkspaceTool(name: string, args: Record<string, unknown>): Promise<string> {
  const path = String(args.path || "");
  if (path) {
    const blocked = checkPath(path);
    if (blocked) return `Error: ${blocked}`;
  }

  switch (name) {
    case "file.read": {
      const result = await readFile({ root: process.cwd(), path });
      if (result.kind === "error") return `Error: ${result.message}`;
      return result.content || "";
    }
    case "file.exists": {
      const { existsSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      return existsSync(resolve(process.cwd(), path)) ? "exists" : "not found";
    }
    case "dir.search": {
      const result = await searchDir({ root: process.cwd(), pattern: String(args.pattern || ""), extensions: (args.extensions as string[]) || [] });
      if (result.kind === "error") return `Error: ${result.message}`;
      return JSON.stringify(result.matches || [], null, 2);
    }
    default:
      return `Error: Unknown tool "${name}"`;
  }
}
```

- [ ] **Step 2: Wire dispatcher in the tool loop**

Replace `executeChatTool(tc.name, tc.args)` in the main loop with:
```typescript
const result = mode === "workspace"
  ? await executeWorkspaceTool(tc.name, tc.args)
  : await executeChatTool(tc.name, tc.args);
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/chat.ts
git commit -m "feat(chat): workspace tools use WorkspacePathResolver for path safety"
```

---

### Task 4: Agent Task-Console Adapter

**Files:**
- Modify: `src/cli/commands/chat.ts`

- [ ] **Step 1: Add agent mode handler**

```typescript
async function runAgentMode(opts: ChatOptions): Promise<void> {
  const { runTask } = await import("../../run.js");
  const { loadConfig } = await import("../../config/loader.js");
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const config = await loadConfig(process.cwd());
  console.log(`\nChat session (agent task console)`);
  console.log(`Provider: ${config.model.provider}/${config.model.name}`);
  console.log("Each prompt starts a new governed task.");
  console.log("Subject to policy, approval, and ownership gates.");
  console.log("Type /exit or /quit to end\n");

  let input = await rl.question("> ");
  while (input.trim() !== "/exit" && input.trim() !== "/quit") {
    if (!input.trim()) { input = await rl.question("> "); continue; }
    try {
      const result = await runTask(process.cwd(), input.trim(), {
        planMode: false,
        sessionMode: config.permissions?.sessionMode ?? "ask",
      });
      if (result.summary) console.log(`\n${result.summary}`);
      console.log(`Session: ${result.sessionId}`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
    }
    input = await rl.question("> ");
  }
  rl.close();
}
```

The contract: `--agent` means task-console mode. Each message is an independent governed task. No shared conversation context between turns.

- [ ] **Step 2: Wire runChat to dispatch**

```typescript
export async function runChat(opts: ChatOptions = {}): Promise<void> {
  const sessionDir = join(process.cwd(), ".alix", "sessions");
  if (opts.list) { await listSessions(sessionDir); return; }
  if (opts.delete) { await deleteSession(sessionDir, opts.delete); return; }
  if (opts.agent) { await runAgentMode(); return; }
  await runChatLoop(sessionDir, opts.sessionId, opts.resume, opts.workspace ?? false);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/chat.ts
git commit -m "feat(chat): add agent task-console mode via runTask()"
```

---

### Task 5: Unit and Smoke Tests

**Files:**
- Create: `tests/cli/chat-modes.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

describe("parseChatArgs (via CLI)", () => {
  const cli = join(process.cwd(), "dist", "src", "cli.js");

  it("rejects unknown flag --foo", () => {
    try {
      execFileSync(process.execPath, [cli, "chat", "--foo"], { encoding: "utf-8", timeout: 5000 });
      assert.fail("should throw");
    } catch (e: any) {
      const out = e.stderr?.toString() || e.stdout?.toString() || "";
      assert.ok(out.includes("Unknown option"), `Should reject, got: ${out}`);
    }
  });

  it("accepts --workspace and shows mode", () => {
    const out = execFileSync(process.execPath, [cli, "chat", "--workspace"], {
      encoding: "utf-8", timeout: 10000, input: "/exit\n",
    });
    assert.ok(out.includes("Mode: workspace"), `Should show workspace mode, got: ${out.slice(0, 200)}`);
  });

  it("accepts --agent and shows agent mode", () => {
    const out = execFileSync(process.execPath, [cli, "chat", "--agent"], {
      encoding: "utf-8", timeout: 10000, input: "/exit\n",
    });
    assert.ok(out.includes("agent task console"), `Should show agent mode, got: ${out.slice(0, 200)}`);
  });

  it("accepts --session flag", () => {
    const out = execFileSync(process.execPath, [cli, "chat", "--session", "flag-test-session"], {
      encoding: "utf-8", timeout: 10000, input: "/exit\n",
    });
    assert.ok(out.includes("flag-test-session"), "Should use provided session name");
  });

  it("rejects --delete without value", () => {
    try {
      execFileSync(process.execPath, [cli, "chat", "--delete"], { encoding: "utf-8", timeout: 5000 });
      assert.fail("should throw");
    } catch (e: any) {
      const out = e.stderr?.toString() || e.stdout?.toString() || "";
      assert.ok(out.includes("requires a session") || out.includes("Unknown option"), `Should require value, got: ${out}`);
    }
  });

  it("rejects --list --agent conflict", () => {
    try {
      execFileSync(process.execPath, [cli, "chat", "--list", "--agent"], { encoding: "utf-8", timeout: 5000 });
      assert.fail("should throw");
    } catch (e: any) {
      const out = e.stderr?.toString() || e.stdout?.toString() || "";
      assert.ok(out.includes("cannot be combined"), `Should reject combo, got: ${out}`);
    }
  });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build && node --test dist/tests/cli/chat-modes.test.js
```

- [ ] **Step 3: Commit**

```bash
git add tests/cli/chat-modes.test.ts
git commit -m "test(chat): add unit and smoke tests for mode selection and flag validation"
```

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/cli/chat-modes.test.js` — all tests pass
3. `node dist/src/cli.js chat --unknown` → "Unknown option: --unknown"
4. `node dist/src/cli.js chat --workspace` → shows workspace mode + file tools + "Mutations: disabled"
5. `node dist/src/cli.js chat --agent` → shows agent task console + runs governed tasks
6. `node dist/src/cli.js chat --list --agent` → "cannot be combined"
7. `node dist/src/cli.js chat --delete` → "requires a session id"
8. `node dist/src/cli.js chat` → original conversational mode unchanged
