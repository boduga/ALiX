# M0.66 Policy Ergonomics — TUI Session Mode Visibility & Control

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current policy session mode visible inside the TUI and allow the operator to switch between `ask`, `bypass`, and `auto` modes without restarting.

**Architecture:** Extract a pure helper function `handlePolicyCommand()` for testability. The `/policy` command handler parses args, calls the helper, and displays the output lines. Mode switch updates `activeConfig.permissions.sessionMode` in-memory — PolicyGate reads this on the next command, no restart needed.

**Tech Stack:** TypeScript, existing TuiStore/TuiPanel patterns, `node:test`.

---

## File Structure

### Modify
- `src/cli/commands/tui.ts` — add `/policy` command handler + `handlePolicyCommand()` helper, update help text

### Create
- `tests/tui/tui-policy-mode.test.ts` — test the real `handlePolicyCommand()` function behavior

---

### Task 1: Extract `handlePolicyCommand()` pure helper

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add the pure helper function before `runTui()`**

Add this exported helper before `echoTask()`:

```typescript
export interface PolicyConfig {
  permissions?: { sessionMode?: string };
}

/**
 * Pure helper for /policy command. Takes the current config and args,
 * mutates config if switching modes, returns display lines.
 * No side effects — no I/O, no TUI output.
 */
export function handlePolicyCommand(
  config: PolicyConfig,
  args: string,
): string[] {
  config.permissions ??= {};
  const currentMode = config.permissions.sessionMode || "bypass";
  const lines: string[] = [];
  const trimmed = args.trim().toLowerCase();

  if (trimmed === "bypass") {
    config.permissions.sessionMode = "bypass";
    lines.push("Session mode changed to: bypass");
    lines.push("  All tools allowed without approval.");
  } else if (trimmed === "ask") {
    config.permissions.sessionMode = "ask";
    lines.push("Session mode changed to: ask");
    lines.push("  Tool approval will be requested when policy requires it.");
  } else if (trimmed === "auto") {
    config.permissions.sessionMode = "auto";
    lines.push("Session mode changed to: auto");
    lines.push("  Previously approved tools allowed automatically.");
  } else if (trimmed === "" || trimmed === "show" || trimmed === "status") {
    const icon = currentMode === "bypass" ? "⚠" : currentMode === "ask" ? "✓" : "●";
    lines.push(`Policy session mode: ${icon} ${currentMode}`);
    lines.push("  Change with: /policy ask | /policy bypass | /policy auto");
    if (currentMode === "ask") {
      lines.push("  Commands requiring approval will prompt inline.");
    } else if (currentMode === "bypass") {
      lines.push("  All tool calls allowed — use with caution.");
    } else if (currentMode === "auto") {
      lines.push("  Previously approved capabilities auto-allowed.");
    }
  } else {
    lines.push("Unknown policy command. Usage:");
    lines.push("  /policy          — show current mode");
    lines.push("  /policy ask      — require approval for risky tools");
    lines.push("  /policy bypass   — allow all tools without approval");
    lines.push("  /policy auto     — auto-allow previously approved tools");
  }

  return lines;
}
```

- [ ] **Step 2: Wire the `/policy` command handler in the TUI loop**

After the `/chronicle` handler, add:

```typescript
      // /policy — view or change session mode
      if (task.startsWith("/policy")) {
        const args = task.slice("/policy".length).trim();
        const lines = handlePolicyCommand(activeConfig, args);
        for (const line of lines) {
          tui.appendOutput(line + "\n", false);
        }
        continue;
      }
```

- [ ] **Step 3: Guard `permissions` initialization in the existing mode-sync code**

Find the existing code at lines 117-118:
```typescript
  if (opts.sessionMode && activeConfig.permissions) {
    activeConfig.permissions.sessionMode = mode as any;
```

Change to:
```typescript
  if (opts.sessionMode) {
    activeConfig.permissions ??= {};
    activeConfig.permissions.sessionMode = mode as any;
  }
```

- [ ] **Step 4: Update help text**

Find the help text around line 399 and add `/policy`:
```typescript
      tui.appendOutput(`Commands: r=refresh tab=next panel d=dashboard(${dState}) /approvals /approve<id> /deny<id> /policy /ifamas ?=help q=quit\n`, false);
```

---

### Task 2: Write proper tests against the real helper

**Files:**
- Create: `tests/tui/tui-policy-mode.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handlePolicyCommand } from "../../src/cli/commands/tui.js";
import type { PolicyConfig } from "../../src/cli/commands/tui.js";

describe("/policy command", () => {
  it("show default mode returns bypass with warning icon", () => {
    const config: PolicyConfig = {};
    const output = handlePolicyCommand(config, "");
    assert.ok(output.some(l => l.includes("bypass")));
    assert.ok(output.some(l => l.includes("⚠")));
  });

  it("show ask mode returns checkmark", () => {
    const config: PolicyConfig = { permissions: { sessionMode: "ask" } };
    const output = handlePolicyCommand(config, "show");
    assert.ok(output.some(l => l.includes("ask")));
    assert.ok(output.some(l => l.includes("✓")));
  });

  it("show auto mode", () => {
    const config: PolicyConfig = { permissions: { sessionMode: "auto" } };
    const output = handlePolicyCommand(config, "status");
    assert.ok(output.some(l => l.includes("auto")));
    assert.ok(output.some(l => l.includes("●")));
  });

  it("switch to ask updates config and returns confirmation", () => {
    const config: PolicyConfig = { permissions: { sessionMode: "bypass" } };
    const output = handlePolicyCommand(config, "ask");
    assert.equal(config.permissions?.sessionMode, "ask");
    assert.ok(output.some(l => l.includes("changed to: ask")));
    assert.ok(output.some(l => l.includes("approval")));
  });

  it("switch to bypass updates config and returns confirmation", () => {
    const config: PolicyConfig = { permissions: { sessionMode: "ask" } };
    const output = handlePolicyCommand(config, "bypass");
    assert.equal(config.permissions?.sessionMode, "bypass");
    assert.ok(output.some(l => l.includes("changed to: bypass")));
    assert.ok(output.some(l => l.includes("allowed")));
  });

  it("switch to auto updates config and returns confirmation", () => {
    const config: PolicyConfig = {};
    const output = handlePolicyCommand(config, "auto");
    assert.equal(config.permissions?.sessionMode, "auto");
    assert.ok(output.some(l => l.includes("changed to: auto")));
  });

  it("works with undefined permissions (initializes)", () => {
    const config: PolicyConfig = {};
    handlePolicyCommand(config, "ask");
    assert.ok(config.permissions);
    assert.equal(config.permissions?.sessionMode, "ask");
  });

  it("unknown subcommand shows usage", () => {
    const config: PolicyConfig = {};
    const output = handlePolicyCommand(config, "unknown");
    assert.ok(output.some(l => l.includes("Usage")));
    assert.ok(output.some(l => l.includes("ask")));
    assert.ok(output.some(l => l.includes("bypass")));
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run build && node --test dist/tests/tui/tui-policy-mode.test.js`
Expected: 8/8 tests pass

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tui/tui-policy-mode.test.js` — 8/8 pass
3. Full suite — no regressions
4. In the live TUI:
   - `/policy` shows current mode
   - `/policy bypass` switches mode and `list files` no longer asks
   - `/policy ask` switches back and `write "hello" to test.txt` asks
   - `?` help includes `/policy`
5. Git diff shows only the intended files
