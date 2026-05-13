import type { AlixConfig } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import { decidePolicy } from "../policy/policy-engine.js";
import { readFile, searchDir } from "./file-tools.js";
import { runCommand } from "./shell-tool.js";
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
    // Extract sessionId from EventLog path: .alix/sessions/<sessionId>/events.jsonl
    const parts = this.log.path.split("sessions/");
    return parts.length > 1 ? parts[1].split("/")[0] : "unknown";
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
      default:
        result = { kind: "error", message: `Unknown tool: ${name}` };
    }

    await this.logEvent(result.kind === "success" ? "tool.completed" : "tool.failed", {
      toolCallId, toolName: name, status: result.kind,
      output: result.kind === "success" ? (result.output ?? result.content ?? "") : "",
      error: result.kind === "error" ? result.message : undefined
    });

    return result;
  }
}