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
import type { EditFormatPolicy } from "../patch/edit-format-policy.js";
import type { CheckpointManager } from "../patch/checkpoint.js";
import type { ToolResult } from "./types.js";
import {
  CompositeToolRouter,
  FileToolRouter,
  ShellToolRouter,
  PatchToolRouter,
  McpToolRouter,
  DelegateToolRouter,
} from "./tool-router.js";

const LARGE_OUTPUT_THRESHOLD = 10000;

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sensitive = ["password", "token", "secret", "key"];
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [
      k,
      sensitive.some((s) => k.toLowerCase().includes(s)) ? "[REDACTED]" : v,
    ])
  );
}

export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
};

export type ExecuteResult = ToolResult | { kind: "denied"; reason: string };

export class ToolExecutor {
  private router: CompositeToolRouter;

  constructor(
    private config: AlixConfig,
    private log: EventLog,
    private root: string,
    private mcpManager?: McpManager,
    private editFormatPolicy?: EditFormatPolicy,
    private extraHandlers?: Record<string, (args: Record<string, unknown>) => Promise<ToolResult>>,
    private checkpointManager?: CheckpointManager
  ) {
    // Create router with all handlers
    this.router = new CompositeToolRouter([
      new FileToolRouter(this.root),
      new ShellToolRouter(this.root),
      new PatchToolRouter(this.root, config, editFormatPolicy, checkpointManager, log, this.sessionId()),
      new McpToolRouter(mcpManager!),
      new DelegateToolRouter(extraHandlers),
    ]);
  }

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

    await this.logEvent(TOOL_EVENT_TYPES.REQUESTED, { toolCallId, toolName: name, capability, argsPreview: sanitizeArgs(args) });

    const policyDecision = decidePolicy(this.config, {
      toolCallId,
      capability,
      ...args as { path?: string; command?: string }
    });

    if (policyDecision.decision === "deny") {
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, { toolCallId, toolName: name, error: policyDecision.reason, durationMs: 0 });
      return { kind: "denied", reason: policyDecision.reason };
    }

    // Handle special case: "done" tool (not in router)
    if (name === "done") {
      await this.logEvent(TOOL_EVENT_TYPES.STARTED, { toolCallId, toolName: name });
      const result: ToolResult = { kind: "success", output: "Task complete.", completed: true };
      const startTime = parseInt(toolCallId.split("_")[1]) || Date.now();
      const durationMs = Date.now() - startTime;
      await this.logEvent(TOOL_EVENT_TYPES.OUTPUT, { toolCallId, outputPreview: "Task complete.", outputSize: 14 });
      await this.logEvent(TOOL_EVENT_TYPES.COMPLETED, { toolCallId, toolName: name, status: "success", durationMs });
      return result;
    }

    // MCP availability check — policy said "ask" or "allow", but is the tool connected?
    if (name.startsWith("mcp.") && !this.mcpManager) {
      const msg = "MCP manager not initialized. No MCP servers are connected.";
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, { toolCallId, toolName: name, error: msg, durationMs: 0 });
      return { kind: "denied", reason: msg };
    }

    await this.logEvent(TOOL_EVENT_TYPES.STARTED, { toolCallId, toolName: name });

    let result = await this.router.execute(request);

    // Classify MCP errors with hints
    if (name.startsWith("mcp.") && result.kind === "error") {
      result = classifyError(result);
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