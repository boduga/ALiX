/**
 * policy-gate.ts — Single authoritative policy decision engine.
 *
 * All execution paths (ToolExecutor, RuntimeGate, daemon routes) call
 * PolicyGate for policy decisions. There is exactly one decision per
 * request, and that decision is both logged and enforced.
 */

import type { AlixConfig, SessionMode } from "../config/schema.js";
import type { ApprovalStore } from "../approvals/approval-store.js";
import type { EventLog } from "../events/event-log.js";
import { BLOCKED_COMMANDS, parseWhitelistEnv } from "./shell-whitelist.js";
import { resolve } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────

export type PolicyGateDecision = {
  requestId: string;
  capability: string;
  decision: "allow" | "ask" | "deny";
  reason: string;
  matchedRuleId?: string;
  approvalId?: string;
};

export type ToolPolicyRequest = {
  requestId: string;
  toolName: string;
  capability?: string;       // caller-provided; falls back to inferCapability
  args: Record<string, unknown>;
  cwd: string;
  sessionMode: SessionMode;
  sessionId?: string;
  source: "tool" | "graph" | "daemon" | "tui" | "replay";
};

export type CapabilityPolicyRequest = {
  requestId: string;
  capability: string;
  sessionMode: SessionMode;
  nodeId?: string;
  graphId?: string;
  sessionId?: string;
  source: "tool" | "graph" | "daemon" | "tui" | "replay";
  metadata?: Record<string, unknown>;
};

// ─── Path resolution helper ──────────────────────────────────────────

/** Normalize a path argument against cwd for policy checks. */
function resolvePolicyPath(cwd: string, path: string): string {
  if (path.startsWith("/")) return path;
  return resolve(cwd, path);
}

/** Infer capability from tool name — mirrors executor.ts inferCapability exactly. */
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

// ─── Evasion patterns (from policy-engine.ts) ────────────────────────

type EvasionPattern = {
  pattern: RegExp;
  severity: "deny" | "ask";
  reason: string;
};

const EVASION_PATTERNS: EvasionPattern[] = [
  { pattern: /\|.*base64.*-d\s*\|.*sh/si, severity: "deny", reason: "Base64 encoded command execution" },
  { pattern: /xxd.*-r.*-p.*\|.*sh/si, severity: "deny", reason: "Hex encoded command execution" },
  { pattern: /\$.*rm/si, severity: "ask", reason: "Variable expansion with rm - need approval" },
  { pattern: /\/dev\/tcp\//, severity: "deny", reason: "Network socket /dev/tcp detected" },
  { pattern: /nc\s+-[eEv]\s+.*\/(bash|sh|bin)/, severity: "deny", reason: "Netcat reverse shell detected" },
  { pattern: /bash\s+-i\s*>&.*\/dev\/tcp\//, severity: "deny", reason: "Bash reverse shell detected" },
  { pattern: /curl\s+.*\|.*(bash|sh)\s*$/smi, severity: "deny", reason: "Download and execute pipe detected" },
  { pattern: /wget.*-O-.*\|.*(bash|sh)\s*$/smi, severity: "deny", reason: "Wget pipe execute detected" },
  { pattern: /sudo\s+su\s+-/, severity: "ask", reason: "Privilege escalation attempt" },
  { pattern: /passwd\s+root/, severity: "deny", reason: "Root password modification" },
  { pattern: /chmod\s+777.*\/(etc|usr|var|bin)/, severity: "deny", reason: "Permission escalation on system directories" },
  { pattern: /crontab\s+-r/, severity: "ask", reason: "Crontab manipulation detected" },
  { pattern: /authorized_keys|ssh.*key.*>>/, severity: "ask", reason: "SSH key injection detected" },
];

function detectEvasion(command: string): { blocked: boolean; ask: boolean; reason?: string } {
  for (const p of EVASION_PATTERNS) {
    if (p.pattern.test(command)) {
      return { blocked: p.severity === "deny", ask: p.severity === "ask", reason: p.reason };
    }
  }
  return { blocked: false, ask: false };
}

// ─── Session mode application ────────────────────────────────────────

function applySessionMode(toolDecision: string, mode: SessionMode): "allow" | "ask" | "deny" {
  if (toolDecision === "allow") return "allow";
  if (toolDecision === "deny") return "deny";
  if (mode === "auto" || mode === "bypass") return "allow";
  return "ask";
}

// ─── Protected path check ────────────────────────────────────────────

function isProtectedPath(patterns: string[], path: string): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -3));
    if (pattern.endsWith(".*")) return path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1));
    return path === pattern;
  });
}

// ─── PolicyGate ──────────────────────────────────────────────────────

export class PolicyGate {
  constructor(
    private readonly config: AlixConfig,
    private readonly deps: {
      approvalStore?: ApprovalStore;
      eventLog?: EventLog;
    } = {},
  ) {}

  /**
   * Evaluate a tool call against policy.
   * Returns one decision that should be both logged and enforced.
   */
  async evaluateToolCall(request: ToolPolicyRequest): Promise<PolicyGateDecision> {
    // Bypass/auto mode short-circuits all policy checks
    if (request.sessionMode === "bypass" || request.sessionMode === "auto") {
      return {
        requestId: request.requestId,
        capability: request.capability ?? inferCapability(request.toolName),
        decision: "allow",
        reason: `Session mode is '${request.sessionMode}' — all tools allowed`,
        matchedRuleId: `session-mode-${request.sessionMode}`,
      };
    }

    const capability = request.capability ?? inferCapability(request.toolName);
    const args = request.args;

    // 1. Check protected paths
    const rawPath = typeof args.path === "string" ? args.path : undefined;
    if (rawPath) {
      const resolvedPath = resolvePolicyPath(request.cwd, rawPath);
      if (isProtectedPath(this.config.permissions.protectedPaths, resolvedPath)) {
        return {
          requestId: request.requestId,
          capability,
          decision: "deny",
          reason: `Path is protected: ${resolvedPath}`,
          matchedRuleId: "protected-path-rule",
        };
      }
    }

    // 2. Check deny commands
    const command = typeof args.command === "string" ? args.command : undefined;
    if (command && this.config.permissions.denyCommands.includes(command)) {
      return {
        requestId: request.requestId,
        capability,
        decision: "deny",
        reason: `Command is denied: ${command}`,
        matchedRuleId: "deny-command-rule",
      };
    }

    // 3. Check shell whitelist
    if (command && this.config.permissions.shellWhitelist?.enabled) {
      const whitelist = this.config.permissions.shellWhitelist;
      const commands = whitelist.commands.length > 0
        ? whitelist.commands
        : parseWhitelistEnv(process.env.ALIX_SHELL_WHITELIST ?? "");
      const baseCmd = command.split(/\s+/)[0];

      if (BLOCKED_COMMANDS.includes(baseCmd)) {
        return {
          requestId: request.requestId,
          capability,
          decision: "deny",
          reason: `Command '${baseCmd}' is blocked for security reasons`,
          matchedRuleId: "blocked-command-rule",
        };
      }

      if (!commands.includes(baseCmd)) {
        if (whitelist.allowUnmatched) {
          return {
            requestId: request.requestId,
            capability,
            decision: "ask",
            reason: `Command '${baseCmd}' requires approval (not in whitelist)`,
            matchedRuleId: "shell-whitelist-rule",
          };
        }
        return {
          requestId: request.requestId,
          capability,
          decision: "deny",
          reason: `Command '${baseCmd}' is not in the allowed whitelist`,
          matchedRuleId: "shell-whitelist-rule",
        };
      }
    }

    // 4. Evasion detection
    if (command) {
      const evasionResult = detectEvasion(command);
      if (evasionResult.blocked || evasionResult.ask) {
        return {
          requestId: request.requestId,
          capability,
          decision: evasionResult.blocked ? "deny" : "ask",
          reason: evasionResult.reason!,
          matchedRuleId: "evasion-detection-rule",
        };
      }
    }

    // 5. Tool permission from config
    const toolDecision = this.config.permissions.tools[capability];
    if (toolDecision) {
      const effective = applySessionMode(toolDecision, request.sessionMode);
      if (effective === "allow") {
        return { requestId: request.requestId, capability, decision: "allow", reason: `Allowed by tool policy (mode: ${request.sessionMode})`, matchedRuleId: `tool-policy-${capability}` };
      }
      if (effective === "deny") {
        return { requestId: request.requestId, capability, decision: "deny", reason: `Denied by tool policy (mode: ${request.sessionMode})`, matchedRuleId: `tool-policy-${capability}` };
      }
    }

    // 6. Default policy
    const defaultDecision = this.config.permissions.default ?? "ask";
    if (defaultDecision === "allow") {
      return { requestId: request.requestId, capability, decision: "allow", reason: "Allowed by default policy", matchedRuleId: "default-policy" };
    }
    if (defaultDecision === "deny") {
      return { requestId: request.requestId, capability, decision: "deny", reason: "Denied by default policy", matchedRuleId: "default-policy" };
    }

    // 7. Ask — approval lifecycle
    const askDecision = await this.handleAskDecision(request.requestId, capability, request.sessionMode, `Requires approval for capability: ${capability}`);

    // Emit approval lifecycle event (created or reused)
    if (this.deps.eventLog && askDecision.approvalId && askDecision.decision === "ask") {
      const isReused = askDecision.matchedRuleId === "pending-approval";
      await this.deps.eventLog.append({
        sessionId: request.sessionId ?? "unknown",
        actor: "policy",
        type: isReused ? "approval.reused" : "approval.created",
        payload: {
          approvalId: askDecision.approvalId,
          requestId: request.requestId,
          sessionId: request.sessionId,
          capability,
          toolName: (request as ToolPolicyRequest).toolName,
          status: isReused ? ("reused" as const) : ("pending" as const),
          reason: askDecision.reason,
          cwd: (request as ToolPolicyRequest).cwd,
          previousApprovalId: isReused ? askDecision.approvalId : undefined,
        },
      }).catch(() => {});
    }

    return askDecision;
  }

  /**
   * Evaluate a capability against policy (for graph node checks).
   * Simpler than evaluateToolCall — no path/command/evasion checks.
   */
  async evaluateCapability(request: CapabilityPolicyRequest): Promise<PolicyGateDecision> {
    const toolDecision = this.config.permissions.tools[request.capability];

    if (toolDecision) {
      const effective = applySessionMode(toolDecision, request.sessionMode);
      if (effective === "allow") {
        return { requestId: request.requestId, capability: request.capability, decision: "allow", reason: `Allowed by tool policy (mode: ${request.sessionMode})`, matchedRuleId: `tool-policy-${request.capability}` };
      }
      if (effective === "deny") {
        return { requestId: request.requestId, capability: request.capability, decision: "deny", reason: `Denied by tool policy (mode: ${request.sessionMode})`, matchedRuleId: `tool-policy-${request.capability}` };
      }
    }

    const defaultDecision = this.config.permissions.default ?? "ask";
    if (defaultDecision === "allow") {
      return { requestId: request.requestId, capability: request.capability, decision: "allow", reason: "Allowed by default policy", matchedRuleId: "default-policy" };
    }
    if (defaultDecision === "deny") {
      return { requestId: request.requestId, capability: request.capability, decision: "deny", reason: "Denied by default policy", matchedRuleId: "default-policy" };
    }

    const capAskDecision = await this.handleAskDecision(request.requestId, request.capability, request.sessionMode, `Requires approval for capability: ${request.capability}`);

    // Emit approval lifecycle event (created or reused)
    if (this.deps.eventLog && capAskDecision.approvalId && capAskDecision.decision === "ask") {
      const isReused = capAskDecision.matchedRuleId === "pending-approval";
      await this.deps.eventLog.append({
        sessionId: request.sessionId ?? "unknown",
        actor: "policy",
        type: isReused ? "approval.reused" : "approval.created",
        payload: {
          approvalId: capAskDecision.approvalId,
          requestId: request.requestId,
          sessionId: request.sessionId,
          capability: request.capability,
          status: isReused ? ("reused" as const) : ("pending" as const),
          reason: capAskDecision.reason,
          previousApprovalId: isReused ? capAskDecision.approvalId : undefined,
        },
      }).catch(() => {});
    }

    return capAskDecision;
  }

  /** Handle the approval lifecycle for "ask" decisions. */
  private async handleAskDecision(requestId: string, capability: string, sessionMode: string, reason: string): Promise<PolicyGateDecision> {
    const store = this.deps.approvalStore;
    if (!store) {
      return { requestId, capability, decision: "deny", reason: "Approval required but no approval store configured", matchedRuleId: "approval-store-missing" };
    }

    // In "ask" mode, always create a fresh approval — don't reuse prior approvals.
    // Prior-approval reuse only applies in "auto" (auto-approve) mode.
    if (sessionMode !== "auto") {
      // Create new pending approval
      const approval = await store.request({ reason, capability });
      return { requestId, capability, decision: "ask", reason: `Pending approval: ${approval.id}`, approvalId: approval.id, matchedRuleId: "created-approval" };
    }

    // Auto mode: check existing resolved approval
    const resolved = store.findResolved({ capability });
    if (resolved) {
      if (resolved.status === "approved") {
        return { requestId, capability, decision: "allow", reason: `Approved by prior approval: ${resolved.id}`, approvalId: resolved.id };
      }
      return { requestId, capability, decision: "deny", reason: `Prior approval was denied: ${resolved.id}`, approvalId: resolved.id };
    }

    // Check existing pending approval — reuse
    const existing = store.findPending({ capability });
    if (existing) {
      return { requestId, capability, decision: "ask", reason: `Pending approval: ${existing.id}`, approvalId: existing.id, matchedRuleId: "pending-approval" };
    }

    // Create new pending approval
    const approval = await store.request({ reason, capability });
    return { requestId, capability, decision: "ask", reason: `Pending approval: ${approval.id}`, approvalId: approval.id, matchedRuleId: "created-approval" };
  }
}
