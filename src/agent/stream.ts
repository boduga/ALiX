import type { ToolCall } from "../providers/types.js";

export function shouldAutoDisableStreaming(): boolean {
  if (!process.stdout.isTTY) return true;
  if (process.env.CI) return true;
  return false;
}

export type StreamHandler = (chunk: { type: "text" | "tool_call"; text?: string; toolCall?: ToolCall }) => void;