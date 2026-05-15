// src/skills/lifecycle.ts
import { readdirSync, statSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSkillContent } from "./types.js";

export type LifecycleConfig = {
  maxStore: number;
  maxCandidates?: number;
};

export function evictIfNeeded(skillsDir: string, config: LifecycleConfig): void {
  if (!existsSync(skillsDir)) return;
  let entries: string[] = [];
  try {
    entries = readdirSync(skillsDir).filter(e => e !== ".usage.json" && e !== "node_modules");
  } catch { return; }

  if (entries.length <= config.maxStore) return; // No eviction needed

  const skills: Array<{ name: string; is_core: boolean; mtime: number }> = [];

  for (const entry of entries) {
    const skillPath = join(skillsDir, entry);
    try {
      if (!statSync(skillPath).isDirectory()) continue;
    } catch { continue; }
    const skillFile = join(skillPath, "SKILL.md");
    try {
      const content = readFileSync(skillFile, "utf8");
      const { manifest } = parseSkillContent(content);
      if (!manifest) continue;
      const mtime = statSync(skillPath).mtimeMs;
      skills.push({ name: entry, is_core: manifest.is_core ?? false, mtime });
    } catch { continue; }
  }

  // Sort: protected skills go last, then oldest first
  skills.sort((a, b) => {
    if (a.is_core && !b.is_core) return 1;
    if (!a.is_core && b.is_core) return -1;
    return a.mtime - b.mtime;
  });

  const nonCore = skills.filter(s => !s.is_core);
  if (nonCore.length >= config.maxStore) {
    const toEvict = nonCore.slice(0, nonCore.length - config.maxStore);
    for (const skill of toEvict) {
      try {
        rmSync(join(skillsDir, skill.name), { recursive: true });
      } catch { /* best effort */ }
    }
  }
}