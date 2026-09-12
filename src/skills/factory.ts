import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSavedApiKey } from "../cli/helpers/api-keys.js";
import { createProvider } from "../providers/registry.js";
import type { ModelAdapter } from "../providers/types.js";
import type { SkillFactoryConfig } from "../config/schema.js";
import type { DispatchParams } from "./dispatcher.js";
import { parseSkillContent } from "./types.js";
import { promoteIfEligible } from "./promotion.js";

const homeDir = process.env.HOME ?? "";
const candidatesDir = join(homeDir, ".alix", "candidates");

/**
 * Trace evidence for skill mining (P3): a tool sequence shape observed
 * across high-score runs (mine.mjs candidate shape), instead of a prose
 * session summary. Carries tool sequences, trace backlinks, and outcome
 * scores. Real prompt TEXT is unavailable — v2 gateway rows carry no I/O
 * payloads (proven live) — so scores stand in for outcomes.
 */
export type TraceEvidence = {
  sessionId: string;
  toolSequence: string[];
  traceIds: string[];
  runs: number;
  /** Per-trace quality scores (score.mjs ledger values); outcomes for gating. */
  scores?: Record<string, number>;
  /** Sessions the evidence was mined from (provenance for the prompt, not identity). */
  traceSessions?: string[];
  suggestedName?: string;
  config: SkillFactoryConfig;
  /** Injected provider (tests, scripted runs). Defaults to configured provider. */
  provider?: ModelAdapter;
  /** Candidate bar (plan tunables): min runs sharing the shape. Default 5. */
  minRuns?: number;
  /** Candidate bar: min quality score every traced run must meet. Default 0.8. */
  minScore?: number;
};

/**
 * Run the skill factory: distill session patterns into a candidate skill.
 * This runs asynchronously and does NOT block the main loop.
 */
export async function runSkillFactory(params: DispatchParams): Promise<void> {
  if (!params.config.enabled) {
    return;
  }
  if (!params.summary && params.filesCreated.length === 0 && params.filesChanged.length === 0) {
    return;
  }

  // Build the distillation prompt
  const prompt = buildDistillationPrompt(params);

  // Call Ollama
  const apiKey = (await getSavedApiKey(params.config.provider)) ?? "";
  const provider = await createProvider(
    { provider: params.config.provider, model: params.config.model },
    apiKey
  );

  await distillWithProvider(
    provider,
    "You are a skill distillation engine. Generate a Hermes-format skill from the provided session summary. Output ONLY the SKILL.md content with valid YAML front matter and a markdown body. No explanations, no preamble.",
    prompt,
    params.sessionId,
    params.config,
  );
}

/**
 * Run the skill factory from trace evidence (P3): distill a tool sequence
 * observed across high-score runs into a candidate skill. Same lifecycle as
 * runSkillFactory (validate → write → promote-if-eligible), different input.
 * Fire-and-forget safe: never throws into the caller (Ollama may be down).
 * Reports whether the evidence cleared the candidate bar (callers use this
 * to summarize batch distill runs).
 */
export async function runSkillFactoryFromTrace(ev: TraceEvidence): Promise<{ accepted: boolean; reason?: string }> {
  if (!ev.config.enabled) {
    return { accepted: false, reason: "factory disabled" };
  }
  // Candidate bar (plan: >= minRuns high-score runs sharing the shape).
  // Authoritative enforcement: mine.mjs prefilters with its own flags to
  // save fetches, but this gate is the one that decides — its overrides
  // win on divergence.
  // Empty tool sequences never distill — there is no pattern to capture.
  // Identity is unique traceIds (not the runs counter, which can inflate).
  if (ev.toolSequence.length === 0) {
    console.warn("[skill-factory] Empty tool sequence — nothing to distill");
    return { accepted: false, reason: "empty tool sequence" };
  }
  const minRuns = ev.minRuns ?? 5;
  const minScore = ev.minScore ?? 0.8;
  const uniqueIds = [...new Set(ev.traceIds)];
  if (uniqueIds.length < minRuns) {
    console.warn(`[skill-factory] Below candidate bar: ${uniqueIds.length} unique traces < ${minRuns}`);
    return { accepted: false, reason: `below candidate bar: ${uniqueIds.length} unique traces < ${minRuns}` };
  }
  // Scores are mandatory, not optional: the bar is "high-score runs", and a
  // scoreless file distilling on count alone would bypass the quality half.
  // Mine always emits scores; callers with arbitrary files must supply them.
  if (!ev.scores) {
    console.warn("[skill-factory] Below quality bar: no per-trace scores supplied");
    return { accepted: false, reason: "below quality bar: no per-trace scores supplied" };
  }
  const scores = ev.scores;
  const belowBar = uniqueIds.filter((id) => (scores[id] ?? 0) < minScore);
  if (belowBar.length > 0) {
    console.warn(`[skill-factory] Below quality bar: ${belowBar.length} traces < ${minScore}`);
    return { accepted: false, reason: `below quality bar: ${belowBar.length} traces < ${minScore}` };
  }

  const prompt = buildTraceDistillationPrompt(ev);

  let provider = ev.provider;
  if (!provider) {
    const apiKey = (await getSavedApiKey(ev.config.provider)) ?? "";
    provider = await createProvider(
      { provider: ev.config.provider, model: ev.config.model },
      apiKey
    );
  }

  const distilled = await distillWithProvider(
    provider,
    "You are a skill distillation engine. Generate a Hermes-format skill from the provided tool sequence observed across successful runs. Output ONLY the SKILL.md content with valid YAML front matter and a markdown body. No explanations, no preamble.",
    prompt,
    ev.sessionId,
    ev.config,
  );
  // distillWithProvider swallows provider-side failure (fire-and-forget for
  // the hot loop) — but this reporter must not claim a distill that wrote
  // nothing. Promotion-check failure stays accepted: the file was written.
  return distilled
    ? { accepted: true as const }
    : { accepted: false as const, reason: "distillation produced no candidate (provider down or invalid output)" };
}

/**
 * One mined candidate row (mine.mjs --factory-out shape): the TraceEvidence
 * fields minus caller-side config/provider/session, plus the gateway-side
 * `sessions` list (mapped to traceSessions on the way in).
 */
export type MinedCandidate = Pick<
  TraceEvidence, "suggestedName" | "toolSequence" | "traceIds" | "runs" | "scores"
> & {
  sessions?: string[];
};

/**
 * Distill a mine.mjs --factory-out file: one runSkillFactoryFromTrace per
 * candidate, with the caller's factory config/provider. Returns per-row
 * outcomes so batch callers (CLI, nightly) can report distilled vs
 * rejected without re-implementing the bar.
 */
export async function distillMinedCandidates(
  file: string,
  deps: {
    config: SkillFactoryConfig;
    provider?: ModelAdapter;
    minRuns?: number;
    minScore?: number;
  },
): Promise<{ distilled: string[]; rejected: Array<{ name: string; reason: string }> }> {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(file, "utf8");
  const distilled: string[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    // Shape-check before naming: only objects are candidate rows. A JSON
    // error or a non-object (null, 123, "hi") is not a row at all —
    // "(unparseable row)". Objects without a name are "(unnamed)" bar
    // rejects. Neither aborts the batch (the header contract).
    let row: MinedCandidate | null = null;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object") row = parsed as MinedCandidate;
    } catch {
      row = null;
    }
    if (row === null) {
      rejected.push({ name: "(unparseable row)", reason: "not a candidate object" });
      continue;
    }
    const name = row.suggestedName ?? row.toolSequence?.[0] ?? "(unnamed)";
    try {
      const outcome = await runSkillFactoryFromTrace({
        sessionId: "mined",
        toolSequence: row.toolSequence ?? [],
        traceIds: row.traceIds ?? [],
        runs: row.runs ?? 0,
        scores: row.scores,
        traceSessions: row.sessions,
        suggestedName: row.suggestedName,
        config: deps.config,
        provider: deps.provider,
        minRuns: deps.minRuns,
        minScore: deps.minScore,
      });
      if (outcome.accepted) distilled.push(name);
      else rejected.push({ name, reason: outcome.reason ?? "rejected" });
    } catch (err) {
      // One bad row (provider down, malformed shape) never aborts the batch.
      rejected.push({ name, reason: String(err instanceof Error ? err.message : err) });
    }
  }
  return { distilled, rejected };
}

/** Distillation prompt from real tool sequences + example trace IDs + outcome scores. */
export function buildTraceDistillationPrompt(ev: TraceEvidence): string {
  const scored = ev.traceIds.map((id) =>
    ev.scores?.[id] !== undefined ? `${id} (${ev.scores[id]})` : id);
  const lines = [
    "Distill this observed tool pattern into a reusable Hermes-format skill.",
    "",
    `Tool sequence (observed in order, ${ev.runs} successful runs): ` + (ev.toolSequence.join(" → ") || "(no tool steps)"),
    "Example traces with quality scores: " + (scored.join(", ") || "none"),
    ...(ev.traceSessions && ev.traceSessions.length > 0 ? [`Sessions: ${ev.traceSessions.join(", ")}`] : []),
    "Session ID: " + ev.sessionId,
    ...(ev.suggestedName ? [`Suggested name: ${ev.suggestedName}`] : []),
    "",
    "Generate a SKILL.md file with:",
    "1. YAML front matter: name, description, trigger (slash command like /name), pattern (regex), version (1.0.0), is_core (false)",
    "2. Markdown body: the complete skill guidance as if written by an expert",
    "",
    "The skill should capture the reusable technique behind this tool pattern, not the specific runs it came from.",
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

/**
 * Shared distillation tail: complete → validate → write candidate →
 * promote-if-eligible. Never throws (provider may be down); warns and returns.
 * Returns true only when a candidate file was written.
 */
async function distillWithProvider(
  provider: ModelAdapter,
  systemPrompt: string,
  userPrompt: string,
  sessionId: string,
  config: SkillFactoryConfig,
): Promise<boolean> {
  let skillContent = "";
  try {
    const response = await provider.complete({
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      tools: [],
    });
    skillContent = response.text?.trim() ?? "";
  } catch (err) {
    // Ollama may not be running - that's fine, fire-and-forget
    console.warn("[skill-factory] Ollama call failed:", err);
    return false;
  }

  if (!skillContent || skillContent.length < 100) {
    console.warn("[skill-factory] Content too short:", skillContent?.length ?? 0, "bytes");
    return false;
  }

  // Validate the skill has front matter
  const { manifest } = parseSkillContent(skillContent);
  if (!manifest) {
    console.warn("[skill-factory] Invalid skill manifest from Ollama");
    return false;
  }

  // Write to candidates directory
  // Note: The factory writes candidates to ~/.alix/candidates/, not to the workspace.
  // If skill verification against the workspace is needed in the future, use
  // runWithIsolation() from './test-isolation.js' to protect working tree changes.
  const sessionCandidateDir = join(candidatesDir, sessionId);
  await mkdir(sessionCandidateDir, { recursive: true });
  await writeFile(join(sessionCandidateDir, "SKILL.md"), skillContent, "utf8");

  if (!config.autoPromote) return true; // skip entirely if not auto-promoting
  // Try to promote — on first write this will fail (successCount=1),
  // on second write it will succeed. Call every time to handle re-use.
  try {
    await promoteIfEligible(sessionId);
  } catch (err) {
    // best effort — non-blocking
    console.warn("[skill-factory] Promotion check failed:", err);
  }
  return true;
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