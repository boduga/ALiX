// src/skills/catalog.ts
import type { SkillManifest, LoadedSkill } from "./types.js";
import { loadSkillContent } from "./loader.js";
import type { SkillManifestOnly } from "./loader.js";

export interface SkillEntry {
  manifest: SkillManifest;
  path: string;
  body?: string; // lazy-loaded on match
}

export class SkillCatalog {
  private byTrigger: Map<string, SkillEntry> = new Map();
  private byPattern: Array<{ pattern: RegExp; entry: SkillEntry }> = [];

  constructor(skills: SkillEntry[]) {
    for (const skill of skills) {
      if (skill.manifest.trigger) {
        this.byTrigger.set(skill.manifest.trigger, skill);
      }
      if (skill.manifest.pattern) {
        try {
          this.byPattern.push({
            pattern: new RegExp(skill.manifest.pattern, "i"),
            entry: skill,
          });
        } catch {
          // skip invalid regex
        }
      }
    }
  }

  /**
   * Match a user prompt against skill triggers and patterns.
   * Returns matched skill entries (body is lazy-loaded via getMatchedContent).
   */
  match(prompt: string): SkillEntry[] {
    const results: SkillEntry[] = [];

    // Exact trigger match (e.g., "/tdd add feature")
    const triggerMatch = prompt.match(/^\/(\w+)/);
    if (triggerMatch) {
      const matched = this.byTrigger.get(`/${triggerMatch[1]}`);
      if (matched) results.push(matched);
    }

    // Pattern match
    for (const { pattern, entry } of this.byPattern) {
      if (pattern.test(prompt) && !results.includes(entry)) {
        results.push(entry);
      }
    }

    return results;
  }

  /**
   * Return matched skill entries with body content lazy-loaded.
   * Only loads body content for skills that match the prompt.
   */
  async getMatchedContent(prompt: string): Promise<LoadedSkill[]> {
    const matched = this.match(prompt);
    const results: LoadedSkill[] = [];

    for (const entry of matched) {
      // Lazy-load body if not already loaded
      if (!entry.body) {
        const content = await loadSkillContent(entry.path);
        if (content) {
          entry.body = content.body;
        } else {
          continue; // skip if we can't load content
        }
      }
      results.push({
        manifest: entry.manifest,
        body: entry.body!,
        path: entry.path,
      });
    }

    return results;
  }

  getAll(): LoadedSkill[] {
    const seen = new Set<string>();
    const result: LoadedSkill[] = [];
    for (const s of [...this.byTrigger.values(), ...this.byPattern.map(p => p.entry)]) {
      if (!seen.has(s.manifest.name)) {
        seen.add(s.manifest.name);
        result.push({ manifest: s.manifest, body: s.body ?? "", path: s.path });
      }
    }
    return result;
  }

  get(name: string): LoadedSkill | undefined {
    const entry = this.byTrigger.get(name)
      ?? this.byTrigger.get(`/${name}`)
      ?? this.byPattern.find(p => p.entry.manifest.name === name)?.entry;
    if (!entry) return undefined;
    return { manifest: entry.manifest, body: entry.body ?? "", path: entry.path };
  }
}

export function buildSkillCatalog(skills: SkillEntry[]): SkillCatalog {
  return new SkillCatalog(skills);
}