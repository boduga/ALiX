// src/skills/catalog.ts
import type { LoadedSkill } from "./types.js";

export class SkillCatalog {
  private byTrigger: Map<string, LoadedSkill> = new Map();
  private byPattern: Array<{ pattern: RegExp; skill: LoadedSkill }> = [];

  constructor(skills: LoadedSkill[]) {
    for (const skill of skills) {
      if (skill.manifest.trigger) {
        this.byTrigger.set(skill.manifest.trigger, skill);
      }
      if (skill.manifest.pattern) {
        try {
          this.byPattern.push({
            pattern: new RegExp(skill.manifest.pattern, "i"),
            skill,
          });
        } catch {
          // skip invalid regex
        }
      }
    }
  }

  /**
   * Match a user prompt against skill triggers and patterns.
   * Returns matched skills ordered by specificity (trigger > pattern).
   */
  match(prompt: string): LoadedSkill[] {
    const results: LoadedSkill[] = [];

    // Exact trigger match (e.g., "/tdd add feature")
    const triggerMatch = prompt.match(/^\/(\w+)/);
    if (triggerMatch) {
      const matched = this.byTrigger.get(`/${triggerMatch[1]}`);
      if (matched) results.push(matched);
    }

    // Pattern match
    for (const { pattern, skill } of this.byPattern) {
      if (pattern.test(prompt) && !results.includes(skill)) {
        results.push(skill);
      }
    }

    return results;
  }

  getAll(): LoadedSkill[] {
    const seen = new Set<string>();
    const result: LoadedSkill[] = [];
    for (const s of [...this.byTrigger.values(), ...this.byPattern.map(p => p.skill)]) {
      if (!seen.has(s.manifest.name)) { seen.add(s.manifest.name); result.push(s); }
    }
    return result;
  }

  get(name: string): LoadedSkill | undefined {
    return this.byTrigger.get(name)
      ?? this.byTrigger.get(`/${name}`)
      ?? this.byPattern.find(p => p.skill.manifest.name === name)?.skill;
  }
}

export function buildSkillCatalog(skills: LoadedSkill[]): SkillCatalog {
  return new SkillCatalog(skills);
}