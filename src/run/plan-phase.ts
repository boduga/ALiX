/**
 * src/run/plan-phase.ts — Plan phase: generate → save → approve.
 *
 * History:
 *   - Round 0: parser creates `PlanTask` records (`src/planning/plan-task.ts`)
 *     and sidecar persistence at `.alix/plans/<sessionId>.tasks.json`.
 *   - Round 1: parser constrained to `## Changes` + `## Verification`; sidecar
 *     failures non-fatal; prompt gate restored to HEAD semantics.
 *   - Round 2 (this file): rebased onto the controller's authoritative HEAD
 *     that includes `PlanApprovalGate` support. The gate is the TUI's
 *     approval surface; the legacy TTY prompt is the CLI fallback. Both
 *     paths now persist the structured sidecar (additive, non-fatal).
 *
 * @module
 */

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { AgentContext } from "../agent/agent.js";
import type { ContextBundle } from "../repomap/context-compiler.js";
import { prompt } from "../cli/commands/prompt.js";
import { isReadOnlyTask, isShellTask } from "../task-classifier.js";
import {
  parsePlanTasks,
  buildPlanTaskList,
  type PlanTask,
} from "../planning/plan-task.js";
import type { PlanApprovalGate } from "./plan-approval-gate.js";
import { runApprovalLoop } from "./plan-approval.js";
import type { PlanApprovalIO } from "./plan-approval.js";

export type PlanPhaseResult =
  | { action: "approved"; planContent: string; planTasks?: readonly PlanTask[] }
  | { action: "rejected"; planContent: string; planTasks?: readonly PlanTask[] };

export type PlanApprovalMode = "interactive" | "deferred";

/**
 * Minimal filesystem operations the sidecar persistence needs.
 * Exported so tests can inject a failing writer/unlinker.
 */
export interface SidecarFs {
  write: (path: string, data: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
}

const defaultSidecarFs: SidecarFs = {
  write: writeFile,
  unlink,
};

/**
 * Persist the structured `.tasks.json` sidecar next to the `.md` plan file.
 *
 * Best-effort: failures are non-fatal. A warning is logged and the
 * function returns `{ wrote: false, warning }` so callers can inspect
 * the outcome without try/catch.
 *
 * If `planTasks` is empty, any existing sidecar is removed so the
 * caller never leaves stale task records on disk.
 *
 * @param planDir - directory containing the `.md` plan (e.g. `.alix/plans`).
 * @param sessionId - session id; combined with `planDir` to produce the sidecar path.
 * @param planTasks - parsed tasks. Empty array triggers sidecar deletion.
 * @param fs - filesystem writer/unlinker; defaults to `node:fs/promises`.
 *             Override for testing.
 */
export async function persistPlanTaskSidecar(
  planDir: string,
  sessionId: string,
  planTasks: readonly PlanTask[],
  fs: SidecarFs = defaultSidecarFs,
): Promise<{ wrote: boolean; warning: string | null }> {
  const sidecarPath = join(planDir, `${sessionId}.tasks.json`);
  try {
    if (planTasks.length === 0) {
      // No tasks → remove any stale sidecar.
      try {
        await fs.unlink(sidecarPath);
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== "ENOENT") throw err;
      }
      return { wrote: false, warning: null };
    }
    const list = buildPlanTaskList(sessionId, planTasks);
    await fs.write(sidecarPath, JSON.stringify(list, null, 2));
    return { wrote: true, warning: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const warning = `[plan-phase] warning: failed to persist plan task sidecar (${sidecarPath}): ${msg}`;
    console.warn(warning);
    return { wrote: false, warning };
  }
}

/**
 * Convenience wrapper: clear the `.tasks.json` sidecar by persisting an empty
 * task list. Used on plan reject / empty edit to remove stale task records.
 *
 * @param planDir - directory containing the `.md` plan (e.g. `.alix/plans`).
 * @param sessionId - session id.
 * @param sidecarFs - filesystem writer/unlinker; defaults to `node:fs/promises`.
 */
export async function clearPlanTaskSidecar(
  planDir: string,
  sessionId: string,
  sidecarFs?: SidecarFs,
): Promise<void> {
  await persistPlanTaskSidecar(planDir, sessionId, [], sidecarFs);
}

/**
 * Run the plan phase: generate plan → save → (optionally) print and prompt.
 *
 * `approvalMode` separates two concerns that `runPlanPhase` previously conflated:
 *   1. **Plan generation** — an LLM operation.
 *   2. **Interactive approval** — a terminal-UI operation.
 *
 * | approvalMode | process.stdout.isTTY | gate | Behaviour |
 * |---|---|---|---|
 * | `"interactive"` (default) | `true` | absent | Generate, print, prompt → approved/rejected |
 * | `"interactive"` | `false` | absent | Skip entirely (backward-compat for CI/piped) |
 * | `"interactive"` | any | provided | Generate, gate handles approve/reject/edit/detail |
 * | `"deferred"` | any | any | Generate, return as approved (caller handles display/prompt) |
 *
 * Read-only / shell tasks always skip plan generation regardless of `approvalMode`.
 *
 * `sidecarFs` allows the caller to inject a custom filesystem writer/unlinker
 * for the `.tasks.json` sidecar. Used by tests to simulate I/O failure.
 * Sidecar failures are non-fatal and logged via `console.warn`.
 */
export async function runPlanPhase(
  ctx: AgentContext,
  bundle: ContextBundle,
  task: string,
  planFilePath?: string,
  opts?: {
    approvalMode?: PlanApprovalMode;
    gate?: PlanApprovalGate;
    sidecarFs?: SidecarFs;
  },
): Promise<PlanPhaseResult> {
  const approvalMode = opts?.approvalMode ?? "interactive";
  const sidecarFs = opts?.sidecarFs ?? defaultSidecarFs;

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

  // 2b. Parse plan content into structured tasks and persist sidecar.
  // Best-effort — sidecar failures are non-fatal (non-fatal warning above).
  const parsedTasks = parsePlanTasks(planContent, ctx.sessionId);
  await persistPlanTaskSidecar(planDir, ctx.sessionId, parsedTasks, sidecarFs);

  // 3. Interactive: ask the operator to approve the plan.
  //    Two surfaces: the TUI gate (when provided) or the legacy TTY prompt.
  if (approvalMode === "interactive") {
    if (opts?.gate) {
      // Gate-driven path: the TUI's plan-approval card owns the operator's
      // yes/no/edit/detail keypresses. `runPlanPhase` is called inside the
      // agent loop, so blocking here is intentional — the loop awaits the
      // gate's Promise before continuing.
      return await resolvePlanDecisionViaGate(
        opts.gate,
        planPath,
        planContent,
        ctx.sessionId,
        planDir,
        sidecarFs,
      );
    }
    console.log("\n" + planContent);
    return await promptForPlanApproval(planPath, planContent, {
      planDir,
      sessionId: ctx.sessionId,
      initialTasks: parsedTasks,
      sidecarFs,
    });
  }

  // 4. Deferred: return plan without prompting (caller handles display/approval)
  return { action: "approved", planContent, planTasks: parsedTasks };
}

/**
 * Drive the approval flow through a `PlanApprovalGate`. The gate returns
 * one of four decisions per round; `edit` and `detail` are not terminal
 * — we re-call the gate after handling the side effect (open editor /
 * print details) until the operator approves or rejects.
 *
 * Why a loop and not a single decision: the gate's contract is a single
 * keypress per round. The model of "edit then re-confirm" is two rounds.
 *
 * Sidecar persistence: after every `edit` round, the `.tasks.json` file
 * is re-parsed and rewritten. After `approve`, the sidecar matches the
 * approved plan; after `reject` or empty-edit, the sidecar is deleted
 * so no stale tasks remain on disk.
 */
async function resolvePlanDecisionViaGate(
  gate: PlanApprovalGate,
  planPath: string,
  planContent: string,
  sessionId: string,
  planDir: string,
  sidecarFs: SidecarFs,
): Promise<PlanPhaseResult> {
  const tuiIO: PlanApprovalIO = {
    async requestDecision(display) {
      return await gate.requestDecision({
        planId: sessionId,
        planSummary: display.planSummary,
        planContent: display.planContent,
        planPath: display.planPath,
      });
    },
    showPlanDetail(_content: string, _planPath: string) {
      /* TUI gate renders plan in card */
    },
  };
  return runApprovalLoop(tuiIO, planPath, planContent, sessionId, planDir, sidecarFs);
}

/**
 * Open `$VISUAL`/`$EDITOR` on the plan file. Returns the new file content
 * (re-read from disk) on success, or null if the editor couldn't launch.
 *
 * Mirrors the edit branch of `promptForPlanApproval` so both surfaces
 * (CLI prompt and TUI gate) handle `edit` identically.
 */
export async function openPlanInEditor(planPath: string): Promise<string | null> {
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
export function summarisePlan(planContent: string): string {
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
 * Optional context passed to `promptForPlanApproval` so the legacy TTY
 * prompt can refresh the `.tasks.json` sidecar after edit / reject.
 */
interface PromptForPlanApprovalCtx {
  planDir: string;
  sessionId: string;
  initialTasks: readonly PlanTask[];
  sidecarFs: SidecarFs;
}

/**
 * Prompt user for plan approval.
 * Returns 'approved' on Y, 'rejected' on n.
 * On 'e', opens $EDITOR for modifications then auto-approves.
 * On 'd', shows expanded info then re-prompts.
 *
 * When `sidecarCtx` is provided, the function also refreshes the
 * `.tasks.json` sidecar:
 *   - On `Y` (approve): current sidecar matches the approved plan.
 *   - On `n` (reject): delete the sidecar (no stale tasks).
 *   - On empty edit (auto-reject): delete the sidecar.
 *   - On `e` then non-empty save (auto-approve): re-parse and rewrite.
 */
async function promptForPlanApproval(
  planPath: string,
  planContent: string,
  sidecarCtx: PromptForPlanApprovalCtx,
): Promise<PlanPhaseResult> {
  const ttyIO: PlanApprovalIO = {
    async requestDecision(): Promise<"approve" | "reject" | "edit" | "detail"> {
      while (true) {
        const answer = await prompt("Approve plan? [Y/n/e/d] ");
        const key = answer.toLowerCase().trim();
        if (key === "" || key === "y" || key === "yes") return "approve";
        if (key === "n" || key === "no") return "reject";
        if (key === "e" || key === "edit") return "edit";
        if (key === "d" || key === "detail") return "detail";
        console.log("Press Y to approve, n to reject, e to edit, d for details.");
      }
    },
    showPlanDetail(content: string, planPath: string) {
      const createCount = (content.match(/-\s+\*\*Action:\*\*\s*create/gi) ?? []).length;
      const modifyCount = (content.match(/-\s+\*\*Action:\*\*\s*modify/gi) ?? []).length;
      const deleteCount = (content.match(/-\s+\*\*Action:\*\*\s*delete/gi) ?? []).length;
      console.log(`Files to create: ${createCount}`);
      console.log(`Files to modify: ${modifyCount}`);
      console.log(`Files to delete: ${deleteCount}`);
      console.log(`\nFull plan saved to: ${planPath}`);
      console.log("\n" + content);
    },
  };
  return runApprovalLoop(ttyIO, planPath, planContent, sidecarCtx.sessionId, sidecarCtx.planDir, sidecarCtx.sidecarFs);
}
