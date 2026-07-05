/**
 * P13.2 — Autonomous governance failure pattern clustering.
 *
 * Reads the P12.5 failure memory (`FailureRecord`) and computes clustered
 * analysis — grouping by failure type, extracting common keywords / file
 * paths, and computing aggregate metrics.
 *
 * All functions are pure (no I/O, no side effects). All sort orders are
 * deterministic.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { FailureType, FailureRecord } from "./failure-memory.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface FailureCluster {
  failureType: FailureType;
  count: number;
  recentTimestamp: string;
  commonDetailKeywords: string[];
  commonFilePaths: string[];
  associatedPolicyIds: string[];
}

export interface FailureAnalysis {
  total: number;
  clusters: FailureCluster[];
  dominantType: FailureType | null;
  recurringFilePaths: string[];
  recurringFilePathCounts: Record<string, number>;
  timeframeDays: number;
}

// ---------------------------------------------------------------------------
// Stop words
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "this", "that", "with", "from", "was", "were", "have", "been",
  "not", "for", "are", "has", "had", "but", "can", "all", "its", "any",
  "out", "one", "use", "may", "see", "set", "two", "way", "who", "now",
  "how", "then", "than", "just", "also", "over", "such", "each", "when",
  "what", "which", "file", "could", "would", "should", "about", "will",
  "into", "more", "some", "them", "very",
]);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Map a failure type to its display severity.
 */
export function failureSeverityForType(
  type: FailureType,
): "high" | "medium" | "low" {
  switch (type) {
    case "approval_denied":
    case "pr_rejected":
      return "high";
    case "policy_denied":
    case "file_scope_violation":
    case "blocked_command":
      return "medium";
    case "verification_timeout":
    case "test_failure":
      return "low";
  }
}

/**
 * Compute the actual time span (in rounded days) covered by a set of
 * failure records. Order-agnostic — finds min/max timestamps.
 * Returns 0 for an empty set.
 */
export function computeTimeframeDays(records: FailureRecord[]): number {
  if (records.length === 0) return 0;
  let minTs = records[0]!.timestamp;
  let maxTs = records[0]!.timestamp;
  for (let i = 1; i < records.length; i++) {
    const ts = records[i]!.timestamp;
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
  }
  const diffMs =
    new Date(maxTs).getTime() - new Date(minTs).getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Extract the most frequent keywords from a set of detail strings.
 *
 * Steps: join → tokenise (split on non-[a-zA-Z0-9]) → filter ≥4 chars →
 * lowercase → remove stop words → count frequency → sort (desc frequency,
 * alpha tie-break) → top 5.
 */
export function extractWords(details: string[]): string[] {
  const joined = details.join(" ");
  const tokens = joined.split(/[^a-zA-Z0-9]+/).filter((t) => t.length >= 4);
  const lowercased = tokens.map((t) => t.toLowerCase());

  const freq = new Map<string, number>();
  for (const w of lowercased) {
    if (!STOP_WORDS.has(w)) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }

  const sorted = [...freq.entries()].sort((a, b) => {
    const diff = b[1] - a[1];
    if (diff !== 0) return diff;
    return a[0].localeCompare(b[0]);
  });

  return sorted.slice(0, 5).map(([word]) => word);
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Compute a full failure analysis from a list of failure records.
 *
 * Groups records by failure type, builds per-type clusters, then aggregates
 * cross-cutting metrics (recurring file paths, timeframe, total).
 */
export function computeFailureAnalysis(
  records: FailureRecord[],
): FailureAnalysis {
  // ---------- Step 1: group by failureType ----------
  const groups = new Map<FailureType, FailureRecord[]>();
  for (const r of records) {
    const list = groups.get(r.failureType);
    if (list) {
      list.push(r);
    } else {
      groups.set(r.failureType, [r]);
    }
  }

  // ---------- Step 2: build clusters ----------
  const clusters: FailureCluster[] = [];

  for (const [failureType, groupRecords] of groups) {
    // recentTimestamp — max ISO 8601 string
    let recentTs = groupRecords[0]!.timestamp;
    for (let i = 1; i < groupRecords.length; i++) {
      const ts = groupRecords[i]!.timestamp;
      if (ts > recentTs) recentTs = ts;
    }

    // commonDetailKeywords
    const details = groupRecords.map((r) => r.detail);
    const commonDetailKeywords = extractWords(details);

    // commonFilePaths — collect, count, sort desc freq then alpha, top 5
    const fileFreq = new Map<string, number>();
    for (const r of groupRecords) {
      if (r.filePaths) {
        for (const fp of r.filePaths) {
          if (fp.length > 0) {
            fileFreq.set(fp, (fileFreq.get(fp) ?? 0) + 1);
          }
        }
      }
    }
    const commonFilePaths = [...fileFreq.entries()]
      .sort((a, b) => {
        const diff = b[1] - a[1];
        if (diff !== 0) return diff;
        return a[0].localeCompare(b[0]);
      })
      .slice(0, 5)
      .map(([fp]) => fp);

    // associatedPolicyIds — collect, dedupe, sort alpha
    const policySet = new Set<string>();
    for (const r of groupRecords) {
      if (r.policyIds) {
        for (const pid of r.policyIds) {
          if (pid.length > 0) policySet.add(pid);
        }
      }
    }
    const associatedPolicyIds = [...policySet].sort((a, b) =>
      a.localeCompare(b),
    );

    clusters.push({
      failureType,
      count: groupRecords.length,
      recentTimestamp: recentTs,
      commonDetailKeywords,
      commonFilePaths,
      associatedPolicyIds,
    });
  }

  // ---------- Step 3: sort clusters ----------
  clusters.sort((a, b) => {
    const diff = b.count - a.count;
    if (diff !== 0) return diff;
    return a.failureType.localeCompare(b.failureType);
  });

  // ---------- Step 4: dominantType ----------
  const dominantType = clusters[0]?.failureType ?? null;

  // ---------- Step 5: recurring file paths (across ALL records) ----------
  const allFileFreq = new Map<string, number>();
  for (const r of records) {
    if (r.filePaths) {
      for (const fp of r.filePaths) {
        if (fp.length > 0) {
          allFileFreq.set(fp, (allFileFreq.get(fp) ?? 0) + 1);
        }
      }
    }
  }
  const recurringFilePathCounts: Record<string, number> = {};
  const recurringFilePaths: string[] = [];

  const entries = [...allFileFreq.entries()].filter(([, count]) => count >= 2);
  entries.sort((a, b) => {
    const diff = b[1] - a[1];
    if (diff !== 0) return diff;
    return a[0].localeCompare(b[0]);
  });
  for (const [fp, count] of entries) {
    recurringFilePathCounts[fp] = count;
    recurringFilePaths.push(fp);
  }

  // ---------- Step 6: timeframeDays + total ----------
  const timeframeDays = computeTimeframeDays(records);
  const total = records.length;

  return {
    total,
    clusters,
    dominantType,
    recurringFilePaths,
    recurringFilePathCounts,
    timeframeDays,
  };
}
