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

/**
 * C0 and C1 control characters that can inject terminal control sequences or
 * break parsing invariants. Tab (0x09), LF (0x0A) and CR (0x0D) are excluded:
 * they are legitimate whitespace that may legitimately appear inside string
 * fields. Everything else in the C0 range (NUL, ESC \x1b, ...) plus DEL (0x7F)
 * and the C1 range (0x80-0x9F, including CSI U+009B and OSC U+009D) is
 * rejected. The `yaml` parser decodes `\x1b`, `\x9b`, etc. in double-quoted
 * strings to literal bytes, which is how ANSI/CSI/OSC injection could
 * otherwise reach the trust prompt.
 */
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

/** True if any string field (or list entry) of the manifest carries a disallowed control character. */
function containsControlChars(m: SkillManifest): boolean {
  const strings = [
    m.name,
    m.description,
    m.trigger,
    m.pattern,
    m.version,
    m.created_at,
    m.license,
    ...(m.tags ?? []),
    ...(m.allowed_tools ?? []),
    ...(m.requires ?? []),
  ];
  return strings.some((s) => typeof s === "string" && CONTROL_CHAR_RE.test(s));
}

export function parseFrontMatter(content: string): SkillManifest | null {
  // Support both full content with --- delimiters and raw YAML (no ---)
  const fullMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const yamlStr = fullMatch ? fullMatch[1] : content;
  try {
    const raw = yaml.parse(yamlStr) as Record<string, unknown>;
    if (!raw || !raw.name || !raw.description) return null;
    const manifest: SkillManifest = {
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
    // Defense-in-depth at parse time: the yaml parser decodes escape sequences
    // in double-quoted strings (\x1b, \x9b, etc.) to literal control bytes.
    // Reject any manifest whose string fields carry C0/C1 control characters
    // (other than tab/LF/CR) so ANSI/CSI/OSC terminal control sequences can
    // never reach the trust prompt via console.log. A manifest: null here is
    // handled cleanly by every install/load path.
    if (containsControlChars(manifest)) return null;
    return manifest;
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