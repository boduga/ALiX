import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type Hook = { command: string; reason: string; env?: Record<string, string> };
export type HookConfig = { pre_task?: Hook[]; post_task?: Hook[]; on_change?: Hook[] };

export async function discoverHooks(root: string): Promise<HookConfig> {
  const path = join(root, ".alix", "hooks.json");
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    return data as HookConfig;
  } catch {
    return {};
  }
}