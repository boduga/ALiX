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
