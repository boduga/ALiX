import type { AlixConfig, Decision, SessionMode } from "../config/schema.js";

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
