# Shell Tool Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix shell tool so model correctly uses `cd && cmd` pattern and can change directories in a single call.

**Architecture:** Improve tool description to teach model shell command chaining. Add optional shell state persistence for future enhancement.

**Tech Stack:** TypeScript, Node.js child_process

---

## Problem

When ALiX runs `cd folder && pwd`, each call spawns a fresh shell, so `cd` doesn't persist across calls. The model needs explicit guidance to chain commands.

## Current State

```typescript
// src/run/helpers.ts:98-108
{
  name: "alix_shell_run",
  description: "Run a shell command in the workspace.",
  input_schema: {
    properties: {
      command: { type: "string", description: "The shell command to execute" },
      cwd: { type: "string", description: "Working directory (defaults to workspace root)" },
      timeoutMs: { type: "number", description: "Timeout in milliseconds" }
    },
    required: ["command"]
  }
}
```

---

### Task 1: Improve Shell Tool Description

**Files:**
- Modify: `src/run/helpers.ts:98-108`
- Test: `tests/integration/shell-tool.test.ts` (new file)

- [ ] **Step 1: Update the tool description with examples**

Modify `src/run/helpers.ts` around line 98, update the description:

```typescript
{
  name: "alix_shell_run",
  description: "Run a shell command in the workspace. IMPORTANT: To change directory within a command, chain with &&. Examples:\n  - cd myfolder && pwd  # Change dir and show new path\n  - cd api && ls -la    # List files in api folder\n  - mkdir test && cd test && echo done  # Create folder, enter it, confirm\nEach call runs in isolation — use && to chain commands that must run together.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to execute. Use && to chain commands that need to run together (e.g., cd dir && ls)."
      },
      cwd: {
        type: "string",
        description: "Working directory (defaults to workspace root). Note: For cd to persist, use: cd dir && your_command"
      },
      timeoutMs: {
        type: "number",
        description: "Timeout in milliseconds"
      }
    },
    required: ["command"]
  }
}
```

- [ ] **Step 2: Run build to verify TypeScript compiles**

Run: `npm run build 2>&1 | grep -E "error|warning" | head -10`
Expected: No errors related to helpers.ts

- [ ] **Step 3: Create integration test**

Create `tests/integration/shell-tool.test.ts`:

```typescript
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { join } from "node:path";

describe("alix_shell_run tool", () => {
  it("should chain cd && pwd to show changed directory", async () => {
    const result = await runAlixShell({
      command: "cd test-folder && pwd",
      cwd: process.cwd()
    });
    
    assert.ok(result.output.includes("test-folder"), `Expected output to contain test-folder, got: ${result.output}`);
  });

  it("should create folder and cd into it in single call", async () => {
    const result = await runAlixShell({
      command: "mkdir verify-shell-test && cd verify-shell-test && pwd",
      cwd: process.cwd()
    });
    
    assert.ok(result.output.includes("verify-shell-test"), `Expected output to contain verify-shell-test`);
    
    // Cleanup
    await runAlixShell({ command: "rm -rf verify-shell-test", cwd: process.cwd() });
  });
});

async function runAlixShell(args: { command: string; cwd: string }): Promise<{ output: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("node", [
      "dist/src/cli.js", "run", args.command, "--no-stream", "--mode=bypass"
    ], { cwd: args.cwd });
    
    let output = "";
    proc.stdout.on("data", d => output += d.toString());
    proc.stderr.on("data", d => output += d.toString());
    
    proc.on("close", () => resolve({ output }));
  });
}
```

- [ ] **Step 4: Run the new test**

Run: `node --test tests/integration/shell-tool.test.ts`
Expected: Both tests should pass showing cd && pwd works

- [ ] **Step 5: Commit**

```bash
git add src/run/helpers.ts tests/integration/shell-tool.test.ts
git commit -m "feat(shell-tool): add command chaining examples to tool description

Teach model to use cd && cmd pattern for directory changes.
Test: verify shell tool correctly chains cd && pwd commands.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add Shell State Persistence (Future Enhancement)

**Files:**
- Create: `src/tools/shell-pool.ts`
- Modify: `src/tools/tool-router.ts:130-144`
- Test: `tests/unit/shell-pool.test.ts`

**This task is OPTIONAL** — Task 1 may be sufficient. Complete Task 1 first and test. Only proceed if shell persistence is still needed.

- [ ] **Step 1: Write test for persistent shell state**

```typescript
// tests/unit/shell-pool.test.ts
describe("ShellPool", () => {
  it("maintains working directory across calls", async () => {
    const pool = new ShellPool({ cwd: "/tmp" });
    
    await pool.run("mkdir test-persist");
    const result = await pool.run("pwd");
    
    assert.ok(result.output.includes("test-persist"));
    await pool.close();
  });
});
```

- [ ] **Step 2: Implement ShellPool class**

Create `src/tools/shell-pool.ts`:

```typescript
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export class ShellPool extends EventEmitter {
  private proc: ReturnType<typeof spawn>;
  private readonly cwd: string;
  
  constructor(options: { cwd: string; timeoutMs?: number }) {
    super();
    this.cwd = options.cwd;
    this.proc = spawn("/bin/bash", [], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
  }
  
  async run(command: string, timeoutMs = 120000): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let output = "";
      let stderr = "";
      let settled = false;
      
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Command timed out: ${command}`));
        }
      }, timeoutMs);
      
      this.proc.stdout.on("data", d => output += d.toString());
      this.proc.stderr.on("data", d => stderr += d.toString());
      
      this.proc.on("close", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ output: output + (stderr ? `\n--- stderr ---\n${stderr}` : ""), exitCode: code ?? 0 });
        }
      });
      
      this.proc.stdin?.write(`${command}\n`);
    });
  }
  
  close(): void {
    this.proc.kill();
  }
}
```

- [ ] **Step 3: Integrate ShellPool into ShellToolRouter**

Modify `src/tools/tool-router.ts`:

```typescript
export class ShellToolRouter implements ToolRouter {
  private shellPool?: ShellPool;
  
  canHandle(name: string): boolean {
    return name === "shell.run";
  }
  
  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const { command, cwd, timeoutMs, root: r, persistent } = request.args as {
      command?: string;
      cwd?: string;
      timeoutMs?: number;
      root?: string;
      persistent?: boolean;
    };
    
    if (!command) {
      return { kind: "error", message: "shell.run requires command" };
    }
    
    const workingDir = cwd ?? r ?? this.root;
    
    if (persistent && !this.shellPool) {
      this.shellPool = new ShellPool({ cwd: workingDir, timeoutMs });
    }
    
    if (this.shellPool) {
      try {
        const result = await this.shellPool.run(command, timeoutMs);
        return { kind: "success", output: result.output };
      } catch (err) {
        return { kind: "error", message: String(err) };
      }
    }
    
    return runCommand({ command, cwd: workingDir, timeoutMs });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/tools/shell-pool.ts src/tools/tool-router.ts tests/unit/shell-pool.test.ts
git commit -m "feat(shell-tool): add optional persistent shell state via ShellPool

Introduces ShellPool for commands that need persistent working directory.
Use persistent=true in tool args to enable.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Verification

After Task 1:

```bash
# Test the fix
timeout 120 node dist/src/cli.js run "create test-dir && cd test-dir && pwd" --no-stream --mode=bypass

# Verify output contains test-dir
cat .alix/sessions/*/events.jsonl | grep "pwd" | jq -r '.payload.outputPreview' | grep test-dir
```

Expected: Shell commands that chain `cd &&` work correctly.

---

## Borrowed Patterns

| Source | Pattern | Implementation |
|--------|---------|----------------|
| Claude Code | Tool description with examples | Added `&&` chaining examples |
| Codex CLI | Explicit command patterns | Documented `cd && cmd` |
| OpenHands | Shell pooling (optional) | ShellPool class for persistence |