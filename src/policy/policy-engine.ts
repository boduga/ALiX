import type { AlixConfig, Decision } from "../config/schema.js";

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

export function decidePolicy(config: AlixConfig, request: ToolRequest): PolicyDecision {
  if (request.path && isProtectedPath(config.permissions.protectedPaths, request.path)) {
    return { decision: "deny", reason: `Path is protected: ${request.path}` };
  }

  if (request.command && config.permissions.denyCommands.includes(request.command)) {
    return { decision: "deny", reason: `Command is denied: ${request.command}` };
  }

  const toolDecision = config.permissions.tools[request.capability];
  if (toolDecision) {
    return { decision: toolDecision, reason: `Matched tool policy for ${request.capability}` };
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
