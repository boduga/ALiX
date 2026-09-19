/**
 * prompts/registry.ts — Central prompt registry.
 *
 * Every static model-facing prompt in ALiX is registered here with a
 * stable id and version. Purpose: one place to audit prompt surface,
 * per-layer token accounting, and snapshot tests that fail loudly when
 * prompt text changes without a version bump.
 *
 * Dynamic per-turn assembly (tool manifests, memory blocks, digests) is
 * not registered — only the static templates listed below.
 */

import {
  SYSTEM_PROMPT_BASE,
  RESEARCH_SUPPLEMENT,
  MUTATION_SUPPLEMENT,
  VALIDATION_SUPPLEMENT,
  SHELL_TASK_PROMPT,
  READ_ONLY_MODE_PROMPT,
} from "../agent/system-prompt.js";
import { ROLE_INSTRUCTIONS } from "../agents/agent-registry.js";
import { buildPlanPrompt } from "../kernel/graph-planner.js";
import { buildExternalRetrievalPrompt } from "../runtime/route-prompts.js";

export type PromptEntry = {
  /** Stable id, e.g. "agent.system-base". */
  id: string;
  /** Bump on any text change. */
  version: string;
  /** Source file owning the text. */
  source: string;
  /** The registered text. */
  text: string;
};

function entry(id: string, version: string, source: string, text: string): PromptEntry {
  return { id, version, source, text };
}

export const PROMPT_REGISTRY: PromptEntry[] = [
  entry("agent.system-base", "1.1.0", "src/agent/system-prompt.ts", SYSTEM_PROMPT_BASE),
  entry("agent.research-supplement", "1.0.0", "src/agent/system-prompt.ts", RESEARCH_SUPPLEMENT),
  entry("agent.execution-supplement", "1.0.0", "src/agent/system-prompt.ts", MUTATION_SUPPLEMENT),
  entry("agent.verification-supplement", "1.0.0", "src/agent/system-prompt.ts", VALIDATION_SUPPLEMENT),
  entry("agent.shell-task", "1.0.0", "src/agent/system-prompt.ts", SHELL_TASK_PROMPT),
  entry("agent.read-only-mode", "1.0.0", "src/agent/system-prompt.ts", READ_ONLY_MODE_PROMPT),
  entry("subagent.explorer", "1.1.0", "src/agents/agent-registry.ts", ROLE_INSTRUCTIONS.explorer),
  entry("subagent.reviewer", "1.1.0", "src/agents/agent-registry.ts", ROLE_INSTRUCTIONS.reviewer),
  entry("subagent.test-investigator", "1.1.0", "src/agents/agent-registry.ts", ROLE_INSTRUCTIONS.test_investigator),
  entry("subagent.docs-researcher", "1.2.0", "src/agents/agent-registry.ts", ROLE_INSTRUCTIONS.docs_researcher),
  entry("subagent.worker", "1.2.0", "src/agents/agent-registry.ts", ROLE_INSTRUCTIONS.worker),
  entry("subagent.researcher", "1.2.0", "src/agents/agent-registry.ts", ROLE_INSTRUCTIONS.researcher),
  entry("planner.graph", "2.1.0", "src/kernel/graph-planner.ts", buildPlanPrompt()),
  entry("route.retrieval-system", "1.1.0", "src/runtime/route-prompts.ts", buildExternalRetrievalPrompt("external_retrieval").systemPrompt),
];
