import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AlixConfig } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import { decidePolicy } from "../policy/policy-engine.js";
import { readFile, searchDir } from "./file-tools.js";
import { runCommand } from "./shell-tool.js";
import { applyPatch } from "../patch/patch-engine.js";
import { createFileCheckpoint } from "../checkpoints/checkpoint-manager.js";
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
    private root: string
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
        const changedFiles = [...patchText.matchAll(/path=([^\s\n]+)/g)].map(m => m[1]);
        if (changedFiles.length > 0) {
          await createFileCheckpoint(r ?? this.root, changedFiles);
        }
        try {
          const patchResult = await applyPatch(r ?? this.root, format as any, patchText);
          result = patchResult.status === "applied"
            ? { kind: "success", changedFiles: patchResult.changedFiles }
            : { kind: "error", message: "Patch invalid" };
        } catch (e: unknown) {
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
          result = { kind: "error", message: "Path is outside workspace" }; break;
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
          result = { kind: "error", message: "Path is outside workspace" }; break;
        }
        const { rm } = await import("node:fs/promises");
        try { await rm(resolvedPath); } catch (e) { result = { kind: "error", message: `Delete failed: ${e instanceof Error ? e.message : String(e)}` }; break; }
        result = { kind: "success", output: `File deleted: ${path}`, deletedPath: path };
        break;
      }
      default:
        result = { kind: "error", message: `Unknown tool: ${name}` };
    }

    await this.logEvent(result.kind === "success" ? "tool.completed" : "tool.failed", {
      toolCallId, toolName: name, status: result.kind,
      outputSize: result.kind === "success" ? ((result.output?.length ?? 0) + (result.content?.length ?? 0)) : 0,
      outputPreview: result.kind === "success" ? ((result.output ?? result.content ?? "").slice(0, 200)) : undefined,
      error: result.kind === "error" ? result.message : undefined
    });

    return result;
  }
}