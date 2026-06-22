/**
 * P7.6c — Chat Skill Bridge.
 *
 * Connects the chat REPL to the skill execution, intent capture, and
 * proposal mapping pipelines.  Each handler returns a human-readable
 * string that the REPL echoes back to the user.
 *
 * @module
 */

import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// handleRunSkill
// ---------------------------------------------------------------------------

/**
 * Run a skill by id with the given input.
 * Uses the real SkillLoader + ExtensionRegistry — same as `alix skill run`.
 */
export async function handleRunSkill(
  skillId: string,
  input: string,
): Promise<string> {
  const { ExtensionRegistry } = await import("../extensions/registry.js");
  const { SkillLoader } = await import("../extensions/skill-loader.js");
  const { dirname } = await import("node:path");

  const extensionStorePath = join(homedir(), ".alix", "extensions");
  const registry = new ExtensionRegistry(extensionStorePath);
  const ext = registry.get(`skill/${skillId}`);
  if (!ext) return `Skill not found: ${skillId}. Use /skills to list installed skills.`;

  const skillDir = dirname(ext.path);
  const loader = new SkillLoader(skillDir);
  const inputJson = input ? { input } : undefined;
  const loaded = await loader.load("SKILL", inputJson);
  if (!loaded) return `Failed to load skill: ${skillId} (SKILL.md not found).`;

  return loaded.content;
}

// ---------------------------------------------------------------------------
// handleCreateIntent
// ---------------------------------------------------------------------------

export async function handleCreateIntent(
  description: string,
  sessionId: string,
  intentDir?: string,
): Promise<string> {
  const { IntentStore } = await import("../adaptation/intent-store.js");

  const dir = intentDir ?? join(homedir(), ".alix", "execution", "intents");
  const intentStore = new IntentStore(dir);

  const intent = {
    id: "",
    generatedAt: new Date().toISOString(),
    source: "skill_run" as const,
    input: description,
    outputSummary: description,
    status: "captured" as const,
    confidence: 1,
    rationale: "Created via alix chat /intent",
    sourceArtifacts: [{ type: "context" as const, id: `session:${sessionId}` }],
    subject: `Chat intent: ${description.slice(0, 80)}`,
    outcome: "captured" as const,
    reasons: [`Intent created from chat session ${sessionId}`],
  };

  await intentStore.append(intent);
  return `Intent captured: ${intent.id || "(id pending)"}`;
}

// ---------------------------------------------------------------------------
// handleProposeIntent
// ---------------------------------------------------------------------------

export async function handleProposeIntent(
  intentId: string,
): Promise<string> {
  const { IntentStore } = await import("../adaptation/intent-store.js");
  const { ProposalStore } = await import("../adaptation/proposal-store.js");
  const { IntentProposalMapper } = await import("../adaptation/intent-proposal-mapper.js");

  const intentDir = join(homedir(), ".alix", "execution", "intents");
  const intentStore = new IntentStore(intentDir);

  const intent = await intentStore.get(intentId);
  if (!intent) return `Intent ${intentId} not found.`;

  const proposalsDir = join(process.cwd(), ".alix", "adaptation", "proposals");
  const proposalStore = new ProposalStore(proposalsDir);
  const mapper = new IntentProposalMapper(proposalStore);

  const result = await mapper.mapToProposal(intent, intentStore);
  if (!result.success) {
    return `Proposal failed: ${result.errors.join("; ")}`;
  }
  return `Proposal created: ${result.proposal!.id}. Review via the decision pipeline.`;
}
