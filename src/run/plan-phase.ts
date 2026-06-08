import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { AgentContext } from "../agent/agent.js";
import type { ContextBundle } from "../repomap/context-compiler.js";
import { prompt } from "../cli/commands/prompt.js";
import { isReadOnlyTask, isShellTask } from "../task-classifier.js";

export type PlanPhaseResult =
  | { action: "approved"; planContent: string }
  | { action: "rejected" };

/**
 * Run the plan phase: generate plan → save → print → prompt → return result.
 * If the task is read-only (research, shell commands), skips plan generation entirely
 * and returns immediately — no model call, no tokens wasted.
 * If not a TTY (pipe), also skips plan generation.
 */
export async function runPlanPhase(
  ctx: AgentContext,
  bundle: ContextBundle,
  task: string,
  planFilePath?: string,
): Promise<PlanPhaseResult> {
  // Skip plan generation for read-only tasks and non-TTY sessions
  if (isReadOnlyTask(task) || isShellTask(task) || !process.stdout.isTTY) {
    return { action: "approved", planContent: "" };
  }

  // 1. Generate plan (or load from file if provided — fast path for testing)
  const planContent = planFilePath
    ? await readFile(planFilePath, "utf-8")
    : await generatePlan(ctx, bundle, task);

  // 2. Save plan to disk
  const projectRoot = (ctx.config as any).projectRoot ?? process.cwd();
  const planDir = join(projectRoot, ".alix", "plans");
  await mkdir(planDir, { recursive: true });
  const planPath = join(planDir, `${ctx.sessionId}.md`);
  await writeFile(planPath, planContent);

  // 3. Print plan to stdout
  console.log("\n" + planContent);

  // 4. Prompt for approval
  return await promptForPlanApproval(planPath, planContent);
}

/**
 * Call the model with context but NO tools to generate a plan.
 * The model outputs a structured markdown plan.
 */
async function generatePlan(
  ctx: AgentContext,
  bundle: ContextBundle,
  task: string,
): Promise<string> {
  const systemPrompt = buildPlanSystemPrompt(task, bundle);

  const response = await ctx.provider.complete({
    systemPrompt,
    messages: [{ role: "user", content: task }],
  });

  const plan = response.text.trim();

  if (!plan) {
    return `## Plan\n\n**Task:** ${task}\n\nNo detailed plan was generated. Proceeding with the task.\n`;
  }

  return plan;
}

/**
 * Build the system prompt for plan generation.
 * Tells the model to plan without executing, provides context bundle.
 */
function buildPlanSystemPrompt(task: string, bundle: ContextBundle): string {
  const lines: string[] = [
    "You are a software engineer planning a task. Do NOT write code or execute anything.",
    "Generate a structured plan in markdown with these sections:",
    "",
    "## Summary",
    "One-line description of what needs to be done.",
    "",
    "## Changes",
    "For each file that will be affected, list:",
    "- **Action:** create | modify | delete",
    "- **File:** path relative to project root",
    "- **Description:** what changes and why",
    "",
    "## Verification",
    "How to confirm the work is correct (tests, build, manual steps).",
    "",
    "## Risk Assessment",
    "- **Risk level:** low | medium | high",
    "- **Blast radius:** what else could break",
    "- **New dependencies:** any new packages/services needed",
    "",
    "Keep the plan concise but specific. Focus on what files change and how.",
    "",
    "Here is the repository context:",
  ];

  if (bundle.primaryFiles.length > 0) {
    lines.push("", "### Primary Files");
    for (const f of bundle.primaryFiles) {
      lines.push(`- ${f.path} — ${f.reason ?? "task target"}`);
    }
  }

  if (bundle.tests.length > 0) {
    lines.push("", "### Related Tests");
    for (const f of bundle.tests) {
      lines.push(`- ${f.path}`);
    }
  }

  if (bundle.supportingFiles.length > 0) {
    lines.push("", "### Supporting Files");
    for (const f of bundle.supportingFiles) {
      lines.push(`- ${f.path}`);
    }
  }

  return lines.join("\n");
}

/**
 * Prompt user for plan approval.
 * Returns 'approved' on Y, 'rejected' on n.
 * On 'e', opens $EDITOR for modifications then auto-approves.
 * On 'd', shows expanded info then re-prompts.
 */
async function promptForPlanApproval(
  planPath: string,
  planContent: string,
): Promise<PlanPhaseResult> {
  while (true) {
    const answer = await prompt("Approve plan? [Y/n/e/d] ");
    const key = answer.toLowerCase().trim();

    if (key === "" || key === "y" || key === "yes") {
      return { action: "approved", planContent };
    }

    if (key === "n" || key === "no") {
      console.log("\nPlan rejected. Task cancelled.");
      return { action: "rejected" };
    }

    if (key === "e" || key === "edit") {
      const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vim";
      const result = spawnSync(editor, [planPath], { stdio: "inherit" });
      if (result.error) {
        console.error(`Failed to open editor "${editor}": ${result.error.message}`);
        continue;
      }
      if (existsSync(planPath)) {
        const edited = await readFile(planPath, "utf8");
        if (edited.trim().length === 0) {
          console.log("Empty plan — cancelling.");
          return { action: "rejected" };
        }
        console.log("\n--- Edited Plan ---\n");
        console.log(edited.trim());
        return { action: "approved", planContent: edited.trim() };
      }
    }

    if (key === "d" || key === "detail") {
      console.log("\n--- Expanded Details ---\n");
      // Count changes by looking for **Action:** lines (format from buildPlanSystemPrompt)
      const createCount = (planContent.match(/-\s+\*\*Action:\*\*\s*create/gi) ?? []).length;
      const modifyCount = (planContent.match(/-\s+\*\*Action:\*\*\s*modify/gi) ?? []).length;
      const deleteCount = (planContent.match(/-\s+\*\*Action:\*\*\s*delete/gi) ?? []).length;
      console.log(`Files to create: ${createCount}`);
      console.log(`Files to modify: ${modifyCount}`);
      console.log(`Files to delete: ${deleteCount}`);
      console.log(`\nFull plan saved to: ${planPath}`);
      console.log("\n" + planContent);
      continue;
    }

    console.log("Press Y to approve, n to reject, e to edit, d for details.");
  }
}
