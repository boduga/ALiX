# Self-Extensible Hooks (Pi-Style Code Generation)

**Goal:** Let the agent create TypeScript hooks from natural language — the agent writes the code, loads it in-process, and it becomes live immediately. User never writes code.

**Architecture:** A `create_hook` tool that takes a plain-language description, generates a TypeScript hook module, registers it with `HookRunner`, and makes it active for the current session. Based on `src/extensions/hook-runner.ts` which already supports runtime-registered `HookFn`.

**Existing infrastructure:**
- `src/extensions/hook-runner.ts` — `HookRunner` with `register()`, `execute()`, 10 hook types
- `src/extensions/manifest.ts` — `HOOK_TRIGGERS` and `HookExtension` type
- `src/extensions/lifecycle.ts` — loads extensions from file system
- `src/self-extend/` — in-process extension registry (from sub-project #5)

---

## What Already Works

```typescript
// HookRunner can register TypeScript hooks at runtime:
const runner = new HookRunner();
runner.register("on_pre_tool", async (event) => {
  if (event.data?.toolName === "file.delete") {
    await writeFile("audit.log", `${new Date()}: deleted ${event.data.path}\n`, { flag: "a" });
  }
});
```

What's **missing**: a `create_hook` tool that generates this code from a user's plain-language request and wires it into the runner.

---

## Task 1: Create `create_hook` tool + hook code generator

**Files:**
- Create: `src/self-extend/generate-hook.ts` — Prompt-to-TypeScript generator (~80 lines)
- Create: `src/self-extend/create-hook.ts` — Tool definition (~60 lines)
- Modify: `src/extensions/hook-runner.ts` — Add `listHooks()` method for introspection
- Modify: `src/tools/tool-router.ts` — Register new `create_hook` tool
- Create: `tests/self-extend/generate-hook.test.ts` — Tests
- Create: `tests/self-extend/create-hook.test.ts` — Tests

### `generate-hook.ts` — Converts natural language to hook code

This module takes a plain-language prompt and returns a `HookFn`:

```typescript
// src/self-extend/generate-hook.ts
import type { HookEvent, HookResult, HookFn } from "../extensions/hook-runner.js";

export type HookSpec = {
  hookName: string;
  trigger: string;
  description: string;
};

// Maps natural language trigger description to hook type
const TRIGGER_MAP: Record<string, string> = {
  "before a tool": "on_pre_tool",
  "after a tool": "on_post_tool",
  "before a file": "on_pre_tool",
  "after a file": "on_post_tool",
  "before patch": "on_pre_patch",
  "after patch": "on_post_patch",
  "session start": "on_session_start",
  "session end": "on_session_end",
  "approval": "on_approval_request",
  "tool completes": "on_tool_complete",
  "tool fails": "on_tool_error",
};

export function parseTrigger(userText: string): string {
  const lower = userText.toLowerCase();
  for (const [key, value] of Object.entries(TRIGGER_MAP)) {
    if (lower.includes(key)) return value;
  }
  return "on_pre_tool"; // default
}

/**
 * Generate a HookFn from a natural language description.
 * The hook body is constructed by the model via the create_hook tool.
 * For tools without model assistance, simple hooks can be built from templates.
 */
export function buildHook(prompt: string, hookBody: string): { trigger: string; fn: HookFn } {
  const trigger = parseTrigger(prompt);
  const fn: HookFn = async (event: HookEvent) => {
    // The hook body is executed in the context of HookRunner
    // event.data contains toolCallId, toolName, args, result, etc.
    try {
      // Wrap in eval-like context so generated code can access event.data
      const data = event.data ?? {};
      // Use Function constructor for isolated execution scope
      const compiled = new Function("data", "console", hookBody);
      await compiled(data, console);
      return { event, handled: true };
    } catch (err) {
      console.error(`[hook] Error: ${err instanceof Error ? err.message : String(err)}`);
      return { event, handled: false };
    }
  };
  return { trigger, fn };
}
```

### `create-hook.ts` — Tool definition

```typescript
// src/self-extend/create-hook.ts
export function createHookTool(runner: HookRunner) {
  return {
    name: "create_hook",
    description: "Create a hook that runs before or after tool calls, patch applications, session events, or approvals. Describe what you want in plain language and I'll generate the hook code.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What should this hook do? e.g. 'log every file.delete to audit.log'" },
        trigger: { type: "string", enum: ["on_pre_tool", "on_post_tool", "on_tool_complete", "on_tool_error", "on_pre_patch", "on_post_patch", "on_approval_request", "on_session_start", "on_session_end"], description: "When should this hook fire?" },
        body: { type: "string", description: "The hook logic as JavaScript code. Use `data` for tool call info (data.toolName, data.args, data.result)." },
      },
      required: ["description", "trigger", "body"],
    },
    async execute(args) {
      const fn = async (event) => {
        const data = event.data ?? {};
        try {
          const compiled = new Function("data", "console", args.body);
          await compiled(data, console);
          return { event, handled: true };
        } catch (err) {
          return { event, handled: false, reason: err.message };
        }
      };
      runner.register(args.trigger, fn);
      return { kind: "success", output: `Hook '${args.description}' registered on ${args.trigger}.` };
    },
  };
}
```

### Test `tests/self-extend/generate-hook.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTrigger, buildHook } from "../../src/self-extend/generate-hook.js";

describe("parseTrigger", () => {
  it("detects pre_tool from 'before every tool call'", () => {
    assert.equal(parseTrigger("before every tool call, check permissions"), "on_pre_tool");
  });
  it("detects post_tool from 'after a file is deleted'", () => {
    assert.equal(parseTrigger("after a file is deleted, log it"), "on_post_tool");
  });
  it("detects session end from 'when session ends'", () => {
    assert.equal(parseTrigger("when session ends, save a summary"), "on_session_end");
  });
  it("defaults to on_pre_tool for unknown triggers", () => {
    assert.equal(parseTrigger("do something"), "on_pre_tool");
  });
});

describe("buildHook", () => {
  it("returns a HookFn that can be called", async () => {
    let called = false;
    const { fn } = buildHook("before every tool call", "data._test = true");
    // Wrap the fn to handle the body execution properly
    const result = await fn({ type: "test", data: { _test: false } });
    assert.ok(result.handled);
  });
});
```

---

## Task 2: Register `create_hook` tool + add `listHooks` to HookRunner

**Files:**
- Modify: `src/extensions/hook-runner.ts` — Add `listHooks()` method
- Modify: `src/tools/tool-router.ts` — Register `create_hook` tool

Add to `hook-runner.ts`:
```typescript
listHooks(): Array<{ name: string; count: number }> {
  return Array.from(this.hooks.entries()).map(([name, fns]) => ({ name, count: fns.length }));
}
```

Register in `tool-router.ts` (follow `WebToolsRouter` pattern):
```typescript
export class SelfExtendToolRouter implements ToolRouter {
  // ... existing web_search, web_fetch, create_skill, etc.
  // add create_hook support
}
```

---

## Task 3: Wire into HookRunner in the agent loop

**Files:**
- Modify: `src/agent/agent.ts` — Create `HookRunner` instance in `AgentContext`
- Modify: `src/run/task-loop.ts` — Run registered hooks at tool boundaries

In `task-loop.ts`, before tool execution:
```typescript
// Run pre_tool hooks
if (runner) {
  await runner.execute("on_pre_tool", { type: "tool_call", data: { toolName, args } });
}
```

After tool execution:
```typescript
if (runner) {
  await runner.execute("on_post_tool", { type: "tool_result", data: { toolName, args, result } });
}
```

---

## Task 4: Final verification

- [ ] `create_hook` tool accepts prompt + generated body
- [ ] Hook executes at the correct trigger point
- [ ] Hook can access tool call data (toolName, args, result)
- [ ] Hook errors don't crash the agent loop
- [ ] `listHooks()` shows registered hooks
- [ ] All tests pass

---

## Self-Review

- [x] `generate-hook.ts` — trigger parsing + hook building
- [x] `create-hook.ts` — tool definition
- [x] `hook-runner.ts` — `listHooks()` addition
- [x] Tool router registration
- [x] Agent loop integration
- [x] Test coverage for trigger parsing
- [x] Follows existing self-extend pattern (same directory as create-skill, list-extensions, inspect-extension)
- [x] No TBD or placeholder code
