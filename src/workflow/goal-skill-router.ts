import type { GoalPlan } from "./goal-types.js";
import type { SkillDefinition } from "./skill.js";
import { listSkills } from "./skill.js";

export interface GoalRouteAlternative {
  id: string;
  score: number;
}

export interface GoalRouteResult {
  matchedSkill: string | null;
  confidence: number;
  alternatives: GoalRouteAlternative[];
  unmatchedCapabilities: string[];
}

export class GoalSkillRouter {
  async route(plan: GoalPlan): Promise<GoalRouteResult> {
    const skills = await listSkills();
    const required = plan.requiredCapabilities;

    let bestSkill: SkillDefinition | null = null;
    let bestScore = 0;
    const alternatives: GoalRouteAlternative[] = [];

    for (const skill of skills) {
      const score = this.matchScore(skill, required);
      alternatives.push({ id: skill.id, score });

      if (score > bestScore) {
        bestScore = score;
        bestSkill = skill;
      }
    }

    const matched = bestSkill?.requiresCapabilities ?? [];
    const unmatched = required.filter((c) => !matched.includes(c));

    return {
      matchedSkill: bestSkill?.id ?? null,
      confidence: bestScore,
      alternatives: alternatives.sort((a, b) => b.score - a.score),
      unmatchedCapabilities: unmatched,
    };
  }

  private matchScore(skill: SkillDefinition, required: string[]): number {
    const skillCaps = skill.requiresCapabilities ?? [];
    if (skillCaps.length === 0) return 0;

    let matches = 0;
    for (const cap of required) {
      if (skillCaps.includes(cap)) matches++;
    }

    return matches / Math.max(skillCaps.length, required.length);
  }
}
