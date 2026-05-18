import type { TaskType } from "../task-classifier.js";
import type { SubagentRole } from "../config/schema.js";

export type RoleRecommendation = {
  role: SubagentRole;
  confidence: "high" | "medium" | "low";
  reason: string;
};

/**
 * Map task type and prompt to recommended subagent role.
 */
export function recommendRole(taskType: TaskType, prompt: string): RoleRecommendation {
  // Bugfix → worker (can apply fixes)
  if (taskType === "bugfix") {
    return { role: "worker", confidence: "high", reason: "bugfix tasks require write capability" };
  }

  // Feature → check if it mentions files (could be worker)
  if (taskType === "feature") {
    const mentionsFiles = /[\/\w]+\.(ts|js|py|go|rs)/i.test(prompt);
    if (mentionsFiles) {
      return { role: "worker", confidence: "medium", reason: "feature mentions existing files" };
    }
    return { role: "explorer", confidence: "medium", reason: "feature without file references" };
  }

  // Refactor → reviewer (analyze code quality)
  if (taskType === "refactor") {
    return { role: "reviewer", confidence: "high", reason: "refactor tasks benefit from code review" };
  }

  // Docs → docs_researcher
  if (taskType === "docs") {
    return { role: "docs_researcher", confidence: "high", reason: "documentation tasks" };
  }

  // Default → explorer (read-only exploration)
  return { role: "explorer", confidence: "low", reason: "no specific role match" };
}