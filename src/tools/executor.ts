import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AlixConfig } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
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
import type { ToolResult } from "./types.js";

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
    private editFormatPolicy?: EditFormatPolicy
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
    const capability = name;

    await this.logEvent("tool.requested", { toolCallId, toolName: name, argsPreview: args, capability });

    const policyDecision = decidePolicy(this.config, {
      toolCallId,
      capability,
      ...args as { path?: string; command?: string }
    });

    if (policyDecision.decision === "deny") {
      await this.logEvent("tool.failed", { toolCallId, toolName: name, error: policyDecision.reason, status: "denied" });
      return { kind: "denied", reason: policyDecision.reason };
    }

    // MCP availability check — policy said "ask" or "allow", but is the tool connected?
    if (name.startsWith("mcp.") && !this.mcpManager) {
      const msg = "MCP manager not initialized. No MCP servers are connected.";
      await this.logEvent("tool.failed", { toolCallId, toolName: name, error: msg, status: "unavailable" });
      return { kind: "denied", reason: msg };
    }

    await this.logEvent("tool.started", { toolCallId, toolName: name });

    let result: ToolResult;

    switch (name) {
      case "file.read": {
        const { root: r, path } = args as { root: string; path: string };
        result = await readFile({ root: r ?? this.root, path });
        break;
      }
      case "dir.search": {
        const { root: r, pattern, extensions } = args as { root: string; pattern: string; extensions: string[] };
        result = await searchDir({ root: r ?? this.root, pattern, extensions: extensions ?? [] });
        break;
      }
      case "shell.run": {
        const { command, cwd, timeoutMs } = args as { command: string; cwd: string; timeoutMs?: number };
        result = await runCommand({ command, cwd: cwd ?? this.root, timeoutMs });
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
        if (changedFiles.length > 0) {
          checkpoint = await createFileCheckpoint(patchRoot, changedFiles);
          await this.logEvent("patch.checkpoint_created", { toolCallId, checkpointId: checkpoint.id, files: checkpoint.files, missingFiles: checkpoint.missingFiles });
        }
        try {
          const patchResult = await applyPatch(patchRoot, format as any, patchText);
          result = patchResult.status === "applied"
            ? { kind: "success", changedFiles: patchResult.changedFiles }
            : { kind: "error", message: "Patch invalid" };
        } catch (e: unknown) {
          if (checkpoint) {
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
        const exists = existsSync(resolvedPath);
        await mkdir(dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, content, "utf8");
        result = { kind: "success", output: exists ? `File updated: ${path}` : `File created: ${path}`, createdPath: path, changedFiles: [path] };
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

    // Build log payload — redact secrets from output/error before logging
    const logPayload = result.kind === "success"
      ? redactValue({
          toolCallId, toolName: name, status: result.kind,
          outputSize: ((result.output?.length ?? 0) + (result.content?.length ?? 0)),
          outputPreview: (result.output ?? result.content ?? "").slice(0, 200),
        })
      : redactValue({
          toolCallId, toolName: name, status: result.kind,
          outputSize: 0,
          error: result.message,
        });
    await this.logEvent(result.kind === "success" ? "tool.completed" : "tool.failed", logPayload.redacted as Record<string, unknown>);

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
