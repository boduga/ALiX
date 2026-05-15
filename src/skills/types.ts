export type SkillManifest = {
  name: string;
  description: string;
  trigger?: string;
  pattern?: string;
  version: string;
  is_core: boolean;
  tags?: string[];
  created_at?: string;
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

export function parseFrontMatter(content: string): SkillManifest | null {
  // Support both full content with --- delimiters and raw YAML (no ---)
  const fullMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const yaml = fullMatch ? fullMatch[1] : content;
  try {
    const raw = yamlToObject(yaml);
    if (!raw.name || !raw.description) return null;
    return {
      name: String(raw.name ?? ""),
      description: String(raw.description ?? ""),
      trigger: raw.trigger != null ? String(raw.trigger) : undefined,
      pattern: raw.pattern != null ? String(raw.pattern) : undefined,
      version: String(raw.version ?? "1.0.0"),
      is_core: raw.is_core === true,
      tags: raw.tags != null ? (Array.isArray(raw.tags) ? raw.tags as string[] : String(raw.tags).split(",").map((t) => t.trim())) : undefined,
      created_at: raw.created_at != null ? String(raw.created_at) : undefined,
    };
  } catch {
    // Returning null is intentional: missing front matter and parse errors are both silent failures.
    return null;
  }
}

function yamlToObject(yaml: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Handle YAML arrays like [tag1, tag2]
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1);
      obj[key] = inner.split(",").map((t: string) => t.trim()).filter(Boolean);
    } else if (value === "true") obj[key] = true;
    else if (value === "false") obj[key] = false;
    else if (!isNaN(Number(value)) && value !== "") obj[key] = Number(value);
    else obj[key] = value.replace(/^["']|["']$/g, "");
  }
  return obj;
}

export function parseSkillContent(content: string): { manifest: SkillManifest | null; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!match) return { manifest: null, body: content };
  const manifest = parseFrontMatter(match[1]);
  return { manifest, body: match[2] ?? "" };
}