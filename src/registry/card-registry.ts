/**
 * card-registry.ts — In-memory registry for AgentCards and ToolCards.
 *
 * Supports register, list, find-by-capability, and disabled-card filtering.
 * Duplicate IDs are rejected on registration.
 */

import type { AgentCard } from "./agent-card.js";
import { validateAgentCard } from "./agent-card.js";
import type { ToolCard } from "./tool-card.js";
import { validateToolCard } from "./tool-card.js";

export class CardRegistry {
  private agents = new Map<string, AgentCard>();
  private tools = new Map<string, ToolCard>();

  registerAgent(card: AgentCard): void {
    const validation = validateAgentCard(card);
    if (!validation.valid) throw new Error(`Invalid AgentCard: ${validation.errors.join("; ")}`);
    if (this.agents.has(card.id)) throw new Error(`Agent already registered: ${card.id}`);
    this.agents.set(card.id, card);
  }

  registerTool(card: ToolCard): void {
    const validation = validateToolCard(card);
    if (!validation.valid) throw new Error(`Invalid ToolCard: ${validation.errors.join("; ")}`);
    if (this.tools.has(card.id)) throw new Error(`Tool already registered: ${card.id}`);
    this.tools.set(card.id, card);
  }

  listAgents(includeDisabled = false): AgentCard[] {
    const all = Array.from(this.agents.values());
    return includeDisabled ? all : all.filter(a => a.enabled);
  }

  listTools(includeDisabled = false): ToolCard[] {
    const all = Array.from(this.tools.values());
    return includeDisabled ? all : all.filter(t => t.enabled);
  }

  findAgentsByCapability(capability: string, includeDisabled = false): AgentCard[] {
    return this.listAgents(includeDisabled).filter(a => a.capabilities.includes(capability));
  }

  findToolsByCapability(capability: string, includeDisabled = false): ToolCard[] {
    return this.listTools(includeDisabled).filter(t => t.capabilities.includes(capability));
  }

  getAgent(id: string): AgentCard | undefined {
    return this.agents.get(id);
  }

  getTool(id: string): ToolCard | undefined {
    return this.tools.get(id);
  }
}
