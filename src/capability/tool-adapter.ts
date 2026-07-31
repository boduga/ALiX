import { ToolExecutorAdapter } from "./executors.js";
import type { ToolCallRequest } from "../tools/types.js";
import type { ExecuteResult } from "../tools/executor.js";

type ToolExecutorLike = { execute(req: ToolCallRequest): Promise<ExecuteResult> };

/** Adapts the existing ToolExecutor.execute() to the capability executor seam. */
export function createToolExecutorAdapter(executor: ToolExecutorLike): ToolExecutorAdapter {
  return new ToolExecutorAdapter(async (name, args) => {
    const req: ToolCallRequest = { toolCallId: `cap_${Date.now()}`, name, args };
    const result = await executor.execute(req);
    if (result.kind === "error") return { error: result.message };
    if (result.kind === "denied") return { error: result.reason };
    return { output: result.content ?? result.output ?? result.value };
  });
}
