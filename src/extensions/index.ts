import { homedir } from "node:os";

export { parseExtensionManifest, getExtensionId, isCoreExtension, EXTENSION_TYPES } from "./manifest.js";
export type { ExtensionManifest, ExtensionType, SkillExtension, HookExtension, McpExtension, RecipeExtension, SubagentExtension } from "./manifest.js";
export { ExtensionRegistry } from "./registry.js";
export type { LoadedExtension, ListOptions } from "./registry.js";
export { loadExtensions } from "./lifecycle.js";
export type { ExtensionBundle } from "./lifecycle.js";

export function getDefaultExtensionStore() {
  return { enabled: true, path: `${homedir()}/.alix/extensions` };
}