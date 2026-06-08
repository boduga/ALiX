import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { AlixConfig } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import { TOOL_EVENT_TYPES, ARTIFACT_EVENT_TYPES } from "../events/types.js";
import type { ToolStartedPayload, ToolOutputPayload, ToolCompletedPayload, ToolFailedPayload, ArtifactCreatedPayload } from "../events/types.js";
import type { McpManager } from "../mcp/manager.js";
import { decidePolicy } from "../policy/policy-engine.js";
import { redactValue } from "../policy/secret-scanner.js";
import type { EditFormatPolicy } from "../patch/edit-format-policy.js";
import type { CheckpointManager } from "../patch/checkpoint.js";
import type { ToolResult } from "./types.js";
import { createPermissivePolicyDecision, assertPolicyArgumentsMatch } from "../kernel/policy-decision.js";
import { legacyCapabilityToCanonical } from "./capability-map.js";
import { AlixToolRepair } from "../../packages/tool-repair/src/adapters/alix.js";
import {
  CompositeToolRouter,
  FileToolRouter,
  ShellToolRouter,
  PatchToolRouter,
  McpToolRouter,
  DelegateToolRouter,
  SelfExtendToolRouter,
  WebToolsRouter,
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

export function hashArgs(args: Record<string, unknown>): string {
  // Stable SHA-256 using JSON.stringify with sorted keys for deterministic output
  const stable = JSON.stringify(args, (_key: string, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (value as Record<string, unknown>)[k];
            return acc;
          }, {})
      : value
  );
  return createHash("sha256").update(stable).digest("hex");
}

export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
};

export type ExecuteResult = ToolResult | { kind: "denied"; reason: string };

export class ToolExecutor {
  private router: CompositeToolRouter;
  private repair: AlixToolRepair | null = null;

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
      new FileToolRouter(this.root, log, this.sessionId()),
      new ShellToolRouter(this.root),
      new PatchToolRouter(this.root, config, editFormatPolicy, checkpointManager, log, this.sessionId()),
      new McpToolRouter(mcpManager ?? null, log, this.sessionId()),
      new DelegateToolRouter(extraHandlers),
      new SelfExtendToolRouter(),
      new WebToolsRouter(),
    ]);

    // Initialize tool repair layer
    try {
      this.repair = new AlixToolRepair(config.model.provider, config.model.name);
    } catch {
      this.repair = null;
    }
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
    const { toolCallId, name } = request;
    let args = request.args;
    let argumentHash = hashArgs(args);
    const capability = inferCapability(name);
    const canonicalCapability = legacyCapabilityToCanonical(capability);

    await this.logEvent(TOOL_EVENT_TYPES.REQUESTED, { toolCallId, toolName: name, capability, canonicalCapability, argumentHash, argsPreview: sanitizeArgs(args) });

    // Create PolicyDecision placeholder (M0.9 permissive audit trail)
    const policyDecision = createPermissivePolicyDecision({
      requestId: toolCallId,
      capability,
      actorId: name,
      args,
      validForToolId: name,
    });

    await this.log.append({
      sessionId: "", actor: "policy",
      type: "policy.decision",
      payload: {
        toolCallId,
        capability,
        decision: policyDecision.decision,
        reason: policyDecision.reasons[0],
        matchedRuleId: policyDecision.id,
      },
    });

    await this.log.append({
      sessionId: "", actor: "system", type: "m09.metric",
      payload: { name: "policy_decisions_total", type: "counter", value: 1, labels: { capability, decision: policyDecision.decision }, timestamp: new Date().toISOString() },
    });

    const legacyPolicyResult = decidePolicy(this.config, {
      toolCallId,
      capability,
      ...args as { path?: string; command?: string }
    });

    if (legacyPolicyResult.decision === "deny") {
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, { toolCallId, toolName: name, error: legacyPolicyResult.reason, durationMs: 0, canonicalCapability, argumentHash });
      return { kind: "denied", reason: legacyPolicyResult.reason };
    }

    // Handle special case: "done" tool (not in router)
    if (name === "done") {
      await this.logEvent(TOOL_EVENT_TYPES.STARTED, { toolCallId, toolName: name, argumentHash });
      const result: ToolResult = { kind: "success", output: "Task complete.", completed: true };
      const startTime = parseInt(toolCallId.split("_")[1]) || Date.now();
      const durationMs = Date.now() - startTime;
      await this.logEvent(TOOL_EVENT_TYPES.OUTPUT, { toolCallId, outputPreview: "Task complete.", outputSize: 14 });
      await this.logEvent(TOOL_EVENT_TYPES.COMPLETED, { toolCallId, toolName: name, status: "success", durationMs, canonicalCapability, argumentHash });
      return result;
    }

    // MCP availability check — policy said "ask" or "allow", but is the tool connected?
    if (name.startsWith("mcp.") && !this.mcpManager) {
      const msg = "MCP manager not initialized. No MCP servers are connected.";
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, { toolCallId, toolName: name, error: msg, durationMs: 0, canonicalCapability, argumentHash });
      return { kind: "denied", reason: msg };
    }

    // === TOOL REPAIR LAYER ===
    let repairHint: string | undefined;
    if (this.repair && name !== "done" && !name.startsWith("mcp.")) {
      const repairResult = this.repair.process(name, args);
      if (repairResult.repaired) {
        repairHint = repairResult.hint;
        (request as Record<string, unknown>).args = repairResult.args;
        // Recompute hash after repair modifies args
        args = repairResult.args;
        argumentHash = hashArgs(args);
      }
    }
    // === END TOOL REPAIR ===

    await this.logEvent(TOOL_EVENT_TYPES.STARTED, { toolCallId, toolName: name, argumentHash });
    // Emit m09 metric for tool call
    await this.log.append({
      sessionId: this.sessionId(), actor: "system", type: "m09.metric",
      payload: { name: "tool_calls_total", type: "counter", value: 1, labels: { tool: name }, timestamp: new Date().toISOString() },
    });

    // Verify argument hash match before execution (M0.9 permissive placeholder)
    assertPolicyArgumentsMatch(policyDecision, args);

    let result = await this.router.execute(request);

    // Append repair hint to success output
    if (repairHint && result.kind === "success") {
      const hintBlock = `\n\n[Tool Repair Hint] ${repairHint}`;
      if (result.output) result.output += hintBlock;
      else if (result.content) result.content += hintBlock;
    }

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
      outputRef = await writeOutputToFile(result.output ?? result.content, this.log.sessionDir, toolCallId, this.log);
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
        canonicalCapability,
        argumentHash,
      };
      await this.logEvent(TOOL_EVENT_TYPES.COMPLETED, completedPayload);
    } else {
      const failedPayload: ToolFailedPayload = {
        toolCallId,
        toolName: name,
        error: result.message,
        durationMs,
        canonicalCapability,
        argumentHash,
      };
      await this.logEvent(TOOL_EVENT_TYPES.FAILED, failedPayload);
      // Emit m09 metric for tool failure
      await this.log.append({
        sessionId: this.sessionId(), actor: "system", type: "m09.metric",
        payload: { name: "tool_failures_total", type: "counter", value: 1, labels: { tool: name }, timestamp: new Date().toISOString() },
      });
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
  if (toolName === "web_search") return "web.search";
  if (toolName === "web_fetch") return "web.fetch";
  return "tool.invoke";
}

function truncateOutput(output: unknown, maxLen = 200): string {
  const str = typeof output === "string" ? output : JSON.stringify(output);
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

async function writeOutputToFile(output: unknown, sessionDir: string, toolCallId: string, log: EventLog): Promise<string> {
  const { join } = await import("node:path");
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");

  const artifactsDir = join(sessionDir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  const artifactId = randomUUID();
  const filePath = join(artifactsDir, `tool-output-${artifactId}.json`);
  const content = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  await writeFile(filePath, content, "utf8");

  const mimeType = typeof output === "string" ? "text/plain" : "application/json";
  const size = Buffer.byteLength(content, "utf8");

  // Emit artifact.created event
  const sessionId = sessionDir.split("sessions/").length > 1 ? sessionDir.split("sessions/")[1] : "unknown";
  await log.append({
    sessionId,
    actor: "system",
    type: ARTIFACT_EVENT_TYPES.CREATED,
    payload: {
      artifactId,
      toolCallId,
      path: filePath,
      mimeType,
      size,
      retention: "session",
    } satisfies ArtifactCreatedPayload,
  });

  return filePath;
}