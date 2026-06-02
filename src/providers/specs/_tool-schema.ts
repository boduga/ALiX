import type { ToolDef } from "../types.js";

/**
 * Build a JSON schema for grammar-constrained tool calling.
 *
 * The schema forces the model to output:
 *   { "name": "<one of the tool names>", "arguments": { ... } }
 *
 * Used by local-llama-spec to wrap llama-server's grammar generation.
 */
export function buildToolCallSchema(tools: ToolDef[]): {
  type: "object";
  properties: { name: { type: "string"; enum: string[] }; arguments: { type: "object" } };
  required: string[];
} {
  return {
    type: "object",
    properties: {
      name: {
        type: "string",
        enum: tools.map((t) => t.name),
      },
      arguments: {
        type: "object",
      },
    },
    required: ["name", "arguments"],
  };
}