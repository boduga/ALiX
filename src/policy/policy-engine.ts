import type { AlixConfig, Decision, SessionMode } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import { POLICY_EVENT_TYPES } from "../events/types.js";
import type { PolicyDecisionPayload } from "../events/types.js";

export type ToolRequest = {
  toolCallId: string;
  capability: string;
  path?: string;
  command?: string;
};

export type PolicyDecision = {
  decision: Decision;
  reason: string;
};

export type PolicyEngineOptions = {
  eventLog?: EventLog;
  sessionId?: string;
};

export class PolicyEngine {
  constructor(
    private config: AlixConfig,
    private options: PolicyEngineOptions = {}
  ) {}

  decide(request: ToolRequest): PolicyDecision {
    const decision = this.evaluatePolicy(request);

    // Emit policy.decision event
    if (this.options.eventLog && this.options.sessionId) {
      this.options.eventLog.append({
        sessionId: this.options.sessionId,
        actor: "policy",
        type: POLICY_EVENT_TYPES.DECISION,
        payload: {
          toolCallId: request.toolCallId,
          capability: request.capability,
          decision: decision.decision,
          reason: decision.reason,
          matchedRuleId: this.extractMatchedRuleId(request),
        } as PolicyDecisionPayload,
      }).catch(err => console.error("Failed to emit policy event:", err));
    }

    return decision;
  }

  private evaluatePolicy(request: ToolRequest): PolicyDecision {
    if (request.path && isProtectedPath(this.config.permissions.protectedPaths, request.path)) {
      return { decision: "deny", reason: `Path is protected: ${request.path}` };
    }

    if (request.command && this.config.permissions.denyCommands.includes(request.command)) {
      return { decision: "deny", reason: `Command is denied: ${request.command}` };
    }

    const toolDecision = this.config.permissions.tools[request.capability];
    const mode = this.config.permissions.sessionMode ?? "ask";
    if (toolDecision) {
      const effective = applySessionMode(toolDecision, mode);
      return { decision: effective, reason: `Matched tool policy for ${request.capability} (mode: ${mode})` };
    }

    return { decision: this.config.permissions.default, reason: "Matched default policy" };
  }

  private extractMatchedRuleId(request: ToolRequest): string | undefined {
    if (request.path && isProtectedPath(this.config.permissions.protectedPaths, request.path)) {
      return "protected-path-rule";
    }
    if (request.command && this.config.permissions.denyCommands.includes(request.command)) {
      return "deny-command-rule";
    }
    if (this.config.permissions.tools[request.capability]) {
      return `tool-policy-${request.capability}`;
    }
    return "default-policy";
  }
}

function applySessionMode(toolDecision: Decision, mode: SessionMode): Decision {
  if (toolDecision === "allow") return "allow";
  if (toolDecision === "deny") return "deny"; // deny always wins, even in bypass
  // toolDecision === "ask"
  if (mode === "auto") return "allow";
  if (mode === "bypass") return "allow";
  return "ask"; // mode === "ask"
}

export function decidePolicy(config: AlixConfig, request: ToolRequest): PolicyDecision {
  if (request.path && isProtectedPath(config.permissions.protectedPaths, request.path)) {
    return { decision: "deny", reason: `Path is protected: ${request.path}` };
  }

  if (request.command && config.permissions.denyCommands.includes(request.command)) {
    return { decision: "deny", reason: `Command is denied: ${request.command}` };
  }

  const toolDecision = config.permissions.tools[request.capability];
  const mode = config.permissions.sessionMode ?? "ask";
  if (toolDecision) {
    const effective = applySessionMode(toolDecision, mode);
    return { decision: effective, reason: `Matched tool policy for ${request.capability} (mode: ${mode})` };
  }

  return { decision: config.permissions.default, reason: "Matched default policy" };
}

function isProtectedPath(patterns: string[], path: string): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -3));
    if (pattern.endsWith(".*")) return path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1));
    return path === pattern;
  });
}
