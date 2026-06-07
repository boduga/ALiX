# ALiX HookRunner Tool-Repair Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the @alix/tool-repair layer into ALiX's HookRunner system so it's accessible from extensions, `.alix/hooks.json`, and tool events.

**Architecture:** Register tool-repair hooks on `on_pre_tool` (monitor/log) and `on_tool_error` (fix + explain). Wire the missing `on_tool_error` event in `task-loop.ts`. Add `.alix/hooks.json` config support for per-project repair settings. The existing inline repair in `ToolExecutor` stays as the primary "fix the args" path — hooks add observability and error recovery.

**Tech Stack:** TypeScript, Node.js 24+, ESM

---

### File Structure

```
Modify:
  src/agent/agent.ts              # Register tool-repair hooks on HookRunner
  src/run/task-loop.ts            # Wire on_tool_error event (missing)
  src/extensions/hook-runner.ts   # Add result.abort support for on_tool_error
  packages/tool-repair/src/adapters/alix-hook.ts   # [CREATE] Hook adapter

New:
  .alix/hooks.json.example        # Example config for tool-repair
```

---

### Task 1: Wire `on_tool_error` in task-loop.ts

**Files:**
- Modify: `src/run/task-loop.ts:505-510`

The `on_tool_error` event is defined in HookRunner but never fired in task-loop.ts. Currently, when a tool errors, the error result is handled inline without firing any hook.

Find the error handling path in `task-loop.ts`. After a tool call fails (check for `toolResult.kind === "error"` or similar), fire `on_tool_error` on the hookRunner before the error handling logic.

Read the current task-loop.ts around lines 480-530 first to find the exact error handling point. The current flow is:
1. Line 490-493: `on_pre_tool` hook
2. Line 497: `handleToolCall` 
3. Line 500-503: `on_post_tool` hook
4. Lines 506+: result handling

Add after line 503 (or wherever the error result is checked):

```typescript
// Fire on_tool_error hook when tool fails
if (deps.hookRunner && toolResult.kind === "error") {
  const hr = await deps.hookRunner.execute("on_tool_error", {
    type: "tool_error",
    data: {
      toolName: execName,
      args: toolCall.args,
      error: toolResult.message,
      retryable: toolResult.retryable,
    },
  });
  if (hr.handled) {
    await log.append({
      ...session,
      actor: "system",
      type: "hook.executed",
      payload: { hookName: "on_tool_error", toolName: execName, handled: true },
    });
  }
}
```

Note: `execName` is already defined earlier in the function (used in the on_pre_tool and on_post_tool hooks). Also, the variable may be `toolResult` or `result` depending on the naming in the function — check and adjust.

- [ ] **Step 1: Read task-loop.ts error handling path**

Read `/home/babasola/Projects/Monolith/src/run/task-loop.ts` lines 475-540 to find where tool errors are handled.

- [ ] **Step 2: Add on_tool_error hook firing**

Insert the hook firing block after a tool error is detected, before the error recovery logic runs.

- [ ] **Step 3: Verify compilation**

Run: `cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/run/task-loop.ts && git commit -m "feat(hooks): wire on_tool_error event in task-loop.ts

Previously on_tool_error was defined in HookRunner but never fired.
Now fires when a tool call returns an error result, enabling
registered hooks to react to tool failures.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Create ALiX hook adapter for tool-repair

**Files:**
- Create: `packages/tool-repair/src/adapters/alix-hook.ts`

This adapter wraps `ToolRepair` as a HookRunner-compatible function. It registers both `on_pre_tool` (for monitoring/telemetry) and `on_tool_error` (for explaining errors with corrected args).

```typescript
/**
 * ALiX HookRunner adapter for @alix/tool-repair.
 *
 * Registers tool-repair as HookRunner callbacks:
 *   - on_pre_tool:  logs repair telemetry when args match known patterns
 *   - on_tool_error: returns corrected args + hint so the error handler
 *                    can provide the model with a repair explanation
 */
import { ToolRepair } from "../index.js";
import type { HookFn, HookEvent, HookResult } from "../../../../src/extensions/hook-runner.js";

export function createToolRepairHooks(modelKey: string): Array<{ name: string; fn: HookFn }> {
  const repair = new ToolRepair(modelKey);

  const onPreTool: HookFn = async (event: HookEvent): Promise<HookResult | void> => {
    if (event.type !== "tool_call") return;
    const data = event.data ?? {};
    const toolName = (data.toolName as string) ?? "";
    const args = (data.args as Record<string, unknown>) ?? {};

    const result = repair.process(toolName, args);
    if (!result.repaired || !result.hint) return;

    // Log telemetry but don't abort — the inline executor handles the fix
    return {
      event,
      handled: true,
    };
  };

  const onToolError: HookFn = async (event: HookEvent): Promise<HookResult | void> => {
    if (event.type !== "tool_error") return;
    const data = event.data ?? {};
    const toolName = (data.toolName as string) ?? "";
    const args = (data.args as Record<string, unknown>) ?? {};
    const errorMsg = (data.error as string) ?? "";

    const result = repair.process(toolName, args);
    if (!result.repaired || !result.hint) return;

    // Return a result that tells the error handler to provide
    // the repair hint to the model
    return {
      event,
      handled: true,
      abort: false, // Don't abort — let the error flow
      // Store repair info for the caller to use
      ...result.repaired && {
        reason: `[Tool Repair] ${result.hint} Correct args: ${JSON.stringify(result.args)}`,
      },
    };
  };

  return [
    { name: "on_pre_tool", fn: onPreTool },
    { name: "on_tool_error", fn: onToolError },
  ];
}
```

Wait — the `HookResult` type only has `event`, `handled`, `abort`, `reason`. It doesn't have arbitrary fields. Let me adjust the approach:

The hook can't pass arbitrary data back through HookResult. Instead, the hook should:
1. For `on_pre_tool`: Just log that a pattern matched (telemetry)
2. For `on_tool_error`: Use the `reason` field to communicate the fix, which the caller can then inject into the model context

- [ ] **Step 1: Create `packages/tool-repair/src/adapters/alix-hook.ts`**

```typescript
/**
 * ALiX HookRunner adapter for @alix/tool-repair.
 *
 * Registers tool-repair callbacks on the HookRunner:
 *   - on_pre_tool:  logs telemetry when args match known patterns
 *   - on_tool_error: reports corrected args via reason field
 */
import { ToolRepair } from "../index.js";
import type { HookFn, HookEvent, HookResult } from "../../../../src/extensions/hook-runner.js";

export function createToolRepairHooks(modelKey: string): Array<{ name: string; fn: HookFn }> {
  const repair = new ToolRepair(modelKey);

  const onPreTool: HookFn = async (event: HookEvent): Promise<HookResult | void> => {
    if (event.type !== "tool_call") return;
    const data = event.data ?? {};
    const toolName = (data.toolName as string) ?? "";
    const args = (data.args as Record<string, unknown>) ?? {};

    const result = repair.process(toolName, args);
    if (!result.repaired) return;

    // The inline executor already fixes the args.
    // This hook just signals that a pattern was detected.
    return {
      event,
      handled: true,
      reason: `[Tool Repair] ${result.hint}`,
    };
  };

  const onToolError: HookFn = async (event: HookEvent): Promise<HookResult | void> => {
    if (event.type !== "tool_error") return;
    const data = event.data ?? {};
    const toolName = (data.toolName as string) ?? "";
    const args = (data.args as Record<string, unknown>) ?? {};

    const result = repair.process(toolName, args);
    if (!result.repaired || !result.hint) return;

    // Tell the error handler what the correct args should have been.
    // The caller (task-loop.ts) can inject this into context.
    return {
      event,
      handled: true,
      abort: false,
      reason: `[Tool Repair Fix] ${result.hint} Correct arguments: ${JSON.stringify(result.args)}`,
    };
  };

  return [
    { name: "on_pre_tool", fn: onPreTool },
    { name: "on_tool_error", fn: onToolError },
  ];
}
```

- [ ] **Step 2: Update `packages/tool-repair/src/types.ts` to add `modelKey` normalization**

Read the existing types file. No changes needed — this is already handled by `ToolRepair` constructor.

- [ ] **Step 3: Verify compilation**

```bash
cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add packages/tool-repair/src/adapters/alix-hook.ts && git commit -m "feat(tool-repair): add ALiX HookRunner adapter

Creates on_pre_tool and on_tool_error hooks that detect known
tool-call patterns and report fixes through the hook system.
Use reason field to communicate corrected args on error.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Register hooks in agent.ts

**Files:**
- Modify: `src/agent/agent.ts:173-200`

After the HookRunner is created and before toolExecutor is used, register the tool-repair hooks.

Read current `agent.ts` around lines 173-200, then:

1. Import the hook adapter at the top of the file:
```typescript
import { createToolRepairHooks } from "../../packages/tool-repair/src/adapters/alix-hook.js";
```

2. After line 175 (`const hookRunner = new HookRunner()`), register the tool-repair hooks:
```typescript
  // Register tool-repair hooks
  const modelKey = `${config.model.provider}-${config.model.name}`;
  const repairHooks = createToolRepairHooks(modelKey);
  for (const hook of repairHooks) {
    hookRunner.register(hook.name, hook.fn);
  }
```

3. After registering hooks, also load hooks from `.alix/hooks.json` if it exists:
```typescript
  // Load project-level hooks from .alix/hooks.json
  const { discoverHooks } = await import("../hooks/discover.js");
  const projectHooks = await discoverHooks(cwd);
  for (const hook of projectHooks.pre_task ?? []) {
    hookRunner.register("on_pre_tool", async () => {
      // These are run via shell runner, not inline
      return { event: { type: "pre_task" }, handled: false };
    });
  }
```

Wait — the `.alix/hooks.json` hooks use a different execution model (shell commands in `src/hooks/runner.ts`). The HookRunner is for programmatic TypeScript hooks. Let me not wire `.alix/hooks.json` here — that's a different system. Keep it focused on registering the tool-repair hooks.

```typescript
  // Register tool-repair hooks on the HookRunner
  const modelKey = `${config.model.provider}-${config.model.name}`;
  const repairHooks = createToolRepairHooks(modelKey);
  for (const hook of repairHooks) {
    hookRunner.register(hook.name, hook.fn);
  }
```

- [ ] **Step 1: Read `src/agent/agent.ts` lines 1-15 and 173-200**

Check the existing import style and the hook runner initialization area.

- [ ] **Step 2: Add import and hook registration**

```typescript
import { createToolRepairHooks } from "../../packages/tool-repair/src/adapters/alix-hook.js";
```

Add after HookRunner creation:
```typescript
  // Register tool-repair hooks for monitoring and error recovery
  const modelKey = `${config.model.provider}-${config.model.name}`;
  const repairHooks = createToolRepairHooks(modelKey);
  for (const hook of repairHooks) {
    hookRunner.register(hook.name, hook.fn);
  }
```

- [ ] **Step 3: Verify compilation**

```bash
cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/agent/agent.ts && git commit -m "feat(hooks): register tool-repair hooks in agent startup

Registers on_pre_tool and on_tool_error hooks from the tool-repair
package on the HookRunner during agent initialization. Enables
repair telemetry and error-context injection for tool failures.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire on_tool_error reason into model context

**Files:**
- Modify: `src/run/task-loop.ts` (the error handling path that follows the hook)

When `on_tool_error` returns a `reason` with repair info, the model should see it. Currently the error handling just logs and returns. We need to inject the repair hint when the hook handled it.

Read the error handling path after the `on_tool_error` hook fires (Task 1). If the hook returned `handled: true` with a `reason`, append that reason to the error message so the model sees the fix suggestion in the next turn.

The key insight: the `execute()` call returns `HookResult` with `reason`. If `hr.handled && hr.reason`, we append the reason to the error message that the model will see.

```typescript
// After the on_tool_error hook fires:
if (deps.hookRunner && toolResult.kind === "error") {
  const hr = await deps.hookRunner.execute("on_tool_error", {
    type: "tool_error",
    data: {
      toolName: execName,
      args: toolCall.args,
      error: toolResult.message,
      retryable: toolResult.retryable,
    },
  });
  if (hr.handled) {
    await log.append({ ...session, actor: "system", type: "hook.executed", payload: { hookName: "on_tool_error", toolName: execName, handled: true } });
    // If the hook provides a repair hint, append it to the error message
    if (hr.reason && typeof toolResult.message === "string") {
      toolResult.message += `\n\n${hr.reason}`;
    }
  }
}
```

Wait — `toolResult` might be immutable or the caller might not reference the updated message. Let me check the actual error handling in task-loop.ts.

- [ ] **Step 1: Read the error handling flow in task-loop.ts**

Read lines 480-570 to see how tool errors are handled and fed back to the model.

- [ ] **Step 2: Implement repair hint injection**

Add the `reason` → error message injection after the hook fires. The exact approach depends on how `toolResult` is used downstream. The safest approach is to store the reason in a local variable and inject it when building the error feedback for the model.

- [ ] **Step 3: Verify compilation**

```bash
cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1
```

- [ ] **Step 4: Commit**

```bash
cd /home/babasola/Projects/Monolith && git add src/run/task-loop.ts && git commit -m "feat(hooks): inject tool-repair hints into model context on error

When on_tool_error hook returns a repair reason, append it to
the error message the model sees so it learns the correct args.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Test the full hook pipeline

**Files:**
- Test: manual verification

No unit tests for the integration (it requires the full agent loop). Instead, verify with a script.

- [ ] **Step 1: Write a quick verification**

```bash
cd /home/babasola/Projects/Monolith && npx tsc --noEmit 2>&1
```

Expected: No errors

- [ ] **Step 2: Verify the HookRunner has registered hooks**

Read `src/agent/agent.ts` to confirm hook registration code is present.

- [ ] **Step 3: Run existing tests**

```bash
cd /home/babasola/Projects/Monolith/packages/tool-repair && npx tsx --test tests/*.test.ts 2>&1
```

Expected: 57/57 pass

- [ ] **Step 4: Commit final changes**

```bash
cd /home/babasola/Projects/Monolith && git add -A && git commit -m "feat: complete tool-repair integration with ALiX HookRunner

Summary of all changes:
- Wire on_tool_error event in task-loop.ts (was defined but never fired)
- Create alix-hook.ts adapter: on_pre_tool (telemetry) + on_tool_error (repair hints)
- Register tool-repair hooks during agent initialization in agent.ts
- Inject repair hints into error messages the model sees

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
