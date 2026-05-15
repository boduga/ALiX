// src/skills/loader.ts
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseSkillContent } from "./types.js";
import type { LoadedSkill } from "./types.js";

/**
 * Discover and load all Hermes-format skills from a directory.
 * Each skill lives in a subdirectory: <root>/<skill-name>/SKILL.md
 */
export async function loadSkills(root: string): Promise<LoadedSkill[]> {
  const skills: LoadedSkill[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const skillPath = join(root, entry);
    let isDir = false;
    try { isDir = (await stat(skillPath)).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    const skillFile = join(skillPath, "SKILL.md");
    let content: string;
    try {
      content = await readFile(skillFile, "utf8");
    } catch {
      continue;
    }
    const { manifest, body } = parseSkillContent(content);
    if (!manifest) continue;
    skills.push({ manifest, body, path: skillPath });
  }

  return skills;
}
