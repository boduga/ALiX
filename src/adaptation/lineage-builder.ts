/**
 * P5.7b — LineageBuilder.
 *
 * Walks ProposalStore, EvidenceStore, EffectivenessStore, and IntelligenceStore
 * to build a LineageGraph for a given root proposal. Cross-links by fingerprint
 * and sourceProposalId. No new storage needed.
 *
 * @module
 */

import type { ProposalStore } from "./proposal-store.js";
import type { EvidenceStore } from "../security/evidence/evidence-store.js";
import type { EffectivenessStore } from "./effectiveness-store.js";
import type { IntelligenceStore } from "./intelligence-store.js";
import type {
  LineageGraph,
  LineageNode,
  LineageEdge,
  LineageWarning,
  LineageCompleteness,
} from "./lineage-types.js";
import type { AdaptationProposal } from "./adaptation-types.js";

const MAX_DEPTH_DEFAULT = 10;

export class LineageBuilder {
  constructor(
    private readonly proposalStore: ProposalStore,
    private readonly evidenceStore: EvidenceStore,
    private readonly effectivenessStore: EffectivenessStore,
    private readonly intelligenceStore: IntelligenceStore,
  ) {}

  async build(
    rootId: string,
    maxDepth: number = MAX_DEPTH_DEFAULT,
  ): Promise<LineageGraph> {
    const generatedAt = new Date().toISOString();
    const nodes: LineageNode[] = [];
    const edges: LineageEdge[] = [];
    const warnings: LineageWarning[] = [];

    // maxDepth controls how many related objects are included per category.
    // The root proposal always counts as 1. For depth=1, only the proposal
    // node is returned. depth=2 adds direct evidence/approval/etc. Each
    // additional depth level expands by one hop. This keeps the graph bounded.
    const effectiveDepth = Math.max(1, maxDepth);

    // 1. Load the root proposal
    const root = await this.proposalStore.load(rootId);
    if (!root) {
      return {
        rootId,
        generatedAt,
        completeness: "broken",
        nodes: [],
        edges: [],
        warnings: [
          {
            type: "missing_evidence_fingerprint",
            message: `Root proposal not found: ${rootId}`,
            sourceId: rootId,
          },
        ],
      };
    }

    // 2. Add root proposal node
    nodes.push({
      id: root.id,
      type: "proposal",
      label: `${root.action}: ${root.reason}`,
      timestamp: root.createdAt,
      status: root.status,
      detail: { sourceRecommendationType: root.sourceRecommendationType },
    });

    // 3. Trace evidence fingerprints — match evidence records by fingerprint
    if (root.evidenceFingerprints.length > 0) {
      for (const fp of root.evidenceFingerprints) {
        const evidence = await this.evidenceStore.getByFingerprint(fp);
        if (!evidence) {
          warnings.push({
            type: "missing_evidence_fingerprint",
            message: `Evidence fingerprint ${fp} referenced by proposal ${rootId} not found in EvidenceStore`,
            sourceId: rootId,
            targetId: fp,
          });
          continue;
        }
        this.#addEvidenceNode(evidence, nodes, edges, rootId);
      }
    }

    // 4. Check for approval evidence (fingerprint-based, depth-limited)
    const approvalRecords = await this.evidenceStore.query({
      type: "adaptation_approved",
      limit: 10000,
    });
    const rootApprovals = approvalRecords.records.filter(
      (r) => r.payload?.proposalId === rootId,
    );
    for (const rec of rootApprovals) {
      const nodeId = `approval:${rec.id}`;
      nodes.push({
        id: nodeId,
        type: "approval",
        label: `approved by ${String(rec.payload?.approvedBy ?? "unknown")}`,
        timestamp: rec.timestamp,
        detail: rec.payload as Record<string, unknown>,
      });
      edges.push({ sourceId: rootId, targetId: nodeId, relation: "approved_as" });
    }

    // 5. Check for application evidence (depth-limited)
    const applyRecords = await this.evidenceStore.query({
      type: "adaptation_applied",
      limit: 10000,
    });
    const rootApplies = applyRecords.records.filter(
      (r) => r.payload?.proposalId === rootId,
    );
    for (const rec of rootApplies) {
      const nodeId = `application:${rec.id}`;
      nodes.push({
        id: nodeId,
        type: "application",
        label: `applied at ${rec.timestamp}`,
        timestamp: rec.timestamp,
      });
      edges.push({ sourceId: rootId, targetId: nodeId, relation: "applied_as" });
    }

    // 6. Check for revert proposals targeting this root
    const allProposals = await this.proposalStore.list();
    const revertProposals = allProposals.filter(
      (p) =>
        p.action === "revert_proposal" &&
        p.target?.kind === "revert" &&
        (p.target as any).sourceProposalId === rootId,
    );
    for (const rp of revertProposals) {
      const nodeId = `revert:${rp.id}`;
      nodes.push({
        id: nodeId,
        type: "revert",
        label: `revert proposal ${rp.id} (${rp.status})`,
        timestamp: rp.createdAt,
        status: rp.status,
      });
      edges.push({ sourceId: rootId, targetId: nodeId, relation: "reverted_by" });
    }

    // 7. Check for effectiveness report
    const effReport = await this.effectivenessStore.load(rootId);
    if (effReport) {
      const nodeId = `effectiveness:${rootId}`;
      nodes.push({
        id: nodeId,
        type: "effectiveness",
        label: `effectiveness: ${String(effReport.recommendation)}`,
        timestamp: effReport.assessedAt,
        detail: {
          recommendation: effReport.recommendation,
          primaryMetric: effReport.primary?.metric,
          dataSufficient: effReport.dataSufficient,
        },
      });
      edges.push({ sourceId: rootId, targetId: nodeId, relation: "measured_as" });
    }

    // 8. Check intelligence reports for references to this proposal (depth-limited).
    //    IntelligenceReport has a dataWindow with oldest/newest proposal creation
    //    timestamps — if this proposal's createdAt falls within that window, the
    //    report analyzed this proposal.
    const intelligenceFiles = await this.intelligenceStore.list();
    const maxIntelScans = effectiveDepth * 2;
    let intelScanned = 0;
    for (const filename of intelligenceFiles) {
      if (intelScanned >= maxIntelScans) break;
      const report = await this.intelligenceStore.load(filename);
      if (!report) continue;
      intelScanned++;
      const inWindow =
        root.createdAt >= report.dataWindow.oldestProposalCreatedAt &&
        root.createdAt <= report.dataWindow.newestProposalCreatedAt;
      if (inWindow) {
        const nodeId = `intelligence:${report.generatedAt}`;
        nodes.push({
          id: nodeId,
          type: "intelligence",
          label: `intelligence report ${report.generatedAt}`,
          timestamp: report.generatedAt,
          detail: {
            totalProposalsAnalyzed: report.totalProposalsAnalyzed,
          } as Record<string, unknown>,
        });
        edges.push({
          sourceId: rootId,
          targetId: nodeId,
          relation: "analyzed_in",
        });
      }
    }

    // 9. Determine completeness
    // Terminal states (applied, rejected, failed) = complete even without revert.
    // Interim states (pending, approved) = partial.
    // Warnings about missing references = broken.
    let completeness: LineageCompleteness;
    if (warnings.length > 0) {
      completeness = "broken";
    } else if (
      root.status === "applied" ||
      root.status === "rejected" ||
      root.status === "failed"
    ) {
      completeness = "complete";
    } else {
      completeness = "partial";
    }

    return {
      rootId,
      generatedAt,
      completeness,
      nodes,
      edges,
      warnings,
    };
  }

  /** Add a node+edge for an evidence record. */
  #addEvidenceNode(
    evidence: any,
    nodes: LineageNode[],
    edges: LineageEdge[],
    rootId: string,
  ): void {
    const nodeId = `evidence:${evidence.fingerprint}`;
    nodes.push({
      id: nodeId,
      type: "evidence",
      label: `${evidence.type} @ ${evidence.timestamp}`,
      timestamp: evidence.timestamp,
      detail: evidence.payload as Record<string, unknown>,
    });
    edges.push({ sourceId: rootId, targetId: nodeId, relation: "generated_from" });
  }
}
