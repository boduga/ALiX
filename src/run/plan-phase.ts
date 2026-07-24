import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { AgentContext } from "../agent/agent.js";
import type { ContextBundle } from "../repomap/context-compiler.js";
import { prompt } from "../cli/commands/prompt.js";
import { isReadOnlyTask, isShellTask } from "../task-classifier.js";
import type { PlanApprovalGate } from "./plan-approval-gate.js";

export type PlanPhaseResult =
  | { action: "approved"; planContent: string }
  | { action: "rejected"; planContent: string };

export type PlanApprovalMode = "interactive" | "deferred";

/**
 * Run the plan phase: generate plan → save → (optionally) print and prompt.
 *
 * `approvalMode` separates two concerns that `runPlanPhase` previously conflated:
 *   1. **Plan generation** — an LLM operation.
 *   2. **Interactive approval** — a terminal-UI operation.
 *
 * | approvalMode | process.stdout.isTTY | Behaviour |
 * |---|---|---|
 * | `"interactive"` (default) | `true` | Generate, print, prompt → approved/rejected |
 * | `"interactive"` | `false` | Skip entirely (backward-compat for CI/piped) |
 * | `"deferred"` | any | Generate, return as approved (caller handles display/prompt) |
 *
 * Read-only / shell tasks always skip plan generation regardless of `approvalMode`.
 */
export async function runPlanPhase(
  ctx: AgentContext,
  bundle: ContextBundle,
  task: string,
  planFilePath?: string,
  opts?: { approvalMode?: PlanApprovalMode; gate?: PlanApprovalGate },
): Promise<PlanPhaseResult> {
  const approvalMode = opts?.approvalMode ?? "interactive";

  // Skip plan generation for read-only / shell tasks — no model call wasted.
  if (isReadOnlyTask(task) || isShellTask(task)) {
    return { action: "approved", planContent: "" };
  }

  // Interactive mode without a TTY: skip plan entirely (CI, piped, scripting).
  // The gate-driven path (opts.gate) bypasses this guard — the gate is the
  // TUI's approval surface, not a TTY prompt, so it remains usable when
  // stdout.isTTY is false (e.g. when the TUI itself is launched under a
  // subshell that doesn't expose a TTY).
  if (approvalMode === "interactive" && !opts?.gate && !process.stdout.isTTY) {
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

  // 3. Interactive: ask the operator to approve the plan.
  //    Two surfaces: the TUI gate (when provided) or the legacy TTY prompt.
  if (approvalMode === "interactive") {
    if (opts?.gate) {
      // Gate-driven path: the TUI's plan-approval card owns the operator's
      // yes/no/edit/detail keypresses. `runPlanPhase` is called inside the
      // agent loop, so blocking here is intentional — the loop awaits the
      // gate's Promise before continuing.
      return await resolvePlanDecisionViaGate(opts.gate, planPath, planContent, ctx.sessionId);
    }
    console.log("\n" + planContent);
    return await promptForPlanApproval(planPath, planContent);
  }

  // 4. Deferred: return plan without prompting (caller handles display/approval)
  return { action: "approved", planContent };
}

/**
 * Drive the approval flow through a `PlanApprovalGate`. The gate returns
 * one of four decisions per round; `edit` and `detail` are not terminal
 * — we re-call the gate after handling the side effect (open editor /
 * print details) until the operator approves or rejects.
 *
 * Why a loop and not a single decision: the gate's contract is a single
 * keypress per round. The model of "edit then re-confirm" is two rounds.
 */
async function resolvePlanDecisionViaGate(
  gate: PlanApprovalGate,
  planPath: string,
  initialContent: string,
  sessionId: string,
): Promise<PlanPhaseResult> {
  let planContent = initialContent;
  // Bounded loop — defensive guard against a misbehaving gate that keeps
  // returning `edit`/`detail`. 10 rounds is far more than a real operator
  // would ever need; the gate is in control so honour anything beyond.
  for (let round = 0; round < 10; round++) {
    const decision = await gate.requestDecision({
      planId: sessionId,
      planSummary: summarisePlan(planContent),
      planContent,
      planPath,
    });
    if (decision === "approve") {
      return { action: "approved", planContent };
    }
    if (decision === "reject") {
      return { action: "rejected", planContent };
    }
    if (decision === "edit") {
      // Open the editor in-place. The persisted file is the source of
      // truth — after editing, we re-read it so the gate's next round
      // sees the new content.
      const edited = await openPlanInEditor(planPath);
      if (edited === null) {
        // Editor failed to launch — surface a hint and re-prompt so the
        // operator can try `d` (detail) or `n` (reject) instead.
        console.error("Could not open editor (set $VISUAL or $EDITOR).");
        continue;
      }
      if (edited.trim().length === 0) {
        console.log("Empty plan — cancelling.");
        return { action: "rejected", planContent };
      }
      planContent = edited;
      continue;
    }
    // "detail" — print the plan to stdout (TTY sidecar) so the operator
    // can read it, then re-prompt. The gate's TUI renders the same plan
    // inside the card; this path is for the CLI fallback where the gate
    // is intentionally not displaying the body.
    console.log("\n" + planContent);
    continue;
  }
  // Defensive default: after 10 rounds, treat as "no decision made" and
  // approve (matches the spirit of deferred mode — unblock the loop).
  return { action: "approved", planContent };
}

/**
 * Open `$VISUAL`/`$EDITOR` on the plan file. Returns the new file content
 * (re-read from disk) on success, or null if the editor couldn't launch.
 *
 * Mirrors the edit branch of `promptForPlanApproval` so both surfaces
 * (CLI prompt and TUI gate) handle `edit` identically.
 */
async function openPlanInEditor(planPath: string): Promise<string | null> {
  const editor = process.env.VISUAL ?? process.env.EDITOR ?? "vim";
  const result = spawnSync(editor, [planPath], { stdio: "inherit" });
  if (result.error) return null;
  if (!existsSync(planPath)) return null;
  return await readFile(planPath, "utf8");
}

/**
 * First non-empty line of the plan, used as the card header.
 * Falls back to a generic label when the plan has no leading prose.
 */
function summarisePlan(planContent: string): string {
  for (const raw of planContent.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // Strip leading markdown heading markers so the summary reads cleanly.
    return line.replace(/^#+\s*/, "").slice(0, 200);
  }
  return "Plan";
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
      return { action: "rejected", planContent };
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
          return { action: "rejected", planContent };
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
