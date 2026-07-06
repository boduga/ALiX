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
import { GovernanceStore } from "../../governance/governance-store.js";
import { InvestigationStore } from "../../governance/investigation-store.js";
import { generateRecommendations } from "../../governance/governance-recommendation-generator.js";
import { generateInvestigations } from "../../governance/investigation-generator.js";
import { listCompatibleInvestigations } from "../../governance/investigation-compat.js";
import { runDashboard } from "./governance-dashboard-handler.js";
import type {
  GovernanceHealthReport,
  GovernanceAssessment,
  GovernanceDriftReport,
  LensLifecycleReview,
  GovernanceIntegrityReport,
  Recommendation,
} from "../../governance/governance-types.js";
import type { InvestigationRecommendation } from "../../governance/investigation-types.js";
import type {
  LedgerAnalytics,
  PeriodRollup,
} from "../../governance/ledger-analytics.js";
import { type FailureAnalysis, failureSeverityForType } from "../../governance/failure-clustering.js";
import type { PolicySuggestion } from "../../governance/policy-suggestions.js";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

function colorForSeverity(severity: string): string {
  switch (severity) {
    case "critical":
    case "high":
      return RED;
    case "medium":
      return YELLOW;
    case "low":
      return GREEN;
    default:
      return RESET;
  }
}

function colorForRecommendation(rec: string): string {
  switch (rec) {
    case "retire":
      return RED;
    case "demote":
      return YELLOW;
    case "promote":
      return GREEN;
    case "keep":
      return CYAN;
    default:
      return RESET;
  }
}

function colorForRate(rate: number): string {
  if (rate >= 80) return GREEN;
  if (rate >= 50) return YELLOW;
  return RED;
}

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

interface ParsedOpts {
  windowDays: number;
  jsonMode: boolean;
}

function parseFlags(args: string[]): ParsedOpts {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowDays = 90;

  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a value (positive integer)");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  return { windowDays, jsonMode };
}

const VALID_PRIORITIES = ["low", "medium", "high", "critical"] as const;
const VALID_SOURCES = ["health", "drift", "lens-review", "integrity"] as const;

interface ParsedRecommendOpts {
  windowDays: number;
  jsonMode: boolean;
  priority: (typeof VALID_PRIORITIES)[number] | null;
  source: (typeof VALID_SOURCES)[number] | null;
}

function parseRecommendFlags(args: string[]): ParsedRecommendOpts {
  const jsonMode = args.includes("--json");

  const windowIdx = args.indexOf("--window");
  let windowDays = 30;
  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a value (positive integer)");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  let priority: ParsedRecommendOpts["priority"] = null;
  const priorityIdx = args.indexOf("--priority");
  if (priorityIdx !== -1) {
    if (priorityIdx + 1 >= args.length) {
      console.error("Error: --priority requires a value (low|medium|high|critical)");
      process.exit(1);
    }
    const v = args[priorityIdx + 1];
    if (!(VALID_PRIORITIES as readonly string[]).includes(v)) {
      console.error(
        `Error: --priority must be one of: ${VALID_PRIORITIES.join(", ")}`,
      );
      process.exit(1);
    }
    priority = v as ParsedRecommendOpts["priority"];
  }

  let source: ParsedRecommendOpts["source"] = null;
  const sourceIdx = args.indexOf("--source");
  if (sourceIdx !== -1) {
    if (sourceIdx + 1 >= args.length) {
      console.error("Error: --source requires a value (health|drift|lens-review|integrity)");
      process.exit(1);
    }
    const v = args[sourceIdx + 1];
    if (!(VALID_SOURCES as readonly string[]).includes(v)) {
      console.error(
        `Error: --source must be one of: ${VALID_SOURCES.join(", ")}`,
      );
      process.exit(1);
    }
    source = v as ParsedRecommendOpts["source"];
  }

  return { windowDays, jsonMode, priority, source };
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export async function handleGovernanceCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case "health":
      return runHealth(rest);
    case "drift":
      return runDrift(rest);
    case "lens-review":
      return runLensReview(rest);
    case "policies": {
      const { DEFAULT_GOVERNANCE_POLICIES } = await import("../../governance/autonomous-policy.js");
      console.log(`P12.1 Autonomous Governance Policies (${DEFAULT_GOVERNANCE_POLICIES.length}):\n`);
      for (const p of DEFAULT_GOVERNANCE_POLICIES) {
        const icon = p.decision === "deny" ? "🔴" : p.decision === "ask" ? "🟡" : "🟢";
        const parts: string[] = [];
        for (const [k, v] of Object.entries(p.match)) {
          if (v !== undefined && Array.isArray(v) && v.length > 0) {
            parts.push(`  ${k}: ${v.join(", ")}`);
          }
        }
        console.log(`${icon} [${p.decision}] ${p.id}`);
        console.log(`   ${p.description}`);
        if (parts.length) console.log(parts.join("\n"));
        if (p.approvalRole) console.log(`   approvalRole: ${p.approvalRole}`);
        console.log();
      }
      return;
    }
    case "integrity":
      return runIntegrity(rest);
    case "recommend":
      return runRecommend(rest);
    case "risk-score": {
      const { riskScoreCLI } = await import("../../governance/risk-scoring.js");
      riskScoreCLI(args.slice(1));
      return;
    }
    case "approval": {
      const { approvalCLI } = await import("../../governance/approval-workflow.js");
      approvalCLI(rest);
      return;
    }
    case "analytics":
      return runAnalytics(rest);
    case "failure-analysis":
      return runFailureAnalysis(rest);
    case "policy-suggestions":
      return runPolicySuggestions(rest);
    case "propose": {
      const recommendationId = rest[0];
      if (!recommendationId) {
        console.error("Usage: alix governance propose <recommendation-id>");
        process.exit(2);
      }
      const json = rest.includes("--json");
      const { createGovernanceProposal } = await import("../../governance/governance-proposal-generator.js");
      const result = await createGovernanceProposal({ recommendationId });
      if (!result.ok) {
        if (json) {
          console.log(JSON.stringify({ ok: false, reason: result.reason }));
        } else {
          console.error(result.reason);
        }
        process.exit(1);
      }
      if (json) {
        console.log(JSON.stringify({ ok: true, proposalId: result.proposalId, recommendationId }));
      } else {
        console.log(`Governance proposal created.`);
        console.log(`  Proposal:        ${result.proposalId}`);
        console.log(`  Recommendation:  ${recommendationId}`);
        console.log(``);
        console.log(`Review and approve:`);
        console.log(`  alix governance explain ${result.proposalId}`);
        console.log(`  alix adaptation approve ${result.proposalId}`);
      }
      return;
    }
    case "approve":
      return runGovernanceApprove(rest);
    case "reject":
      return runGovernanceReject(rest);
    case "list":
      return runGovernanceList(rest);
    case "cleanup":
      return runGovernanceCleanup(rest);
    case "explain":
      return runGovernanceExplain(rest);
    case "dashboard":
      return runDashboard(rest);
    case "investigate":
      return runInvestigate(rest);
    default:
      console.error(
        `Unknown governance subcommand: "${subcommand ?? ""}"`,
      );
      console.error(
        "Usage: alix governance {health|drift|lens-review|integrity|policies|recommend|analytics|failure-analysis|policy-suggestions|propose|approve|reject|list|cleanup|explain|dashboard|investigate} [--window <days>] [--json]",
      );
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// runHealth — `alix governance health [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runHealth(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  // Dynamic import the builders (as specified by the plan)
  const { buildGovernanceHealth } = await import(
    "../../governance/governance-health-builder.js"
  );
  const { buildGovernanceAssessment } = await import(
    "../../governance/governance-assessment.js"
  );

  const report = await buildGovernanceHealth({ cwd, windowDays });
  await store.append("health", report);

  const assessment = buildGovernanceAssessment(report);
  await store.append("assessment", assessment);

  if (jsonMode) {
    console.log(
      JSON.stringify({ health: report, assessment }, null, 2),
    );
    return;
  }

  renderHealth(report);
  console.log("");
  renderAssessment(assessment);
}

// ---------------------------------------------------------------------------
// runDrift — `alix governance drift [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runDrift(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  const { detectGovernanceDrift } = await import(
    "../../governance/governance-drift-detector.js"
  );

  const report = await detectGovernanceDrift({ cwd, windowDays });
  await store.append("drift", report);

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  renderDrift(report);
}

// ---------------------------------------------------------------------------
// runLensReview — `alix governance lens-review [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runLensReview(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  const { reviewLenses } = await import(
    "../../governance/governance-lens-review.js"
  );

  const review = await reviewLenses({ cwd, windowDays });
  await store.append("lensReviews", review);

  if (jsonMode) {
    console.log(JSON.stringify(review, null, 2));
    return;
  }

  renderLensReview(review);
}

// ---------------------------------------------------------------------------
// runIntegrity — `alix governance integrity [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runIntegrity(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const cwd = process.cwd();
  const store = new GovernanceStore();

  const { buildGovernanceIntegrity } = await import(
    "../../governance/governance-integrity.js"
  );

  const report = await buildGovernanceIntegrity({ cwd, windowDays });
  await store.append("integrity", report);

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  renderIntegrity(report);
}

// ---------------------------------------------------------------------------
// runRecommend — `alix governance recommend [--window <days>] [--json]
//                            [--priority <level>] [--source <source>]`
// ---------------------------------------------------------------------------

async function runRecommend(args: string[]): Promise<void> {
  const { windowDays, jsonMode, priority, source } = parseRecommendFlags(args);
  const cwd = process.cwd();
  const generatedAt = new Date().toISOString();

  const artifact = await generateRecommendations({ cwd, windowDays, generatedAt });

  let recs: Recommendation[] = artifact.recommendations;
  if (priority) {
    recs = recs.filter((r) => r.priority === priority);
  }
  if (source) {
    recs = recs.filter((r) => r.source === source);
  }

  if (jsonMode) {
    console.log(JSON.stringify(recs, null, 2));
    return;
  }

  renderRecommendations(artifact.id, recs, generatedAt);
}

// ---------------------------------------------------------------------------
// runGovernanceApprove — `alix governance approve <proposal-id> [--json]`
// ---------------------------------------------------------------------------

async function runGovernanceApprove(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId) {
    console.error("Usage: alix governance approve <proposal-id> [--json]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { ApprovalGate } = await import("../../adaptation/approval-gate.js");
  const { ProposalStore } = await import("../../adaptation/proposal-store.js");
  const { EvidenceEventWriter } = await import("../../workflow/evidence-writer.js");
  const { EvidenceStore } = await import("../../security/evidence/evidence-store.js");
  const { runGovernanceCriteria } = await import("../../governance/governance-approval-criteria.js");

  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, ".alix", "evidence") });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const governanceCriteria = (proposal: any) => runGovernanceCriteria({ proposal, cwd });

  const gate = new ApprovalGate(
    new ProposalStore(proposalsDir),
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

async function runGovernanceReject(args: string[]): Promise<void> {
  const proposalId = args[0];
  const reason = args.slice(1).filter(a => !a.startsWith("--")).join(" ");
  if (!proposalId || !reason) {
    console.error("Usage: alix governance reject <proposal-id> <reason> [--json]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { ApprovalGate } = await import("../../adaptation/approval-gate.js");
  const { ProposalStore } = await import("../../adaptation/proposal-store.js");
  const { EvidenceEventWriter } = await import("../../workflow/evidence-writer.js");
  const { EvidenceStore } = await import("../../security/evidence/evidence-store.js");

  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, ".alix", "evidence") });

  const gate = new ApprovalGate(
    new ProposalStore(proposalsDir),
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

async function runGovernanceList(args: string[]): Promise<void> {
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

async function runGovernanceCleanup(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId) {
    console.error("Usage: alix governance cleanup <proposal-id> [--json]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { ProposalStore } = await import("../../adaptation/proposal-store.js");
  const { EvidenceEventWriter } = await import("../../workflow/evidence-writer.js");
  const { EvidenceStore } = await import("../../security/evidence/evidence-store.js");

  const cwd = process.cwd();
  const proposalsDir = join(cwd, ".alix", "adaptation", "proposals");
  const store = new ProposalStore(proposalsDir);

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

async function runGovernanceExplain(args: string[]): Promise<void> {
  const proposalId = args[0];
  if (!proposalId) {
    console.error("Usage: alix governance explain <proposal-id> [--json]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const { assembleProposalExplanation } = await import("../../explain/proposal-explanation-assembler.js");
  const { EvidenceStore } = await import("../../security/evidence/evidence-store.js");

  const cwd = process.cwd();
  const explanation = await assembleProposalExplanation({
    proposalId,
    cwd,
    windowDays: 90,
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

// ---------------------------------------------------------------------------
// runInvestigate — `alix governance investigate <subcommand> [args]`
// ---------------------------------------------------------------------------

async function runInvestigate(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "list":
      return runInvestigateList(args.slice(1));
    case "show":
      return runInvestigateShow(args.slice(1));
    case "update":
      return runInvestigateUpdate(args.slice(1));
    case "generate":
      return runInvestigateGenerate(args.slice(1));
    default:
      console.error(
        `Usage: alix governance investigate {list|show|update|generate} [options]`,
      );
      process.exit(2);
  }
}

async function runInvestigateList(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const kindIdx = args.indexOf("--kind");
  let kind: "chain_restoration" | "governance_integrity" | undefined;
  if (kindIdx !== -1 && kindIdx + 1 < args.length) {
    const v = args[kindIdx + 1];
    if (v !== "chain_restoration" && v !== "governance_integrity") {
      console.error("Error: --kind must be 'chain_restoration' or 'governance_integrity'");
      process.exit(1);
    }
    kind = v;
  }

  const store = new GovernanceStore();
  const invStore = new InvestigationStore();

  const investigations = await listCompatibleInvestigations(
    store,
    invStore,
    kind ? { kind } : undefined,
  );

  if (jsonMode) {
    console.log(JSON.stringify(investigations, null, 2));
    return;
  }

  if (investigations.length === 0) {
    console.log(BOLD + "Investigations" + RESET);
    console.log(BAR);
    console.log(DIM + "  No investigations found." + RESET);
    return;
  }

  const resolvedCount = investigations.filter((i) => i.status === "resolved" || i.status === "dismissed").length;
  const openCount = investigations.length - resolvedCount;

  console.log(BOLD + `Investigations (${openCount} open, ${resolvedCount} resolved)` + RESET);
  console.log(BAR);

  for (const inv of investigations) {
    const statusIcon = inv.status === "open" ? "○" : inv.status === "in_progress" ? "◐" : inv.status === "resolved" ? "✓" : "✗";
    const severityColor = inv.severity === "critical" || inv.severity === "high" ? RED : inv.severity === "medium" ? YELLOW : GREEN;

    console.log(
      `  ${statusIcon} ${severityColor}[${inv.severity.toUpperCase()}]${RESET}` +
      ` ${inv.kind.replace("_", " ")}` +
      (inv.legacySource ? DIM + " (legacy)" + RESET : ""),
    );
    console.log(`    ${CYAN}${inv.id}${RESET}`);
    console.log(`    ${inv.title}`);
    console.log(`    ${DIM}Status: ${inv.status} | Source: ${inv.source}${RESET}`);
    if (inv.assignedTo) {
      console.log(`    ${DIM}Assigned: ${inv.assignedTo}${RESET}`);
    }
    console.log("");
  }
}

async function runInvestigateShow(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix governance investigate show <investigation-id>");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const invStore = new InvestigationStore();
  const native = await invStore.get(id);

  if (!native) {
    const store = new GovernanceStore();
    const all = await listCompatibleInvestigations(store, invStore);
    const found = all.find((i) => i.id === id);
    if (!found) {
      console.error(`Investigation not found: ${id}`);
      process.exit(1);
    }
    if (jsonMode) {
      console.log(JSON.stringify(found, null, 2));
    } else {
      renderInvestigationDetail(found);
    }
    return;
  }

  if (jsonMode) {
    console.log(JSON.stringify(native, null, 2));
  } else {
    renderInvestigationDetail(native);
  }
}

function renderInvestigationDetail(inv: InvestigationRecommendation): void {
  console.log(BOLD + `Investigation: ${inv.id}` + RESET);
  console.log(BAR);
  console.log(`  Kind:       ${inv.kind}`);
  console.log(`  Status:     ${inv.status}`);
  console.log(`  Severity:   ${inv.severity}`);
  console.log(`  Source:     ${inv.source}`);
  console.log(`  Created:    ${inv.createdAt}`);
  if (inv.updatedAt) console.log(`  Updated:    ${inv.updatedAt}`);
  if (inv.assignedTo) console.log(`  Assigned:   ${inv.assignedTo}`);
  if (inv.resolvedAt) console.log(`  Resolved:   ${inv.resolvedAt}`);
  if (inv.resolution) console.log(`  Resolution: ${inv.resolution}`);
  console.log("");
  console.log(BOLD + "  Description" + RESET);
  console.log(`  ${inv.description}`);
  console.log("");
  console.log(BOLD + "  Operator Guidance" + RESET);
  console.log(`  ${inv.operatorGuidance}`);
  if (inv.legacySource) {
    console.log("");
    console.log(DIM + "  Legacy Source" + RESET);
    console.log(`  Store:              ${inv.legacySource.store}`);
    console.log(`  Recommendation:     ${inv.legacySource.recommendationId}`);
    console.log(`  Parent Report:      ${inv.legacySource.parentReportId}`);
  }
}

async function runInvestigateUpdate(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error("Usage: alix governance investigate update <id> [--status <status>] [--assign <user>] [--resolution <text>]");
    process.exit(2);
  }
  const jsonMode = args.includes("--json");

  const statusIdx = args.indexOf("--status");
  let status: "open" | "in_progress" | "resolved" | "dismissed" | undefined;
  if (statusIdx !== -1 && statusIdx + 1 < args.length) {
    const v = args[statusIdx + 1];
    if (!["open", "in_progress", "resolved", "dismissed"].includes(v)) {
      console.error("Error: --status must be one of: open, in_progress, resolved, dismissed");
      process.exit(1);
    }
    status = v as typeof status;
  }

  const assignIdx = args.indexOf("--assign");
  let assignedTo: string | undefined;
  if (assignIdx !== -1 && assignIdx + 1 < args.length) {
    assignedTo = args[assignIdx + 1];
  }

  const resolutionIdx = args.indexOf("--resolution");
  let resolution: string | undefined;
  if (resolutionIdx !== -1 && resolutionIdx + 1 < args.length) {
    resolution = args[resolutionIdx + 1];
  }

  const invStore = new InvestigationStore();

  if (!status && !assignedTo) {
    console.error("Error: provide at least --status or --assign");
    process.exit(1);
  }

  if (status) {
    await invStore.updateStatus(id, status, { resolution, assignedTo });
  } else if (assignedTo) {
    const existing = await invStore.get(id);
    if (!existing) {
      console.error(`Investigation not found: ${id}`);
      process.exit(1);
    }
    await invStore.updateStatus(id, existing.status, { assignedTo });
  }

  if (jsonMode) {
    const updated = await invStore.get(id);
    console.log(JSON.stringify({ ok: true, investigation: updated }));
  } else {
    console.log(`Investigation updated: ${id}`);
    if (status) console.log(`  Status:     ${status}`);
    if (assignedTo) console.log(`  Assigned:   ${assignedTo}`);
    if (resolution) console.log(`  Resolution: ${resolution}`);
  }
}

async function runInvestigateGenerate(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const windowIdx = args.indexOf("--window");
  let windowDays = 30;
  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a value (positive integer)");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  const store = new GovernanceStore();
  const invStore = new InvestigationStore();
  const generatedAt = new Date().toISOString();

  const investigations = await generateInvestigations({
    store,
    investigationStore: invStore,
    windowDays,
    generatedAt,
  });

  if (jsonMode) {
    console.log(JSON.stringify(investigations, null, 2));
  } else {
    console.log(`Generated ${investigations.length} investigation(s).`);
    for (const inv of investigations) {
      const severityColor = inv.severity === "critical" || inv.severity === "high" ? RED : YELLOW;
      console.log(
        `  ${severityColor}[${inv.severity.toUpperCase()}]${RESET}` +
        ` ${inv.kind.replace("_", " ")} — ${inv.title}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// runAnalytics — `alix governance analytics [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runAnalytics(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const { FileLedgerStore } = await import("../../governance/run-ledger.js");
  const { computeAnalytics, computePeriodRollups } = await import(
    "../../governance/ledger-analytics.js",
  );

  const cwd = process.cwd();
  const store = new FileLedgerStore(cwd);
  const entries = await store.list();

  // Apply window filter — FileLedgerStore.list() returns newest-first
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();
  const filtered = entries.filter(
    (e) => new Date(e.timestamp).getTime() >= cutoffMs,
  );

  const analytics = computeAnalytics(filtered, windowDays);
  const rollups = computePeriodRollups(filtered);

  if (jsonMode) {
    console.log(JSON.stringify({ analytics, rollups }, null, 2));
    return;
  }

  renderAnalytics(analytics, rollups);
}

// ---------------------------------------------------------------------------
// runFailureAnalysis — `alix governance failure-analysis [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runFailureAnalysis(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const { FileFailureMemoryStore } = await import("../../governance/failure-memory.js");
  const { computeFailureAnalysis } = await import(
    "../../governance/failure-clustering.js",
  );

  const cwd = process.cwd();
  const store = new FileFailureMemoryStore(cwd);
  const records = await store.list();

  // Apply window filter
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();
  const filtered = records.filter(
    (r) => new Date(r.timestamp).getTime() >= cutoffMs,
  );

  const failureAnalysis = computeFailureAnalysis(filtered);

  if (jsonMode) {
    console.log(JSON.stringify({ failureAnalysis }, null, 2));
    return;
  }

  renderFailureAnalysis(failureAnalysis, windowDays);
}

// ---------------------------------------------------------------------------
// runPolicySuggestions — `alix governance policy-suggestions [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runPolicySuggestions(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const { FileLedgerStore } = await import("../../governance/run-ledger.js");
  const { FileFailureMemoryStore } = await import("../../governance/failure-memory.js");
  const { computePolicySuggestions } = await import(
    "../../governance/policy-suggestions.js",
  );

  const cwd = process.cwd();
  const ledger = new FileLedgerStore(cwd);
  const failures = new FileFailureMemoryStore(cwd);

  // Window filter applied independently to each store.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();

  const ledgerEntries = (await ledger.list()).filter(
    (e) => new Date(e.timestamp).getTime() >= cutoffMs,
  );
  const failureRecords = (await failures.list()).filter(
    (r) => new Date(r.timestamp).getTime() >= cutoffMs,
  );

  const policySuggestions = computePolicySuggestions(ledgerEntries, failureRecords);

  if (jsonMode) {
    console.log(JSON.stringify({ policySuggestions }, null, 2));
    return;
  }

  renderPolicySuggestions(policySuggestions, windowDays);
}

// ---------------------------------------------------------------------------
// Terminal renderers
// ---------------------------------------------------------------------------

const BAR = "═══════════════════════════════════════════════════════════════";

// -- Analytics ----------------------------------------------------------------

function colorForTrend(trend: string): string {
  switch (trend) {
    case "improving":
      return GREEN;
    case "degrading":
      return RED;
    default:
      return YELLOW;
  }
}

function colorForRateValue(rate: number): string {
  if (rate >= 0.8) return GREEN;
  if (rate >= 0.5) return YELLOW;
  return RED;
}

function renderAnalytics(
  analytics: LedgerAnalytics,
  rollups: PeriodRollup[],
): void {
  console.log(BOLD + "Governance Analytics" + RESET);
  console.log(BAR);

  // Summary line
  console.log(
    `  ${analytics.totalRuns} runs, ${analytics.timeframeDays}d window`,
  );

  // Trend
  const trendColor = colorForTrend(analytics.trendDirection);
  console.log(
    `  Trend: ${trendColor}${analytics.trendDirection.toUpperCase()}${RESET}`,
  );

  // Approval rate
  const rateColor = colorForRateValue(analytics.approvalRate);
  console.log(
    `  Approval Rate: ${rateColor}${(analytics.approvalRate * 100).toFixed(1)}%${RESET}`,
  );

  // Average risk
  console.log(
    `  Avg Risk Score: ${analytics.averageRiskScore.toFixed(1)}`,
  );

  // Outcomes
  console.log("");
  console.log(BOLD + "By Outcome" + RESET);
  for (const [outcome, count] of Object.entries(analytics.byOutcome)) {
    if (count > 0) {
      const icon =
        outcome === "failed"
          ? "❌"
          : outcome === "denied"
            ? "🚫"
            : "⏹️";
      console.log(` ${icon} ${outcome}: ${count}`);
    }
  }
  console.log("");

  // Risk levels
  console.log(BOLD + "By Risk Level" + RESET);
  for (const [level, count] of Object.entries(analytics.byRiskLevel)) {
    if (count > 0) {
      const color = colorForSeverity(level);
      console.log(` ${color}[${level.toUpperCase()}]${RESET} ${count}`);
    }
  }
  console.log("");

  // Period rollups (last 7 days max)
  if (rollups.length > 0) {
    const recent = rollups.slice(-7);
    console.log(
      BOLD + `Daily Rollups (last ${recent.length} day(s))` + RESET,
    );
    for (const r of recent) {
      const badCount = r.failures + r.denied;
      const failStr =
        badCount > 0
          ? ` ${RED}${badCount} bad${RESET}`
          : " 0 bad";
      console.log(
        ` ${r.date} | ${r.runs} runs${failStr} | avg risk ${r.avgRiskScore.toFixed(1)}`,
      );
    }
  }
}

// -- Failure Analysis --------------------------------------------------------

function severityColor(severity: "high" | "medium" | "low"): string {
  switch (severity) {
    case "high": return RED;
    case "medium": return YELLOW;
    default: return GREEN;
  }
}

function renderFailureAnalysis(analysis: FailureAnalysis, windowDays: number): void {
  console.log(BOLD + "Governance Failure Analysis" + RESET);
  console.log(BAR);
  console.log(`Total Records:  ${analysis.total}`);
  console.log(`Window:         ${windowDays} days (requested)`);
  console.log(`Data Span:      ${analysis.timeframeDays} days (actual)`);
  console.log(`Dominant Type:  ${analysis.dominantType ?? "none"}`);
  console.log("");

  // Clusters
  if (analysis.clusters.length > 0) {
    console.log(BOLD + "By Cluster" + RESET);
    for (const c of analysis.clusters) {
      const sev = failureSeverityForType(c.failureType);
      const color = severityColor(sev);
      console.log(
        ` ${color}[${sev.toUpperCase()}]${RESET} ${c.failureType} (${c.count})`,
      );
      if (c.commonDetailKeywords.length > 0) {
        console.log(`    Keywords: ${c.commonDetailKeywords.join(", ")}`);
      }
      if (c.commonFilePaths.length > 0) {
        console.log(`    File paths: ${c.commonFilePaths.join(", ")}`);
      }
    }
    console.log("");
  }

  // Recurring file paths
  if (analysis.recurringFilePaths.length > 0) {
    console.log(BOLD + "Recurring File Paths (2+ records)" + RESET);
    const maxLen = Math.max(...analysis.recurringFilePaths.map((p) => p.length)) + 4;
    for (const fp of analysis.recurringFilePaths) {
      const count = analysis.recurringFilePathCounts[fp] ?? 0;
      console.log(` ${fp.padEnd(maxLen)}(${count})`);
    }
  }
}

// -- Policy Suggestions ------------------------------------------------------

function confidenceColor(confidence: number): string {
  // High-confidence suggestions carry the strongest evidence and warrant urgent human attention → RED.
  if (confidence >= 0.75) return RED;
  if (confidence >= 0.6) return YELLOW;
  return GREEN;
}

function renderPolicySuggestions(
  suggestions: PolicySuggestion[],
  windowDays: number,
): void {
  console.log(BOLD + "Governance Policy Suggestions" + RESET);
  console.log(BAR);
  console.log(`Window: ${windowDays} days`);
  console.log(
    DIM + `${suggestions.length} suggestion(s) — advisory only, no policy files modified` + RESET,
  );
  console.log("");

  if (suggestions.length === 0) {
    console.log(
      DIM + "  No suggestions. Either insufficient evidence or policies look healthy." + RESET,
    );
    return;
  }

  for (const s of suggestions) {
    const color = confidenceColor(s.confidence);
    const pid = s.policyId ? ` ${s.policyId}` : " (no policyId)";
    console.log(
      `${color}[${s.confidence.toFixed(2)}]${RESET} ${s.type}${pid} ${DIM}${s.sourceHeuristic}${RESET}`,
    );
    console.log(`    Reason: ${s.reason}`);
    console.log(`    Recommendation: ${s.recommendation}`);
    console.log(
      `    Evidence: matched=${s.evidence.matchedCount}, denied=${s.evidence.deniedCount}, bypassed=${s.evidence.bypassedCount}, related=${s.evidence.relatedFailureCount}`,
    );
    console.log("");
  }
}

// -- Health ------------------------------------------------------------------

function renderHealth(report: GovernanceHealthReport): void {
  console.log(BOLD + "Governance Health" + RESET);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(BAR);
  console.log(`Total Reviews:    ${report.totalReviews}`);
  console.log(`Total Proposals:  ${report.totalProposals}`);
  console.log(`Policy Coverage:  ${report.policyCoverage}%`);
  console.log("");

  console.log(BOLD + "Source Metrics" + RESET);
  console.log(
    `  Dashboard Integrity:    ${report.sourceMetrics.dashboardIntegrityScore ?? "n/a"}`,
  );
  console.log(
    `  Explanation Completeness: ${report.sourceMetrics.explanationCompleteness ?? "n/a"}%`,
  );
  console.log(
    `  Evidence Chain Usage:   ${report.sourceMetrics.evidenceChainUsage ?? "n/a"}%`,
  );
  console.log(
    `  Incomplete Chain Layers: ${report.sourceMetrics.incompleteChainLayers}`,
  );

  const lenses = Object.entries(report.lensEffectiveness);
  if (lenses.length > 0) {
    console.log("");
    console.log(BOLD + "Lens Effectiveness" + RESET);
    for (const [lens, value] of lenses) {
      console.log(`  ${lens}: ${value}%`);
    }
  }
}

// -- Assessment ---------------------------------------------------------------

function renderAssessment(assessment: GovernanceAssessment): void {
  console.log(BOLD + "Governance Assessment" + RESET);
  console.log(`Generated: ${assessment.generatedAt}`);
  console.log(BAR);
  console.log(
    `Governance Confidence: ${(assessment.governanceConfidence * 100).toFixed(1)}%`,
  );
  console.log(
    `Unresolved Issues:    ${assessment.unresolvedGovernanceIssues}`,
  );
  console.log("");
  console.log(BOLD + "Notes" + RESET);
  for (const note of assessment.assessmentNotes) {
    console.log(`  ${note}`);
  }
}

// -- Drift -------------------------------------------------------------------

function renderDrift(report: GovernanceDriftReport): void {
  console.log(BOLD + "Governance Drift" + RESET);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Findings:  ${report.findings.length}`);
  console.log(BAR);

  if (report.findings.length === 0) {
    console.log(GREEN + "  No drift detected." + RESET);
    return;
  }

  for (const finding of report.findings) {
    const color = colorForSeverity(finding.severity);
    console.log("");
    console.log(
      color + BOLD + `  [${finding.severity.toUpperCase()}]` + RESET +
        ` ${finding.driftType}`,
    );
    console.log(`  ${finding.description}`);
    console.log(DIM + `  Confidence: ${finding.confidence}` + RESET);
    console.log(`  Recommendation: ${finding.recommendation}`);
  }
}

// -- Lens Review -------------------------------------------------------------

function renderLensReview(review: LensLifecycleReview): void {
  console.log(BOLD + "Lens Lifecycle Review" + RESET);
  console.log(`Generated: ${review.generatedAt}`);
  console.log(`Lenses Reviewed: ${review.lensReviews.length}`);
  console.log(BAR);

  if (review.lensReviews.length === 0) {
    console.log(DIM + "  No calibration data available for any lens." + RESET);
    return;
  }

  for (const lr of review.lensReviews) {
    const recColor = colorForRecommendation(lr.recommendation);
    console.log("");
    console.log(BOLD + `  ${lr.lens}` + RESET);
    console.log(`    Predictive Value:  ${lr.predictiveValue}`);
    console.log(`    Reviews Analyzed:  ${lr.reviewsAnalyzed}`);
    console.log(`    False Alarms:      ${lr.falseAlarms}`);
    console.log(`    Missed Failures:   ${lr.missedFailures}`);
    console.log(
      `    Recommendation:    ` +
        recColor + lr.recommendation.toUpperCase() + RESET,
    );
    console.log(`    Reason: ${lr.reason}`);
  }
}

// -- Integrity ---------------------------------------------------------------

function renderIntegrity(report: GovernanceIntegrityReport): void {
  const m = report.metrics;
  console.log(BOLD + "Governance Integrity" + RESET);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(BAR);

  console.log(`Total Reviews:              ${m.totalReviews}`);
  console.log("");
  console.log(`Reviews with Provenance:    ${m.reviewsWithProvenance}`);
  console.log(`Reviews with Explanations:  ${m.reviewsWithExplanations}`);
  console.log(`Reviews Linked to Outcomes: ${m.reviewsLinkedToOutcomes}`);
  console.log(`Untraceable Findings:       ${m.untraceableFindings}`);
  console.log("");
  console.log(BOLD + "Rates" + RESET);
  console.log(
    `  Provenance Rate:     ` +
      colorForRate(m.provenanceRate) + `${m.provenanceRate}%` + RESET,
  );
  console.log(
    `  Explanation Rate:    ` +
      colorForRate(m.explanationRate) + `${m.explanationRate}%` + RESET,
  );
  console.log(
    `  Outcome Link Rate:   ` +
      colorForRate(m.outcomeLinkRate) + `${m.outcomeLinkRate}%` + RESET,
  );
}

// -- Recommendations --------------------------------------------------------

function colorForPriority(priority: string): string {
  switch (priority) {
    case "critical":
    case "high":
      return RED;
    case "medium":
      return YELLOW;
    case "low":
      return GREEN;
    default:
      return DIM;
  }
}

function renderRecommendations(
  artifactId: string,
  recs: Recommendation[],
  generatedAt: string,
): void {
  console.log(BOLD + "Governance Recommendations" + RESET);
  console.log(`Artifact ID: ${artifactId}`);
  console.log(`Generated:   ${generatedAt}`);
  console.log(`Total:       ${recs.length}`);
  console.log(BAR);

  if (recs.length === 0) {
    console.log(
      DIM +
        "No recommendations in this window (or all filtered out)." +
        RESET,
    );
    return;
  }

  for (const r of recs) {
    console.log(
      colorForPriority(r.priority) +
        `[${r.priority.toUpperCase()}]` +
        RESET +
        ` (${r.source}/${r.category}) ${r.title}`,
    );
    console.log(`  ${DIM}${r.description}${RESET}`);
    console.log(`  ${CYAN}→ ${r.operatorGuidance}${RESET}`);
    if (r.expectedBenefit) {
      console.log(`  ${GREEN}Expected benefit:${RESET} ${r.expectedBenefit}`);
    }
    console.log("");
  }
}
