import type { SkillManifest } from "./types.js";

export interface SlashInput {
  /** The slash token including the leading slash, e.g. "/tdd". */
  command: string;
  /** Everything after the first whitespace, trimmed. Empty when absent. */
  rest: string;
}

/**
 * Parse a TUI input buffer into a slash command + rest. Returns null when the
 * buffer is not a slash command (doesn't start with "/") or is exactly "/"
 * (which the TUI treats as the palette-opener, not a command).
 */
export function parseSlashInput(buffer: string): SlashInput | null {
  if (!buffer.startsWith("/") || buffer === "/") return null;
  const match = buffer.match(/^\/(\S+)\s*(.*)$/s);
  if (!match) return null;
  return { command: `/${match[1]}`, rest: match[2] ?? "" };
}

/**
 * The slash labels a skill responds to: its trigger (normalized to a leading
 * slash) plus "/name". Deduplicated, stable order: trigger first, name second.
 */
export function skillSlashNames(manifest: SkillManifest): string[] {
  const trigger = manifest.trigger ? `/${manifest.trigger.replace(/^\/+/, "")}` : undefined;
  const byName = `/${manifest.name}`;
  const names = [trigger, byName].filter((n): n is string => Boolean(n));
  return [...new Set(names)];
}

type RankBucket = 1 | 2 | 3 | 4 | 5;

function bucket(query: string, skill: SkillManifest): RankBucket | null {
  const names = skillSlashNames(skill);
  if (names.includes(query)) {
    // Exact trigger outranks exact name (the trigger is the primary alias).
    return skill.trigger && skillSlashNames(skill)[0] === query ? 1 : 2;
  }
  if (skill.trigger?.replace(/^\/+/, "").startsWith(query.slice(1)) || `/${skill.trigger}`.startsWith(query)) return 3;
  if (`/${skill.name}`.startsWith(query)) return 4;
  // Fuzzy: subsequence match on "/name" (e.g. "/t_d" matches "/tdd").
  const q = query.replace(/^\/+/, "");
  const target = skill.name;
  let qi = 0;
  for (let i = 0; i < target.length && qi < q.length; i++) {
    if (target[i] === q[qi]) qi++;
  }
  return qi === q.length ? 5 : null;
}

/**
 * Rank skills against a slash query. Ordering is a CONTRACT (asserted in
 * tests): exact trigger > exact name > prefix trigger > prefix name > fuzzy.
 * Stable for ties (preserves input order).
 */
export function rankSkillMatches(skills: SkillManifest[], query: string): SkillManifest[] {
  const scored: Array<{ skill: SkillManifest; bucket: RankBucket; idx: number }> = [];
  skills.forEach((skill, idx) => {
    const b = bucket(query, skill);
    if (b !== null) scored.push({ skill, bucket: b, idx });
  });
  scored.sort((x, y) => x.bucket - y.bucket || x.idx - y.idx);
  return scored.map((s) => s.skill);
}

/**
 * Resolve a slash command (e.g. "/tdd") to a skill's canonical name. Trigger
 * match wins over name match. Returns null when nothing matches.
 */
export function resolveSkillName(command: string, skills: SkillManifest[]): string | null {
  const top = rankSkillMatches(skills, command)[0];
  return top ? canonicalSkillId(top) : null;
}

/**
 * The SOLE dedup authority for the union/dedupe/inject path. Nothing else
 * (display name, trigger, path) decides whether two skills are the same.
 * Returns manifest.name today (the catalog key and on-disk dir name); keep
 * all identity decisions behind this function so a future canonical-id change
 * updates one place.
 */
export function canonicalSkillId(manifest: SkillManifest): string {
  return manifest.name;
}
