/**
 * P4.6c — Skill-to-Workflow Binding: executes a SkillDefinition against
 * the P4.5 agent chain.
 *
 * Maps each skill step to the corresponding agent:
 *   intake    → IssueIntakeAgent
 *   plan      → PlanningAgent
 *   review    → ReviewAgent
 *   execute   → ExecutionAgent
 *   pr        → PRAgent
 *
 * Hooks are called before and after each step if a HookManager is provided.
 *
 * @module
 */

import type { SkillDefinition } from "./skill.js";
import type { WorkflowCoordinator } from "./coordinator.js";
import type { EvidenceEventWriter } from "./evidence-writer.js";
import type { HookManager } from "./hooks.js";
import type { GhIssueData } from "./agents/issue-intake-agent.js";
import type { CardRegistry } from "../registry/card-registry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillGoal {
  issueNumber: number;
  issueTitle: string;
  body: string;
  labels: Array<{ name: string }>;
}

export interface SkillContext {
  coordinator: WorkflowCoordinator;
  writer: EvidenceEventWriter;
  hooks?: HookManager;
  registry?: CardRegistry;
}

export type SkillResult =
  | { success: true; issueNumber: number; workPackage: any; plan: any; review: any }
  | { success: false; issueNumber: number; error: string };

// ---------------------------------------------------------------------------
// runWorkflowSkill
// ---------------------------------------------------------------------------

/**
 * Run a skill definition against the P4.5 agent chain.
 *
 * Iterates over skill.steps and dispatches each step to the corresponding
 * agent. Pre/post hooks are called for each step if a HookManager is provided.
 */
export async function runWorkflowSkill(
  skill: SkillDefinition,
  goal: SkillGoal,
  context: SkillContext,
): Promise<SkillResult> {
  const { coordinator, writer, hooks } = context;
  const { issueNumber } = goal;

  const { IssueIntakeAgent } = await import("./agents/issue-intake-agent.js");
  const { PlanningAgent } = await import("./agents/planning-agent.js");
  const { ReviewAgent } = await import("./agents/review-agent.js");

  const intakeAgent = new IssueIntakeAgent();
  const planAgent = new PlanningAgent();
  const reviewAgent = new ReviewAgent();

  let workPackage: any;
  let plan: any;
  let review: any;

  const issueData: GhIssueData = {
    number: goal.issueNumber,
    title: goal.issueTitle,
    body: goal.body,
    state: "OPEN",
    labels: goal.labels,
    closed: false,
  };

  for (const step of skill.steps) {
    // Pre-step hook
    // Resolve capability if configured
    let resolvedAgent = step.agent;
    if (step.resolve && step.capability && context.registry) {
      const { resolveCapabilities } = await import("../registry/capability-resolver.js");
      const resolution = resolveCapabilities({
        requiredCapabilities: [step.capability],
        registry: context.registry,
      });
      if (resolution.agents.length === 0) {
        return {
          success: false,
          issueNumber,
          error: `No agent found for capability "${step.capability}"`,
        };
      }
      resolvedAgent = resolution.agents[0].id;
      await context.writer.recordCapabilityRouted(issueNumber, {
        capability: step.capability,
        resolvedAgent,
        candidates: resolution.agents.length,
        candidateAgentIds: resolution.agents.map(a => a.id),
      });
      await context.writer.recordAgentResolved(issueNumber, {
        capability: step.capability,
        agentId: resolvedAgent,
        step: step.step,
      });
    }

    if (hooks) {
      const ok = await hooks.run("preAgentRun", {
        type: "preAgentRun",
        agentId: step.agent,
        issueNumber,
      });
      if (!ok) {
        return { success: false, issueNumber, error: `Blocked by pre-hook: ${step.agent}` };
      }
    }

    try {
      if (resolvedAgent === "workflow.intake" || step.agent === "workflow.intake") {
        const result = await intakeAgent.intake(issueNumber, issueData);
        if (!result.success) {
          return { success: false, issueNumber, error: result.error };
        }
        workPackage = result.workPackage;
        await coordinator.transition(issueNumber, "NEW", { actor: "system" });
        await coordinator.transition(issueNumber, "SELECTED", { actor: "IssueIntakeAgent" });
      } else if (workPackage && resolvedAgent === "workflow.planning" || step.agent === "workflow.planning") {
        const result = await planAgent.plan(workPackage);
        if (!result.success) {
          return { success: false, issueNumber, error: result.error };
        }
        plan = result.plan;
        await coordinator.transition(issueNumber, "PLANNED", { actor: "PlanningAgent" });
      } else if (plan && resolvedAgent === "workflow.review" || step.agent === "workflow.review") {
        const result = await reviewAgent.review(plan);
        if (!result.success) {
          return { success: false, issueNumber, error: result.error };
        }
        review = result.report;
        await coordinator.transition(issueNumber, "UNDER_REVIEW", { actor: "ReviewAgent" });
        await writer.recordReviewCompleted(issueNumber, {
          verdict: review.verdict,
          findingCount: review.findings.length,
        });
      } else if (resolvedAgent === "workflow.execution" || step.agent === "workflow.execution" || resolvedAgent === "workflow.pr" || step.agent === "workflow.pr") {
        // Execution and PR require human approval — stop in automated flow
        return {
          success: true,
          issueNumber,
          workPackage,
          plan,
          review,
        };
      }
    } catch (err) {
      return { success: false, issueNumber, error: `Step "${step.step}" failed: ${err}` };
    }

    // Post-step hook
    if (hooks) {
      await hooks.run("postAgentRun", {
        type: "postAgentRun",
        agentId: step.agent,
        issueNumber,
      });
    }
  }


  return { success: true, issueNumber, workPackage, plan, review };
}
