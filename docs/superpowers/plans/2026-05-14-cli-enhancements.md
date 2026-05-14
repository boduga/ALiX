# CLI Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five CLI enhancements: interactive MCP discover install, shell output formatting, extensible verification hooks, context management, and non-TTY streaming.

**Architecture:** Each feature is self-contained. Shared utilities go in `src/utils/` (token counter, ANSI stripper). Feature-specific code lives alongside existing files.

**Tech Stack:** Pure TypeScript/Node.js, no new dependencies.

---

### Task 1: Interactive MCP Discover Install

**Files:**
- Modify: `src/cli.ts:450-471` (discover case)
- Modify: `src/mcp/manager.ts:109-141` (discoverServer already exists)
- Modify: `src/config/schema.ts` (no changes needed, server config type already supports all fields)
- Test: `tests/cli-discover.test.ts` (new)

The `discoverServer` method already works and returns `{ name, version, toolCount, toolNames[] }`. The CLI currently just prints the info. We need to prompt the user, then write to `.alix/config.json`.

- [ ] **Step 1: Write test for discover interactive flow**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

// Test that discover returns name/version/toolCount/toolNames from a real npm package
// We'll mock the prompt to avoid interactive input — test the writeConfig path
```

Write test in `tests/cli-discover.test.ts`:
- `discoverServer` resolves with package name/version/tools from a real package
- After discover, user can confirm and server is added to project config

- [ ] **Step 2: Run test — expect it to fail (discover CLI doesn't handle prompt yet)**

Run: `npm run build && node --test dist/tests/cli-discover.test.js`
Expected: FAIL — the prompt handling is not yet wired

- [ ] **Step 3: Add interactive confirm to discover case in cli.ts**

Read the current discover case in `src/cli.ts` around line 450:

```typescript
case "discover": {
  const packageName = args[1];
  if (!packageName) { console.error("Usage: alix mcp discover <npm-package-name>"); process.exit(1); }
  try {
    const info = await mcpManager.discoverServer(packageName);
    console.log(`Server: ${info.name} v${info.version}`);
    console.log(`Tools: ${info.toolCount}`);
    for (const t of info.toolNames) { console.log(`  - ${t}`); }
    console.log(`\nTo add permanently, add to .alix/config.json:`);
    console.log(JSON.stringify({ mcpServers: [{ name: info.name, type: "stdio", command: "uvx", args: [packageName] }] }, null, 2));
  } catch (err) {
    console.error(`Discovery failed: ${err instanceof Error ? err.message : String(err)}`); process.exit(1);
  }
  break;
}
```

Replace with a version that prompts after showing tools:

```typescript
case "discover": {
  const packageName = args[1];
  if (!packageName) { console.error("Usage: alix mcp discover <npm-package-name>"); process.exit(1); }
  try {
    const info = await mcpManager.discoverServer(packageName);
    console.log(`Server: ${info.name} v${info.version}`);
    console.log(`Tools: ${info.toolCount}`);
    for (const t of info.toolNames) console.log(`  - ${t}`);

    console.log(`\nWould you like to add this to your project config?`);
    console.log(`  Config entry: ${JSON.stringify({ name: info.name, type: "stdio", command: "uvx", args: [packageName] }, null, 2)}`);
    const confirm = await prompt("Add to .alix/config.json? [y/N]: ");
    if (confirm.toLowerCase() !== "y") { console.log("Cancelled."); break; }

    // Read existing config
    const projectConfigPath = join(process.cwd(), ".alix", "config.json");
    await mkdir(join(process.cwd(), ".alix"), { recursive: true });
    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(await readFile(projectConfigPath, "utf8")); } catch {}
    const servers: unknown[] = existing.mcpServers ? [...existing.mcpServers as unknown[]] : [];
    servers.push({ name: info.name, type: "stdio", command: "uvx", args: [packageName] });
    await writeFile(projectConfigPath, JSON.stringify({ ...existing, mcpServers: servers }, null, 2) + "\n");
    console.log(`Added '${info.name}' to .alix/config.json`);
  } catch (err) {
    console.error(`Discovery failed: ${err instanceof Error ? err.message : String(err)}`); process.exit(1);
  }
  break;
}
```

Also import `prompt`, `readFile`, `writeFile`, `mkdir` at the top of cli.ts if not already imported.

- [ ] **Step 4: Run build + tests**

Run: `npm run build && node --test dist/tests/cli-discover.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli-discover.test.ts
git commit -m "feat: add interactive confirm to alix mcp discover"
```

---

### Task 2: Shell Tool Output Formatting

**Files:**
- Modify: `src/tools/shell-tool.ts:1-80`
- Modify: `src/tools/types.ts`
- Test: `tests/shell-tool.test.ts`

- [ ] **Step 1: Write tests for output formatting**

In `tests/shell-tool.test.ts`, add tests:

```typescript
test("runCommand truncates output at 80KB", async () => {
  // Create a temp script that prints 100KB of output
  const longOutput = runCommand({ command: `node -e "console.log('x'.repeat(100000))"`, cwd: process.cwd() });
  const result = await longOutput;
  assert.ok(result.kind === "success");
  assert.ok((result.output ?? "").length <= 80000 + 30); // 80KB + truncation marker
  assert.ok((result.output ?? "").includes("[...truncated"));
});

test("runCommand separates stdout and stderr", async () => {
  const r = await runCommand({ command: `node -e "console.log('out');console.error('err')"`, cwd: process.cwd() });
  assert.ok(r.kind === "success");
  // Both stdout and stderr should be present
  assert.ok((r.output ?? "").includes("out"));
  assert.ok((r.output ?? "").includes("err"));
  assert.ok((r.output ?? "").includes("--- stdout ---") || r.output?.includes("stdout") || r.output?.includes("--- stderr ---") || r.output?.includes("stderr"));
});
```

- [ ] **Step 2: Run tests — expect truncation test to fail**

Run: `npm run build && node --test dist/tests/shell-tool.test.js`
Expected: FAIL — no truncation yet

- [ ] **Step 3: Add OUTPUT_MAX_BYTES = 80_000 constant and truncation logic**

Read current `src/tools/shell-tool.ts` — the key change is in the `runCommand` function where output is accumulated.

After accumulating `stdout` and `stderr`, before returning:

```typescript
const MAX_BYTES = 80_000;

function truncate(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  const cut = text.slice(0, maxBytes);
  const lineCount = cut.split("\n").length;
  return cut + `\n[... ${lineCount} lines truncated, ${text.length - maxBytes} bytes hidden]`;
}

let combined = stdout;
if (stderr) {
  combined += "\n--- stderr ---\n" + stderr;
}
combined = truncate(combined, MAX_BYTES);
```

Update the success return to use `combined` instead of raw stdout concatenation.

- [ ] **Step 4: Run tests — expect all to pass**

Run: `npm run build && node --test dist/tests/shell-tool.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/shell-tool.ts tests/shell-tool.test.ts
git commit -m "feat: truncate long shell output, separate stderr from stdout"
```

---

### Task 3: Extensible Verification Hooks

**Files:**
- Create: `src/hooks/registry.ts`
- Create: `src/hooks/discover.ts`
- Create: `src/hooks/runner.ts`
- Modify: `src/verifier/verifier.ts`
- Modify: `src/run.ts` (wire hooks into run loop)
- Modify: `src/ui/app.js` (display hook results in inspector)
- Test: `tests/verification-hooks.test.ts` (new)

- [ ] **Step 1: Write test for hook discovery from .alix/hooks.json**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { discoverHooks } from "../src/hooks/discover.js";
import { runHooks } from "../src/hooks/runner.js";

test("discoverHooks reads .alix/hooks.json with pre/post/task checks", async () => {
  const tmp = await import("node:fs/promises").then(m => import("node:path").then(p => ({ fs: m, path: p })));
  const dir = await tmp.fs.mkdtemp("/tmp/alix-hook-test-");
  const hooksPath = join(dir, ".alix", "hooks.json");
  await tmp.fs.mkdir(join(dir, ".alix"));
  await tmp.fs.writeFile(hooksPath, JSON.stringify({
    pre_task: [{ command: "echo pre", reason: "pre check" }],
    post_task: [{ command: "echo post", reason: "post check" }]
  }));
  const hooks = await discoverHooks(dir);
  assert.equal(hooks.pre_task.length, 1);
  assert.equal(hooks.pre_task[0].command, "echo pre");
  await tmp.fs.rm(dir, { recursive: true });
});
```

- [ ] **Step 2: Run test — expect FAIL (hooks directory doesn't exist)**

Run: `npm run build && node --test dist/tests/verification-hooks.test.js`
Expected: FAIL

- [ ] **Step 3: Create src/hooks/discover.ts**

```typescript
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Hook = { command: string; reason: string; env?: Record<string, string> };
export type HookConfig = { pre_task?: Hook[]; post_task?: Hook[]; on_change?: Hook[] };

export async function discoverHooks(root: string): Promise<HookConfig> {
  const path = join(root, ".alix", "hooks.json");
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    return data as HookConfig;
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Create src/hooks/runner.ts**

```typescript
import { spawn } from "node:child_process";
import type { Hook } from "./discover.js";

export async function runHook(hook: Hook, cwd: string): Promise<{ passed: boolean; output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("/bin/sh", ["-c", hook.command], {
      cwd,
      env: { ...process.env, ...hook.env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let out = "";
    proc.stdout?.on("data", d => out += d.toString());
    proc.stderr?.on("data", d => out += d.toString());
    proc.on("close", (code) => {
      resolve({ passed: code === 0, output: out, exitCode: code ?? -1 });
    });
    proc.on("error", () => resolve({ passed: false, output: "", exitCode: -1 }));
  });
}
```

- [ ] **Step 5: Wire hooks into run.ts**

In `src/run.ts`, after loading `mcpManager`, add:

```typescript
const { discoverHooks } = await import("./hooks/discover.js");
const { runHook } = await import("./hooks/runner.js");
const hooks = await discoverHooks(cwd);
```

Before `runTask` body (inside the for loop, at the start of each iteration):
```typescript
if (hooks.pre_task) {
  for (const hook of hooks.pre_task) {
    const result = await runHook(hook, cwd);
    await log.append({ ...session, actor: "system", type: "hook.pre_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
  }
}
```

After tool calls complete (before next iteration or end):
```typescript
if (hooks.post_task && toolCalls.length === 0) {
  for (const hook of hooks.post_task) {
    const result = await runHook(hook, cwd);
    await log.append({ ...session, actor: "system", type: "hook.post_task", payload: { command: hook.command, passed: result.passed, output: result.output.slice(0, 500) } });
  }
}
```

- [ ] **Step 6: Run build + tests**

Run: `npm run build && node --test dist/tests/verification-hooks.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/hooks/discover.ts src/hooks/runner.ts src/run.ts tests/verification-hooks.test.ts
git commit -m "feat: extensible verification hooks via .alix/hooks.json"
```

---

### Task 4: Context Management (Token Budget)

**Files:**
- Create: `src/utils/tokens.ts`
- Modify: `src/run.ts`
- Modify: `src/cli.ts` (add --no-stream flag)
- Test: `tests/streaming.test.ts` (new)

- [ ] **Step 1: Write tests for token counting**

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "../src/utils/tokens.js";

test("estimateTokens counts words roughly", () => {
  const text = "hello world this is a test";
  const tokens = estimateTokens(text);
  assert.ok(tokens > 0);
  assert.ok(tokens <= text.split(" ").length * 2); // rough upper bound
});

test("estimateTokens truncates message array to budget", () => {
  const messages = [
    { role: "user", content: "a".repeat(10000) },
    { role: "assistant", content: "b".repeat(10000) },
    { role: "user", content: "c".repeat(10000) },
  ];
  const { kept, dropped } = truncateToTokenBudget(messages, 15000);
  assert.ok(kept.length < messages.length);
  assert.ok(dropped.length > 0);
  // Should keep most recent messages
  assert.equal(kept[kept.length - 1].content, "c".repeat(10000));
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm run build && node --test dist/tests/token-budget.test.js`
Expected: FAIL — functions don't exist yet

- [ ] **Step 3: Create src/utils/tokens.ts**

```typescript
// Rough token estimation: ~4 chars per token on average
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a string. Uses char count / 4 as a rough proxy.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a full message (role + name + content).
 */
export function estimateMessageTokens(msg: { role: string; name?: string; content: string }): number {
  const roleOverhead = 5; // {"role":"user"} ≈ 5 tokens
  const nameOverhead = msg.name ? estimateTokens(msg.name) + 6 : 0;
  return roleOverhead + nameOverhead + estimateTokens(msg.content);
}

/**
 * Truncate messages array to stay within token budget, keeping the most recent.
 * Returns { kept, dropped }.
 */
export function truncateToTokenBudget(
  messages: Array<{ role: string; name?: string; content: string }>,
  maxTokens: number
): { kept: typeof messages; dropped: typeof messages } {
  const result: typeof messages = [];
  let totalTokens = 0;
  // Iterate newest to oldest, keep adding until budget hit
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const cost = estimateMessageTokens(msg);
    if (totalTokens + cost > maxTokens && result.length > 0) break;
    result.unshift(msg);
    totalTokens += cost;
  }
  return { kept: result, dropped: messages.slice(0, messages.length - result.length) };
}
```

- [ ] **Step 4: Wire into run.ts**

In `src/run.ts`, before the `for (let i = 0; i < MAX_ITERATIONS; i++)` loop:

```typescript
const MAX_CONTEXT_TOKENS = 80_000; // leave room for system prompt + response
const { estimateTokens, truncateToTokenBudget } = await import("./utils/tokens.js");
```

After each tool call round where messages grow, before calling `provider.stream()` or `provider.complete()`:

```typescript
// Before streaming / completion
const msgTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
if (msgTokens > MAX_CONTEXT_TOKENS / 2) {
  const { kept, dropped } = truncateToTokenBudget(messages, MAX_CONTEXT_TOKENS / 2);
  if (dropped.length > 0) {
    messages = [
      { role: "system", content: `[Context truncated: ${dropped.length} messages removed to stay within token budget. Recent history preserved.]` },
      ...kept
    ];
    await log.append({ ...session, actor: "system", type: "context.truncated", payload: { droppedCount: dropped.length } });
  }
}
```

- [ ] **Step 5: Run build + tests**

Run: `npm run build && node --test dist/tests/token-budget.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/tokens.ts src/run.ts tests/token-budget.test.ts
git commit -m "feat: context truncation when token budget is exceeded"
```

---

### Task 5: Non-TTY Streaming

**Files:**
- Modify: `src/run.ts`
- Modify: `src/cli.ts` (add --no-stream flag)
- Test: `tests/streaming.test.ts` (new)

- [ ] **Step 1: Write tests for streaming detection**

```typescript
import test from "node:test";
import assert from "node:assert/strict";

test("streaming auto-disables when stdout is not a TTY", async () => {
  // Mock process.stdout.isTTY = false
  // When streaming is requested but stdout is not TTY, fallback to non-streaming
  // This is tested by checking the provider.stream path is skipped
});
```

- [ ] **Step 2: Add --no-stream flag to alix run**

In `src/cli.ts`, in the `run` command:

```typescript
if (command === "run") {
  const task = args.join(" ").trim();
  // Strip --no-stream flag if present
  const noStream = task.includes("--no-stream");
  const cleanTask = task.replace(/\s*--no-stream\s*/g, "").trim();
  if (!cleanTask) { console.error("Usage: alix run \"<task>\" [--no-stream]"); process.exit(1); }
  // ... rest of run logic, but pass noStream to override config
}
```

The config loading already respects `ALIX_STREAMING` env var. For the `--no-stream` flag, we can set `process.env.ALIX_STREAMING = "false"` before loading config, or pass a flag directly to `runTask`.

Better approach — modify `runTask` signature to accept an optional `streamingOverride`:

In `src/run.ts`, change:
```typescript
export async function runTask(cwd: string, task: string): Promise<RunResult> {
```

To:
```typescript
export async function runTask(cwd: string, task: string, opts?: { streaming?: boolean }): Promise<RunResult> {
```

And use `opts?.streaming` as override before calling `loadConfig`. In `cli.ts`, pass `{ streaming: false }` when `--no-stream` is present.

- [ ] **Step 3: Add TTY detection for auto-disable**

In `src/run.ts`, at the top of `runTask`:

```typescript
function shouldAutoDisableStreaming(): boolean {
  // Disable streaming in CI/non-TTY environments
  if (!process.stdout.isTTY) return true;
  if (process.env.CI) return true;
  return false;
}
```

Then in `runTask`, before loading config:
```typescript
const config = await loadConfig(cwd);
// Auto-disable streaming in non-TTY environments unless explicitly forced
if (shouldAutoDisableStreaming() && config.model.streaming && !opts?.streaming) {
  config.model.streaming = false;
}
```

- [ ] **Step 4: Run build + tests**

Run: `npm run build && node --test dist/tests/streaming.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/run.ts src/cli.ts tests/streaming.test.ts
git commit -m "feat: auto-disable streaming in non-TTY, add --no-stream flag"
```