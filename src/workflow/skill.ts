/**
 * P4.6b — Skill Definitions: reusable operating procedures for the orchestrator.
 *
 * Skills tell the orchestrator how to run a task. Each skill is a sequence
 * of steps, where each step maps to an agent and its action.
 *
 * Skills are stored as JSON files under .alix/skills/workflow/.
 *
 * @module
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillStep {
  /** Step identifier (e.g. "intake", "plan") */
  step: string;
  /** Agent card ID (e.g. "workflow.intake") */
  agent: string;
  /** Action the agent performs */
  action: string;
  /** Human gate before this step */
  requiresApproval?: boolean;
  /** Hooks to run before/after this step */
  hooks?: {
    pre?: string[];
    post?: string[];
  };
}

export interface SkillDefinition {
  /** Unique skill ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this skill accomplishes */
  description: string;
  /** Ordered list of workflow steps */
  steps: SkillStep[];
  /** Capabilities required to run this skill */
  requiresCapabilities?: string[];
}

// ---------------------------------------------------------------------------
// Skill loading
// ---------------------------------------------------------------------------

/** Directories searched for skill files, in priority order. */
function skillDirs(): string[] {
  return [
    join(process.cwd(), ".alix", "skills", "workflow"),
    join(homedir(), ".alix", "skills", "workflow"),
  ];
}

/**
 * Load a workflow skill by name.
 *
 * Search order:
 *   1. .alix/skills/workflow/<name>.json  (project-local)
 *   2. ~/.alix/skills/workflow/<name>.json (user-global)
 *   3. Built-in skills
 */
export async function loadSkill(name: string): Promise<SkillDefinition | null> {
  // Search file-system dirs first
  for (const dir of skillDirs()) {
    try {
      const raw = await readFile(join(dir, `${name}.json`), "utf-8");
      return JSON.parse(raw) as SkillDefinition;
    } catch { /* try next */ }
  }

  // Built-in fallback
  const builtIn = builtInSkills();
  return builtIn.find(s => s.id === name) ?? null;
}

/**
 * List all available workflow skills.
 * Merges project-local, user-installed, and built-in (built-in loses on id conflict).
 */
export async function listSkills(): Promise<SkillDefinition[]> {
  const seen = new Set<string>();
  const skills: SkillDefinition[] = [];

  // Helper: load skills from a directory
  async function loadFromDir(dir: string): Promise<void> {
    try {
      const files = await readdir(dir);
      for (const f of files.filter(f => f.endsWith(".json"))) {
        try {
          const raw = await readFile(join(dir, f), "utf-8");
          const skill = JSON.parse(raw) as SkillDefinition;
          if (!seen.has(skill.id)) {
            seen.add(skill.id);
            skills.push(skill);
          }
        } catch { /* skip invalid */ }
      }
    } catch { /* dir doesn't exist */ }
  }

  // Load in priority order: project-local, user-global, built-in
  for (const dir of skillDirs()) {
    await loadFromDir(dir);
  }
  for (const builtIn of builtInSkills()) {
    if (!seen.has(builtIn.id)) {
      skills.push(builtIn);
    }
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Built-in skills
// ---------------------------------------------------------------------------

function builtInSkills(): SkillDefinition[] {
  return [
    {
      id: "issue-lifecycle",
      name: "Issue Lifecycle",
      description: "Full issue lifecycle: intake, plan, review, execute, PR",
      requiresCapabilities: [
        "workflow.intake", "workflow.planning", "workflow.review",
        "workflow.execution", "workflow.pr",
      ],
      steps: [
        { step: "intake", agent: "workflow.intake", action: "Read and validate issue, produce WorkPackage" },
        { step: "plan", agent: "workflow.planning", action: "Convert WorkPackage to ExecutionPlan" },
        { step: "review-plan", agent: "workflow.review", action: "Review ExecutionPlan for completeness and risk", requiresApproval: true },
        { step: "execute", agent: "workflow.execution", action: "Execute each subtask with test gating", requiresApproval: true },
        { step: "review-code", agent: "workflow.review", action: "Review completed code changes" },
        { step: "pr", agent: "workflow.pr", action: "Create draft PR with evidence links" },
      ],
    },
    {
      id: "plan-only",
      name: "Plan Only",
      description: "Intake and plan without execution",
      requiresCapabilities: ["workflow.intake", "workflow.planning", "workflow.review"],
      steps: [
        { step: "intake", agent: "workflow.intake", action: "Read and validate issue" },
        { step: "plan", agent: "workflow.planning", action: "Produce ExecutionPlan" },
        { step: "review-plan", agent: "workflow.review", action: "Review ExecutionPlan" },
      ],
    },
  ];
}
