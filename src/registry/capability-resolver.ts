/**
 * capability-resolver.ts — Resolve agents and tools for a graph node's
 * required capabilities, domain, and execution profile.
 *
 * The resolver asks the CardRegistry: which enabled agents/tools cover
 * the required capabilities? It respects execution profile filters and
 * reports missing capabilities and risk warnings.
 */

import type { AgentCard } from "./agent-card.js";
import type { ToolCard } from "./tool-card.js";
import type { CardRegistry } from "./card-registry.js";

export interface CapabilityResolution {
  nodeId?: string;
  agents: AgentCard[];
  tools: ToolCard[];
  missingCapabilities: string[];
  warnings: string[];
}

export interface ResolveInput {
  requiredCapabilities: string[];
  domain?: string;
  executionProfile?: string;
  registry: CardRegistry;
}

export function resolveCapabilities(input: ResolveInput): CapabilityResolution {
  const { requiredCapabilities, domain, executionProfile, registry } = input;
  const agents: AgentCard[] = [];
  const tools: ToolCard[] = [];
  const missingCapabilities: string[] = [];
  const warnings: string[] = [];

  for (const cap of requiredCapabilities) {
    // Find agents covering this capability
    const matchingAgents = registry.findAgentsByCapability(cap);

    // Filter by domain if specified
    const domainMatch = domain
      ? matchingAgents.filter(a => a.domains.includes(domain))
      : matchingAgents;
    const pool = domainMatch.length > 0 ? domainMatch : matchingAgents;

    // Filter by execution profile if specified
    const profileMatch = executionProfile
      ? pool.filter(a => !a.executionProfile || a.executionProfile === executionProfile)
      : pool;

    if (profileMatch.length > 0) {
      agents.push(...profileMatch);
    }

    // Find tools covering this capability
    const matchingTools = registry.findToolsByCapability(cap);

    // Filter by allowed execution profiles
    const toolMatch = executionProfile
      ? matchingTools.filter(t => !t.allowedExecutionProfiles || t.allowedExecutionProfiles.includes(executionProfile))
      : matchingTools;

    if (toolMatch.length > 0) {
      tools.push(...toolMatch);
    }

    // Track missing capabilities
    if (profileMatch.length === 0 && toolMatch.length === 0) {
      missingCapabilities.push(cap);
    }

    // Warn on high/critical risk tools
    for (const t of toolMatch) {
      if (t.riskLevel === "high" || t.riskLevel === "critical") {
        warnings.push(`Tool ${t.id} has risk level: ${t.riskLevel}`);
      }
    }
  }

  return {
    agents: [...new Map(agents.map(a => [a.id, a])).values()],
    tools: [...new Map(tools.map(t => [t.id, t])).values()],
    missingCapabilities: [...new Set(missingCapabilities)],
    warnings,
  };
}
