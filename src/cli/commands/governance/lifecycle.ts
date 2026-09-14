/**
 * P9.0f — `alix governance` CLI dispatcher + terminal renderers.
 *
 * Five subcommands, each consuming one or more P9 builders:
 *   - health  — buildGovernanceHealth + buildGovernanceAssessment
 *   - drift   — detectGovernanceDrift
 *   - lens-review — reviewLenses
 *   - integrity — buildGovernanceIntegrity
 *   - recommend — generateRecommendations (P9.1)
 *
 * Each subcommand stores its artifact via GovernanceStore.append() and renders
 * either ANSI-colored terminal output or raw JSON.
 *
 * CORE INVARIANT: this module NEVER writes any P8 store. It only calls P9
 * builders (which are read-only analysers) and GovernanceStore (the single
 * permitted P9 write target). Sentinel-enforced.
 *
 * @module
 */

import { join } from "node:path";
import "node:crypto";
import "../../../governance/governance-store.js";
import "../../../governance/investigation-store.js";
import "../../../governance/governance-recommendation-generator.js";
import "../../../governance/investigation-generator.js";
import "../../../governance/investigation-compat.js";
import "../governance-dashboard-handler.js";
// A8 T7 imports — learning CLI surface (4-adapter construction, per A8
// wayfinder map #517 locked ruling). Imports are dynamic-free at module
// scope to keep the seam file's load graph small.
import "../../../evolution/learning/learning-cli.js";
// A9 Slice 5 — pre-execution risk forecast CLI surface.
import "../../../evolution/forecast/forecast-cli.js";
import "../../../events/event-log.js";
import { BAR } from "./analytics.js";
import { BOLD, RESET, YELLOW } from "./shared.js";

// ---------------------------------------------------------------------------
// runGovernanceApprove — `alix governance approve <proposal-id> [--json]`
// ---------------------------------------------------------------------------

export async function runGovernanceApprove(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId) {
    console.error("Usage: alix governance approve <proposal-id> [--json]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { ApprovalGate } = await import("../../../adaptation/approval-gate.js");
  const { AdaptationProposalStore } = await import("../../../adaptation/adaptation-proposal-store.js");
  const { EvidenceEventWriter } = await import("../../../workflow/evidence-writer.js");
  const { EvidenceStore } = await import("../../../security/evidence/evidence-store.js");
  const { runGovernanceCriteria } = await import("../../../governance/governance-approval-criteria.js");

  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, ".alix", "evidence") });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const governanceCriteria = (proposal: any) => runGovernanceCriteria({ proposal, cwd });

  const gate = new ApprovalGate(
    new AdaptationProposalStore(proposalsDir),
    new EvidenceEventWriter((type, payload) => evidenceStore.append(type, payload)),
    governanceCriteria,
  );

  try {
    const updated = await gate.approve(proposalId, "operator");
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, proposalId, status: updated.status, approvedAt: updated.approvedAt }));
    } else {
      console.log(`Governance proposal approved.`);
      console.log(`  Proposal: ${proposalId}`);
      console.log(`  Status:   ${updated.status}`);
      console.log(`  Approved: ${updated.approvedAt}`);
      console.log(``);
      console.log(`Next step: apply via`);
      console.log(`  alix adaptation apply ${proposalId}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}


// ---------------------------------------------------------------------------
// runGovernanceReject — `alix governance reject <proposal-id> <reason> [--json]`
// ---------------------------------------------------------------------------

export async function runGovernanceReject(args: string[]): Promise<void> {
  const proposalId = args[0];
  const reason = args.slice(1).filter(a => !a.startsWith("--")).join(" ");
  if (!proposalId || !reason) {
    console.error("Usage: alix governance reject <proposal-id> <reason> [--json]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { ApprovalGate } = await import("../../../adaptation/approval-gate.js");
  const { AdaptationProposalStore } = await import("../../../adaptation/adaptation-proposal-store.js");
  const { EvidenceEventWriter } = await import("../../../workflow/evidence-writer.js");
  const { EvidenceStore } = await import("../../../security/evidence/evidence-store.js");

  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, ".alix", "evidence") });

  const gate = new ApprovalGate(
    new AdaptationProposalStore(proposalsDir),
    new EvidenceEventWriter((type, payload) => evidenceStore.append(type, payload)),
  );

  try {
    const updated = await gate.reject(proposalId, "operator", reason);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: true, proposalId, status: updated.status }));
    } else {
      console.log(`Governance proposal rejected.`);
      console.log(`  Proposal: ${proposalId}`);
      console.log(`  Status:   ${updated.status}`);
      console.log(`  Reason:   ${reason}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}


// ---------------------------------------------------------------------------
// runGovernanceList — `alix governance list [--orphaned] [--json]`
// ---------------------------------------------------------------------------

export async function runGovernanceList(args: string[]): Promise<void> {
  const showOrphaned = args.includes("--orphaned");
  const jsonMode = args.includes("--json");

  const { readdirSync, readFileSync, existsSync } = await import("node:fs");

  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allProposals: any[] = [];
  if (existsSync(proposalsDir)) {
    const files = readdirSync(proposalsDir).filter(f => f.endsWith(".json"));
    for (const f of files) {
      try {
        const parsed = JSON.parse(readFileSync(join(proposalsDir, f), "utf-8"));
        allProposals.push(parsed);
      } catch {
        // Skip corrupt files
      }
    }
  }

  const governanceProposals = allProposals.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p: any) => p.action === "governance_change",
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filtered = governanceProposals.filter((p: any) => {
    if (showOrphaned) return p.systemState?.orphaned === true && p.systemState?.cleaned !== true;
    return p.status === "pending" && !p.systemState?.orphaned;
  });

  if (jsonMode) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log(showOrphaned
      ? "No orphaned governance proposals."
      : "No pending governance proposals."
    );
    return;
  }

  console.log(BOLD + (showOrphaned ? "Orphaned Governance Proposals" : "Pending Governance Proposals") + RESET);
  console.log(BAR);
  for (const p of filtered) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = p.target as any;
    console.log(`  ${p.id}`);
    console.log(`    Action: ${p.action}`);
    console.log(`    Recommendation: ${target.recommendationId ?? "—"}`);
    console.log(`    Confidence: ${p.sourceConfidence}`);
    if (p.systemState?.orphaned) {
      console.log(`    Orphaned: ${p.systemState.reason}`);
    }
    console.log("");
  }
}


// ---------------------------------------------------------------------------
// runGovernanceCleanup — `alix governance cleanup <proposal-id> [--json]`
// ---------------------------------------------------------------------------

export async function runGovernanceCleanup(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId) {
    console.error("Usage: alix governance cleanup <proposal-id> [--json]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { AdaptationProposalStore } = await import("../../../adaptation/adaptation-proposal-store.js");
  const { EvidenceEventWriter } = await import("../../../workflow/evidence-writer.js");
  const { EvidenceStore } = await import("../../../security/evidence/evidence-store.js");

  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");
  const store = new AdaptationProposalStore(proposalsDir);

  const existing = await store.load(proposalId);
  if (!existing) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Proposal not found: ${proposalId}` }));
    } else {
      console.error(`Proposal not found: ${proposalId}`);
    }
    process.exit(1);
  }

  if (existing.action !== "governance_change") {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Not governance proposal: ${proposalId} (action="${existing.action}")` }));
    } else {
      console.error(`Not governance proposal: ${proposalId} (action="${existing.action}")`);
    }
    process.exit(1);
  }

  if (!existing.systemState?.orphaned) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Proposal ${proposalId} is not orphaned` }));
    } else {
      console.error(`Proposal ${proposalId} is not orphaned. Only orphaned proposals may be cleaned up.`);
    }
    process.exit(1);
  }

  if (existing.systemState?.cleaned === true) {
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, error: `Proposal ${proposalId} is already cleaned` }));
    } else {
      console.error(`Proposal ${proposalId} is already cleaned. No action taken.`);
    }
    process.exit(1);
  }

  // Tombstone: mark systemState.cleaned = true (file stays on disk)
  await store.update(proposalId, {
    systemState: { ...existing.systemState, cleaned: true },
  });

  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, ".alix", "evidence") });
  const writer = new EvidenceEventWriter((type, payload) => evidenceStore.append(type, payload));
  await writer.recordGovernanceOrphanCleaned(proposalId, {
    reason: "Operator cleanup",
  });

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, proposalId, cleaned: true }));
  } else {
    console.log(`Orphaned governance proposal cleaned up.`);
    console.log(`  Proposal: ${proposalId}`);
    console.log(`  File retained for audit.`);
  }
}


// ---------------------------------------------------------------------------
// runGovernanceExplain — `alix governance explain <proposal-id> [--json]`
// ---------------------------------------------------------------------------

export async function runGovernanceExplain(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId) {
    console.error("Usage: alix governance explain <proposal-id> [--json]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { assembleProposalExplanation } = await import("../../../explain/proposal-explanation-assembler.js");
  const { EvidenceStore } = await import("../../../security/evidence/evidence-store.js");

  const cwd = process.cwd();
  const explanation = await assembleProposalExplanation({
    proposalId,
    cwd,
    windowDays: 90,
    executionEvidence: [],
    executionLineageRefs: [],
  });

  // Query evidence events for governance approval history
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, ".alix", "evidence") });
  const allRecords = await evidenceStore.query().catch(() => ({ records: [], total: 0, truncated: false }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const denialRecords = (allRecords.records as any[])
    .filter((r: any) =>
      r.type === "governance_approval_denied" && r.payload?.proposalId === proposalId,
    )
    .sort(
      (a: any, b: any) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decisionRecords = (allRecords.records as any[]).filter(
    (r: any) =>
      r.type === "governance_approval_decision" && r.payload?.proposalId === proposalId,
  );

  if (jsonMode) {
    console.log(JSON.stringify({
      explanation,
      approvalHistory: {
        denied: denialRecords.length,
        decisions: decisionRecords.length,
        lastDenial: denialRecords[0] ?? null,
      },
    }, null, 2));
    return;
  }

  // Render standard explanation summary
  const integ = explanation.explanationIntegrity;
  console.log(BOLD + "Governance Proposal Explanation" + RESET);
  console.log(`Proposal: ${proposalId}`);
  console.log(`Generated: ${explanation.generatedAt}`);
  console.log(BAR);
  console.log(`Layers Available: ${integ.layersAvailable}/${integ.totalLayers}`);
  console.log(`Evidence Chain: ${integ.evidenceChainUsed ? "✅ yes" : "❌ no"}`);
  console.log(`Completeness: ${integ.completenessPercent}%`);
  if (integ.incompleteChainLayers > 0) {
    console.log(`${YELLOW}Incomplete Chain Layers: ${integ.incompleteChainLayers}${RESET}`);
  }

  // Render approval attempt history
  console.log("");
  console.log(BOLD + "Approval Attempt History" + RESET);
  console.log(`Denials: ${denialRecords.length}`);
  console.log(`Decisions: ${decisionRecords.length}`);
  if (denialRecords.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last: any = denialRecords[0];
    console.log(`Last Denial: ${last.timestamp}`);
    if (last.payload?.criterion) {
      console.log(`  Criterion: ${last.payload.criterion}`);
    }
  }
}
