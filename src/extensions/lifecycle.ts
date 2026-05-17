import type { LoadedExtension } from "./registry.js";
import type { SkillExtension, HookExtension, McpExtension, RecipeExtension, SubagentExtension } from "./manifest.js";
import { HOOK_TRIGGERS } from "./manifest.js";

export type ExtensionBundle = {
  skills: Map<string, LoadedExtension>;         // key: trigger or name
  hooks: Map<string, LoadedExtension[]>;        // key: pre_task | post_task | on_change
  mcp: Map<string, LoadedExtension>;            // key: extension name
  recipes: Map<string, LoadedExtension>;       // key: extension name
  subagents: Map<string, LoadedExtension>;     // key: extension name
};

export function loadExtensions(registry: { list: () => LoadedExtension[] }): ExtensionBundle {
  const skills = new Map<string, LoadedExtension>();
  const hooks = new Map<string, LoadedExtension[]>(
    HOOK_TRIGGERS.map(t => [t, [] as LoadedExtension[]])
  );
  const mcp = new Map<string, LoadedExtension>();
  const recipes = new Map<string, LoadedExtension>();
  const subagents = new Map<string, LoadedExtension>();

  for (const ext of registry.list()) {
    switch (ext.manifest.type) {
      case "skill": {
        const trigger = (ext.manifest as SkillExtension).trigger;
        const key = trigger ?? ext.manifest.name;
        skills.set(key, ext);
        break;
      }
      case "hook": {
        const trigger = (ext.manifest as HookExtension).trigger;
        const list = hooks.get(trigger) ?? [];
        list.push(ext);
        hooks.set(trigger, list);
        break;
      }
      case "mcp":
        mcp.set(ext.manifest.name, ext);
        break;
      case "recipe":
        recipes.set(ext.manifest.name, ext);
        break;
      case "subagent":
        subagents.set(ext.manifest.name, ext);
        break;
    }
  }

  return { skills, hooks, mcp, recipes, subagents };
}