import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AlixConfig } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import { TOOL_EVENT_TYPES } from "../events/types.js";
import type { ToolStartedPayload, ToolOutputPayload, ToolCompletedPayload, ToolFailedPayload } from "../events/types.js";
import type { McpManager } from "../mcp/manager.js";
import { decidePolicy } from "../policy/policy-engine.js";
import { redactValue } from "../policy/secret-scanner.js";
import { readFile, searchDir } from "./file-tools.js";
import { runCommand } from "./shell-tool.js";
import { applyPatch } from "../patch/patch-engine.js";
import { buildEditFormatPolicy } from "../patch/edit-format-policy.js";
import type { EditFormat, EditFormatPolicy } from "../patch/edit-format-policy.js";
import { extractPatchPaths } from "../patch/patch-paths.js";
import { createFileCheckpoint, restoreFileCheckpoint } from "../checkpoints/checkpoint-manager.js";
import type { Checkpoint } from "../checkpoints/checkpoint-manager.js";
import { CheckpointManager } from "../patch/checkpoint.js";
import type { ToolResult } from "./types.js";

const LARGE_OUTPUT_THRESHOLD = 10000;

export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
};

export type ExecuteResult = ToolResult | { kind: "denied"; reason: string };

export class ToolExecutor {
  constructor(
    private config: AlixConfig,
    private log: EventLog,
    private root: string,
    private mcpManager?: McpManager,
    private editFormatPolicy?: EditFormatPolicy,
    private extraHandlers?: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>>,
    private checkpointManager?: CheckpointManager
  ) {}

  private sessionId(): string {
    // Extract sessionId from EventLog sessionDir: .alix/sessions/<sessionId>
    const parts = this.log.sessionDir.split("sessions/");
    return parts.length > 1 ? parts[1] : "unknown";
  }

  private async logEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.log.append({ sessionId: this.sessionId(), actor: "system", type, payload });
  }

  async execute(request: ToolCallRequest): Promise<ExecuteResult> {
    const { toolCallId, name, args } = request;
    const capability = inferCapability(name);

    await this.logEvent(TOOL_EVENT_TYPES.REQUESTED, { toolCallId, toolName: name, capability, argsPreview: args });

    const policyDecision = decidePolicy(this.config, {
      toolCallId,
      capability,
      ...args as { path?: string; command?: string }
    });

    if (policyDecision.decision === "deny") {
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, { toolCallId, toolName: name, error: policyDecision.reason, durationMs: 0 });
      return { kind: "denied", reason: policyDecision.reason };
    }

    // MCP availability check — policy said "ask" or "allow", but is the tool connected?
    if (name.startsWith("mcp.") && !this.mcpManager) {
      const msg = "MCP manager not initialized. No MCP servers are connected.";
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, { toolCallId, toolName: name, error: msg, durationMs: 0 });
      return { kind: "denied", reason: msg };
    }

    await this.logEvent(TOOL_EVENT_TYPES.STARTED, { toolCallId, toolName: name });

    let result: ToolResult;

    switch (name) {
      case "file.read": {
        const { root: r, path } = args as { root: string; path: string };
        result = await readFile({ root: r ?? this.root, path });
        if (result.kind === "success" && result.content) {
          // Suggest calling done if the file looks like a complete implementation
          const hasFunction = /^(?:async )?\s*function|^(?:async )?\s*def|^(?:async )?\s*const\s+\w+\s*=/m.test(result.content);
          const hasReturn = /return|yield/.test(result.content);
          if (hasFunction && hasReturn) {
            result.content = `${result.content.slice(0, 200)}\n\n[File contains a complete implementation. Call done if no further changes are needed.]`;
          }
        }
        break;
      }
      case "dir.search": {
        const { root: r, pattern, extensions } = args as { root: string; pattern: string; extensions: string[] };
        result = await searchDir({ root: r ?? this.root, pattern, extensions: extensions ?? [] });
        break;
      }
      case "shell.run": {
        const { root: r, command, cwd, timeoutMs } = args as { root?: string; command: string; cwd?: string; timeoutMs?: number };
        result = await runCommand({ command, cwd: cwd ?? r ?? this.root, timeoutMs });
        break;
      }
      case "patch.apply": {
        const { root: r, format, patchText } = args as { root: string; format: string; patchText: string };
        const patchRoot = r ?? this.root;
        const policy = this.editFormatPolicy ?? buildEditFormatPolicy({ provider: this.config.model.provider });
        const requestedFormat = format as EditFormat;
        const allowed = policy.allowed.includes(requestedFormat);
        await this.logEvent("patch.edit_format_policy", {
          toolCallId,
          provider: policy.provider,
          requestedFormat: format,
          preferredFormat: policy.preferred,
          allowedFormats: policy.allowed,
          matchesPreference: requestedFormat === policy.preferred,
          allowed,
          fullFileRewrite: policy.fullFileRewrite,
        });
        if (!allowed) {
          result = { kind: "error", message: `Patch format "${format}" is not allowed by edit format policy. Allowed formats: ${policy.allowed.join(", ")}`, retryable: false };
          break;
        }
        const changedFiles = extractPatchPaths(format, patchText);
        let checkpoint: Checkpoint | null = null;
        let checkpointId: string | undefined;
        let proposalId: string | undefined;
        // Create checkpoint using CheckpointManager if available, otherwise use legacy approach
        if (changedFiles.length > 0) {
          if (this.checkpointManager) {
            try {
              const cp = await this.checkpointManager.create("patch", changedFiles.map(f => resolve(patchRoot, f)));
              checkpointId = cp.id;
              await this.logEvent("patch.checkpoint_created", { toolCallId, checkpointId: cp.id, files: changedFiles });
            } catch (e) {
              // Continue without checkpoint
            }
          } else {
            checkpoint = await createFileCheckpoint(patchRoot, changedFiles);
            await this.logEvent("patch.checkpoint_created", { toolCallId, checkpointId: checkpoint.id, files: checkpoint.files, missingFiles: checkpoint.missingFiles });
          }
        }
        try {
          const patchResult = await applyPatch(patchRoot, format as any, patchText, {
            eventLog: this.log,
            sessionId: this.sessionId(),
            checkpointManager: this.checkpointManager,
          });
          proposalId = patchResult.proposalId;
          checkpointId = patchResult.checkpointId ?? checkpointId;
          result = patchResult.status === "applied"
            ? { kind: "success", changedFiles: patchResult.changedFiles }
            : { kind: "error", message: "Patch invalid" };
        } catch (e: unknown) {
          const cpToRestore = checkpoint ?? (checkpointId && this.checkpointManager ? { id: checkpointId } : null);
          if (cpToRestore && this.checkpointManager) {
            await this.logEvent("patch.rollback_started", { toolCallId, checkpointId: cpToRestore.id, files: changedFiles });
            try {
              await this.checkpointManager.restore(cpToRestore.id);
              await this.logEvent("patch.rollback_completed", { toolCallId, checkpointId: cpToRestore.id, files: changedFiles });
            } catch (rollbackError: unknown) {
              await this.logEvent("patch.rollback_failed", {
                toolCallId,
                checkpointId: cpToRestore.id,
                error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
              });
            }
          } else if (checkpoint) {
            await this.logEvent("patch.rollback_started", { toolCallId, checkpointId: checkpoint.id, files: checkpoint.files });
            try {
              await restoreFileCheckpoint(checkpoint);
              await this.logEvent("patch.rollback_completed", { toolCallId, checkpointId: checkpoint.id, files: checkpoint.files });
            } catch (rollbackError: unknown) {
              await this.logEvent("patch.rollback_failed", {
                toolCallId,
                checkpointId: checkpoint.id,
                error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
              });
            }
          }
          result = { kind: "error", message: e instanceof Error ? e.message : String(e) };
        }
        break;
      }
      case "file.create": {
        const { root: r, path, content } = args as { root: string; path: string; content: string };
        if (!path || content === undefined) { result = { kind: "error", message: "file.create requires path and content" }; break; }
        const resolvedRoot = resolve(r ?? this.root);
        const resolvedPath = resolve(resolvedRoot, path);
        if (!resolvedPath.startsWith(resolvedRoot + "/") && resolvedPath !== resolvedRoot) {
          result = { kind: "error", message: "Path is outside workspace", retryable: false, hint: "Check the path is relative and inside the project directory." }; break;
        }
        if (existsSync(resolvedPath)) {
          result = { kind: "error", message: `File already exists: ${path}`, retryable: false, hint: `Use file.read to inspect the existing content, then use patch.apply to modify it.` }; break;
        }
        await mkdir(dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, content, "utf8");
        result = { kind: "success", output: `File created: ${path}`, createdPath: path, changedFiles: [path] };
        break;
      }
      case "file.delete": {
        const { root: r, path } = args as { root: string; path: string };
        if (!path) { result = { kind: "error", message: "file.delete requires path" }; break; }
        const resolvedRoot = resolve(r ?? this.root);
        const resolvedPath = resolve(resolvedRoot, path);
        if (!resolvedPath.startsWith(resolvedRoot + "/") && resolvedPath !== resolvedRoot) {
          result = { kind: "error", message: "Path is outside workspace", retryable: false, hint: "Check the path is relative and inside the project directory." }; break;
        }
        const { rm } = await import("node:fs/promises");
        try { await rm(resolvedPath); } catch (e) { result = { kind: "error", message: `Delete failed: ${e instanceof Error ? e.message : String(e)}` }; break; }
        result = { kind: "success", output: `File deleted: ${path}`, deletedPath: path };
        break;
      }
      case "file.exists": {
        const { root: r, path } = args as { root: string; path: string };
        if (!path) { result = { kind: "error", message: "file.exists requires path" }; break; }
        const resolvedRoot = resolve(r ?? this.root);
        const resolvedPath = resolve(resolvedRoot, path);
        if (!resolvedPath.startsWith(resolvedRoot + "/") && resolvedPath !== resolvedRoot) {
          result = { kind: "error", message: "Path is outside workspace", retryable: false }; break;
        }
        result = { kind: "success", output: existsSync(resolvedPath) ? `File exists: ${path}` : `File not found: ${path}`, exists: existsSync(resolvedPath) };
        break;
      }
      case "done": {
        result = { kind: "success", output: "Task complete.", completed: true };
        break;
      }
      case "delegate": {
        const handler = this.extraHandlers?.delegate;
        if (!handler) {
          result = { kind: "error", message: "Delegate handler not initialized", retryable: false };
        } else {
          result = await handler(args as Record<string, unknown>);
        }
        break;
      }
      default: {
        // Check if this is an MCP tool (mcp.server.tool format)
        if (name.startsWith("mcp.")) {
          if (!this.mcpManager) {
            result = { kind: "error", message: "MCP manager not initialized", retryable: false };
          } else {
            const parts = name.split(".");
            const serverName = parts[1];
            const toolName = parts.slice(2).join("_");
            const fullName = `${serverName}/${toolName}`;
            result = await this.mcpManager.callTool(fullName, args);
            // Classify MCP errors with hints
            if (result.kind === "error") {
              result = classifyError(result);
            }
          }
        } else {
          result = { kind: "error", message: `Unknown tool: ${name}`, retryable: false };
        }
      }
    }

    // Calculate duration from start time in toolCallId
    const startTime = parseInt(toolCallId.split("_")[1]) || Date.now();
    const durationMs = Date.now() - startTime;

    // Handle large outputs by writing to file
    const outputSize = (result.kind === "success")
      ? ((result.output?.length ?? 0) + (result.content?.length ?? 0))
      : 0;
    let outputRef: string | undefined;

    if (result.kind === "success" && outputSize > LARGE_OUTPUT_THRESHOLD) {
      outputRef = await writeOutputToFile(result.output ?? result.content);
    }

    // Build and emit tool.output event for success
    if (result.kind === "success") {
      const outputPayload: ToolOutputPayload = {
        toolCallId,
        outputRef,
        outputPreview: truncateOutput(result.output ?? result.content ?? ""),
        outputSize,
      };
      await this.logEvent(TOOL_EVENT_TYPES.OUTPUT, outputPayload);
    }

    // Build and emit tool.completed or tool.failed event
    if (result.kind === "success") {
      const completedPayload: ToolCompletedPayload = {
        toolCallId,
        toolName: name,
        status: "success",
        durationMs,
      };
      await this.logEvent(TOOL_EVENT_TYPES.COMPLETED, completedPayload);
    } else {
      const failedPayload: ToolFailedPayload = {
        toolCallId,
        toolName: name,
        error: result.message,
        durationMs,
      };
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, failedPayload);
    }

    return result;
  }
}

type ErrorResult = { kind: "error"; message: string; retryable?: boolean; hint?: string };

export function classifyError(result: ErrorResult): ErrorResult {
  const msg = result.message.toLowerCase();

  // Fatal — don't retry, model can't fix this
  if (msg.includes("unknown mcp tool") ||
      msg.includes("not initialized") ||
      msg.includes("authentication failed") ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("invalid api key") ||
      msg.includes("permission denied") ||
      msg.includes("path is outside")) {
    return { ...result, retryable: false };
  }

  // Retryable — transient or server-side
  if (msg.includes("timed out") ||
      msg.includes("timeout") ||
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("connection") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("503") ||
      msg.includes("unavailable")) {
    return { ...result, retryable: true };
  }

  // Unknown/ambiguous — retry once, model decides
  return { ...result, retryable: true };
}

function inferCapability(toolName: string): string {
  if (toolName.startsWith("mcp.")) return "mcp.invoke";
  if (toolName === "file.read") return "file.read";
  if (toolName === "file.create") return "file.write";
  if (toolName === "file.delete") return "file.write";
  if (toolName === "file.exists") return "file.read";
  if (toolName === "dir.search") return "file.search";
  if (toolName === "shell.run") return "shell.run";
  if (toolName === "patch.apply") return "patch.apply";
  if (toolName === "done") return "task.complete";
  if (toolName === "delegate") return "delegate";
  return "tool.invoke";
}

function truncateOutput(output: unknown, maxLen = 200): string {
  const str = typeof output === "string" ? output : JSON.stringify(output);
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

async function writeOutputToFile(output: unknown): Promise<string> {
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");

  const outputDir = join(tmpdir(), "alix-tool-outputs");
  await mkdir(outputDir, { recursive: true });

  const filePath = join(outputDir, `${randomUUID()}.json`);
  const content = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  await writeFile(filePath, content, "utf8");

  return filePath;
}
