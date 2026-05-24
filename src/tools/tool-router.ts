import type { ToolResult, ToolCallRequest } from "./types.js";
import { readFile, searchDir } from "./file-tools.js";
import { runCommand } from "./shell-tool.js";
import { isSafeShellCommand, executeSafeShell } from "./safe-shell.js";
import { ShellPool } from "./shell-pool.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { applyPatch } from "../patch/patch-engine.js";
import { buildEditFormatPolicy, type EditFormatPolicy, type EditFormat } from "../patch/edit-format-policy.js";
import { extractPatchPaths } from "../patch/patch-paths.js";
import { createFileCheckpoint, restoreFileCheckpoint } from "../checkpoints/checkpoint-manager.js";
import type { Checkpoint } from "../checkpoints/checkpoint-manager.js";
import type { CheckpointManager } from "../patch/checkpoint.js";
import type { EventLog } from "../events/event-log.js";
import { FILE_EVENT_TYPES, MCP_EVENT_TYPES, PATCH_EVENT_TYPES } from "../events/types.js";
import type { AlixConfig } from "../config/schema.js";
import type { McpManager } from "../mcp/manager.js";

export interface ToolRouter {
  canHandle(name: string): boolean;
  execute(request: ToolCallRequest): Promise<ToolResult>;
}

export class FileToolRouter implements ToolRouter {
  private static readonly SUPPORTED_TOOLS = [
    "file.read",
    "file.create",
    "file.delete",
    "file.exists",
    "dir.search",
  ];

  constructor(
    private readonly root: string = "",
    private eventLog?: EventLog,
    private sessionId?: string
  ) {}

  canHandle(name: string): boolean {
    return FileToolRouter.SUPPORTED_TOOLS.includes(name);
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const args = request.args as {
      root?: string;
      path?: string;
      pattern?: string;
      extensions?: string[];
      content?: string;
    };

    switch (request.name) {
      case "file.read": {
        if (!args.path) return { kind: "error", message: "file.read requires path" };
        return readFile({ root: args.root ?? this.root, path: args.path });
      }
      case "dir.search": {
        if (!args.pattern) return { kind: "error", message: "dir.search requires pattern" };
        return searchDir({
          root: args.root ?? this.root,
          pattern: args.pattern,
          extensions: args.extensions ?? [],
        });
      }
      case "file.create": {
        const { root: r, path, content } = args;
        if (!path || content === undefined) {
          return { kind: "error", message: "file.create requires path and content" };
        }
        const baseRoot = resolve(r ?? this.root);
        const resolvedPath = resolve(baseRoot, path);
        // CRITICAL: validate path stays within workspace
        if (!resolvedPath.startsWith(baseRoot + "/") && resolvedPath !== baseRoot) {
          return { kind: "error", message: "Path is outside workspace", retryable: false };
        }
        if (existsSync(resolvedPath)) {
          return { kind: "error", message: "File already exists", retryable: false };
        }
        await mkdir(dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, content, "utf8");
        if (this.eventLog) {
          await this.eventLog.append({
            sessionId: this.sessionId ?? "unknown",
            actor: "system",
            type: FILE_EVENT_TYPES.CREATED,
            payload: { path },
          });
        }
        return {
          kind: "success",
          output: `File created: ${path}`,
          createdPath: path,
          changedFiles: [path],
        };
      }
      case "file.delete": {
        const { root: r, path } = args;
        if (!path) return { kind: "error", message: "file.delete requires path" };
        const baseRoot = resolve(r ?? this.root);
        const resolvedPath = resolve(baseRoot, path);
        if (!resolvedPath.startsWith(baseRoot + "/") && resolvedPath !== baseRoot) {
          return { kind: "error", message: "Path is outside workspace", retryable: false, hint: "Check the path is relative and inside the project directory." };
        }
        const { rm } = await import("node:fs/promises");
        try {
          await rm(resolvedPath);
          if (this.eventLog) {
            await this.eventLog.append({
              sessionId: this.sessionId ?? "unknown",
              actor: "system",
              type: FILE_EVENT_TYPES.DELETED,
              payload: { path },
            });
          }
        } catch (e) {
          return { kind: "error", message: `Delete failed: ${e instanceof Error ? e.message : String(e)}` };
        }
        return { kind: "success", output: `File deleted: ${path}`, deletedPath: path };
      }
      case "file.exists": {
        if (!args.path) return { kind: "error", message: "file.exists requires path" };
        const exists = existsSync(resolve(args.root ?? this.root, args.path));
        return { kind: "success", output: exists ? "exists" : "not found", exists };
      }
      default:
        return { kind: "error", message: `Unhandled: ${request.name}`, retryable: false };
    }
  }
}

export class ShellToolRouter implements ToolRouter {
  private shellPool?: ShellPool;

  constructor(private readonly root: string = "") {}

  canHandle(name: string): boolean {
    return name === "shell.run";
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const { command, cwd, timeoutMs, root: r, persistent } = request.args as {
      command?: string;
      cwd?: string;
      timeoutMs?: number;
      root?: string;
      persistent?: boolean;
    };

    if (!command) {
      return { kind: "error", message: "shell.run requires command" };
    }

    // Level 5: Check if command is safe shell (runs before policy decision)
    if (isSafeShellCommand(command)) {
      const result = await executeSafeShell(command);
      if (result.allowed) {
        return {
          kind: "success",
          output: result.output ?? result.error ?? "",
        };
      }
      return { kind: "error", message: result.error ?? "SafeShell validation failed" };
    }

    const workingDir = cwd ?? r ?? this.root;

    if (persistent) {
      if (!this.shellPool) {
        this.shellPool = new ShellPool({ cwd: workingDir, timeoutMs });
      }
      try {
        const result = await this.shellPool.run(command, timeoutMs);
        return { kind: "success", output: result.output };
      } catch (err) {
        return { kind: "error", message: String(err) };
      }
    }

    return runCommand({ command, cwd: workingDir, timeoutMs });
  }
}

export class PatchToolRouter implements ToolRouter {
  constructor(
    private readonly root: string,
    private readonly config: AlixConfig,
    private editFormatPolicy?: EditFormatPolicy,
    private checkpointManager?: CheckpointManager,
    private eventLog?: EventLog,
    private sessionId?: string
  ) {}

  canHandle(name: string): boolean {
    return name === "patch.apply";
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const { format, patchText, root: r } = request.args as { root?: string; format?: string; patchText?: string };
    if (!format || !patchText) {
      return { kind: "error", message: "patch.apply requires format and patchText" };
    }

    const patchRoot = r ?? this.root;
    const policy = this.editFormatPolicy ?? buildEditFormatPolicy({ provider: this.config.model.provider });
    const requestedFormat = format as EditFormat;
    const allowed = policy.allowed.includes(requestedFormat);

    // Log edit format policy telemetry
    if (this.eventLog) {
      await this.eventLog.append({
        sessionId: this.sessionId ?? "unknown",
        actor: "system",
        type: "patch.edit_format_policy",
        payload: {
          toolCallId: request.toolCallId,
          provider: policy.provider,
          requestedFormat: format,
          preferredFormat: policy.preferred,
          allowedFormats: policy.allowed,
          matchesPreference: requestedFormat === policy.preferred,
          allowed,
          fullFileRewrite: policy.fullFileRewrite,
        },
      });
    }

    if (!allowed) {
      return {
        kind: "error",
        message: `Patch format "${format}" is not allowed by edit format policy. Allowed formats: ${policy.allowed.join(", ")}`,
        retryable: false,
      };
    }

    const changedFiles = extractPatchPaths(requestedFormat, patchText);
    let checkpointId: string | undefined;
    let checkpoint: Checkpoint | null = null;

    const toolCallId = request.toolCallId;
    if (changedFiles.length > 0) {
      if (this.checkpointManager) {
        try {
          const cp = await this.checkpointManager.create("patch", changedFiles.map((f) => resolve(patchRoot, f)));
          checkpointId = cp.id;
          if (this.eventLog) {
            await this.eventLog.append({ sessionId: this.sessionId ?? "unknown", actor: "system", type: "patch.checkpoint_created", payload: { toolCallId, checkpointId: cp.id, files: changedFiles } });
          }
        } catch {
          // Continue without checkpoint
        }
      } else {
        checkpoint = await createFileCheckpoint(patchRoot, changedFiles);
        if (this.eventLog) {
          await this.eventLog.append({ sessionId: this.sessionId ?? "unknown", actor: "system", type: "patch.checkpoint_created", payload: { toolCallId, checkpointId: checkpoint.id, files: checkpoint.files, missingFiles: checkpoint.missingFiles } });
        }
      }
    }

    try {
      const patchResult = await applyPatch(patchRoot, requestedFormat, patchText, {
        eventLog: this.eventLog,
        sessionId: this.sessionId,
        checkpointManager: this.checkpointManager,
      });

      if (patchResult.status === "applied") {
        if (this.eventLog) {
          await this.eventLog.append({
            sessionId: this.sessionId ?? "unknown",
            actor: "system",
            type: PATCH_EVENT_TYPES.CHANGED_FILES,
            payload: { changedFiles: patchResult.changedFiles },
          });
        }
        return { kind: "success", changedFiles: patchResult.changedFiles };
      }
      return { kind: "error", message: "Patch invalid" };
    } catch (e: unknown) {
      // Rollback on failure
      const cpToRestore = checkpointId && this.checkpointManager ? { id: checkpointId } : checkpoint;
      if (cpToRestore && this.checkpointManager) {
        if (this.eventLog) {
          await this.eventLog.append({ sessionId: this.sessionId ?? "unknown", actor: "system", type: "patch.rollback_started", payload: { toolCallId, checkpointId: cpToRestore.id, files: changedFiles } });
        }
        try {
          await this.checkpointManager.restore(cpToRestore.id);
          if (this.eventLog) {
            await this.eventLog.append({ sessionId: this.sessionId ?? "unknown", actor: "system", type: "patch.rollback_completed", payload: { toolCallId, checkpointId: cpToRestore.id, files: changedFiles } });
          }
        } catch (rollbackError: unknown) {
          if (this.eventLog) {
            await this.eventLog.append({ sessionId: this.sessionId ?? "unknown", actor: "system", type: "patch.rollback_failed", payload: { toolCallId, checkpointId: cpToRestore.id, error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) } });
          }
        }
      } else if (checkpoint) {
        if (this.eventLog) {
          await this.eventLog.append({ sessionId: this.sessionId ?? "unknown", actor: "system", type: "patch.rollback_started", payload: { toolCallId, checkpointId: checkpoint.id, files: checkpoint.files } });
        }
        try {
          await restoreFileCheckpoint(checkpoint);
          if (this.eventLog) {
            await this.eventLog.append({ sessionId: this.sessionId ?? "unknown", actor: "system", type: "patch.rollback_completed", payload: { toolCallId, checkpointId: checkpoint.id, files: checkpoint.files } });
          }
        } catch (rollbackError: unknown) {
          if (this.eventLog) {
            await this.eventLog.append({ sessionId: this.sessionId ?? "unknown", actor: "system", type: "patch.rollback_failed", payload: { toolCallId, checkpointId: checkpoint.id, error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) } });
          }
        }
      }
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }
}

export class McpToolRouter implements ToolRouter {
  constructor(
    private mcpManager: McpManager | null,
    private eventLog?: EventLog,
    private sessionId?: string
  ) {}

  canHandle(name: string): boolean {
    return name.startsWith("mcp.") && this.mcpManager !== null;
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    if (!this.mcpManager) {
      return { kind: "error", message: "MCP manager not available", retryable: false };
    }
    // Parse mcp.server.tool format: mcp.github.repos.list -> github/repos_list
    const parts = request.name.split(".");
    if (parts.length < 3) {
      return { kind: "error", message: `Invalid MCP tool name: ${request.name}`, retryable: false };
    }
    const serverName = parts[1];
    const toolName = parts.slice(2).join("_");
    if (!serverName || !toolName) {
      return { kind: "error", message: `Invalid MCP tool name: ${request.name}`, retryable: false };
    }
    const fullName = `${serverName}/${toolName}`;
    const startTime = Date.now();
    try {
      const result = await this.mcpManager.callTool(fullName, request.args);
      const durationMs = Date.now() - startTime;
      if (this.eventLog) {
        await this.eventLog.append({
          sessionId: this.sessionId ?? "unknown",
          actor: "system",
          type: MCP_EVENT_TYPES.TOOL_INVOKED,
          payload: { serverName, toolName: fullName, durationMs },
        });
      }
      return result;
    } catch (e: unknown) {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }
}

export class DelegateToolRouter implements ToolRouter {
  constructor(private handlers?: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>>) {}

  canHandle(name: string): boolean {
    return name === "delegate";
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const handler = this.handlers?.delegate;
    if (!handler) {
      return { kind: "error", message: "Delegate handler not initialized", retryable: false };
    }
    try {
      return await handler(request.args);
    } catch (e: unknown) {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }
}

export class CompositeToolRouter implements ToolRouter {
  constructor(private readonly routers: ToolRouter[]) {}

  canHandle(_name: string): boolean {
    return true; // Composite router always matches; delegation decides
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const router = this.routers.find((r) => r.canHandle(request.name));
    if (!router) {
      return {
        kind: "error",
        message: `No router found for tool: ${request.name}`,
      };
    }
    return router.execute(request);
  }
}