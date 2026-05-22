// src/skills/loader.ts
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontMatter, parseSkillContent } from "./types.js";
import type { SkillManifest, LoadedSkill } from "./types.js";

export interface SkillManifestOnly {
  manifest: SkillManifest;
  path: string;
}

/**
 * Load only manifests (lightweight) — no body content.
 * Used at startup for catalog building.
 */
export async function loadSkillManifests(root: string): Promise<SkillManifestOnly[]> {
  const manifests: SkillManifestOnly[] = [];
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
    const manifest = parseFrontMatter(content);
    if (!manifest) continue;
    manifests.push({ manifest, path: skillPath });
  }

  return manifests;
}

/**
 * Load full skill content (manifest + body) for a specific path.
 * Used when a skill matches — lazy-load only what's needed.
 */
export async function loadSkillContent(path: string): Promise<{ manifest: SkillManifest; body: string } | null> {
  const skillFile = join(path, "SKILL.md");
  try {
    const content = await readFile(skillFile, "utf8");
    const { manifest, body } = parseSkillContent(content);
    if (!manifest) return null;
    return { manifest, body: body ?? "" };
  } catch {
    return null;
  }
}

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
