import type { ToolResult, ToolCallRequest } from "./types.js";
import { readFile, searchDir } from "./file-tools.js";
import { runCommand } from "./shell-tool.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { applyPatch } from "../patch/patch-engine.js";
import { buildEditFormatPolicy, type EditFormatPolicy, type EditFormat } from "../patch/edit-format-policy.js";
import { extractPatchPaths } from "../patch/patch-paths.js";
import type { CheckpointManager } from "../patch/checkpoint.js";
import type { EventLog } from "../events/event-log.js";
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

  constructor(private readonly root: string = "") {}

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
        return {
          kind: "success",
          output: `File created: ${path}`,
          createdPath: path,
          changedFiles: [path],
        };
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
  constructor(private readonly root: string = "") {}

  canHandle(name: string): boolean {
    return name === "shell.run";
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const { command, cwd, timeoutMs } = request.args as { command?: string; cwd?: string; timeoutMs?: number };
    if (!command) {
      return { kind: "error", message: "shell.run requires command" };
    }
    return runCommand({ command, cwd: cwd ?? this.root, timeoutMs });
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

    if (!policy.allowed.includes(requestedFormat)) {
      return {
        kind: "error",
        message: `Patch format "${format}" is not allowed. Allowed: ${policy.allowed.join(", ")}`,
        retryable: false,
      };
    }

    const changedFiles = extractPatchPaths(requestedFormat, patchText);
    let checkpointId: string | undefined;

    if (changedFiles.length > 0 && this.checkpointManager) {
      try {
        const cp = await this.checkpointManager.create("patch", changedFiles.map((f) => resolve(patchRoot, f)));
        checkpointId = cp.id;
      } catch {
        // Continue without checkpoint
      }
    }

    try {
      const patchResult = await applyPatch(patchRoot, requestedFormat, patchText, {
        eventLog: this.eventLog,
        sessionId: this.sessionId,
        checkpointManager: this.checkpointManager,
      });

      return patchResult.status === "applied"
        ? { kind: "success", changedFiles: patchResult.changedFiles }
        : { kind: "error", message: "Patch invalid" };
    } catch (e: unknown) {
      // Rollback on failure
      if (checkpointId && this.checkpointManager) {
        await this.checkpointManager.restore(checkpointId);
      }
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }
}

export class McpToolRouter implements ToolRouter {
  constructor(private mcpManager: McpManager) {}

  canHandle(name: string): boolean {
    return name.startsWith("mcp.");
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    // Parse mcp.server.tool format: mcp.github.repos.list -> github/repos_list
    const parts = request.name.split(".");
    const serverName = parts[1];
    const toolName = parts.slice(2).join("_");
    const fullName = `${serverName}/${toolName}`;
    return this.mcpManager.callTool(fullName, request.args);
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
    return handler(request.args);
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