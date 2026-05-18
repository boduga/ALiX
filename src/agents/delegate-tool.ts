/**
 * Delegate tool handler — parent agent calls this to spawn subagents.
 * Returns findings as structured output.
 */
import { randomUUID } from "crypto";
import type { SubagentRole, SubagentTask, SubagentResult } from "../config/schema.js";
import type { SubagentManager } from "./subagent-manager.js";
import type { ToolResult } from "../tools/types.js";

export function createDelegateHandler(
  subagentManager: SubagentManager,
  buildTask: (opts: { role: SubagentRole; prompt: string; ownedPaths?: string[]; mode?: "read_only" | "write" }) => SubagentTask,
  onResult?: (result: SubagentResult) => void,
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
        if (onResult) onResult(result);
        return {
          kind: "success",
          output: result.findings.map(f => `[${f.type}] ${f.content}`).join("\n") || "(no findings)",
        };
      } else {
        if (onResult) onResult(result);
        return {
          kind: "error",
          message: `Subagent failed: ${result.error ?? "unknown error"}`,
          retryable: false,
        };
      }
    } catch (err) {
      const errorResult: SubagentResult = {
        id: crypto.randomUUID(), role, status: "failed", findings: [], events: [],
        error: err instanceof Error ? err.message : String(err),
      };
      if (onResult) onResult(errorResult);
      return {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      };
    }
  };
}