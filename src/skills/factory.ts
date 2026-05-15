import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProvider } from "../providers/registry.js";
import type { SkillFactoryConfig } from "../config/schema.js";
import type { DispatchParams } from "./dispatcher.js";
import { parseSkillContent } from "./types.js";
import { promoteIfEligible } from "./promotion.js";

const homeDir = process.env.HOME ?? "";
const candidatesDir = join(homeDir, ".alix", "candidates");

/**
 * Run the skill factory: distill session patterns into a candidate skill.
 * This runs asynchronously and does NOT block the main loop.
 */
export async function runSkillFactory(params: DispatchParams): Promise<void> {
  if (!params.config.enabled) return;
  if (!params.summary && params.filesCreated.length === 0 && params.filesChanged.length === 0) return;

  // Build the distillation prompt
  const prompt = buildDistillationPrompt(params);

  // Call Ollama
  const provider = createProvider(
    { provider: params.config.provider, model: params.config.model },
    process.env.OLLAMA_API_KEY
  );

  let skillContent = "";
  try {
    const response = await provider.complete({
      systemPrompt: "You are a skill distillation engine. Generate a Hermes-format skill from the provided session summary. Output ONLY the SKILL.md content with valid YAML front matter and a markdown body. No explanations, no preamble.",
      messages: [{ role: "user", content: prompt }],
      tools: [],
    });
    skillContent = response.text?.trim() ?? "";
  } catch (err) {
    // Ollama may not be running - that's fine, fire-and-forget
    console.warn("[skill-factory] Ollama call failed:", err);
    return;
  }

  if (!skillContent || skillContent.length < 100) return;

  // Validate the skill has front matter
  const { manifest } = parseSkillContent(skillContent);
  if (!manifest) {
    console.warn("[skill-factory] Invalid skill manifest from Ollama");
    return;
  }

  // Write to candidates directory
  // Note: The factory writes candidates to ~/.alix/candidates/, not to the workspace.
  // If skill verification against the workspace is needed in the future, use
  // runWithIsolation() from './test-isolation.js' to protect working tree changes.
  const sessionCandidateDir = join(candidatesDir, params.sessionId);
  await mkdir(sessionCandidateDir, { recursive: true });
  await writeFile(join(sessionCandidateDir, "SKILL.md"), skillContent, "utf8");

  if (!params.config.autoPromote) return; // skip entirely if not auto-promoting
  // Try to promote — on first write this will fail (successCount=1),
  // on second write it will succeed. Call every time to handle re-use.
  try {
    await promoteIfEligible(params.sessionId);
  } catch (err) {
    // best effort — non-blocking
    console.warn("[skill-factory] Promotion check failed:", err);
  }
}

function buildDistillationPrompt(params: DispatchParams): string {
  const files = [...params.filesCreated, ...params.filesChanged].join(", ") || "none";
  const lines = [
    "Distill this coding session into a reusable Hermes-format skill.",
    "",
    "Session summary: " + params.summary,
    "Files involved: " + files,
    "Session ID: " + params.sessionId,
    "",
    "Generate a SKILL.md file with:",
    "1. YAML front matter: name, description, trigger (slash command like /name), pattern (regex), version (1.0.0), is_core (false)",
    "2. Markdown body: the complete skill guidance as if written by an expert",
    "",
    "The skill should capture the reusable pattern/technique from this session, not the specific implementation details.",
    "",
    "Output format:",
    "---",
    "name: <skill-name>",
    "description: <one-line description>",
    "trigger: /<name>",
    'pattern: "<optional regex>"',
    'version: "1.0.0"',
    "is_core: false",
    "---",
    "# Skill Title",
    "",
    "[Full skill guidance in markdown]",
  ];
  return lines.join("\n");
}