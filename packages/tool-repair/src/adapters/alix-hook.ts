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
