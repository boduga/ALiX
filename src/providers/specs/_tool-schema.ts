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
      },
      content: {
        type: "string",
      },
      name: {
        type: "string",
        enum: tools.map((t) => t.name),
      },
      arguments: {
        type: "object",
      },
    },
    required: ["type"],
  };
}
