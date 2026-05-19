import type { AlixConfig, Decision, SessionMode } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import { POLICY_EVENT_TYPES } from "../events/types.js";
import type { PolicyDecisionPayload } from "../events/types.js";
import type { CommandClassifier } from "./command-classifier.js";
import { NetworkPolicyMatcher } from "./network-policy-matcher.js";
import type { NetworkPolicy } from "./network-policy-matcher.js";

export type Capability = "shell.readonly" | "shell.mutating" | "file.read" | "file.write" | "network.fetch" | "tool.use";

export type ToolCallArgs = {
  command?: string;
  url?: string;
  path?: string;
};

export type ToolRequest = {
  toolCallId: string;
  capability: string;
  path?: string;
  command?: string;
};

export type ToolCallRequest = {
  toolCallId: string;
  toolName: string;
  args: ToolCallArgs;
  capability: string;
  sessionMode: SessionMode;
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
  private commandClassifier?: CommandClassifier;
  private networkMatcher?: NetworkPolicyMatcher;

  constructor(
    private config: AlixConfig,
    private options: PolicyEngineOptions = {}
  ) {}

  setCommandClassifier(classifier: CommandClassifier): void {
    this.commandClassifier = classifier;
  }

  setNetworkPolicy(policy: NetworkPolicy): void {
    this.networkMatcher = new NetworkPolicyMatcher(policy);
  }

  check(request: ToolCallRequest): PolicyDecision & { toolCallId: string; capability: Capability } {
    const { toolCallId, toolName, args, capability, sessionMode } = request;

    // Check shell command risk
    if (toolName === "shell.run" && this.commandClassifier) {
      const command = args.command;
      if (command) {
        const classification = this.commandClassifier.classify(command);
        if (classification.risk === "critical") {
          return {
            toolCallId,
            capability: capability as Capability,
            decision: "deny",
            reason: `Critical risk command: ${classification.category}`,
          };
        }
      }
    }

    // Check network destination
    if (toolName === "network.fetch" && this.networkMatcher) {
      const url = args.url;
      if (url) {
        const match = this.networkMatcher.match(url);
        if (match.decision === "deny") {
          return {
            toolCallId,
            capability: capability as Capability,
            decision: "deny",
            reason: `Network destination denied: ${match.reason}`,
          };
        }
        if (match.decision === "allow") {
          return {
            toolCallId,
            capability: capability as Capability,
            decision: "allow",
            reason: `Network destination allowed: ${match.domain}`,
          };
        }
        if (match.decision === "ask") {
          return {
            toolCallId,
            capability: capability as Capability,
            decision: "ask",
            reason: `Network destination requires approval: ${match.domain}`,
          };
        }
      }
    }

    // Fall through to existing policy evaluation using the request fields
    const internalRequest: ToolRequest = {
      toolCallId,
      capability,
      path: args.path,
      command: args.command,
    };
    const decision = this.decide(internalRequest);

    return {
      toolCallId,
      capability: capability as Capability,
      decision: decision.decision,
      reason: decision.reason,
    };
  }

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
