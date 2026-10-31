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
import type { ApprovalStore } from "../../governance/approvals/approval-store.js";
import { claimLiveStep, emitBlockedStepApprovalCreated, liveStepInvocation } from "../../governance/approvals/live-step-approval.js";
import type { ReplayDiffSet, ReplayDiffStore } from "./replay-diff-store.js";
import { readFile, grepSearch, globMatch } from "../../capabilities/tools/file-tools.js";
import type { ReplayStatusIndex } from "./replay-status-index.js";

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
  replayId?: string;
  diffSet?: ReplayDiffSet;
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

/** Determine if a tool is a network tool (blocked in both modes). */
function isNetworkTool(toolName: string): boolean {
  if (toolName.startsWith("mcp.")) return true;
  return ["web.search", "web.fetch", "agent.delegate"].includes(toolName);
}

/**
 * Execute a single tool step in the given mode.
 * Returns the step result without any side effects (for the mode).
 */
async function replayToolStep(
  step: ReplayPlanStep,
  mode: ReplayMode,
  cwd: string,
  opts?: { replayId?: string; diffStore?: ReplayDiffStore },
): Promise<Pick<ReplayStepResult, "status" | "output" | "error" | "blockReason"> & { outcomeUnknown?: boolean }> {
  const toolName = step.toolName || "";
  const args = step.args || {};

  // Approved-live shell: execute for real
  if (toolName === "shell.run" && mode === "approved-live") {
    const command = String(args.command || "");
    const { runCommand } = await import("../../capabilities/tools/shell-tool.js");
    const { executeWithEffectJournal } = await import("../../capabilities/tools/effect-journal.js");
    // Replay IDs and renewed approvals are not effect identities. The durable
    // journal keys the actual shell command and workspace across replay runs.
    const result = await executeWithEffectJournal(cwd, {
      toolCallId: `replay-${step.index}`, name: "shell.run", args: { command, cwd },
    }, (boundRequest) => runCommand({ command, cwd: String(boundRequest.args.cwd) }));
    if (result.kind === "error") {
      return { status: "failed", error: result.message, outcomeUnknown: result.outcomeUnknown === true };
    }
    return { status: "completed", output: result.output || "" };
  }

  // Approved-live file.create: execute for real with diff capture
  if (toolName === "file.create" && mode === "approved-live") {
    const { executeWithEffectJournal } = await import("../../capabilities/tools/effect-journal.js");
    const result = await executeWithEffectJournal(cwd, {
      toolCallId: `replay-${step.index}`, name: "file.create", args,
    }, async () => {
      const path = String(args.path || "");
      const content = args.content !== undefined ? String(args.content) : "";
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { dirname, resolve } = await import("node:path");
      const resolvedPath = resolve(cwd, path);

      // Capture before (will be null for new file)
      const beforePath = opts?.replayId && opts?.diffStore
        ? await opts.diffStore.captureBefore(opts.replayId, path) : null;

      await mkdir(dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, content, "utf8");

      // Capture after
      if (opts?.replayId && opts?.diffStore) {
        const afterPath = await opts.diffStore.captureAfter(opts.replayId, path);
        const diffOutput = await opts.diffStore.computeDiff(opts.replayId, path);
        await opts.diffStore.appendRecord(opts.replayId, {
          filePath: path,
          changeType: "created",
          beforeSnapshotPath: beforePath || undefined,
          afterSnapshotPath: afterPath || undefined,
          diffPreview: diffOutput.slice(0, 2000),
          diffSize: diffOutput.length,
          rollbackable: false,
          timestamp: new Date().toISOString(),
        });
      }

      return { kind: "success" as const, output: `File created: ${path}` };
    });
    // The journal owns uncertainty: an unknown outcome must stay non-retryable
    // and reach the caller's blocked/unknown handling, not be smoothed to failed.
    if (result.kind === "error") {
      return { status: "failed", error: result.message, outcomeUnknown: result.outcomeUnknown === true };
    }
    return { status: "completed", output: result.output || `File created: ${String(args.path || "")}` };
  }

  // Approved-live file.delete: execute for real with diff capture
  if (toolName === "file.delete" && mode === "approved-live") {
    const { executeWithEffectJournal } = await import("../../capabilities/tools/effect-journal.js");
    const result = await executeWithEffectJournal(cwd, {
      toolCallId: `replay-${step.index}`, name: "file.delete", args,
    }, async () => {
      const path = String(args.path || "");
      const { rm } = await import("node:fs/promises");
      const { resolve } = await import("node:path");
      const resolvedPath = resolve(cwd, path);
      const beforePath = opts?.replayId && opts?.diffStore
        ? await opts.diffStore.captureBefore(opts.replayId, path) : null;

      await rm(resolvedPath);

      if (opts?.replayId && opts?.diffStore) {
        const afterPath = await opts.diffStore.captureAfter(opts.replayId, path);
        const diffOutput = await opts.diffStore.computeDiff(opts.replayId, path);
        await opts.diffStore.appendRecord(opts.replayId, {
          filePath: path,
          changeType: "deleted",
          beforeSnapshotPath: beforePath || undefined,
          afterSnapshotPath: afterPath || undefined,
          diffPreview: diffOutput.slice(0, 2000),
          diffSize: diffOutput.length,
          rollbackable: true,
          timestamp: new Date().toISOString(),
        });
      }
      return { kind: "success", output: `File deleted: ${path}` };
    });
    return result.kind === "error"
      ? { status: "failed", error: result.message, outcomeUnknown: result.outcomeUnknown === true }
      : { status: "completed", output: result.output };
  }

  // Approved-live patch.apply: execute for real with diff capture
  if (toolName === "patch.apply" && mode === "approved-live") {
    const format = (args.format || "search_replace") as any;
    const patchText = String(args.patchText || "");
    const { applyPatch } = await import("../../execution/patch/patch-engine.js");
    const { extractPatchPaths } = await import("../../execution/patch/patch-paths.js");

    // Extract files that will be changed before applying
    const changedByPatch = extractPatchPaths(format, patchText);

    // Capture before for each file
    const beforePaths: Record<string, string | null> = {};
    if (opts?.replayId && opts?.diffStore) {
      for (const f of changedByPatch) {
        beforePaths[f] = await opts.diffStore.captureBefore(opts.replayId, f);
      }
    }

    // Execute the patch inside the journal boundary: a patch that applies and
    // then throws (or reports an unknown outcome) must not be replayed blindly.
    const { executeWithEffectJournal } = await import("../../capabilities/tools/effect-journal.js");
    const journaled = await executeWithEffectJournal(cwd, {
      toolCallId: `replay-${step.index}`, name: "patch.apply", args,
    }, async () => {
      const result = await applyPatch(cwd as string, format, patchText);
      if (result.status === "applied" && result.changedFiles) {
        // After capture + diff
        if (opts?.replayId && opts?.diffStore) {
          for (const f of result.changedFiles) {
            const afterPath = await opts.diffStore.captureAfter(opts.replayId, f);
            const diffOutput = await opts.diffStore.computeDiff(opts.replayId, f);
            await opts.diffStore.appendRecord(opts.replayId, {
              filePath: f,
              changeType: beforePaths[f] !== null ? "modified" : "created",
              beforeSnapshotPath: beforePaths[f] || undefined,
              afterSnapshotPath: afterPath || undefined,
              diffPreview: diffOutput.slice(0, 2000),
              diffSize: diffOutput.length,
              rollbackable: beforePaths[f] !== null,
              timestamp: new Date().toISOString(),
            });
          }
        }
        return { kind: "success" as const, output: `Patch applied: ${result.changedFiles.join(", ")}` };
      }
      // A patch that did not apply is a definite, non-mutating failure.
      return { kind: "success" as const, output: `Patch invalid` };
    });
    if (journaled.kind === "error") {
      return { status: "failed", error: journaled.message, outcomeUnknown: journaled.outcomeUnknown === true };
    }
    const applied = journaled.output?.startsWith("Patch applied:");
    return applied
      ? { status: "completed", output: journaled.output }
      : { status: "failed", error: "Patch invalid" };
  }

  // Approved-live network: execute for real (already gated by approval above)
  if (isNetworkTool(toolName) && mode === "approved-live") {
    if (toolName === "web.search" || toolName === "web.fetch") {
      const { webSearchTool } = await import("../../capabilities/tools/web-search.js");
      const { webFetchTool } = await import("../../capabilities/tools/web-fetch.js");
      const tool = toolName === "web.search" ? webSearchTool() : webFetchTool();
      const result = await tool.execute(args as any);
      if (result.ok) {
        return { status: "completed", output: JSON.stringify(result.data) };
      }
      return { status: "failed", error: result.error ?? "Unknown error" };
    }
    if (toolName === "agent.delegate") {
      return { status: "blocked", blockReason: "delegate tool requires subagent context in replay" };
    }
    // mcp.* tools
    return { status: "blocked", blockReason: `MCP tool ${toolName} requires MCP manager in approved-live replay` };
  }

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
    const { runCommand } = await import("../../capabilities/tools/shell-tool.js");
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

  if (toolName === "grep.search") {
    try {
      const result = await grepSearch({
        root: cwd,
        pattern: String(args.pattern || ""),
        caseSensitive: args.caseSensitive === true,
        include: Array.isArray(args.include) ? args.include as string[] : undefined,
        headLimit: typeof args.headLimit === "number" ? args.headLimit : undefined,
      });
      if (result.kind === "error") return { status: "failed", error: result.message };
      return { status: "completed", output: JSON.stringify(result.matches || []) };
    } catch (err: any) {
      return { status: "failed", error: err.message };
    }
  }

  if (toolName === "glob.match") {
    try {
      const result = await globMatch({
        root: cwd,
        pattern: String(args.pattern || ""),
        headLimit: typeof args.headLimit === "number" ? args.headLimit : undefined,
      });
      if (result.kind === "error") return { status: "failed", error: result.message };
      return { status: "completed", output: result.output ?? "" };
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

// ─── Side-effect classification ──────────────────────────────────────────

export type SideEffectLevel = "read-only" | "side-effect" | "network";

export function classifySideEffect(toolName: string): SideEffectLevel {
  if (["file.read", "file.exists", "grep.search", "glob.match"].includes(toolName)) return "read-only";
  if (toolName.startsWith("mcp.")) return "network";
  if (["web.search", "web.fetch", "agent.delegate"].includes(toolName)) return "network";
  return "side-effect";
}

export type ReplayExecuteOptions = {
  approvalStore?: ApprovalStore;
  diffStore?: ReplayDiffStore;
  statusIndex?: ReplayStatusIndex;
};

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

  async execute(plan: ReplayPlan, opts?: ReplayExecuteOptions): Promise<ReplayResult> {
    plan = structuredClone(plan);
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    await this.logEvent(REPLAY_EVENT_TYPES.STARTED, {
      mode: plan.mode,
      sessionId: this.sessionId(),
      replayId: plan.replayId,
    });

    const stepResults: ReplayStepResult[] = [];
    let successCount = 0;
    let blockedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const [position, step] of plan.steps.entries()) {
      let claimedApprovalId: string | undefined;
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
          replayId: plan.replayId,
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
          replayId: plan.replayId,
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
        replayId: plan.replayId,
      });

      // Approved-live mode: re-check policy, get approval for side effects
      if (plan.mode === "approved-live" && step.toolName) {
        const toolName = step.toolName;
        const sideEffect = classifySideEffect(toolName);

        if (sideEffect !== "read-only") {
          const store = opts?.approvalStore;
          if (!store || !plan.replayId?.trim()) {
            stepResult.status = "blocked";
            stepResult.blockReason = !store
              ? "Approval store required for approved-live mode"
              : "Replay identity required for approved-live mode";
            stepResult.durationMs = Date.now() - stepStart;
            blockedCount++;
            stepResults.push(stepResult);
            continue;
          }

          const invocation = liveStepInvocation(this.cwd, this.sessionId(), toolName, toolName, {
            operation: "replay", replayId: plan.replayId, sourceSessionId: plan.sessionId,
            position, step,
          });
          const claim = await claimLiveStep(store, invocation,
            `Replay ${plan.replayId || "?"} step ${step.index}: ${toolName}`,
            { replayId: plan.replayId, position, step });
          if (!claim.claimed) {
            await emitBlockedStepApprovalCreated(store, claim, {
              replayId: plan.replayId,
              capability: toolName, toolName,
            }, (eventType, data) => this.logEvent(eventType, data));
            stepResult.status = "blocked";
            stepResult.blockReason = claim.reason;
            stepResult.durationMs = Date.now() - stepStart;
            blockedCount++;
            stepResults.push(stepResult);
            continue;
          }
          claimedApprovalId = claim.approvalId;
        }
      }

      try {
        const toolResult = await replayToolStep(step, plan.mode, this.cwd, {
          replayId: plan.replayId,
          diffStore: opts?.diffStore,
        });
        if (claimedApprovalId && !toolResult.outcomeUnknown) {
          await opts!.approvalStore!.recordExecutionOutcome(claimedApprovalId,
            toolResult.status === "completed" ? "succeeded" : "failed");
        }
        await this.logEvent(REPLAY_EVENT_TYPES.STEP_COMPLETED, {
          stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
          toolName: step.toolName, status: toolResult.status, outputPreview: (toolResult.output || "").slice(0, 200),
          blockReason: toolResult.blockReason, error: toolResult.error, durationMs: Date.now() - stepStart,
          replayId: plan.replayId,
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
        // A thrown adapter can have applied an effect; leave the consumed approval pending.
        await this.logEvent(REPLAY_EVENT_TYPES.STEP_BLOCKED, {
          stepIndex: step.index, traceId: step.traceId, action: step.replayAction,
          toolName: step.toolName, error: err.message,
          replayId: plan.replayId,
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
      replayId: plan.replayId,
    });

    // Set status to "completed" for approved-live replays that ran without critical failures
    if (plan.replayId && plan.mode === "approved-live" && opts?.statusIndex) {
      // Only set completed if at least one step succeeded and no fatal errors
      if (successCount > 0 && failedCount === 0 && blockedCount === 0) {
        await opts.statusIndex.ensureReplay(plan.replayId, "approved-live");
        await opts.statusIndex.setStatus(plan.replayId, "completed", "approved-live");
      }
    }

    // Load diff set if available
    let diffSet: ReplayDiffSet | undefined;
    if (plan.replayId && opts?.diffStore) {
      diffSet = await opts.diffStore.loadIndex(plan.replayId) ?? undefined;
    }

    return {
      mode: plan.mode,
      replayId: plan.replayId,
      diffSet,
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
