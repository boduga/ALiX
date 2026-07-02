// src/correlation/normalize-subsystem.ts

import type { CorrelationSubsystemId } from "./correlation-types.js";

const EXECUTIVE_TO_CORRELATION: Record<string, CorrelationSubsystemId> = {
  memory: "memory",
  workflow: "workflow",
  learning: "skills",
  agents: "agents",
  tools: "tools",
  security: "security",
  governance: "governance",
  adaptation: "adaptation",
};

export { EXECUTIVE_TO_CORRELATION };

export function executiveToCorrelationSubsystem(
  name: string,
): CorrelationSubsystemId | null {
  return EXECUTIVE_TO_CORRELATION[name] ?? null;
}
