import type { ToolDef } from "../types.js";

/**
 * Build a JSON schema for grammar-constrained tool calling.
 *
 * The schema gives the model two options:
 * 1. Respond with text:  { "type": "text", "content": "..." }
 * 2. Call a tool:        { "type": "tool", "name": "<tool>", "arguments": {...} }
 *
 * This is critical for Q&A tasks where the model should respond with text,
 * not try to call a tool. Without this, models default to "call any tool" behavior.
 *
 * Used by local-llama-spec to wrap llama-server's grammar generation.
 */
export function buildToolCallSchema(tools: ToolDef[]): {
  type: "object";
  properties: {
    type: { type: "string"; enum: string[] };
    content?: { type: "string" };
    name?: { type: "string"; enum: string[] };
    arguments?: { type: "object" };
  };
  required: string[];
} {
  return {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: ["text", "tool"],
        description: "Whether to respond with text or call a tool",
      },
      content: {
        type: "string",
        description: "The text content (only used when type=text)",
      },
      name: {
        type: "string",
        enum: tools.map((t) => t.name),
        description: "The tool name to call (only used when type=tool)",
      },
      arguments: {
        type: "object",
        description: "The tool arguments (only used when type=tool)",
      },
    },
    required: ["type"],
  };
}
