/**
 * agent-card.ts -- AgentCard schema and validation.
 *
 * Describes an agent identity with capabilities, domains, execution profile,
 * and safety metadata. Cards are validated before registration.
 */

export interface AgentCard {
  id: string;
  name: string;
  description: string;
  version: string;
  domains: string[];
  capabilities: string[];
  modelProfile?: string;
  executionProfile?: "general" | "research" | "coding" | "critic" | "artifact";
  inputModes?: string[];
  outputModes?: string[];
  maxConcurrency?: number;
  safetyTags?: string[];
  enabled: boolean;
}

export interface AgentCardValidation {
  valid: boolean;
  errors: string[];
}

export function validateAgentCard(card: AgentCard): AgentCardValidation {
  const errors: string[] = [];
  if (!card.id || typeof card.id !== "string") errors.push("id is required");
  if (!card.name || typeof card.name !== "string") errors.push("name is required");
  if (!card.description) errors.push("description is required");
  if (!card.version) errors.push("version is required");
  if (!Array.isArray(card.domains)) errors.push("domains must be an array");
  if (!Array.isArray(card.capabilities)) errors.push("capabilities must be an array");
  if (card.enabled === undefined) errors.push("enabled is required");
  return { valid: errors.length === 0, errors };
}
