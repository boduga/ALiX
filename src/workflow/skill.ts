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

const SKILLS_DIR = join(homedir(), ".alix", "skills", "workflow");

/**
 * Load a workflow skill by name.
 * Searches .alix/skills/workflow/<name>.json first, then built-in fallback.
 */
export async function loadSkill(name: string): Promise<SkillDefinition | null> {
  // Try user-installed skill first
  try {
    const raw = await readFile(join(SKILLS_DIR, `${name}.json`), "utf-8");
    return JSON.parse(raw) as SkillDefinition;
  } catch { /* fall through to built-in */ }

  // Built-in skills
  const builtIn = builtInSkills();
  return builtIn.find(s => s.id === name) ?? null;
}

/**
 * List all available workflow skills (built-in + user-installed).
 */
export async function listSkills(): Promise<SkillDefinition[]> {
  const skills = [...builtInSkills()];
  try {
    const files = await readdir(SKILLS_DIR);
    for (const f of files.filter(f => f.endsWith(".json"))) {
      try {
        const raw = await readFile(join(SKILLS_DIR, f), "utf-8");
        const skill = JSON.parse(raw) as SkillDefinition;
        if (!skills.find(s => s.id === skill.id)) {
          skills.push(skill);
        }
      } catch { /* skip invalid */ }
    }
  } catch { /* no user skills dir */ }
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
