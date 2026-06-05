// src/self-extend/create-hook.ts
import { HookRunner } from "../extensions/hook-runner.js";

export type CreateHookArgs = {
  description: string;
  trigger: string;
  body: string;
};

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
    async execute(args: CreateHookArgs) {
      if (!args.body || args.body.trim() === "") {
        return { kind: "error" as const, message: "Hook body cannot be empty" };
      }
      const fn = async (event: any) => {
        const data = event.data ?? {};
        try {
          const compiled = new Function("data", "console", args.body);
          await compiled(data, console);
          return { event, handled: true };
        } catch (err: any) {
          return { event, handled: false, reason: err.message };
        }
      };
      runner.register(args.trigger, fn);
      return { kind: "success" as const, output: `Hook '${args.description}' registered on ${args.trigger}.` };
    },
  };
}
