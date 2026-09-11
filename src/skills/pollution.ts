// src/skills/pollution.ts
//
// Catalog-pollution detection: pairwise overlap between installed/candidate
// skills — the skill-side analog of CapabilityOverlapAnalyzer
// (src/adaptation/capability-overlap-analyzer.ts), which measures
// co-occurrence (shared agents/proposals). Skills have no such signals, so
// this module scores routing + textual collisions instead: shared triggers,
// subsuming patterns, and near-identical names/descriptions/bodies.
//
// Pure compute — no I/O, no mutations, no stores. Identity reuse:
// canonicalSkillId() from ./slash.js is the SOLE dedup authority, so
// same-name pairs are skipped here (owned by resolveNamingCollision).
// The single wordTokens()/jaccard() pair below is the only text-similarity
// implementation in the skills subsystem — do not duplicate it elsewhere.

import type { SkillManifest } from "./types.js";
import { canonicalSkillId } from "./slash.js";

/** Minimal skill view — accepts LoadedSkill, SkillEntry, or manifest+body. */
export interface SkillSnapshot {
  manifest: SkillManifest;
  body?: string;
}

export interface PollutionSignals {
  /** Both skills claim the same normalized trigger (routing collision). */
  sameTrigger: boolean;
  /** Either pattern matches the other's trigger/name/description probes. */
  patternOverlap: boolean;
  /** Jaccard similarity over name tokens (0-1). */
  nameSimilarity: number;
  /** Jaccard similarity over description tokens (0-1). */
  descriptionSimilarity: number;
  /** Jaccard similarity over body tokens (0 when either body is missing). */
  bodySimilarity: number;
}

export interface PollutionFinding {
  a: string;
  b: string;
  score: number;
  signals: PollutionSignals;
  consolidationCandidate: boolean;
}

export interface PollutionOptions {
  /** Minimum score to report a pair (default 0.3). */
  minScore?: number;
  /** Mean text similarity that, with pattern overlap, consolidates (default 0.3). */
  textThreshold?: number;
  /** Mean text similarity that consolidates on its own (default 0.65). */
  textOnlyThreshold?: number;
  /** Include body text in scoring (default true; false for manifest-only scans). */
  includeBody?: boolean;
}

// ---------------------------------------------------------------------------
// Single text-similarity implementation for the skills subsystem.
// ---------------------------------------------------------------------------

/** Lowercase alphanumeric tokens with light plural folding. */
function wordTokens(s: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of s.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    // Fold simple plurals ("loops" -> "loop"); keep "ss" endings intact.
    const token =
      raw.length > 3 && raw.endsWith("s") && !raw.endsWith("ss")
        ? raw.slice(0, -1)
        : raw;
    tokens.add(token);
  }
  return tokens;
}

/** Jaccard similarity. Empty-vs-anything is 0 (no evidence, not a match). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

/** Trigger identity: leading slashes stripped, case-insensitive. */
function normalizeTrigger(trigger: string | undefined): string {
  return (trigger ?? "").replace(/^\/+/, "").trim().toLowerCase();
}

/** Compile a skill pattern the same way SkillCatalog does (invalid → null). */
function compilePattern(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/** Deterministic probe strings a colliding pattern would fire on. */
function probesFor(manifest: SkillManifest): string[] {
  const trigger = normalizeTrigger(manifest.trigger);
  const probes = [
    manifest.trigger ?? "",
    trigger ? `/${trigger}` : "",
    manifest.name,
    `/${manifest.name}`,
    manifest.description ?? "",
  ];
  return [...new Set(probes.filter(Boolean))];
}

/** True when either skill's pattern matches any of the other's probes. */
function patternsOverlap(a: SkillManifest, b: SkillManifest): boolean {
  const patternA = compilePattern(a.pattern);
  if (patternA && probesFor(b).some((probe) => patternA.test(probe))) {
    return true;
  }
  const patternB = compilePattern(b.pattern);
  if (patternB && probesFor(a).some((probe) => patternB.test(probe))) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pairwise analysis (mirrors CapabilityOverlapAnalyzer.analyze shape).
// ---------------------------------------------------------------------------

const SCORE_WEIGHTS = {
  sameTrigger: 0.35,
  patternOverlap: 0.25,
  name: 0.15,
  description: 0.15,
  body: 0.1,
} as const;

function scoreSignals(signals: PollutionSignals): number {
  return (
    SCORE_WEIGHTS.sameTrigger * (signals.sameTrigger ? 1 : 0) +
    SCORE_WEIGHTS.patternOverlap * (signals.patternOverlap ? 1 : 0) +
    SCORE_WEIGHTS.name * signals.nameSimilarity +
    SCORE_WEIGHTS.description * signals.descriptionSimilarity +
    SCORE_WEIGHTS.body * signals.bodySimilarity
  );
}

/**
 * Analyze pairwise overlap across a skill set.
 *
 * @returns One finding per pair meeting `minScore` (default 0.3), sorted by
 *          score descending. Same-canonical-id pairs are skipped (owned by
 *          resolveNamingCollision, not pollution).
 */
export function detectCatalogPollution(
  skills: SkillSnapshot[],
  opts?: PollutionOptions,
): PollutionFinding[] {
  const minScore = opts?.minScore ?? 0.3;
  const textThreshold = opts?.textThreshold ?? 0.3;
  const textOnlyThreshold = opts?.textOnlyThreshold ?? 0.65;
  const includeBody = opts?.includeBody ?? true;

  const findings: PollutionFinding[] = [];

  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const snapA = skills[i];
      const snapB = skills[j];
      if (canonicalSkillId(snapA.manifest) === canonicalSkillId(snapB.manifest)) {
        continue;
      }

      const triggerA = normalizeTrigger(snapA.manifest.trigger);
      const triggerB = normalizeTrigger(snapB.manifest.trigger);
      const sameTrigger = triggerA !== "" && triggerA === triggerB;

      const signals: PollutionSignals = {
        sameTrigger,
        patternOverlap: patternsOverlap(snapA.manifest, snapB.manifest),
        nameSimilarity: jaccard(
          wordTokens(snapA.manifest.name),
          wordTokens(snapB.manifest.name),
        ),
        descriptionSimilarity: jaccard(
          wordTokens(snapA.manifest.description ?? ""),
          wordTokens(snapB.manifest.description ?? ""),
        ),
        bodySimilarity:
          includeBody && snapA.body && snapB.body
            ? jaccard(wordTokens(snapA.body), wordTokens(snapB.body))
            : 0,
      };

      const textSims = [signals.nameSimilarity, signals.descriptionSimilarity];
      if (includeBody && snapA.body && snapB.body) {
        textSims.push(signals.bodySimilarity);
      }
      const textAvg =
        textSims.reduce((sum, sim) => sum + sim, 0) / textSims.length;

      // A shared trigger is pollution by construction (SkillCatalog.byTrigger
      // is a Map — the second install silently shadows the first).
      const consolidationCandidate =
        signals.sameTrigger ||
        (signals.patternOverlap && textAvg >= textThreshold) ||
        textAvg >= textOnlyThreshold;

      const score = signals.sameTrigger ? 1 : scoreSignals(signals);
      if (score < minScore) continue;

      findings.push({
        a: canonicalSkillId(snapA.manifest),
        b: canonicalSkillId(snapB.manifest),
        score,
        signals,
        consolidationCandidate,
      });
    }
  }

  findings.sort((x, y) => y.score - x.score);
  return findings;
}

/**
 * Same-name body check: true when two bodies are near-identical token sets.
 * Whitespace/case/punctuation-insensitive by construction (wordTokens).
 * Empty on either side is no evidence → false, never a match.
 */
export function isDuplicateBody(
  aBody: string | undefined,
  bBody: string | undefined,
  threshold = 0.9,
): boolean {
  if (!aBody || !bBody) return false;
  return jaccard(wordTokens(aBody), wordTokens(bBody)) >= threshold;
}

/**
 * Promotion gate: collisions between one candidate and the installed set.
 * Returns only consolidation candidates involving the candidate skill.
 */
export function findCandidateCollisions(
  candidate: SkillSnapshot,
  installed: SkillSnapshot[],
  opts?: PollutionOptions,
): PollutionFinding[] {
  const name = canonicalSkillId(candidate.manifest);
  return detectCatalogPollution([candidate, ...installed], opts).filter(
    (finding) =>
      finding.consolidationCandidate &&
      (finding.a === name || finding.b === name),
  );
}
