/**
 * P9.6 — Investigation compatibility adapter.
 *
 * Provides a unified investigation queue by merging:
 *   1. Native InvestigationRecommendation records from InvestigationStore
 *   2. Legacy GovernanceRecommendation records with investigation categories
 *      (chain_restoration, governance_integrity) from GovernanceStore
 *
 * Read-only — never mutates GovernanceStore or writes to investigations.jsonl.
 *
 * @module
 */

import { InvestigationStore } from "./investigation-store.js";
import { GovernanceStore } from "./governance-store.js";
import type {
  InvestigationRecommendation,
  InvestigationKind,
  InvestigationFilter,
} from "./investigation-types.js";
import type { Recommendation } from "./governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INVESTIGATION_CATEGORIES = new Set(["chain_restoration", "governance_integrity"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapCategoryToKind(category: string): InvestigationKind | null {
  if (category === "chain_restoration") return "chain_restoration";
  if (category === "governance_integrity") return "governance_integrity";
  return null;
}

function mapLegacySeverity(rec: Recommendation): "low" | "medium" | "high" | "critical" {
  if (rec.priority === "critical" || rec.priority === "high") return rec.priority;
  if (rec.priority === "medium") return "medium";
  return "low";
}

function legacyToInvestigation(
  rec: Recommendation,
  parentReportId: string,
  parentGeneratedAt: string,
): InvestigationRecommendation | null {
  const kind = mapCategoryToKind(rec.category);
  if (!kind) return null;

  return {
    id: `legacy-investigation-${rec.id}`,
    kind,
    status: mapLegacyStatus(rec.status),
    severity: mapLegacySeverity(rec),
    source: rec.source === "health" ? "health" : rec.source === "drift" ? "drift" : "integrity",
    sourceArtifactId: rec.sourceArtifactId,
    evidenceRefs: [...rec.evidenceRefs],
    title: rec.title,
    description: rec.description,
    operatorGuidance: rec.operatorGuidance,
    createdAt: parentGeneratedAt,
    legacySource: {
      store: "governance",
      recommendationId: rec.id,
      parentReportId,
    },
  };
}

function mapLegacyStatus(status: string): "open" | "in_progress" | "resolved" | "dismissed" {
  if (status === "acknowledged") return "in_progress";
  if (status === "dismissed") return "dismissed";
  return "open";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a unified, deduplicated list of InvestigationRecommendations from
 * both native InvestigationStore records and legacy GovernanceStore records.
 *
 * Dedupe rule: a legacy record is skipped if a native InvestigationRecommendation
 * already exists with the same `sourceArtifactId` and `kind`.
 *
 * Results are sorted by createdAt descending (newest first).
 */
export async function listCompatibleInvestigations(
  governanceStore: GovernanceStore,
  investigationStore: InvestigationStore,
  filter?: InvestigationFilter,
): Promise<InvestigationRecommendation[]> {
  // 1. Load native records
  const native = await investigationStore.list(filter);

  // 2. Build dedupe set from native records: sourceArtifactId + kind
  const dedupeKeys = new Set<string>();
  for (const n of native) {
    dedupeKeys.add(`${n.sourceArtifactId}::${n.kind}`);
  }

  // 3. Load legacy GovernanceStore records
  const allReports = await governanceStore.list("recommendations");
  const legacy: InvestigationRecommendation[] = [];

  for (const report of allReports) {
    for (const rec of report.recommendations) {
      if (!INVESTIGATION_CATEGORIES.has(rec.category)) continue;

      const kind = mapCategoryToKind(rec.category);
      if (!kind) continue;

      // Dedupe: skip if a native record already covers this source + kind
      const dedupeKey = `${rec.sourceArtifactId}::${kind}`;
      if (dedupeKeys.has(dedupeKey)) continue;

      const wrapped = legacyToInvestigation(rec, report.id, report.generatedAt);
      if (wrapped) {
        legacy.push(wrapped);
      }
    }
  }

  // 4. Merge, sort by createdAt descending
  const merged = [...native, ...legacy];
  merged.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return merged;
}
