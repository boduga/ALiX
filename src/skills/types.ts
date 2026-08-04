export type SkillManifest = {
  name: string;
  description: string;
  trigger?: string;
  pattern?: string;
  version: string;
  is_core: boolean;
  tags?: string[];
  created_at?: string;
  /** Declared tools the skill intends to use (informative for trust review). */
  allowed_tools?: string[];
  /** Declared runtime requirements (e.g. system packages). */
  requires?: string[];
  /** SPDX license identifier, when declared. */
  license?: string;
};

export type LoadedSkill = {
  manifest: SkillManifest;
  body: string;
  path: string;
};

export type SkillCandidate = {
  id: string;
  manifest: SkillManifest;
  body: string;
  path: string;
  created_at: string;
  sessionId: string;
  successCount: number;
};

import yaml from "yaml";

/** Parse a YAML list-or-comma-string field into a string array. */
function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => s.length > 0);
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return undefined;
}

export function parseFrontMatter(content: string): SkillManifest | null {
  // Support both full content with --- delimiters and raw YAML (no ---)
  const fullMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const yamlStr = fullMatch ? fullMatch[1] : content;
  try {
    const raw = yaml.parse(yamlStr) as Record<string, unknown>;
    if (!raw || !raw.name || !raw.description) return null;
    return {
      name: String(raw.name ?? ""),
      description: String(raw.description ?? ""),
      trigger: raw.trigger != null ? String(raw.trigger) : undefined,
      pattern: raw.pattern != null ? String(raw.pattern) : undefined,
      version: String(raw.version ?? "1.0.0"),
      is_core: raw.is_core === true,
      tags: raw.tags != null ? (Array.isArray(raw.tags) ? raw.tags as string[] : String(raw.tags).split(",").map((t) => t.trim())) : undefined,
      created_at: raw.created_at != null ? String(raw.created_at) : undefined,
      allowed_tools: toStringArray(raw.allowed_tools ?? raw["allowed-tools"]),
      requires: toStringArray(raw.requires),
      license: raw.license != null ? String(raw.license) : undefined,
    };
  } catch {
    // Returning null is intentional: missing front matter and parse errors are both silent failures.
    return null;
  }
}

export function parseSkillContent(content: string): { manifest: SkillManifest | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!match) return { manifest: null, body: content };
  const manifest = parseFrontMatter(match[1]);
  return { manifest, body: match[2] ?? "" };
}