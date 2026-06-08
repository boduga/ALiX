/**
 * tool-card.ts — ToolCard schema and validation.
 *
 * Describes a tool with capabilities, risk level, approval mode,
 * and side effects. Cards are validated before registration.
 */

export interface ToolCard {
  id: string;
  name: string;
  description: string;
  version: string;
  capabilities: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
  approvalMode: "auto" | "ask" | "deny";
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  allowedExecutionProfiles?: string[];
  sideEffects?: "none" | "read" | "write" | "network" | "system";
  enabled: boolean;
}

export interface ToolCardValidation {
  valid: boolean;
  errors: string[];
}

export function validateToolCard(card: ToolCard): ToolCardValidation {
  const errors: string[] = [];
  if (!card.id || typeof card.id !== "string") errors.push("id is required");
  if (!card.name || typeof card.name !== "string") errors.push("name is required");
  if (!card.description) errors.push("description is required");
  if (!card.version) errors.push("version is required");
  if (!Array.isArray(card.capabilities)) errors.push("capabilities must be an array");
  const validRisks = ["low", "medium", "high", "critical"];
  if (!validRisks.includes(card.riskLevel)) errors.push(`riskLevel must be one of: ${validRisks.join(", ")}`);
  const validApprovals = ["auto", "ask", "deny"];
  if (!validApprovals.includes(card.approvalMode)) errors.push(`approvalMode must be one of: ${validApprovals.join(", ")}`);
  if (card.enabled === undefined) errors.push("enabled is required");
  return { valid: errors.length === 0, errors };
}
