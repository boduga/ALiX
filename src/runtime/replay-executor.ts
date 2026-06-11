/**
 * replay-executor.ts -- Execute a ReplayPlan through bounded execution modes.
 *
 * Dry-run mode: simulates writes, blocks network, shell is simulated.
 * Sandbox mode: shell commands run in an isolated temp directory.
 * Both modes: audit events emitted via EventLog.
 */

import type { EventLog } from "../events/event-log.js";
import { REPLAY_EVENT_TYPES } from "../events/types.js";
import type { ReplayAction } from "./replay-preview.js";
import type { ReplayPlan, ReplayPlanStep, ReplayMode } from "./replay-plan.js";
import { existsSync } from "node:fs";
import { readFile, searchDir } from "../tools/file-tools.js";

// -- Types ---------------------------------------------------------------

export type ReplayStepResult = {
  index: number;
  traceId: string;
  action: ReplayAction;
  status: "completed" | "blocked" | "skipped" | "failed";
  toolName?: string;
  output?: string;
  outputSize?: number;
  durationMs?: number;
  blockReason?: string;
  error?: string;
};

export type ReplayResult = {
  mode: ReplayMode;
  steps: ReplayStepResult[];
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  toolCallCount: number;
  successCount: number;
  blockedCount: number;
  skippedCount: number;
  failedCount: number;
  warnings: string[];
};

// -- Tool wrappers (dry-run / sandbox) -----------------------------------

/** Determine if a tool name is a read-only file operation. */
function isReadOnlyFileTool(toolName: string): boolean {
  return ["file.read", "file.exists", "dir.search"].includes(toolName);
}

/** Determine if a tool is a network tool (blocked in both modes). */
function isNetworkTool(toolName: string): boolean {
  if (toolName.startsWith("mcp.")) return true;
  return ["web_search", "web_fetch", "delegate"].includes(toolName);
}

/**
 * Execute a single tool step in the given mode.
 * Returns the step result without any side effects (for the mode).
 */
async function replayToolStep(
  step: ReplayPlanStep,
  mode: ReplayMode,
  cwd: string,
): Promise<Pick<ReplayStepResult, "status" | "output" | "error" | "blockReason">> {
  const toolName = step.toolName || "";
  const args = step.args || {};

  // Dry-run shell: simulate
  if (toolName === "shell.run" && mode === "dry-run") {
    const command = String(args.command || "");
    return {
      status: "completed",
      output: `[DRY-RUN] Would run: ${command}`,
    };
  }

  // Sandbox shell: execute in temp dir
  if (toolName === "shell.run" && mode === "sandbox") {
    const command = String(args.command || "");
    const { runCommand } = await import("../tools/shell-tool.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const sandboxDir = mkdtempSync(join(tmpdir(), "alix-replay-"));
    try {
      const result = await runCommand({ command, cwd: sandboxDir });
      if (result.kind === "error") {
        return { status: "failed", error: result.message };
      }
      return {
        status: "completed",
        output: result.output || "",
      };
    } finally {
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  }

  // Dry-run file.create: simulate
  if (toolName === "file.create") {
    const path = String(args.path || "");
    const content = args.content !== undefined ? String(args.content) : "";
    return {
      status: "completed",
      output: `[DRY-RUN] Would create: ${path}\n${content.slice(0, 2000)}`,
    };
  }

  // Dry-run file.delete: simulate
  if (toolName === "file.delete") {
    const path = String(args.path || "");
    return {
      status: "completed",
      output: `[DRY-RUN] Would delete: ${path}`,
    };
  }

  // Dry-run patch.apply: simulate
  if (toolName === "patch.apply") {
    const patchText = String(args.patchText || "");
    const format = String(args.format || "");
    return {
      status: "completed",
      output: `[DRY-RUN] Would apply ${format} patch:\n${patchText.slice(0, 2000)}`,
    };
  }

  // Read-only file operations: execute normally
  if (toolName === "file.read") {
    const path = String(args.path || "");
    try {
      const result = await readFile({ root: cwd, path });
      if (result.kind === "error") {
        return { status: "failed", error: result.message };
      }
      return {
        status: "completed",
        output: result.content || "",
      };
    } catch (err: any) {
      return { status: "failed", error: err.message };
    }
  }

  if (toolName === "dir.search") {
    const pattern = String(args.pattern || "");
    const extensions = (args.extensions as string[]) || [];
    try {
      const result = await searchDir({ root: cwd, pattern, extensions });
      if (result.kind === "error") {
        return { status: "failed", error: result.message };
      }
      return {
        status: "completed",
        output: JSON.stringify(result.matches || []),
      };
    } catch (err: any) {
      return { status: "failed", error: err.message };
    }
  }

  if (toolName === "file.exists") {
    const path = String(args.path || "");
    const resolvedPath = path.startsWith("/") ? path : path ? `${cwd}/${path}` : cwd;
    return {
      status: "completed",
      output: existsSync(resolvedPath) ? "exists" : "not found",
    };
  }

  // Network tools: blocked
  if (isNetworkTool(toolName)) {
    return {
      status: "blocked",
      blockReason: `"${toolName}" is not available in ${mode} mode`,
    };
  }

  // Fallback for unknown tools
  return {
    status: "skipped",
    blockReason: `No replay handler for tool: ${toolName}`,
  };
}

// -- ReplayExecutor -------------------------------------------------------

export class ReplayExecutor {
  constructor(
    private cwd: string,
    private eventLog: EventLog,
  ) {}

  private sessionId(): string {
    const parts = this.eventLog.sessionDir.split("sessions/");
    return parts.length > 1 ? parts[1] : "unknown";
  }

  private async logEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.eventLog.append({ sessionId: this.sessionId(), actor: "system", type, payload });
  }

  async execute(plan: ReplayPlan): Promise<ReplayResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    await this.logEvent(REPLAY_EVENT_TYPES.STARTED, { mode: plan.mode, sessionId: this.sessionId() });

    const stepResults: ReplayStepResult[] = [];
    let successCount = 0;
    let blockedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const step of plan.steps) {
      const stepStart = Date.now();
      const stepResult: ReplayStepResult = {
        index: step.index,
        traceId: step.traceId,
        action: step.replayAction,
        toolName: step.toolName,
        status: "completed", // default, overwritten below per actual outcome
      };

      if (step.status === "blocked") {
        await this.logEvent(REPLAY_EVENT_TYPES.STEP_BLOCKED, {
          stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
          toolName: step.toolName, blockReason: step.blockReason,
        });
        stepResult.status = "blocked";
        stepResult.blockReason = step.blockReason;
        stepResult.durationMs = Date.now() - stepStart;
        blockedCount++;
        stepResults.push(stepResult);
        continue;
      }

      if (step.status === "skipped") {
        await this.logEvent(REPLAY_EVENT_TYPES.STEP_SKIPPED, {
          stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
        });
        stepResult.status = "skipped";
        stepResult.durationMs = 0;
        skippedCount++;
        stepResults.push(stepResult);
        continue;
      }

      await this.logEvent(REPLAY_EVENT_TYPES.STEP_STARTED, {
        stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
        toolName: step.toolName,
      });

      try {
        const toolResult = await replayToolStep(step, plan.mode, this.cwd);
        await this.logEvent(REPLAY_EVENT_TYPES.STEP_COMPLETED, {
          stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
          toolName: step.toolName, status: toolResult.status, outputPreview: (toolResult.output || "").slice(0, 200),
          blockReason: toolResult.blockReason, error: toolResult.error, durationMs: Date.now() - stepStart,
        });

        stepResult.status = toolResult.status;
        stepResult.output = toolResult.output;
        stepResult.outputSize = (toolResult.output || "").length;
        stepResult.error = toolResult.error;
        stepResult.blockReason = toolResult.blockReason;

        if (toolResult.status === "completed") successCount++;
        else if (toolResult.status === "blocked") blockedCount++;
        else if (toolResult.status === "skipped") skippedCount++;
        else failedCount++;
      } catch (err: any) {
        await this.logEvent(REPLAY_EVENT_TYPES.STEP_BLOCKED, {
          stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
          toolName: step.toolName, error: err.message,
        });
        stepResult.status = "failed";
        stepResult.error = err.message;
        failedCount++;
      }

      stepResult.durationMs = Date.now() - stepStart;
      stepResults.push(stepResult);
    }

    const totalDurationMs = Date.now() - startTime;
    const completedAt = new Date().toISOString();

    await this.logEvent(REPLAY_EVENT_TYPES.COMPLETED, {
      mode: plan.mode, stepCount: plan.steps.length,
      successCount, blockedCount, skippedCount, failedCount, totalDurationMs,
    });

    return {
      mode: plan.mode,
      steps: stepResults,
      startedAt,
      completedAt,
      totalDurationMs,
      toolCallCount: plan.toolCount,
      successCount,
      blockedCount,
      skippedCount,
      failedCount,
      warnings: plan.warnings,
    };
  }
}
