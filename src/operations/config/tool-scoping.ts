/**
 * T1a/T1b tool scoping: deterministic keyword-overlap relevance filter
 * (§2 admission-control).
 *
 * T1a = CORE_TOOL_NAMES — always admitted (task-invariant, small schemas).
 * T1b = extended tools — admitted per keyword relevance; fallbackFull when
 *       no relevance signal exists.
 */

import type { ToolDef } from "../../models/providers/types.js";
import type { DeferredToolEntry } from "../../capabilities/mcp/tool-deferral.js";

/** T1a core, always-mandatory tools (task-invariant, small schemas). */
export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "alix_shell_run",
  "alix_file_read",
  "alix_patch_apply",
  "alix_done",
  "alix_collaboration_publish_finding",
  "alix_collaboration_publish_artifact",
  "alix_collaboration_query_findings",
  "alix_collaboration_get_dependency_results",
  "alix_collaboration_report_conflict",
  "alix_collaboration_list_conflicts",
]);

/**
 * Stable machine-readable scoping reason codes. Never prose, never speculation:
 * a reason is recorded only when a subsystem actually made that determination.
 */
export const SCOPING_REASONS = {
  CORE: "core",
  RELEVANCE_MATCH: "relevance_match",
  FALLBACK_FULL: "fallback_full",
  NOT_RELEVANT: "not_relevant",
} as const;

export type ScopingReason = (typeof SCOPING_REASONS)[keyof typeof SCOPING_REASONS];

export type ScopingDisposition = { tool: string; reasons: string[] };

/**
 * Why each tool was admitted or dropped, keyed by tool NAME — the scoper runs
 * before the candidate surface is frozen. `excluded` is provenance for the
 * "requirement-closing tool disappeared" question; callers that persist it
 * should gate it behind a debug flag.
 *
 * The frozen, id-keyed counterpart is `FrozenScopingProvenance` in
 * `src/operations/observability/tool-selection-observation.ts`; `run/task-loop/main.ts`
 * translates between them. Do not confuse the two — they were briefly declared
 * under this same name with different element types.
 */
export type ScopingProvenance = {
  admitted: ScopingDisposition[];
  excluded: ScopingDisposition[];
  fallbackFull: boolean;
  /**
   * The scoper's own relevance ordering of the admitted surface — the
   * relevance signal a selector comparison can cite, NOT a next-tool
   * preference: it answers "how much does this tool's description match the
   * task text", so presenting it as the deterministic selection baseline would
   * compare two different questions. Native semantics: the score is a
   * CONTENT-TOKEN IDF sum over the offered surface (English function words
   * scored as absent; see `weightedScore`). It was a raw overlapping-token
   * count until T3 finding 8, which showed it ranked a tool matching four pure
   * connectives above one matching two content words. Core tools DO receive a
   * real score — they are admitted on membership, but the recorded ranking is
   * computed the same way for every admitted tool so the ordering is
   * comparable across the whole surface. Only admitted tools appear, so
   * `set(ranking) ⊆ set(offered)`.
   */
  ranking: Array<{ tool: string; score: number }>;
};

export type ScopedTools = {
  core: ToolDef[];
  extended: ToolDef[];
  /** true when heuristic could not decide — admitted all + logged */
  fallbackFull: boolean;
  provenance: ScopingProvenance;
};

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function toolSignals(desc: string, name: string, serverName?: string): Set<string> {
  const parts = [desc, name];
  if (serverName) parts.push(serverName);
  return new Set(parts.flatMap((t) => tokens(t)));
}

/**
 * Inverse document frequency over the offered surface: how much a token
 * DISCRIMINATES between tools.
 *
 * The ranking used to be a raw overlap count, which scored connectives as
 * content. T3 finding 8 recorded it "ranked `create_hook` 9 above `file_read`
 * 6 for a read-and-summarize prompt". Reproduced on this branch's own tool set,
 * worse than recorded — for "Read the config file and summarize what it does":
 *
 *   grep_search  matched [the, and, it, does]   -> 0 content tokens, ranked 1st
 *   create_hook  matched [the, file, and, what] -> 1 content token, ranked 2nd
 *   file_read    matched [read, the, file]      -> 2 content tokens, ranked 5th
 *
 * A token appearing in nearly every description carries no information about
 * which tool the task wants, and a raw count cannot tell that apart from a
 * genuinely distinctive match.
 */
function buildIdf(allSignals: ReadonlyArray<Set<string>>): Map<string, number> {
  const total = allSignals.length;
  const documentFrequency = new Map<string, number>();
  for (const signals of allSignals) {
    for (const token of signals) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [token, freq] of documentFrequency) {
    // A token in EVERY description is pure connective; weight it to ~0 rather
    // than subtracting a floor, so a surface where everything matches equally
    // still orders deterministically instead of collapsing to ties.
    idf.set(token, Math.log((total + 1) / (freq + 1)));
  }
  return idf;
}

/**
 * English function words: articles, pronouns, auxiliaries, prepositions, and
 * conjunctions. Scored as if absent.
 *
 * IDF alone does NOT solve T3 finding 8 here, and it is worth recording why
 * rather than assuming it does. Over a surface of 21 long descriptions the
 * grammatical commoners are lexically RARE, so IDF rewards them:
 *
 *   it    df 4  -> idf 1.482      read  df 6  -> idf 1.145
 *   does  df 2  -> idf 1.992      the   df 17 -> idf 0.201
 *
 * `grep_search`'s four connector-only matches then sum to 4.28 while
 * `file_read`'s two real content matches plus one article reach 2.24 — so the
 * connective-only tool still wins on a corpus far too small for IDF to
 * identify stopwords on its own.
 *
 * Honest limitation: this list is English-scoped. The IDF half is
 * language-agnostic and does most of the work on any surface; the list is what
 * rescues the short-lexical-vocabulary case. A non-English surface degrades to
 * the IDF half rather than breaking — worst case is the old raw-count ordering,
 * never a wrong ADMISSION, because admission does not use this at all.
 */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  // articles / determiners
  "a", "an", "the", "this", "that", "these", "those", "each", "every", "some", "any", "all",
  // pronouns
  "it", "its", "he", "she", "they", "them", "his", "her", "their", "we", "us", "our", "you", "your", "i",
  // auxiliaries / copulas
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done",
  "has", "have", "had", "will", "would", "shall", "should", "can", "could", "may", "might", "must",
  // prepositions / particles
  "of", "to", "in", "on", "at", "by", "for", "with", "from", "into", "over", "under", "up", "down",
  "out", "off", "about", "after", "before", "between", "through", "during", "than", "then", "so",
  // conjunctions / adverbs that carry no tool signal
  "and", "or", "but", "if", "not", "no", "nor", "as", "also", "just", "very", "only", "when", "where",
  "which", "who", "whom", "whose", "what", "how", "why", "there", "here", "use", "using", "used",
]);

/** Does this token carry any tool-selection signal? */
function isContentToken(token: string): boolean {
  return !FUNCTION_WORDS.has(token);
}

/**
 * Content-token IDF relevance. Used for the recorded ORDER only — never for
 * admission.
 */
function weightedScore(
  matched: ReadonlyArray<string>,
  idf: ReadonlyMap<string, number>,
): number {
  let score = 0;
  for (const token of new Set(matched)) {
    if (!isContentToken(token)) continue;
    score += idf.get(token) ?? 0;
  }
  // Round for stable JSON in the trace; sub-1e-6 differences are noise.
  return Math.round(score * 1e6) / 1e6;
}

/**
 * Deterministic, no-LLM relevance filter: keyword overlap between tool
 * description/name/server and task text. Cheap and reproducible.
 */
export function scopeToolsByTask(
  tools: ToolDef[],
  mcpTools: DeferredToolEntry[],
  task: string,
  _taskType?: string,
): ScopedTools {
  const core: ToolDef[] = [];
  const extended: ToolDef[] = [];
  const admitted: ScopingDisposition[] = [];
  const excluded: ScopingDisposition[] = [];
  const scores = new Map<string, number>();

  const taskTokens = tokens(task);
  // Admission stays a RAW overlap test (`score > 0` below) and is deliberately
  // not weighted. Changing which tools are offered is a product decision; this
  // change only fixes the ORDER the trace records. Weighting admission would
  // let a connective-only match drop a tool from the surface, which is a
  // different and far larger change than T3 finding 8 describes.
  const idf = buildIdf([
    ...tools.map((t) => toolSignals(t.description, t.name)),
    ...mcpTools.map((t) => toolSignals(t.description, t.searchName ?? t.name, t.serverName)),
  ]);

  // Partition provider tools
  for (const t of tools) {
    if (CORE_TOOL_NAMES.has(t.name)) {
      core.push(t);
      admitted.push({ tool: t.name, reasons: [SCOPING_REASONS.CORE] });
      const matched = taskTokens.filter((token) => toolSignals(t.description, t.name).has(token));
      scores.set(t.name, weightedScore(matched, idf));
    } else {
      const signals = toolSignals(t.description, t.name);
      const matched = taskTokens.filter((token) => signals.has(token));
      if (matched.length > 0) {
        extended.push(t);
        admitted.push({ tool: t.name, reasons: [SCOPING_REASONS.RELEVANCE_MATCH] });
        scores.set(t.name, weightedScore(matched, idf));
      } else {
        excluded.push({ tool: t.name, reasons: [SCOPING_REASONS.NOT_RELEVANT] });
      }
    }
  }

  // Partition and flatten MCP tools
  const all: (ToolDef | DeferredToolEntry)[] = [...tools, ...mcpTools];
  for (const t of mcpTools) {
    if (!CORE_TOOL_NAMES.has(t.name)) {
      const signals = toolSignals(t.description, t.searchName ?? t.name, t.serverName);
      const matched = taskTokens.filter((token) => signals.has(token));
      if (matched.length > 0) {
        extended.push({
          name: t.name,
          description: t.description,
          input_schema: (t.input_schema ?? { type: "object", properties: {} }) as ToolDef["input_schema"],
        });
        admitted.push({ tool: t.name, reasons: [SCOPING_REASONS.RELEVANCE_MATCH] });
        scores.set(t.name, weightedScore(matched, idf));
      } else {
        excluded.push({ tool: t.name, reasons: [SCOPING_REASONS.NOT_RELEVANT] });
      }
    }
  }

  // fallbackFull: no extended matched but non-core tools exist.
  // Admit everything so the model isn't silently crippled, but log
  // it so the miss is visible.
  if (extended.length === 0 && all.some((t) => !CORE_TOOL_NAMES.has(t.name))) {
    const extendedFallback: ToolDef[] = [];
    const fallbackAdmitted: ScopingDisposition[] = [];
    for (const t of all) {
      if (!CORE_TOOL_NAMES.has(t.name)) {
        extendedFallback.push({
          name: t.name,
          description: t.description,
          input_schema: "input_schema" in t ? t.input_schema : (t as DeferredToolEntry).input_schema ?? { type: "object", properties: {} },
        } as ToolDef);
        fallbackAdmitted.push({ tool: t.name, reasons: [SCOPING_REASONS.FALLBACK_FULL] });
      }
    }
    const fallbackRanking = fallbackAdmitted.map((entry) => ({ tool: entry.tool, score: 0 }));
    return {
      core,
      extended: extendedFallback,
      fallbackFull: true,
      // Everything non-core is admitted in this branch, so nothing is excluded.
      provenance: {
        admitted: [...admitted, ...fallbackAdmitted],
        excluded: [],
        fallbackFull: true,
        ranking: [...rankingFrom(scores), ...fallbackRanking],
      },
    };
  }

  return {
    core,
    extended,
    fallbackFull: false,
    provenance: { admitted, excluded, fallbackFull: false, ranking: rankingFrom(scores) },
  };
}

/** Admission order, then score descending — stable for equal scores. */
function rankingFrom(scores: Map<string, number>): Array<{ tool: string; score: number }> {
  return [...scores.entries()]
    .map(([tool, score], index) => ({ tool, score, index }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(({ tool, score }) => ({ tool, score }));
}
