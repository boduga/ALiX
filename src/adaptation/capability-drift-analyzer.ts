/**
 * P5.5.5 — CapabilityDriftAnalyzer.
 *
 * Detects when a capability's actual usage has drifted from its original
 * intended scope, identifying potential split candidates. Uses Jaccard
 * distance between original-scope keywords and current-scope keywords.
 *
 * Pure compute — no I/O, no mutations, no stores.
 *
 * @module
 */

import type { CapabilityDrift } from "./capability-evolution-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
const RECENT_DAYS = 30;
const DEFAULT_MIN_DRIFT = 0.3;
const SPLIT_CANDIDATE_THRESHOLD = 0.5;
const MAX_SCOPE_CHARS = 200;
const MIN_RECENT_PROPOSALS = 3;

const STOPWORDS = new Set([
  "the", "a", "an", "for", "to", "in", "of", "and", "or", "is", "are",
  "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
  "did", "will", "would", "can", "could", "should", "may", "might", "shall",
  "not", "no", "nor", "with", "at", "from", "by", "on", "as", "it", "its",
  "this", "that", "these", "those",
]);

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

/**
 * Extract meaningful keywords from text by lowercasing, splitting on
 * non-word boundaries, and filtering out stopwords and short tokens.
 */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.;:!?()\[\]{}"']+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// ---------------------------------------------------------------------------
// Pseudo-type for the parameter shape (keeps the class signature clean)
// ---------------------------------------------------------------------------

interface AgentCardInput {
  id: string;
  capabilities: string[];
  description?: string;
}

interface ProposalInput {
  target: { kind: string; capability?: string };
  payload?: Record<string, unknown>;
  reason?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a proposal references a given capability.
 *
 * A proposal references a capability when:
 * - target.kind is "capability" and target.capability matches, OR
 * - payload.capability matches.
 */
function proposalReferencesCapability(
  prop: ProposalInput,
  capName: string,
): boolean {
  if (prop.target.kind === "capability" && prop.target.capability === capName) {
    return true;
  }
  if (
    prop.payload &&
    typeof prop.payload.capability === "string" &&
    prop.payload.capability === capName
  ) {
    return true;
  }
  return false;
}

/**
 * Extract human-readable text from a proposal's reason and payload fields.
 * The payload is serialised as JSON, excluding the "capability" key since
 * that is the selector, not descriptive text.
 */
function proposalText(prop: ProposalInput): string {
  const parts: string[] = [];
  if (prop.reason) {
    parts.push(prop.reason);
  }
  if (prop.payload) {
    // Collect all payload values except the capability key
    const entries = Object.entries(prop.payload).filter(
      ([k]) => k !== "capability",
    );
    if (entries.length > 0) {
      parts.push(JSON.stringify(Object.fromEntries(entries)));
    }
  }
  return parts.join(" ");
}

/**
 * Sort proposals by createdAt ascending (earliest first).
 */
function sortByCreatedAt(
  props: ProposalInput[],
): ProposalInput[] {
  return [...props].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

// ---------------------------------------------------------------------------
// CapabilityDriftAnalyzer
// ---------------------------------------------------------------------------

export class CapabilityDriftAnalyzer {
  /**
   * Analyze capability scope drift across the registered capability set.
   *
   * For each registered capability the analyzer collects **original scope**
   * text (agent card descriptions + the first 3 proposals by date) and
   * **current scope** text (proposals from the last 30 days, falling back
   * to ALL proposals when fewer than 3 recent ones exist).  It then computes
   * the Jaccard distance between the two keyword sets.
   *
   * @returns One {@link CapabilityDrift} entry per capability whose drift
   *          magnitude equals or exceeds `minDriftMagnitude`.  Capabilities
   *          with an empty keyword set in either scope are always excluded
   *          (driftMagnitude = 0 for those).
   */
  analyze(params: {
    /** All registered capability names. */
    registeredCapabilities: string[];
    /** Agent cards with descriptions and capabilities. */
    agentCards: AgentCardInput[];
    /** All proposals (early ones for original scope, recent for current). */
    proposals: ProposalInput[];
    /** Minimum drift magnitude to include (default 0.3). */
    minDriftMagnitude?: number;
  }): CapabilityDrift[] {
    const minDrift = params.minDriftMagnitude ?? DEFAULT_MIN_DRIFT;
    const now = Date.now();
    const recentCutoff = now - RECENT_DAYS * MS_PER_DAY;

    // ---- Index proposals by capability ----
    const proposalsByCap = new Map<string, ProposalInput[]>();
    for (const prop of params.proposals) {
      for (const cap of params.registeredCapabilities) {
        if (proposalReferencesCapability(prop, cap)) {
          if (!proposalsByCap.has(cap)) proposalsByCap.set(cap, []);
          proposalsByCap.get(cap)!.push(prop);
        }
      }
    }

    // ---- Index agent descriptions by capability ----
    const descriptionsByCap = new Map<string, string[]>();
    for (const card of params.agentCards) {
      if (!card.description) continue;
      for (const cap of card.capabilities) {
        if (!descriptionsByCap.has(cap)) descriptionsByCap.set(cap, []);
        descriptionsByCap.get(cap)!.push(card.description);
      }
    }

    const results: CapabilityDrift[] = [];

    for (const cap of params.registeredCapabilities) {
      // ---------------------------------------------------------------
      // Build original-scope text
      // ---------------------------------------------------------------
      const originalParts: string[] = [];

      // Agent card descriptions
      const descs = descriptionsByCap.get(cap);
      if (descs) {
        originalParts.push(...descs);
      }

      // First 3 proposals (by createdAt) that reference this capability
      const allProps = proposalsByCap.get(cap) ?? [];
      if (allProps.length > 0) {
        const sorted = sortByCreatedAt(allProps);
        const earliestThree = sorted.slice(0, 3);
        for (const prop of earliestThree) {
          const text = proposalText(prop);
          if (text) originalParts.push(text);
        }
      }

      let originalScope = originalParts.join(" ");
      if (!originalScope.trim()) {
        originalScope = cap;
      }

      // ---------------------------------------------------------------
      // Build current-scope text
      // ---------------------------------------------------------------
      const recentProps = allProps.filter(
        (p) => new Date(p.createdAt).getTime() >= recentCutoff,
      );

      let currentProps: ProposalInput[];
      if (recentProps.length >= MIN_RECENT_PROPOSALS) {
        currentProps = recentProps;
      } else {
        // Sparse data — use ALL proposals for current scope
        currentProps = allProps;
      }

      const currentParts: string[] = [];
      for (const prop of currentProps) {
        const text = proposalText(prop);
        if (text) currentParts.push(text);
      }

      let currentScope = currentParts.join(" ");
      if (!currentScope.trim()) {
        currentScope = cap;
      }

      // ---------------------------------------------------------------
      // Compute drift (Jaccard distance)
      // ---------------------------------------------------------------
      const origKeywords = extractKeywords(originalScope);
      const currKeywords = extractKeywords(currentScope);

      let driftMagnitude = 0;
      let splitCandidate = false;

      if (origKeywords.length > 0 && currKeywords.length > 0) {
        // Use unique keyword sets to compute the true Jaccard distance.
        const origSet = new Set(origKeywords);
        const currSet = new Set(currKeywords);
        let intersectionCount = 0;
        for (const k of origSet) {
          if (currSet.has(k)) intersectionCount++;
        }
        const unionCount = new Set([...origSet, ...currSet]).size;
        const jaccardSimilarity = intersectionCount / unionCount;
        driftMagnitude = 1 - jaccardSimilarity;
        splitCandidate = driftMagnitude > SPLIT_CANDIDATE_THRESHOLD;
      }
      // else: either keyword set is empty → driftMagnitude stays 0, excluded

      if (driftMagnitude >= minDrift) {
        results.push({
          capability: cap,
          originalScope: originalScope.slice(0, MAX_SCOPE_CHARS),
          currentScope: currentScope.slice(0, MAX_SCOPE_CHARS),
          driftMagnitude: Math.round(driftMagnitude * 1_000_000) / 1_000_000,
          splitCandidate,
        });
      }
    }

    return results;
  }
}
