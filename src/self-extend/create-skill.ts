// src/self-extend/create-skill.ts
import { registerInProcess, type InProcessExtension } from "./registry.js";

export type CreateSkillArgs = {
  name: string;
  description: string;
  trigger: string;
  body: string;
  isCore?: boolean;
};

export type ToolResult = { ok: boolean; error?: string; data?: unknown };

export function createSkillTool() {
  return {
    name: "create_skill",
    description: "Create a new skill at runtime. The skill becomes available immediately and can be triggered by its trigger pattern.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique skill name (lowercase, hyphens)" },
        description: { type: "string", description: "What the skill does" },
        trigger: { type: "string", description: "Pattern that activates this skill" },
        body: { type: "string", description: "Skill body (markdown)" },
        isCore: { type: "boolean", description: "If true, protected from eviction" },
      },
      required: ["name", "description", "trigger", "body"],
    },
    async execute(args: CreateSkillArgs): Promise<ToolResult> {
      if (!args.name || args.name.trim() === "") {
        return { ok: false, error: "Skill name cannot be empty" };
      }
      if (!/^[a-z0-9-]+$/.test(args.name)) {
        return { ok: false, error: "Skill name must be lowercase letters, digits, and hyphens only" };
      }
      if (!args.description || !args.trigger || !args.body) {
        return { ok: false, error: "description, trigger, and body are required" };
      }

      const ext: InProcessExtension = {
        type: "skill",
        name: args.name,
        manifest: {
          type: "skill",
          name: args.name,
          description: args.description,
          trigger: args.trigger,
          body: args.body,
          is_core: args.isCore ?? false,
          version: "1.0.0",
        },
        registeredAt: Date.now(),
      };

      try {
        registerInProcess(ext);
      } catch (err: any) {
        return { ok: false, error: err.message };
      }

      return { ok: true, data: { name: args.name, registered: true } };
    },
  };
}