/**
 * agent-registry.ts -- Canonical NLP subagent (delegate) registry.
 *
 * Single authoritative source of metadata for the ephemeral delegate roles
 * spawned by the NLP `delegate` tool.
 *
 * Metadata only — no execution.
 *
 * The control-plane roles (operator / governor / executor / verifier) are
 * architectural layers and are intentionally not registry entries.
 *
 * The workflow.* cards are a separate P4.5 workflow surface and are
 * intentionally not registry entries.
 *
 * `auto` is a router sentinel and is intentionally absent from the registry.
 */

import type {
  SubagentRole,
  SubagentRoleConfig,
  SubagentStyle,
} from "../config/schema.js";

export type AgentToolCategory = "read" | "write" | "research";

export type AgentCapability = {
  role: SubagentRole;
  name: string;
  description: string;
  instructions: string;
  toolCategory: AgentToolCategory;
  mode: "read_only" | "write";
  style: SubagentStyle;
  capabilities: string[];
  executionProfile?: "research";
};

export const DEFAULT_SUBAGENT_INSTRUCTIONS =
  "You are an autonomous subagent. Adapt your behavior based on context — read files, analyze code, and apply changes as needed. Be efficient and self-directed.";

export const AGENT_REGISTRY: readonly AgentCapability[] = [
  {
    role: "explorer",
    name: "Explorer",
    description:
      "Read-only codebase exploration: find files, trace code paths, summarize structure.",
    instructions:
      "You are an explorer subagent. Understand code regions and report your findings concisely. Use file references, summarize structure, identify key symbols.",
    toolCategory: "read",
    mode: "read_only",
    style: "fast",
    capabilities: ["filesystem.read", "filesystem.search"],
  },
  {
    role: "reviewer",
    name: "Code Reviewer",
    description:
      "Independent code/design review for correctness, quality, and risks.",
    instructions:
      "You are a code reviewer. Analyze code quality, style, and potential issues. Be constructive and specific. Flag risks and suggest improvements.",
    toolCategory: "read",
    mode: "read_only",
    style: "critic",
    capabilities: [],
  },
  {
    role: "test_investigator",
    name: "Test Investigator",
    description:
      "Map tests to code, diagnose failures, and suggest fixes.",
    instructions:
      "You are a test investigator. Map tests to code, diagnose failures, and suggest fixes. Be precise. Use test names and file paths.",
    toolCategory: "read",
    mode: "read_only",
    style: "thinking",
    capabilities: ["filesystem.read", "filesystem.search"],
  },
  {
    role: "docs_researcher",
    name: "Docs Researcher",
    description:
      "Find and summarize relevant documentation; cite sources.",
    instructions:
      "You are a docs researcher. Find and summarize relevant documentation. Cite file paths and sources. Be thorough.",
    toolCategory: "read",
    mode: "read_only",
    style: "fast",
    capabilities: ["filesystem.read"],
  },
  {
    role: "worker",
    name: "Worker",
    description:
      "Implementation worker that applies changes to owned files.",
    instructions:
      "You are a worker subagent. Apply changes to owned files only. Do NOT delete files you create — leave them in place. Always explain what you changed.",
    toolCategory: "write",
    mode: "write",
    style: "coding",
    capabilities: ["filesystem.write", "shell.exec"],
  },
  {
    role: "researcher",
    name: "Researcher",
    description:
      "External research and synthesis using web search; cite sources.",
    instructions:
      "You are a researcher subagent. Search for information, analyze findings, and report concisely. Use web search for external knowledge. Cite sources.",
    toolCategory: "research",
    mode: "read_only",
    style: "fast",
    capabilities: ["web.search", "web.fetch"],
    executionProfile: "research",
  },
];

export function getAgentDefinition(
  role: SubagentRole,
): AgentCapability | undefined {
  return AGENT_REGISTRY.find((a) => a.role === role);
}

export function getToolCategory(
  role: SubagentRole,
): AgentToolCategory | undefined {
  return getAgentDefinition(role)?.toolCategory;
}

export const ROLE_INSTRUCTIONS: Readonly<Record<SubagentRole, string>> = {
  auto: DEFAULT_SUBAGENT_INSTRUCTIONS,
  ...(Object.fromEntries(
    AGENT_REGISTRY.map((a) => [a.role, a.instructions]),
  ) as Record<string, string>),
} as Record<SubagentRole, string>;

export function defaultRoleConfigs(): SubagentRoleConfig[] {
  return AGENT_REGISTRY.map((a) => ({
    role: a.role,
    mode: a.mode,
    style: a.style,
    retryCount: a.role === "worker" ? 0 : 1,
  }));
}
