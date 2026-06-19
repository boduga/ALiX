/**
 * P4.6d — WorkflowOrchestrator: goal-to-workflow bridge.
 *
 * The orchestrator:
 *   1. Accepts a user goal (GitHub issue data)
 *   2. Selects the appropriate skill based on goal characteristics
 *   3. Executes the skill via runWorkflowSkill()
 *   4. Returns the result
 *
 * This is the integration layer between the existing ALiX orchestrator
 * and the P4.5 workflow engine.
 *
 * @module
 */

import type { WorkflowCoordinator } from "./coordinator.js";
import type { EvidenceEventWriter } from "./evidence-writer.js";
import type { HookManager } from "./hooks.js";
import type { SkillGoal, SkillResult } from "./workflow-skill.js";
import type { SkillDefinition } from "./skill.js";
import { runWorkflowSkill } from "./workflow-skill.js";
import { listSkills } from "./skill.js";

// Re-export types
export type { SkillGoal };
export type OrchestratorResult = SkillResult;

// ---------------------------------------------------------------------------
// WorkflowOrchestrator
// ---------------------------------------------------------------------------

export class WorkflowOrchestrator {
  constructor(
    private readonly coordinator: WorkflowCoordinator,
    private readonly writer: EvidenceEventWriter,
    private readonly hooks?: HookManager,
  ) {}

  /**
   * Run a user goal through the workflow engine.
   *
   * Currently selects the "plan-only" skill (intake → plan → review).
   * Future: select skill based on goal complexity, labels, or intent.
   */
  async runGoal(goal: SkillGoal): Promise<OrchestratorResult> {
    const { loadSkill } = await import("./skill.js");
    const skill = await loadSkill("plan-only");
    if (!skill) {
      return { success: false, issueNumber: goal.issueNumber, error: "No matching skill found" };
    }

    return runWorkflowSkill(skill, goal, {
      coordinator: this.coordinator,
      writer: this.writer,
      hooks: this.hooks,
    });
  }

  /**
   * List all available workflow skills.
   */
  async listSkills(): Promise<SkillDefinition[]> {
    return listSkills();
  }
}
