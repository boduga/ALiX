import type { AlixConfig, Decision, SessionMode } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";
import { POLICY_EVENT_TYPES } from "../events/types.js";
import type { PolicyDecisionPayload } from "../events/types.js";
import type { CommandClassifier } from "./command-classifier.js";
import { NetworkPolicyMatcher } from "./network-policy-matcher.js";
import type { NetworkPolicy } from "./network-policy-matcher.js";
import type { CapabilityRegistry } from "./capability-registry.js";
import type { RiskLevel } from "./capability-registry.js";
import { SecretScanner } from "../security/secret-scanner.js";
import type { SecretFinding } from "../security/secret-scanner.js";

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

export type PolicyEngineSubsystems = {
  capabilityRegistry?: CapabilityRegistry;
  commandClassifier?: CommandClassifier;
  networkMatcher?: NetworkPolicyMatcher;
  secretScanner?: SecretScanner;
};

export interface SecretScanResult {
  hasSecret: boolean;
  findings: SecretFinding[];
}

export class PolicyEngine {
  constructor(
    private config: AlixConfig,
    private subsystems: PolicyEngineSubsystems = {},
    private options: PolicyEngineOptions = {}
  ) {}

  getCapabilityRisk(capability: string): RiskLevel | undefined {
    return this.subsystems.capabilityRegistry?.getRiskLevel(capability);
  }

  requiresCapabilityApproval(capability: string): boolean {
    return this.subsystems.capabilityRegistry?.requiresApproval(capability) ?? false;
  }

  checkSecretExposure(content: string): SecretScanResult {
    const findings = this.subsystems.secretScanner?.scan(content) ?? [];
    return {
      hasSecret: findings.length > 0,
      findings,
    };
  }

  check(request: ToolCallRequest): PolicyDecision & { toolCallId: string; capability: Capability } {
    const { toolCallId, toolName, args, capability, sessionMode } = request;

    // Check capability approval requirement via CapabilityRegistry
    if (this.subsystems.capabilityRegistry?.requiresApproval(capability)) {
      return {
        toolCallId,
        capability: capability as Capability,
        decision: "ask",
        reason: `Capability '${capability}' requires approval (${this.subsystems.capabilityRegistry.getRiskLevel(capability)} risk)`,
      };
    }

    // Check shell command risk
    if (toolName === "shell.run" && this.subsystems.commandClassifier) {
      const command = args.command;
      if (command) {
        const classification = this.subsystems.commandClassifier.classify(command);
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
    if (toolName === "network.fetch" && this.subsystems.networkMatcher) {
      const url = args.url;
      if (url) {
        const match = this.subsystems.networkMatcher.match(url);
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

export class PolicyEngineBuilder {
  private _config: AlixConfig;
  private _capabilityRegistry?: CapabilityRegistry;
  private _commandClassifier?: CommandClassifier;
  private _networkMatcher?: NetworkPolicyMatcher;
  private _secretScanner?: SecretScanner;
  private _eventLog?: EventLog;
  private _sessionId?: string;

  constructor(config: AlixConfig) {
    this._config = config;
  }

  withCapabilityRegistry(registry: CapabilityRegistry): this {
    this._capabilityRegistry = registry;
    return this;
  }

  withCommandClassifier(classifier: CommandClassifier): this {
    this._commandClassifier = classifier;
    return this;
  }

  withNetworkPolicy(policy: NetworkPolicy): this {
    this._networkMatcher = new NetworkPolicyMatcher(policy);
    return this;
  }

  withSecretScanner(scanner: SecretScanner): this {
    this._secretScanner = scanner;
    return this;
  }

  withEventLog(log: EventLog, sessionId: string): this {
    this._eventLog = log;
    this._sessionId = sessionId;
    return this;
  }

  build(): PolicyEngine {
    return new PolicyEngine(this._config, {
      capabilityRegistry: this._capabilityRegistry,
      commandClassifier: this._commandClassifier,
      networkMatcher: this._networkMatcher,
      secretScanner: this._secretScanner,
    }, {
      eventLog: this._eventLog,
      sessionId: this._sessionId,
    });
  }
}
