// src/self-extend/inspect-extension.ts
import { getInProcess } from "./registry.js";

export type InspectExtensionArgs = {
  type: "skill" | "hook" | "mcp" | "recipe" | "subagent";
  name: string;
};

export type ToolResult = { ok: boolean; error?: string; data?: unknown };

export function inspectExtensionTool() {
  return {
    name: "inspect_extension",
    description: "Get detailed information about a specific extension: full manifest and registration metadata.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["skill", "hook", "mcp", "recipe", "subagent"] },
        name: { type: "string" },
      },
      required: ["type", "name"],
    },
    async execute(args: InspectExtensionArgs): Promise<ToolResult> {
      const ext = getInProcess(args.type, args.name);
      if (!ext) {
        return { ok: false, error: `Extension not found: ${args.type}/${args.name}` };
      }
      return {
        ok: true,
        data: {
          manifest: ext.manifest,
          metadata: {
            registeredAt: ext.registeredAt,
            source: "in-process",
          },
        },
      };
    },
  };
}