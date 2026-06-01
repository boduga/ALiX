// src/self-extend/list-extensions.ts
import { listInProcess, type InProcessExtension } from "./registry.js";

export type ListExtensionsResult = {
  skills: Array<{ name: string; description?: string; trigger?: string; isCore: boolean }>;
  hooks: Array<{ name: string; trigger: string }>;
  mcp: Array<{ name: string }>;
  recipes: Array<{ name: string }>;
  subagents: Array<{ name: string }>;
};

export type ToolResult = { ok: boolean; error?: string; data?: unknown };

export function listExtensionsTool() {
  return {
    name: "list_extensions",
    description: "List all loaded extensions: skills, hooks, MCP servers, recipes, subagents.",
    input_schema: { type: "object", properties: {} },
    async execute(_args: {}): Promise<ToolResult> {
      const all = listInProcess();
      const data: ListExtensionsResult = {
        skills: [],
        hooks: [],
        mcp: [],
        recipes: [],
        subagents: [],
      };

      for (const ext of all) {
        switch (ext.type) {
          case "skill":
            data.skills.push({
              name: ext.manifest.name,
              description: ext.manifest.description,
              trigger: ext.manifest.trigger,
              isCore: ext.manifest.is_core ?? false,
            });
            break;
          case "hook":
            data.hooks.push({ name: ext.manifest.name, trigger: ext.manifest.trigger });
            break;
          case "mcp":
            data.mcp.push({ name: ext.manifest.name });
            break;
          case "recipe":
            data.recipes.push({ name: ext.manifest.name });
            break;
          case "subagent":
            data.subagents.push({ name: ext.manifest.name });
            break;
        }
      }

      return { ok: true, data };
    },
  };
}