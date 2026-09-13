// src/skills/discovery.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadSkillManifests, type SkillManifestOnly } from "./loader.js";

/**
 * ALiX-native skill store — the ONLY write target for
 * install/remove/promote/evict. Read discovery unions this with the
 * shared agent skills dir below; writes never touch the shared dir.
 */
export function getAlixSkillsDir(home: string = homedir()): string {
  return join(home, ".alix", "skills");
}

/**
 * Shared agent skills dir (opencode/claude-style `~/.agents/skills`).
 * Read-only for ALiX: matched, slash-completed, and runnable, but never
 * written to by install/promote/evict.
 */
export function getAgentsSkillsDir(home: string = homedir()): string {
  return join(home, ".agents", "skills");
}

/**
 * Project-local skill store (`<cwd>/.alix/skills`) — selected by
 * `alix skills ... --project`. Managed explicitly (install/remove);
 * never auto-evicted, never written by the factory.
 */
export function getProjectSkillsDir(cwd: string): string {
  return join(cwd, ".alix", "skills");
}

/**
 * Discovery roots in priority order — first root wins on
 * manifest.name collision: project-local shadows the ALiX user store,
 * which shadows a same-named shared skill.
 */
export function getSkillDiscoveryRoots(home: string = homedir(), projectDir?: string | null): string[] {
  const roots = [getAlixSkillsDir(home), getAgentsSkillsDir(home)];
  if (projectDir) roots.unshift(getProjectSkillsDir(projectDir));
  return roots;
}

/**
 * Load manifests from explicit roots, deduped by manifest.name with
 * first-root-wins. Missing/unreadable roots yield [] (never throw),
 * matching `loadSkillManifests` semantics per root.
 */
export async function loadSkillManifestsFromRoots(roots: string[]): Promise<SkillManifestOnly[]> {
  const seen = new Set<string>();
  const out: SkillManifestOnly[] = [];
  for (const root of roots) {
    for (const entry of await loadSkillManifests(root)) {
      if (seen.has(entry.manifest.name)) continue;
      seen.add(entry.manifest.name);
      out.push(entry);
    }
  }
  return out;
}

/** Union discovery across the standard roots (project first when given). */
export async function loadDiscoveredSkillManifests(home: string = homedir(), projectDir?: string | null): Promise<SkillManifestOnly[]> {
  return loadSkillManifestsFromRoots(getSkillDiscoveryRoots(home, projectDir));
}

/**
 * Resolve an installed skill dir by name across discovery roots
 * (project first when given). Returns null when no root holds `<name>/SKILL.md`.
 */
export function resolveDiscoveredSkillDir(name: string, home: string = homedir(), projectDir?: string | null): string | null {
  for (const root of getSkillDiscoveryRoots(home, projectDir)) {
    const dir = join(root, name);
    if (existsSync(join(dir, "SKILL.md"))) return dir;
  }
  return null;
}
