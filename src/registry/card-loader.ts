/**
 * card-loader.ts — Load AgentCards and ToolCards from directory or defaults.
 *
 * Reads .alix/cards/agents/*.json and .alix/cards/tools/*.json.
 * Falls back to built-in defaults when no card files exist.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { CardRegistry } from "./card-registry.js";
import type { AgentCard } from "./agent-card.js";
import type { ToolCard } from "./tool-card.js";

/** Built-in agent cards for the default registry. */
export function defaultAgentCards(): AgentCard[] {
  return [
    { id: "orchestrator.core", name: "Core Orchestrator", description: "Owns workflow run and final response", version: "1.0.0", domains: ["general"], capabilities: ["graph.mutate", "agent.spawn"], enabled: true },
    { id: "planner.graph", name: "Graph Planner", description: "Decomposes goals into TaskGraphs", version: "1.0.0", domains: ["general"], capabilities: [], executionProfile: "coding", enabled: true },
    { id: "research.scout", name: "Research Scout", description: "Searches the web for sources", version: "1.0.0", domains: ["research"], capabilities: ["web.search", "web.fetch"], executionProfile: "research", enabled: true },
    { id: "critic.general", name: "General Critic", description: "Reviews outputs for correctness and gaps", version: "1.0.0", domains: ["general"], capabilities: [], enabled: true },
    { id: "artifact.writer", name: "Artifact Writer", description: "Writes report artifacts to disk", version: "1.0.0", domains: ["research"], capabilities: ["filesystem.write"], executionProfile: "artifact", enabled: true },
    { id: "memory.curator", name: "Memory Curator", description: "Manages memory records and conflicts", version: "1.0.0", domains: ["general"], capabilities: ["memory.read", "memory.write.session"], enabled: true },
    // P4.5 workflow agents
    { id: "workflow.intake", name: "Issue Intake Agent", description: "Reads GitHub issues, validates labels, estimates priority/complexity", version: "1.0.0", domains: ["workflow"], capabilities: ["workflow.intake"], enabled: true },
    { id: "workflow.planning", name: "Planning Agent", description: "Converts WorkPackages into ExecutionPlans with subtask decomposition", version: "1.0.0", domains: ["workflow"], capabilities: ["workflow.planning"], enabled: true },
    { id: "workflow.review", name: "Review Agent", description: "Reviews ExecutionPlans for completeness, governance, and risk", version: "1.0.0", domains: ["workflow"], capabilities: ["workflow.review"], enabled: true },
    { id: "workflow.execution", name: "Execution Agent", description: "Executes one subtask at a time with test gating and permit validation", version: "1.0.0", domains: ["workflow"], capabilities: ["workflow.execution"], enabled: true },
    { id: "workflow.pr", name: "PR Agent", description: "Creates draft PRs with issue links, evidence fingerprints, and review findings", version: "1.0.0", domains: ["workflow"], capabilities: ["workflow.pr"], enabled: true },
  ];
}

/** Built-in tool cards for the default registry. */
export function defaultToolCards(): ToolCard[] {
  return [
    { id: "web_search", name: "Web Search", description: "Search the web", version: "1.0.0", capabilities: ["web.search", "web.fetch"], riskLevel: "low", approvalMode: "auto", allowedExecutionProfiles: ["research"], sideEffects: "read", enabled: true },
    { id: "file_read", name: "File Read", description: "Read files", version: "1.0.0", capabilities: ["filesystem.read"], riskLevel: "low", approvalMode: "auto", sideEffects: "read", enabled: true },
    { id: "file_write", name: "File Write", description: "Write files", version: "1.0.0", capabilities: ["filesystem.write"], riskLevel: "medium", approvalMode: "ask", allowedExecutionProfiles: ["artifact"], sideEffects: "write", enabled: true },
    { id: "shell_exec", name: "Shell Exec", description: "Execute shell commands", version: "1.0.0", capabilities: ["shell.exec"], riskLevel: "high", approvalMode: "ask", sideEffects: "system", enabled: true },
  ];
}

/** Load or create a CardRegistry from card files or defaults. */
export async function loadCardRegistry(cwd: string): Promise<CardRegistry> {
  const registry = new CardRegistry();
  const cardsDir = join(cwd, ".alix", "cards");
  let hasFiles = false;

  // Load agent cards from .alix/cards/agents/*.json
  const agentsDir = join(cardsDir, "agents");
  if (existsSync(agentsDir)) {
    const files = await readdir(agentsDir);
    for (const f of files.filter(f => f.endsWith(".json"))) {
      try {
        const card = JSON.parse(await readFile(join(agentsDir, f), "utf-8")) as AgentCard;
        registry.registerAgent(card);
        hasFiles = true;
      } catch (err) {
        console.error(`Failed to load agent card ${f}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Load tool cards from .alix/cards/tools/*.json
  const toolsDir = join(cardsDir, "tools");
  if (existsSync(toolsDir)) {
    const files = await readdir(toolsDir);
    for (const f of files.filter(f => f.endsWith(".json"))) {
      try {
        const card = JSON.parse(await readFile(join(toolsDir, f), "utf-8")) as ToolCard;
        registry.registerTool(card);
        hasFiles = true;
      } catch (err) {
        console.error(`Failed to load tool card ${f}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Fall back to defaults if no card files exist
  if (!hasFiles) {
    for (const card of defaultAgentCards()) registry.registerAgent(card);
    for (const card of defaultToolCards()) registry.registerTool(card);
  }

  return registry;
}
