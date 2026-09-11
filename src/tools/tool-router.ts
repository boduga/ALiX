import type { ToolResult, ToolCallRequest } from "./types.js";
import { readFile, searchDir } from "./file-tools.js";
import { runCommand } from "./shell-tool.js";
import { isSafeShellCommand, executeSafeShell, safeShellPathOperands } from "./safe-shell.js";
import { ShellPool } from "./shell-pool.js";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { applyPatch } from "../patch/patch-engine.js";
import { buildEditFormatPolicy, type EditFormatPolicy, type EditFormat } from "../patch/edit-format-policy.js";
import { resolveModelConfig } from "../config/model-resolver.js";
import { extractPatchPaths } from "../patch/patch-paths.js";
import { createFileCheckpoint, restoreFileCheckpoint } from "../checkpoints/checkpoint-manager.js";
import type { Checkpoint } from "../checkpoints/checkpoint-manager.js";
import type { CheckpointManager } from "../patch/checkpoint.js";
import type { EventLog } from "../events/event-log.js";
import { FILE_EVENT_TYPES, MCP_EVENT_TYPES, PATCH_EVENT_TYPES } from "../events/types.js";
import { measurePhase } from "../runtime/timing-events.js";
import type { AlixConfig } from "../config/schema.js";
import type { McpManager } from "../mcp/manager.js";
import { WorkspacePathResolver } from "../runtime/workspace-path.js";
import { validateShellNetworkCommand, type ResolveNetworkHost } from "./shell-network-policy.js";

import { buildDefaultToolIndex, ToolRetriever } from "./tool-registry.js";
import type { ToolRegistry, CapabilityIndex } from "./tool-registry.js";

export interface ToolRouter {
  canHandle(name: string): boolean;
  execute(request: ToolCallRequest): Promise<ToolResult>;
}

/** Convert Codex-style Aider update hunks (`@@` without line ranges) into
 * exact search/replace blocks. A numbered Aider diff remains unified_diff. */
function normalizeSimpleAiderUpdates(patchText: string): string | undefined {
  if (!/^\*\*\* Begin Patch/m.test(patchText) || !/^@@\s*$/m.test(patchText)) return undefined;
  if (/^\*\*\* (?:Add|Delete) File:/m.test(patchText)) return undefined;

  const blocks: Array<{ path: string; oldLines: string[]; newLines: string[] }> = [];
  let path: string | undefined;
  let oldLines: string[] | undefined;
  let newLines: string[] | undefined;
  const flush = (): void => {
    if (path && oldLines && newLines && oldLines.join("\n") !== newLines.join("\n")) {
      blocks.push({ path, oldLines, newLines });
    }
    oldLines = undefined;
    newLines = undefined;
  };

  for (const line of patchText.replace(/\r\n?/g, "\n").split("\n")) {
    const file = line.match(/^\*\*\* Update File:\s*(.+)$/);
    if (file) {
      flush();
      path = file[1].trim();
      continue;
    }
    if (/^@@\s*$/.test(line)) {
      flush();
      oldLines = [];
      newLines = [];
      continue;
    }
    if (!oldLines || !newLines || /^\*\*\* (?:Begin|End) Patch/.test(line)) continue;
    if (line.startsWith("-")) oldLines.push(line.slice(1));
    else if (line.startsWith("+")) newLines.push(line.slice(1));
    else {
      const context = line.startsWith(" ") ? line.slice(1) : line;
      oldLines.push(context);
      newLines.push(context);
    }
  }
  flush();
  if (blocks.length === 0) return undefined;
  return blocks.map((block) => [
    `<<<<<<< SEARCH path=${block.path}`,
    block.oldLines.join("\n"),
    "=======",
    block.newLines.join("\n"),
    ">>>>>>> REPLACE",
  ].join("\n")).join("\n");
}

export class FileToolRouter implements ToolRouter {
  private static readonly SUPPORTED_TOOLS = [
    "file.read",
    "file.create",
    "file.delete",
    "file.exists",
    "dir.search",
  ];

  private readonly pathResolver: WorkspacePathResolver;

  constructor(
    private readonly root: string = process.cwd(),
    private eventLog?: EventLog,
    private sessionId?: string,
    pathResolver?: WorkspacePathResolver,
  ) {
    this.pathResolver = pathResolver ?? new WorkspacePathResolver(this.root);
  }

  /** Validate a file path through the path resolver. Returns error result if blocked. */
  private checkPath(rawPath: string): ToolResult | null {
    const result = this.pathResolver.check(rawPath);
    if (!result.insideWorkspace || !this.pathResolver.isCanonicalInWorkspace(result.absolute)) {
      return { kind: "error", message: `Access denied: path is outside workspace (${result.absolute})`, retryable: false };
    }
    // Check protected first — user-configured protections take priority over
    // the generic sensitive pattern message for better UX.
    if (result.protected && result.insideWorkspace) {
      return { kind: "error", message: `Access denied: path is protected (${result.absolute})` };
    }
    if (result.sensitive) {
      return { kind: "error", message: `Access denied: path is sensitive (${result.absolute})` };
    }
    return null;
  }

  canHandle(name: string): boolean {
    return FileToolRouter.SUPPORTED_TOOLS.includes(name);
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const args = request.args as any;

    // Path validation via WorkspacePathResolver
    if (args.root && resolve(args.root) !== resolve(this.root)) {
      return { kind: "error", message: "Access denied: root override is outside the configured workspace", retryable: false };
    }
    if (args.path) {
      const blocked = this.checkPath(resolve(this.root, args.path));
      if (blocked) return blocked;
    }

    switch (request.name) {
      case "file.read": {
        if (!args.path) return { kind: "error", message: "file.read requires path" };
        return readFile({ root: this.root, path: args.path });
      }
      case "dir.search": {
        if (!args.pattern) return { kind: "error", message: "dir.search requires pattern" };
        return searchDir({
          root: this.root,
          pattern: args.pattern,
          extensions: args.extensions ?? [],
        });
      }
      case "file.create": {
        const { path, content } = args;
        if (!path || content === undefined) {
          return { kind: "error", message: "file.create requires path and content" };
        }
        const baseRoot = resolve(this.root);
        const resolvedPath = resolve(baseRoot, path);
        // CRITICAL: validate path stays within workspace
        const rel = relative(baseRoot, resolvedPath);
        if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
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
            payload: { path, resolvedPath, root: this.root },
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
        const { path } = args;
        if (!path) return { kind: "error", message: "file.delete requires path" };
        const baseRoot = resolve(this.root);
        const resolvedPath = resolve(baseRoot, path);
        const rel = relative(baseRoot, resolvedPath);
        if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
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
        const exists = existsSync(resolve(this.root, args.path));
        return { kind: "success", output: exists ? "exists" : "not found", exists };
      }
      default:
        return { kind: "error", message: `Unhandled: ${request.name}`, retryable: false };
    }
  }
}

export class ShellToolRouter implements ToolRouter {
  private shellPool?: ShellPool;
  private readonly pathResolver: WorkspacePathResolver;

  constructor(
    private readonly root: string = process.cwd(),
    pathResolver?: WorkspacePathResolver,
    private envAllowlist?: string[],
    private allowNetworkDomains: string[] = [],
    private resolveNetworkHost?: ResolveNetworkHost,
  ) {
    this.pathResolver = pathResolver ?? new WorkspacePathResolver(this.root);
  }

  canHandle(name: string): boolean {
    return name === "shell.run";
  }

  /** Validate a path through the resolver. Returns error result if blocked. */
  private checkPath(rawPath: string): ToolResult | null {
    const r = this.pathResolver.check(rawPath);
    if (!r.insideWorkspace || !this.pathResolver.isCanonicalInWorkspace(r.absolute)) {
      return { kind: "error", message: "Shell access denied: path is outside workspace (" + r.absolute + ")", retryable: false };
    }
    // Check protected first — user-configured protections take priority over
    // the generic sensitive pattern message for better UX (mirrors FileToolRouter).
    if (r.protected && r.insideWorkspace) {
      return { kind: "error", message: "Shell access denied: path is protected (" + r.absolute + ")" };
    }
    if (r.sensitive) {
      return { kind: "error", message: "Shell access denied: path is sensitive (" + r.absolute + ")" };
    }
    return null;
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const { command, cwd, timeoutMs, root: r, persistent } = request.args as {
      command?: string;
      cwd?: string;
      timeoutMs?: number;
      root?: string;
      persistent?: boolean;
    };

    // Path validation via WorkspacePathResolver
    if (cwd) {
      const blocked = this.checkPath(cwd);
      if (blocked) return blocked;
    }
    if (r) {
      const blocked = this.checkPath(r);
      if (blocked) return blocked;
    }

    if (r && resolve(r) !== resolve(this.root)) {
      return { kind: "error", message: "Shell root override must be the configured workspace", retryable: false };
    }

    // Scan the command string for references to known sensitive paths.
    // Uses boundary-aware patterns to avoid false positives (.git != .gitignore).
    if (command && this.pathResolver) {
      if (/\bgit\b[^;&|\n]*\bconfig\b/i.test(command)) {
        return { kind: "error", message: "Shell access denied: command reads or writes protected Git configuration" };
      }
      const sensitivePathPatterns: { pattern: RegExp; name: string }[] = [
        // Path-based patterns: match .alix, .ssh, .git, .env when preceded by
        // space, slash, tilde, or start-of-string (the real ways paths appear).
        { pattern: /(?:^|\s|\/|~)\.(?:alix|ssh|git|env)(?:$|\/|\s)/, name: ".alix/.ssh/.git/.env" },
        { pattern: /\bid_rsa\b/, name: "id_rsa" },
        { pattern: /\bid_ed25519\b/, name: "id_ed25519" },
        { pattern: /\bknown_hosts\b/, name: "known_hosts" },
        { pattern: /\/config\.json\b/, name: "config.json" },
      ];
      for (const { pattern, name } of sensitivePathPatterns) {
        if (pattern.test(command)) {
          return { kind: "error", message: "Shell access denied: command references sensitive path (" + name + ")" };
        }
      }
    }

    if (!command) {
      return { kind: "error", message: "shell.run requires command" };
    }

    try {
      await validateShellNetworkCommand(command, this.allowNetworkDomains, this.resolveNetworkHost);
    } catch (error) {
      return {
        kind: "error",
        message: `Shell network access denied: ${error instanceof Error ? error.message : String(error)}`,
        retryable: false,
      };
    }

    // Safe-shell admission is about command shape, not path authority. Every
    // filesystem operand still goes through the same workspace/canonical-path
    // boundary as file tools so `cat ../secret` cannot bypass containment.
    if (isSafeShellCommand(command)) {
      for (const operand of safeShellPathOperands(command)) {
        const blocked = this.checkPath(operand);
        if (blocked) return blocked;
      }
    }

    // Level 5: Check if command is safe shell (runs before policy decision)
    if (isSafeShellCommand(command)) {
      const sResult = await executeSafeShell(command, { cwd: this.root, envAllowlist: this.envAllowlist });
      if (sResult.allowed) {
        if (sResult.error) return { kind: "error", message: sResult.error };
        return {
          kind: "success",
          output: sResult.output ?? "",
        };
      }
      return { kind: "error", message: sResult.error ?? "SafeShell validation failed" };
    }

    const workingDir = cwd ?? this.root;

    if (persistent) {
      if (!this.shellPool) {
        this.shellPool = new ShellPool({ cwd: workingDir, timeoutMs, envAllowlist: this.envAllowlist });
      }
      try {
        const shResult = await this.shellPool.run(command, timeoutMs);
        return { kind: "success", output: shResult.output };
      } catch (err) {
        return { kind: "error", message: String(err) };
      }
    }

    // Operator-cancel signal (optional) is threaded into runCommand so an
    // operator abort kills the child (via spawnCommand's cancel path) and the
    // outcome surfaces as ExecutionCancelledError, never as a tool failure.
    return runCommand({ command, cwd: workingDir, timeoutMs, signal: request.signal, envAllowlist: this.envAllowlist });
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
    const { format, patchText, root: requestedRoot } = request.args as { root?: string; format?: string; patchText?: string };
    if (!format || !patchText) {
      return { kind: "error", message: "patch.apply requires format and patchText" };
    }

    if (requestedRoot && resolve(requestedRoot) !== resolve(this.root)) {
      return { kind: "error", message: "Access denied: patch root override is outside the configured workspace", retryable: false };
    }
    const patchRoot = this.root;
    const policy = this.editFormatPolicy ?? buildEditFormatPolicy({ provider: resolveModelConfig(this.config).provider });
    const requestedFormat = format as EditFormat;
    // Patch syntax is authoritative when a model labels an unmistakable
    // unified/Aider payload as another supported format.
    const trimmedPatch = patchText.trimStart();
    const isSimpleAiderUpdate =
      trimmedPatch.startsWith("*** Begin Patch") &&
      /^@@\s*$/m.test(trimmedPatch) &&
      !/^\*\*\* (?:Add|Delete) File:/m.test(trimmedPatch);
    const normalizedSimpleAider = normalizeSimpleAiderUpdates(patchText);
    if (isSimpleAiderUpdate && !normalizedSimpleAider) {
      return { kind: "error", message: "No patch changes found" };
    }
    const effectivePatchText = normalizedSimpleAider ?? patchText;
    const effectiveFormat: EditFormat = normalizedSimpleAider
      ? "search_replace"
      : trimmedPatch.startsWith("*** Begin Patch") ||
      (/^---\s+\S+/m.test(trimmedPatch) && /^\+\+\+\s+\S+/m.test(trimmedPatch))
        ? "unified_diff"
        : requestedFormat;
    const allowed = policy.allowed.includes(effectiveFormat);

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
          effectiveFormat,
          formatAutoDetected: effectiveFormat !== requestedFormat,
          preferredFormat: policy.preferred,
          allowedFormats: policy.allowed,
          matchesPreference: effectiveFormat === policy.preferred,
          allowed,
          fullFileRewrite: policy.fullFileRewrite,
        },
      });
    }

    if (!allowed) {
      return {
        kind: "error",
        message: `Patch format "${effectiveFormat}" is not allowed by edit format policy. Allowed formats: ${policy.allowed.join(", ")}`,
        retryable: false,
      };
    }

    const changedFiles = extractPatchPaths(effectiveFormat, effectivePatchText);
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
      const patchResult = await applyPatch(patchRoot, effectiveFormat, effectivePatchText, {
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

export class WebToolsRouter implements ToolRouter {
  private static readonly SUPPORTED_TOOLS = ["web_search", "web_fetch"];
  constructor(private readonly allowDomains: string[] = []) {}

  canHandle(name: string): boolean {
    return WebToolsRouter.SUPPORTED_TOOLS.includes(name);
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    const { webSearchTool } = await import("./web-search.js");
    const { webFetchTool } = await import("./web-fetch.js");

    const tool = request.name === "web_search" ? webSearchTool() : webFetchTool({ allowDomains: this.allowDomains });
    const result = await tool.execute(request.args as any);

    if (result.ok) {
      return { kind: "success", output: JSON.stringify(result.data) };
    }
    return { kind: "error", message: result.error ?? "Unknown error" };
  }
}

export class SelfExtendToolRouter implements ToolRouter {
  private static readonly SUPPORTED_TOOLS = ["create_skill", "list_extensions", "inspect_extension", "create_hook"];

  canHandle(name: string): boolean {
    return SelfExtendToolRouter.SUPPORTED_TOOLS.includes(name);
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    // Handle create_hook specially — it needs a HookRunner instance
    if (request.name === "create_hook") {
      const { createHookTool } = await import("../self-extend/create-hook.js");
      const { HookRunner } = await import("../extensions/hook-runner.js");
      const runner = new HookRunner();
      const tool = createHookTool(runner);
      return tool.execute(request.args as import("../self-extend/create-hook.js").CreateHookArgs);
    }

    // Lazy imports to avoid circular dependency
    const { createSkillTool } = await import("../self-extend/create-skill.js");
    const { listExtensionsTool } = await import("../self-extend/list-extensions.js");
    const { inspectExtensionTool } = await import("../self-extend/inspect-extension.js");

    const tool = request.name === "create_skill" ? createSkillTool()
      : request.name === "list_extensions" ? listExtensionsTool()
      : inspectExtensionTool();

    const result = await tool.execute(request.args);

    // Convert to ToolResult format
    if (result.ok) {
      return { kind: "success", output: JSON.stringify(result.data) };
    }
    return { kind: "error", message: result.error ?? "Unknown error" };
  }
}

/**
 * Decorator router that filters available tools by task intent before
 * passing to the downstream CompositeToolRouter. When intent keywords
 * are provided, only tools matching those keywords (plus essential
 * always-include tools) are offered to the model.
 *
 * Pure filtering — does not change tool execution, PolicyGate, or
 * ApprovalStore behavior. When no intent is set, all tools pass through.
 */
export class ToolAwareRouter implements ToolRouter {
  private retriever: ToolRetriever;
  private currentIntent: string[] = [];
  /** Cached tool set for the current intent — rebuilt on setIntent(), cleared on clearIntent(). */
  private allowedToolNames: Set<string> | null = null;

  constructor(
    readonly downstream: ToolRouter,
    private eventLog?: EventLog,
    private sessionId?: string,
  ) {
    const { registry, index } = buildDefaultToolIndex();
    this.retriever = new ToolRetriever(registry, index);
  }

  /** Set the current task intent keywords for tool filtering. */
  setIntent(intent: string[]): void {
    this.currentIntent = intent;
    this.allowedToolNames = new Set(
      this.retriever.selectForIntent(intent).map(t => t.name)
    );
  }

  /** Clear the current intent — fall back to allowing all tools. */
  clearIntent(): void {
    this.currentIntent = [];
    this.allowedToolNames = null;
  }

  canHandle(name: string): boolean {
    if (this.currentIntent.length === 0) return true;
    return this.allowedToolNames?.has(name) ?? false;
  }

  async execute(request: ToolCallRequest): Promise<ToolResult> {
    // If an intent is set, reject execution of tools that don't match
    if (this.currentIntent.length > 0 && !this.canHandle(request.name)) {
      return {
        kind: "error",
        message: `Tool "${request.name}" is not available for the current task intent`,
        retryable: false,
      };
    }
    return measurePhase(
      this.eventLog,
      this.sessionId ?? "system",
      `tool.route.${request.name}`,
      () => this.downstream.execute(request),
    );
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
