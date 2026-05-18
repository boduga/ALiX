/**
 * Delegate tool handler — parent agent calls this to spawn subagents.
 * Returns findings as structured output.
 */
import type { SubagentRole, SubagentTask } from "../config/schema.js";
import type { SubagentManager } from "./subagent-manager.js";
import type { ToolResult } from "../tools/types.js";

export function createDelegateHandler(
  subagentManager: SubagentManager,
  buildTask: (opts: { role: SubagentRole; prompt: string; ownedPaths?: string[]; mode?: "read_only" | "write" }) => SubagentTask,
): (args: Record<string, unknown>) => Promise<ToolResult> {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const role = args.role as SubagentRole;
    const prompt = args.prompt as string;
    const ownedPaths = (args.ownedPaths as string[] | undefined) ?? [];

    if (role === "worker" && ownedPaths.length === 0) {
      return { kind: "error", message: "Worker subagent requires ownedPaths", retryable: false };
    }

    const mode = role === "worker" ? "write" : "read_only";
    const task = buildTask({ role, prompt, ownedPaths, mode });

    try {
      const result = await subagentManager.spawn(task);

      if (result.status === "success") {
        return {
          kind: "success",
          output: result.findings.map(f => `[${f.type}] ${f.content}`).join("\n") || "(no findings)",
        };
      } else {
        return {
          kind: "error",
          message: `Subagent failed: ${result.error ?? "unknown error"}`,
          retryable: false,
        };
      }
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      };
    }
  };
}