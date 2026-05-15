// src/skills/loader.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseSkillContent } from "./types.js";
import type { LoadedSkill } from "./types.js";

/**
 * Discover and load all Hermes-format skills from a directory.
 * Each skill lives in a subdirectory: <root>/<skill-name>/SKILL.md
 */
export function loadSkills(root: string): LoadedSkill[] {
  const skills: LoadedSkill[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const skillPath = join(root, entry);
    try {
      if (!statSync(skillPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const skillFile = join(skillPath, "SKILL.md");
    let content;
    try {
      content = readFileSync(skillFile, "utf8");
    } catch {
      continue;
    }
    const { manifest, body } = parseSkillContent(content);
    if (!manifest) continue;
    skills.push({ manifest, body, path: skillPath });
  }

  return skills;
}
