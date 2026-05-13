import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { AlixConfig } from "./schema.js";

type PartialConfig = Partial<AlixConfig> & {
  model?: Partial<AlixConfig["model"]>;
  permissions?: Partial<AlixConfig["permissions"]>;
  context?: Partial<AlixConfig["context"]>;
  runtime?: Partial<AlixConfig["runtime"]>;
  ui?: Partial<AlixConfig["ui"]>;
};

export async function loadConfig(cwd: string): Promise<AlixConfig> {
  const projectPath = join(cwd, ".alix", "config.json");
  const projectConfig = existsSync(projectPath) ? await readJson(projectPath) : {};
  return mergeConfig(DEFAULT_CONFIG, projectConfig);
}

async function readJson(path: string): Promise<PartialConfig> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as PartialConfig;
}

export function mergeConfig(base: AlixConfig, override: PartialConfig): AlixConfig {
  return {
    ...base,
    ...override,
    model: { ...base.model, ...override.model },
    permissions: {
      ...base.permissions,
      ...override.permissions,
      tools: { ...base.permissions.tools, ...override.permissions?.tools },
      protectedPaths: mergeUnique(base.permissions.protectedPaths, override.permissions?.protectedPaths ?? [])
    },
    context: { ...base.context, ...override.context },
    runtime: { ...base.runtime, ...override.runtime },
    ui: { ...base.ui, ...override.ui }
  };
}

function mergeUnique<T>(a: T[], b: T[]): T[] {
  return Array.from(new Set([...a, ...b]));
}
