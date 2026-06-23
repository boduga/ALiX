import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GovernanceStore } from "../../src/governance/governance-store.js";
import { ProposalStore } from "../../src/adaptation/proposal-store.js";
import { EvidenceChainStore } from "../../src/learning/evidence-chain-store.js";
import { createGovernanceProposal } from "../../src/governance/governance-proposal-generator.js";

describe("createGovernanceProposal", () => {
  let tempRoot: string;
  let govStore: GovernanceStore;
  let propStore: ProposalStore;
  let chainStore: EvidenceChainStore;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "gov-proposal-"));
    govStore = new GovernanceStore(join(tempRoot, ".alix", "governance"));
    propStore = new ProposalStore(join(tempRoot, ".alix", "adaptation", "proposals"));
    chainStore = new EvidenceChainStore(join(tempRoot, ".alix", "learning"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("creates one pending proposal from an open, high-confidence, non-low-priority recommendation", async () => {
    await govStore.append("recommendations", {
      id: "report-1",
      subject: "Test",
      outcome: "computed",
      confidence: 0.85,
      reasons: ["drift detected"],
      generatedAt: "2026-06-23T00:00:00.000Z",
      reportType: "governance_recommendation",
      recommendations: [{
        id: "rec-a",
        source: "drift",
        sourceArtifactId: "drift-1",
        priority: "high",
        confidence: 0.85,
        status: "open",
        category: "chain_restoration",
        title: "Restore chain for drift-1",
        description: "Provenance rate 45%",
        evidenceRefs: ["drift-1"],
        operatorGuidance: "Investigate",
        expectedBenefit: "Higher coverage",
        risks: [],
        metadata: {
          category: "chain_restoration",
          targetArtifactId: "drift-1",
          currentRate: 45,
          targetRate: 80
        }
      }],
      evidenceRefs: ["drift-1"]
    } as any);

    const result = await createGovernanceProposal({
      recommendationId: "rec-a",
      proposalStore: propStore,
      chainStore: chainStore,
      govStore: govStore,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposalId).toMatch(/^prop-/);

    const all = await propStore.list();
    const created = all.find((p) => p.id === result.proposalId);
    expect(created).toBeDefined();
    expect(created?.action).toBe("governance_change");
    expect(created?.status).toBe("pending");
    expect((created?.target as any).kind).toBe("governance");
    expect((created?.target as any).recommendationId).toBe("rec-a");
    expect((created?.payload as any).kind).toBe("chain_restoration");
    expect((created?.payload as any).targetArtifactId).toBe("drift-1");
    expect((created?.payload as any).currentRate).toBe(45);
    expect((created?.payload as any).targetRate).toBe(80);
    expect((created?.payload as any)._provenance.parentRecommendationId).toBe("rec-a");
    expect((created?.payload as any)._provenance.parentRecommendationReportId).toBe("report-1");
    expect((created?.payload as any)._provenance.recommendationCategory).toBe("chain_restoration");
    expect(created?.sourceRecommendationType).toBe("governance_recommendation");
    expect(created?.sourceConfidence).toBe(0.85);
    expect(created?.evidenceFingerprints).toContain("rec-a");
    expect(created?.provenance).toBe("manual");
  });

  it("rejects with reason when confidence is below threshold", async () => {
    await govStore.append("recommendations", {
      id: "report-low-conf", subject: "T", outcome: "c", confidence: 0.4, reasons: [],
      generatedAt: "2026-06-23T00:00:00.000Z", reportType: "governance_recommendation",
      recommendations: [{
        id: "rec-low-conf", source: "drift", sourceArtifactId: "d", priority: "high",
        confidence: 0.4, status: "open", category: "chain_restoration", title: "T", description: "T",
        evidenceRefs: [], operatorGuidance: "T", expectedBenefit: "T", risks: [],
        metadata: { category: "chain_restoration", targetArtifactId: "d", currentRate: 30, targetRate: 80 }
      }], evidenceRefs: []
    } as any);
    const result = await createGovernanceProposal({ recommendationId: "rec-low-conf", govStore, proposalStore: propStore, chainStore });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/confidence 0\.40 is below threshold 0\.60/);
  });

  it("rejects with reason when status is not open", async () => {
    await govStore.append("recommendations", {
      id: "report-dismissed", subject: "T", outcome: "c", confidence: 0.9, reasons: [],
      generatedAt: "2026-06-23T00:00:00.000Z", reportType: "governance_recommendation",
      recommendations: [{
        id: "rec-dismissed", source: "drift", sourceArtifactId: "d", priority: "high",
        confidence: 0.9, status: "dismissed", category: "chain_restoration", title: "T", description: "T",
        evidenceRefs: [], operatorGuidance: "T", expectedBenefit: "T", risks: [],
        metadata: { category: "chain_restoration", targetArtifactId: "d", currentRate: 30, targetRate: 80 }
      }], evidenceRefs: []
    } as any);
    const result = await createGovernanceProposal({ recommendationId: "rec-dismissed", govStore, proposalStore: propStore, chainStore });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/status "dismissed" is not eligible/);
  });

  it("rejects with reason when priority is low", async () => {
    await govStore.append("recommendations", {
      id: "report-low-pri", subject: "T", outcome: "c", confidence: 0.9, reasons: [],
      generatedAt: "2026-06-23T00:00:00.000Z", reportType: "governance_recommendation",
      recommendations: [{
        id: "rec-low-pri", source: "drift", sourceArtifactId: "d", priority: "low",
        confidence: 0.9, status: "open", category: "chain_restoration", title: "T", description: "T",
        evidenceRefs: [], operatorGuidance: "T", expectedBenefit: "T", risks: [],
        metadata: { category: "chain_restoration", targetArtifactId: "d", currentRate: 50, targetRate: 80 }
      }], evidenceRefs: []
    } as any);
    const result = await createGovernanceProposal({ recommendationId: "rec-low-pri", govStore, proposalStore: propStore, chainStore });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/priority.*"low".*not eligible/);
  });

  it("refuses duplicate (idempotency)", async () => {
    await govStore.append("recommendations", {
      id: "report-dup", subject: "T", outcome: "c", confidence: 0.9, reasons: [],
      generatedAt: "2026-06-23T00:00:00.000Z", reportType: "governance_recommendation",
      recommendations: [{
        id: "rec-dup", source: "drift", sourceArtifactId: "d", priority: "high",
        confidence: 0.9, status: "open", category: "chain_restoration", title: "T", description: "T",
        evidenceRefs: [], operatorGuidance: "T", expectedBenefit: "T", risks: [],
        metadata: { category: "chain_restoration", targetArtifactId: "d", currentRate: 30, targetRate: 80 }
      }], evidenceRefs: []
    } as any);
    const first = await createGovernanceProposal({ recommendationId: "rec-dup", govStore, proposalStore: propStore, chainStore });
    expect(first.ok).toBe(true);
    const second = await createGovernanceProposal({ recommendationId: "rec-dup", govStore, proposalStore: propStore, chainStore });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toMatch(/has already been proposed as/);
  });

  it("returns not-found when inner recommendation does not exist", async () => {
    const result = await createGovernanceProposal({ recommendationId: "does-not-exist", govStore, proposalStore: propStore, chainStore });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/Recommendation not found: does-not-exist/);
  });
});
