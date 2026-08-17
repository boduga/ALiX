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
import { buildDefaultToolIndex } from "../tools/tool-registry.js";
import { AGENT_REGISTRY } from "../agents/agent-registry.js";
import type { AgentCard } from "./agent-card.js";
import type { ToolCard } from "./tool-card.js";

/** Derive a display name from a canonical tool name (e.g. "file.read" → "File Read"). */
function displayName(name: string): string {
  if (name === "mcp.*") return "MCP Tool";
  return name.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The 5 P4.5 workflow agents.
 *
 * This is catalog metadata only. It does not activate or instantiate
 * workflow agents. Runtime activation remains owned by the P4.5
 * workflow orchestration surface.
 */
export function defaultWorkflowAgentCards(): AgentCard[] {
  return [
    {
      id: "workflow.intake",
      name: "Issue Intake Agent",
      description:
        "Reads GitHub issues, validates labels, estimates priority/complexity",
      version: "1.0.0",
      domains: ["workflow"],
      capabilities: ["workflow.intake"],
      enabled: true,
    },
    {
      id: "workflow.planning",
      name: "Planning Agent",
      description:
        "Converts WorkPackages into ExecutionPlans with subtask decomposition",
      version: "1.0.0",
      domains: ["workflow"],
      capabilities: ["workflow.planning"],
      enabled: true,
    },
    {
      id: "workflow.review",
      name: "Review Agent",
      description:
        "Reviews ExecutionPlans for completeness, governance, and risk",
      version: "1.0.0",
      domains: ["workflow"],
      capabilities: ["workflow.review"],
      enabled: true,
    },
    {
      id: "workflow.execution",
      name: "Execution Agent",
      description:
        "Executes one subtask at a time with test gating and permit validation",
      version: "1.0.0",
      domains: ["workflow"],
      capabilities: ["workflow.execution"],
      enabled: true,
    },
    {
      id: "workflow.pr",
      name: "PR Agent",
      description:
        "Creates draft PRs with issue links, evidence fingerprints, and review findings",
      version: "1.0.0",
      domains: ["workflow"],
      capabilities: ["workflow.pr"],
      enabled: true,
    },
  ];
}

/**
 * NLP delegate cards are a display projection of the canonical
 * agent registry. They do not instantiate delegates.
 */
export function deriveNlpAgentCards(): AgentCard[] {
  return AGENT_REGISTRY.map((def) => ({
    id: def.role,
    name: def.name,
    description: def.description,
    version: "1.0.0",
    domains: [
      def.policyBucket === "research"
        ? "research"
        : "general",
    ],
    capabilities: def.capabilities,
    ...(def.executionProfile
      ? { executionProfile: def.executionProfile }
      : {}),
    enabled: true,
  }));
}

/**
 * Aggregate catalog surface:
 *
 * 6 canonical NLP delegate cards
 * +
 * 5 separate workflow cards
 * =
 * 11 default cards.
 *
 * This aggregation does not merge runtime taxonomies.
 */
export function defaultAgentCards(): AgentCard[] {
  return [
    ...deriveNlpAgentCards(),
    ...defaultWorkflowAgentCards(),
  ];
}

/** Built-in tool cards for the default registry.
 *
 * Tool cards are a DISPLAY PROJECTION of the canonical tool registry — never a
 * hand-maintained list. The canonical registry (src/tools/tool-registry.ts) is
 * the single source of truth for which tools exist and their capability/risk/
 * side-effect metadata; this derivation keeps the card taxonomy in lockstep. */
export function defaultToolCards(): ToolCard[] {
  return buildDefaultToolIndex().registry.getAll().map((t) => ({
    id: t.name,
    name: displayName(t.name),
    description: t.description,
    version: "1.0.0",
    capabilities: [t.capabilityId],
    riskLevel: t.risk,
    approvalMode: t.risk === "low" ? "auto" : "ask",
    ...(t.executionProfiles ? { allowedExecutionProfiles: t.executionProfiles } : {}),
    sideEffects: t.mutates ? "write" : "read",
    enabled: true,
  }));
}

/** Load or create a CardRegistry from card files or defaults.
 *
 * Agents and tools default INDEPENDENTLY: a config that only ships tools dir
 * files (or only agents dir files) no longer suppresses the other kind's
 * defaults. Previously a single `hasFiles` flag caused a partial config to
 * strip the other kind entirely. */
export async function loadCardRegistry(cwd: string): Promise<CardRegistry> {
  const registry = new CardRegistry();
  const cardsDir = join(cwd, ".alix", "cards");

  // Load agent cards from .alix/cards/agents/*.json; fall back per-kind
  const agentsDir = join(cardsDir, "agents");
  let agentsLoaded = false;
  if (existsSync(agentsDir)) {
    const files = await readdir(agentsDir);
    for (const f of files.filter(f => f.endsWith(".json"))) {
      try {
        const card = JSON.parse(await readFile(join(agentsDir, f), "utf-8")) as AgentCard;
        registry.registerAgent(card);
        agentsLoaded = true;
      } catch (err) {
        console.error(`Failed to load agent card ${f}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (!agentsLoaded) {
    for (const card of defaultAgentCards()) registry.registerAgent(card);
  }

  // Load tool cards from .alix/cards/tools/*.json; fall back per-kind
  const toolsDir = join(cardsDir, "tools");
  let toolsLoaded = false;
  if (existsSync(toolsDir)) {
    const files = await readdir(toolsDir);
    for (const f of files.filter(f => f.endsWith(".json"))) {
      try {
        const card = JSON.parse(await readFile(join(toolsDir, f), "utf-8")) as ToolCard;
        registry.registerTool(card);
        toolsLoaded = true;
      } catch (err) {
        console.error(`Failed to load tool card ${f}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (!toolsLoaded) {
    for (const card of defaultToolCards()) registry.registerTool(card);
  }

  return registry;
}
