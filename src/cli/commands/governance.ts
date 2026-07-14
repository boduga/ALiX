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
import { randomUUID } from "node:crypto";
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
import type { FrictionReport } from "../../governance/approval-friction.js";
import type { GovernanceSignal } from "../../governance/governance-signal.js";
import type { DecisionKind } from "../../governance/decision-capture.js";
import type {
  ActionProposalKind,
  ActionProposalStatus,
  GovernanceActionProposal,
  ActionProposalStatusTransition,
} from "../../governance/action-queue.js";

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

const VALID_SECTIONS = ["analytics", "failures", "policies", "friction"] as const;

function parseSectionFlag(args: string[]): string | null {
  const idx = args.indexOf("--section");
  if (idx === -1) return null;
  if (idx + 1 >= args.length) {
    console.error("Error: --section requires a value (analytics|failures|policies|friction)");
    process.exit(2);
  }
  const val = args[idx + 1];
  if (!(VALID_SECTIONS as readonly string[]).includes(val)) {
    console.error(`Error: Unknown section "${val}". Valid: ${VALID_SECTIONS.join(", ")}`);
    process.exit(2);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export async function handleGovernanceCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case "status":
      return runStatus(rest);
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
    case "execution":
      return runExecution(rest);
    case "workbench":
      return runWorkbench(rest);
    default:
      console.error(
        `Unknown governance subcommand: "${subcommand ?? ""}"`,
      );
      console.error(
        "Usage: alix governance {status|health|drift|lens-review|integrity|policies|recommend|propose|approve|reject|list|cleanup|explain|dashboard|investigate} [--window <days>] [--json]",
      );
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// runStatus — `alix governance status [--json]`
// ---------------------------------------------------------------------------

async function runStatus(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const cwd = process.cwd();
  const govDir = join(cwd, ".alix", "governance");

  // Import stores
  const { FileLedgerStore } = await import(
    "../../governance/run-ledger.js"
  );
  const { FileFailureMemoryStore } = await import(
    "../../governance/failure-memory.js"
  );

  const ledgerStore = new FileLedgerStore(govDir);
  const failureStore = new FileFailureMemoryStore(govDir);

  const allRuns = await ledgerStore.list();
  const allFailures = await failureStore.list();

  const pendingApprovals = allRuns.filter((r) =>
    r.outcome === "completed" && r.approvals.some((g) => g.status === "pending"),
  ).length;
  const deniedRuns = allRuns.filter((r) => r.outcome === "denied").length;
  const failedRuns = allRuns.filter((r) => r.outcome === "failed").length;

  if (jsonMode) {
    console.log(JSON.stringify({
      components: {
        policyAdapter: true,
        riskScoring: true,
        approvalWorkflow: true,
        runLedger: true,
        failureMemory: true,
      },
      counts: {
        recentRuns: allRuns.length,
        recentFailures: allFailures.length,
        pendingApprovals,
        deniedRuns,
        failedRuns,
      },
    }, null, 2));
    return;
  }

  const available = GREEN + "available" + RESET;

  console.log(BOLD + "Governance Status" + RESET);
  console.log(BAR);
  console.log(`  ${GREEN}●${RESET} policy adapter     ${available}`);
  console.log(`  ${GREEN}●${RESET} risk scoring        ${available}`);
  console.log(`  ${GREEN}●${RESET} approval workflow   ${available}`);
  console.log(`  ${GREEN}●${RESET} run ledger          ${available}`);
  console.log(`  ${GREEN}●${RESET} failure memory      ${available}`);
  console.log("");
  console.log(BOLD + "Recent Activity" + RESET);
  console.log(`  runs:     ${allRuns.length}`);
  console.log(`  failures: ${allFailures.length}`);
  console.log(`  pending approvals: ${pendingApprovals > 0 ? YELLOW + pendingApprovals + RESET : pendingApprovals}`);
  console.log(`  denied:   ${deniedRuns > 0 ? RED + deniedRuns + RESET : deniedRuns}`);
  console.log(`  failed:   ${failedRuns > 0 ? RED + failedRuns + RESET : failedRuns}`);
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
// runFrictionAnalysis — `alix governance friction-analysis [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runFrictionAnalysis(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const { FileLedgerStore } = await import("../../governance/run-ledger.js");
  const { computeFrictionReport } = await import("../../governance/approval-friction.js");

  const cwd = process.cwd();
  const store = new FileLedgerStore(cwd);
  const entries = await store.list();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();
  const filtered = entries.filter((e) => new Date(e.timestamp).getTime() >= cutoffMs);

  const frictionReport = computeFrictionReport(filtered);

  if (jsonMode) {
    console.log(JSON.stringify({ frictionReport }, null, 2));
    return;
  }

  renderFrictionAnalysis(frictionReport, windowDays);
}

// ---------------------------------------------------------------------------
// runReport — `alix governance report [--section <s>] [--window <days>] [--json]`
// ---------------------------------------------------------------------------

async function runReport(args: string[]): Promise<void> {
  const { windowDays, jsonMode } = parseFlags(args);
  const section = parseSectionFlag(args);

  // Dynamic imports for stores and pure functions
  const { FileLedgerStore } = await import("../../governance/run-ledger.js");
  const { FileFailureMemoryStore } = await import("../../governance/failure-memory.js");
  const { computeAnalytics, computePeriodRollups } = await import(
    "../../governance/ledger-analytics.js",
  );
  const { computeFailureAnalysis } = await import("../../governance/failure-clustering.js");
  const { computePolicySuggestions } = await import(
    "../../governance/policy-suggestions.js",
  );
  const { computeFrictionReport } = await import("../../governance/approval-friction.js");

  const cwd = process.cwd();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();

  // Helper: fetch + filter a store
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const windowed = async <T extends { timestamp: string }>(
    store: { list: (limit?: number) => Promise<T[]> },
  ): Promise<T[]> =>
    (await store.list()).filter((e) => new Date(e.timestamp).getTime() >= cutoffMs);

  // Check if a section should be computed
  const want = (s: string): boolean => section === null || section === s;

  const result: Record<string, unknown> = {};

  if (want("analytics")) {
    const entries = await windowed(new FileLedgerStore(cwd));
    result.analytics = computeAnalytics(entries, windowDays);
    result.rollups = computePeriodRollups(entries);
  }

  if (want("failures")) {
    const records = await windowed(new FileFailureMemoryStore(cwd));
    result.failureAnalysis = computeFailureAnalysis(records);
  }

  if (want("policies")) {
    const entries = await windowed(new FileLedgerStore(cwd));
    const records = await windowed(new FileFailureMemoryStore(cwd));
    result.policySuggestions = computePolicySuggestions(entries, records);
  }

  if (want("friction")) {
    const entries = await windowed(new FileLedgerStore(cwd));
    result.frictionReport = computeFrictionReport(entries);
  }

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  renderReport(result, windowDays, section);
}

// ---------------------------------------------------------------------------
// Terminal renderers
// ---------------------------------------------------------------------------

const BAR = "═══════════════════════════════════════════════════════════════";

// -- Report (aggregated P13.1-P13.4) -----------------------------------------

function renderReport(result: Record<string, unknown>, windowDays: number, section: string | null): void {
  console.log(BOLD + "Governance Report" + RESET);
  console.log(`Window: ${windowDays} days`);
  console.log(DIM + "  Advisory only — no policies or gates modified." + RESET);
  console.log(BAR);

  const show = (name: string) => section === null || section === name;

  if (show("analytics") && result.analytics) {
    console.log("");
    console.log(BOLD + "◆ Ledger Analytics" + RESET);
    renderAnalytics(result.analytics as LedgerAnalytics, result.rollups as PeriodRollup[]);
  } else if (show("analytics")) {
    console.log("");
    console.log(BOLD + "◆ Ledger Analytics" + RESET);
    console.log(DIM + "  No data" + RESET);
  }

  if (show("failures") && result.failureAnalysis) {
    console.log("");
    console.log(BOLD + "◆ Failure Clustering" + RESET);
    renderFailureAnalysis(result.failureAnalysis as FailureAnalysis, windowDays);
  } else if (show("failures")) {
    console.log("");
    console.log(BOLD + "◆ Failure Clustering" + RESET);
    console.log(DIM + "  No data" + RESET);
  }

  if (show("policies") && result.policySuggestions) {
    console.log("");
    console.log(BOLD + "◆ Policy Suggestions" + RESET);
    renderPolicySuggestions(result.policySuggestions as PolicySuggestion[], windowDays);
  } else if (show("policies")) {
    console.log("");
    console.log(BOLD + "◆ Policy Suggestions" + RESET);
    console.log(DIM + "  No data" + RESET);
  }

  if (show("friction") && result.frictionReport) {
    console.log("");
    console.log(BOLD + "◆ Approval Friction" + RESET);
    renderFrictionAnalysis(result.frictionReport as FrictionReport, windowDays);
  } else if (show("friction")) {
    console.log("");
    console.log(BOLD + "◆ Approval Friction" + RESET);
    console.log(DIM + "  No data" + RESET);
  }
}

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

// -- Approval Friction Analysis ---------------------------------------------

function frictionColor(score: number): string {
  if (score >= 0.6) return RED;
  if (score >= 0.3) return YELLOW;
  return GREEN;
}

function renderFrictionAnalysis(report: FrictionReport, windowDays: number): void {
  console.log(BOLD + "Governance Approval Friction Analysis" + RESET);
  console.log(BAR);
  console.log(`Window:                    ${windowDays} days`);
  console.log(`Total Approvals Requested: ${report.totalApprovalsRequested}`);
  console.log(`Overall Friction Score:    ${frictionColor(report.overallFrictionScore)}${report.overallFrictionScore.toFixed(2)}${RESET}`);
  console.log(`Highest Friction Gate:     ${report.highestFrictionGate ?? "none"}`);
  console.log(`Average time to approve:   not available (no request timestamps)`);
  console.log(DIM + "  Advisory only — no approval gates modified." + RESET);
  console.log("");

  if (report.gates.length > 0) {
    console.log(BOLD + "By Gate" + RESET);
    for (const g of report.gates) {
      const color = frictionColor(g.frictionScore);
      console.log(
        `  ${color}${g.frictionScore.toFixed(2)}${RESET}  ${g.gate}` +
        ` (${g.totalOccurrences} occurrences: ${g.deniedCount} denied, ${g.pendingCount} pending, ${g.approvedCount} approved)`,
      );
    }
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

// ---------------------------------------------------------------------------
// P14.1 — Inbox
// ---------------------------------------------------------------------------

async function runInbox(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "refresh") {
    return runInboxRefresh(args.slice(1));
  }
  return runInboxList(args);
}

async function runInboxList(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const { FileSignalStore } = await import("../../governance/governance-signal.js");

  const store = new FileSignalStore(cwd);
  const signals = await store.list();

  // Parse filters
  const statusFilter = parseInlineFlag(args, "--status");
  const sourceFilter = parseInlineFlag(args, "--source");
  const jsonMode = args.includes("--json");

  let filtered = signals;
  if (statusFilter) {
    filtered = filtered.filter((s) => s.status === statusFilter);
  }
  if (sourceFilter) {
    filtered = filtered.filter((s) => s.sourcePhase === sourceFilter);
  }

  if (jsonMode) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  renderInboxList(filtered, signals.length);
}

function renderInboxList(signals: GovernanceSignal[], totalStored: number): void {
  console.log(BOLD + "Governance Signal Inbox" + RESET);
  console.log(`Total stored: ${totalStored}  |  Showing: ${signals.length}`);
  console.log(BAR);

  if (signals.length === 0) {
    console.log(DIM + "No signals match the current filters." + RESET);
    return;
  }

  const statusColor: Record<string, string> = {
    new: YELLOW,
    reviewing: CYAN,
    decided: GREEN,
    dismissed: DIM,
    escalated: RED,
  };

  for (const s of signals) {
    const sevColor = severityColor(s.severity === "critical" ? "high" : s.severity);
    console.log(
      sevColor + `[${s.severity.toUpperCase()}]` + RESET +
      ` ${s.title}`,
    );
    console.log(
      `  ${DIM}ID: ${s.signalId}${RESET}`,
    );
    console.log(
      `  ${DIM}Source: ${s.sourcePhase} | Type: ${s.signalType} | Conf: ${(s.confidence * 100).toFixed(0)}%${RESET}`,
    );
    console.log(
      `  ${statusColor[s.status] ?? DIM}Status: ${s.status}${RESET}  ${DIM}${s.createdAt}${RESET}`,
    );
    console.log("");
  }
}

async function runInboxRefresh(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const { windowDays } = parseFlags(args);
  const now = new Date().toISOString();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffMs = cutoff.getTime();

  // Helper: fetch + filter a store by window (same pattern as runReport)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const windowed = async <T extends { timestamp: string }>(
    store: { list: (limit?: number) => Promise<T[]> },
  ): Promise<T[]> =>
    (await store.list()).filter((e) => new Date(e.timestamp).getTime() >= cutoffMs);

  // Dynamic imports — P13 modules
  const { FileLedgerStore } = await import("../../governance/run-ledger.js");
  const { FileFailureMemoryStore } = await import("../../governance/failure-memory.js");
  const { computeAnalytics, computePeriodRollups } = await import("../../governance/ledger-analytics.js");
  const { computeFailureAnalysis } = await import("../../governance/failure-clustering.js");
  const { computePolicySuggestions } = await import("../../governance/policy-suggestions.js");
  const { computeFrictionReport } = await import("../../governance/approval-friction.js");
  const { FileSignalStore, normalizeAllP13Outputs } = await import("../../governance/governance-signal.js");

  // Read P13 store data (same pattern as runReport)
  const entries = await windowed(new FileLedgerStore(cwd));
  const records = await windowed(new FileFailureMemoryStore(cwd));

  // Run P13 pure functions
  const analytics = computeAnalytics(entries, windowDays);
  const rollups = computePeriodRollups(entries);
  const failureAnalysis = computeFailureAnalysis(records);
  const policySuggestions = computePolicySuggestions(entries, records);
  const frictionReport = computeFrictionReport(entries);

  // Create audited signal store — outgoing append emits exactly one audit event
  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { auditSignalStore } = await import("../../governance/audit-decorators.js");
  const auditStore = new FileAuditStore(cwd);
  const signalStore = auditSignalStore(new FileSignalStore(cwd), auditStore);

  const existingSignals = await signalStore.list();

  // Normalise and dedup
  const newSignals = normalizeAllP13Outputs(
    existingSignals,
    analytics,
    rollups,
    failureAnalysis,
    policySuggestions,
    frictionReport,
    now,
  );

  // Append new signals — decorator handles audit emission
  let appended = 0;
  for (const signal of newSignals) {
    await signalStore.append(signal);
    appended++;
  }

  // Report
  const jsonMode = args.includes("--json");
  if (jsonMode) {
    console.log(JSON.stringify({
      newSignals: appended,
      totalSignals: existingSignals.length + appended,
      timestamp: now,
    }, null, 2));
    return;
  }

  console.log(BOLD + "Governance Inbox Refresh" + RESET);
  console.log(`Window: ${windowDays} days`);
  console.log(`Timestamp: ${now}`);
  console.log(BAR);
  console.log(`${GREEN}${appended} new signals${RESET} appended to inbox (${existingSignals.length + appended} total)`);
  if (appended > 0) {
    console.log("");
    console.log(`  ${CYAN}→${RESET} Run \`alix governance inbox\` to view signals`);
  }
  console.log(
    DIM + "  Advisory only — no policies or gates modified." + RESET,
  );
  if (appended === 0) {
    console.log(DIM + "  (All signals deduplicated against existing inbox items.)" + RESET);
  }
}

// ---------------------------------------------------------------------------
// P14.2 — Review
// ---------------------------------------------------------------------------

async function runReview(args: string[]): Promise<void> {
  const signalId = extractPositionalArg(args, ["--as", "--notes", "--classification"]);
  if (!signalId) {
    console.error("Usage: alix governance review <signal-id> [--notes ...] [--classification ...] [--json] [--as ...]");
    process.exit(1);
  }

  const cwd = process.cwd();
  const notes = parseInlineFlag(args, "--notes");
  const classification = parseInlineFlag(args, "--classification");
  const jsonMode = args.includes("--json");
  const explicitAs = parseInlineFlag(args, "--as");

  const { FileSignalStore } = await import("../../governance/governance-signal.js");
  const signalStore = new FileSignalStore(cwd);
  const signal = await signalStore.getById(signalId);

  if (!signal) {
    console.error(`Signal not found: ${signalId}`);
    process.exit(1);
  }

  // Read-only mode — no --notes or --classification
  if (notes === null && classification === null) {
    const { FileReviewStore } = await import("../../governance/operator-review.js");
    const reviewStore = new FileReviewStore(cwd);
    const priorReviews = await reviewStore.getBySignalId(signalId);

    if (jsonMode) {
      console.log(JSON.stringify({ signal, priorReviews }, null, 2));
      return;
    }

    renderReviewShow(signal, priorReviews);
    return;
  }

  // Create mode — use audited review store for single audit emission
  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { auditReviewStore } = await import("../../governance/audit-decorators.js");
  const { FileReviewStore, createOperatorReview, resolveReviewer } = await import("../../governance/operator-review.js");
  const reviewStore = auditReviewStore(new FileReviewStore(cwd), new FileAuditStore(cwd));
  const reviewer = resolveReviewer(explicitAs ?? undefined);
  const now = new Date().toISOString();
  const reviewId = `rev-${now.replace(/[:.]/g, "-")}-${signalId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;

  const review = await createOperatorReview(
    reviewId,
    signalId,
    signal, // pass fetched signal to avoid redundant store read inside createOperatorReview
    reviewer,
    notes,
    classification,
    now,
  );

  await reviewStore.append(review);

  if (jsonMode) {
    console.log(JSON.stringify({ signal, review }, null, 2));
    return;
  }

  renderReviewCreated(signal, review);
}

function renderReviewShow(
  signal: { signalId: string; title: string; severity: string; sourcePhase: string; signalType: string; confidence: number; createdAt: string; description: string },
  priorReviews: { reviewId: string; reviewer: string; notes: string | null; classification: string | null; createdAt: string }[],
): void {
  console.log(BOLD + "Signal Detail" + RESET);
  console.log(`${DIM}ID:${RESET} ${signal.signalId}`);
  console.log(`${DIM}Title:${RESET} ${signal.title}`);
  console.log(`${DIM}Severity:${RESET} ${severityColor(signal.severity === "critical" ? "high" : signal.severity as "high" | "medium" | "low")}${signal.severity.toUpperCase()}${RESET}`);
  console.log(`${DIM}Source:${RESET} ${signal.sourcePhase} | ${signal.signalType} | Conf: ${(signal.confidence * 100).toFixed(0)}%`);
  console.log(`${DIM}Created:${RESET} ${signal.createdAt}`);
  console.log(`${DIM}Description:${RESET} ${signal.description}`);
  console.log(BAR);

  if (priorReviews.length === 0) {
    console.log(DIM + "No prior reviews." + RESET);
  } else {
    console.log(BOLD + `Prior Reviews (${priorReviews.length})` + RESET);
    for (const r of priorReviews) {
      console.log(`  ${CYAN}Review:${RESET} ${r.reviewId} | ${r.reviewer} | ${r.createdAt}`);
      if (r.notes) console.log(`  ${DIM}Notes:${RESET} ${r.notes}`);
      if (r.classification) console.log(`  ${DIM}Classification:${RESET} ${r.classification}`);
      console.log("");
    }
  }
  console.log(DIM + "To create a review, use: --notes \"...\" or --classification \"...\"" + RESET);
}

function renderReviewCreated(
  signal: { signalId: string; title: string; severity: string },
  review: { reviewId: string; reviewer: string; notes: string | null; classification: string | null; createdAt: string },
): void {
  console.log(GREEN + "Review Created" + RESET);
  console.log(`${DIM}Signal:${RESET} ${signal.title} (${signal.signalId})`);
  console.log(`${DIM}Review ID:${RESET} ${review.reviewId}`);
  console.log(`${DIM}Reviewer:${RESET} ${review.reviewer}`);
  if (review.notes) console.log(`${DIM}Notes:${RESET} ${review.notes}`);
  if (review.classification) console.log(`${DIM}Classification:${RESET} ${review.classification}`);
  console.log(`${DIM}Created:${RESET} ${review.createdAt}`);
  console.log(GREEN + "✓ Review appended to store." + RESET);
  console.log(DIM + "  Advisory only — no signal or policy mutation." + RESET);
}

// ---------------------------------------------------------------------------
// P14.3 — Decision Capture
// ---------------------------------------------------------------------------

const KIND_FLAGS = ["--accept", "--dismiss", "--defer", "--escalate", "--convert-to-issue"] as const;
const KIND_MAP: Record<string, string> = {
  "--accept": "accept",
  "--dismiss": "dismiss",
  "--defer": "defer",
  "--escalate": "escalate",
  "--convert-to-issue": "convert_to_issue",
};

async function runDecide(args: string[]): Promise<void> {
  const signalId = extractPositionalArg(args, ["--as", "--review", "--reason"]);
  if (!signalId) {
    console.error("Usage: alix governance decide <signal-id> --<kind> --reason \"...\" [--as ...] [--review ...] [--json]");
    process.exit(1);
  }

  const cwd = process.cwd();
  const jsonMode = args.includes("--json");
  const explicitAs = parseInlineFlag(args, "--as");
  const reviewId = parseInlineFlag(args, "--review");
  const rationale = parseInlineFlag(args, "--reason");

  // Exactly one kind flag
  const providedKindFlags = KIND_FLAGS.filter((f) => args.includes(f));
  if (providedKindFlags.length === 0) {
    console.error("Exactly one decision kind flag is required: --accept, --dismiss, --defer, --escalate, or --convert-to-issue.");
    process.exit(1);
  }
  if (providedKindFlags.length > 1) {
    console.error(`Multiple decision kind flags provided: ${providedKindFlags.join(", ")}. Exactly one is allowed.`);
    process.exit(1);
  }

  const decisionKind = KIND_MAP[providedKindFlags[0]!]!;

  // Rationale required
  if (!rationale || !rationale.trim()) {
    console.error("Rationale is required and must be non-empty. Use --reason \"...\"");
    process.exit(1);
  }

  const { FileSignalStore } = await import("../../governance/governance-signal.js");
  const signalStore = new FileSignalStore(cwd);
  const signal = await signalStore.getById(signalId);

  if (!signal) {
    console.error(`Signal not found: ${signalId}`);
    process.exit(1);
  }

  const { FileDecisionStore, createOperatorDecision, resolveReviewer } = await import("../../governance/decision-capture.js");
  const { FileReviewStore } = await import("../../governance/operator-review.js");
  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { auditDecisionStore } = await import("../../governance/audit-decorators.js");
  const decisionStore = auditDecisionStore(new FileDecisionStore(cwd), new FileAuditStore(cwd));
  const reviewStore = new FileReviewStore(cwd);
  const decider = resolveReviewer(explicitAs ?? undefined);
  const now = new Date().toISOString();
  const decisionId = `dec-${now.replace(/[:.]/g, "-")}-${signalId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;

  const decision = await createOperatorDecision(
    decisionId,
    signalId,
    signal,
    decisionKind as DecisionKind,
    rationale,
    decider,
    reviewId,
    reviewStore,
    now,
  );

  await decisionStore.append(decision);

  if (jsonMode) {
    console.log(JSON.stringify({ signal, decision }, null, 2));
    return;
  }

  renderDecisionCreated(signal, decision);
}

function renderDecisionCreated(
  signal: { signalId: string; title: string; severity: string },
  decision: {
    decisionId: string;
    decision: string;
    rationale: string;
    decider: string;
    reviewId: string | null;
    actionProposalId: null;
    createdAt: string;
  },
): void {
  console.log(GREEN + "Decision Captured" + RESET);
  console.log(`${DIM}Signal:${RESET} ${signal.title} (${signal.signalId})`);
  console.log(`${DIM}Decision:${RESET} ${CYAN}${decision.decision}${RESET}`);
  console.log(`${DIM}Rationale:${RESET} ${decision.rationale}`);
  console.log(`${DIM}Decider:${RESET} ${decision.decider}`);
  if (decision.reviewId) console.log(`${DIM}Review:${RESET} ${decision.reviewId}`);
  console.log(`${DIM}Decision ID:${RESET} ${decision.decisionId}`);
  console.log(`${DIM}Created:${RESET} ${decision.createdAt}`);
  console.log(BAR);
  console.log(GREEN + "✓ Decision appended to store." + RESET);
  console.log(DIM + "  Advisory only — no action taken. No signal, policy, or gate mutation." + RESET);
}

// ---------------------------------------------------------------------------
// P14.4 — Action Queue
// ---------------------------------------------------------------------------

type ActionsSubcommand = "list" | "refresh" | "mark-executed" | "dismiss";

function isActionsSubcommand(s: string): s is ActionsSubcommand {
  return ["list", "refresh", "mark-executed", "dismiss"].includes(s);
}

/** Generate a transition ID from a timestamp and proposal ID. */
function transitionId(now: string, proposalId: string): string {
  return `trans-${now.replace(/[:.]/g, "-")}-${proposalId.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function runActions(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const jsonMode = args.includes("--json");

  // Determine subcommand
  const sub = args.find((a) => isActionsSubcommand(a)) ?? "list";

  switch (sub) {
    case "list":
      return runActionsList(cwd, args, jsonMode);
    case "refresh":
      return runActionsRefresh(cwd, jsonMode);
    case "mark-executed":
      return runActionsMarkExecuted(cwd, args, jsonMode);
    case "dismiss":
      return runActionsDismiss(cwd, args, jsonMode);
    default:
      console.error("Unknown actions subcommand. Use: list, refresh, mark-executed, dismiss");
      process.exit(1);
  }
}

async function runActionsList(cwd: string, args: string[], jsonMode: boolean): Promise<void> {
  const { FileActionQueueStore, deriveEffectiveStatus } = await import("../../governance/action-queue.js");
  const store = new FileActionQueueStore(cwd);

  const proposals = await store.list();

  // Resolve effective statuses for all proposals once — then filter and render synchronously.
  // This avoids the O(N*M) repeated file-read pattern and the async-filter correctness bug.
  const statusMap = new Map<string, ActionProposalStatus>();
  for (const p of proposals) {
    const transitions = await store.getTransitions(p.proposalId);
    statusMap.set(p.proposalId, deriveEffectiveStatus(p, transitions));
  }

  // Apply filters
  const statusFilter = parseInlineFlag(args, "--status") as ActionProposalStatus | null;
  const kindFilter = parseInlineFlag(args, "--kind") as ActionProposalKind | null;

  let filtered = proposals;
  if (statusFilter) {
    filtered = filtered.filter((p) => statusMap.get(p.proposalId) === statusFilter);
  }
  if (kindFilter) {
    filtered = filtered.filter((p) => p.kind === kindFilter);
  }

  if (jsonMode) {
    const withStatus = filtered.map((p) => ({
      ...p,
      effectiveStatus: statusMap.get(p.proposalId) ?? "pending",
    }));
    console.log(JSON.stringify(withStatus, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log("No action proposals found.");
    return;
  }

  console.log(BOLD + "Action Proposals" + RESET);
  console.log(BAR);

  for (const p of filtered) {
    const effective = statusMap.get(p.proposalId) ?? "pending";
    const statusColor = effective === "dismissed" ? DIM : effective === "marked_executed_elsewhere" ? GREEN : YELLOW;
    const kindColor = p.kind === "escalation_review" ? MAGENTA : CYAN;

    console.log(`${BOLD}${p.proposalId}${RESET}`);
    console.log(`${DIM}Signal:${RESET} ${p.title} (${p.signalId})`);
    console.log(`${DIM}Decision:${RESET} ${p.decisionId}`);
    console.log(`${DIM}Kind:${RESET} ${kindColor}${p.kind}${RESET}`);
    console.log(`${DIM}Status:${RESET} ${statusColor}${effective}${RESET}`);
    console.log(`${DIM}Rationale:${RESET} ${p.rationale}`);
    if (p.executionRef) console.log(`${DIM}Ref:${RESET} ${p.executionRef}`);
    console.log(`${DIM}Created:${RESET} ${p.createdAt}`);
    console.log();
  }

  console.log(DIM + `${filtered.length} proposal(s)` + RESET);
}

async function runActionsRefresh(cwd: string, jsonMode: boolean): Promise<void> {
  const { refreshProposals } = await import("../../governance/action-queue.js");
  const { FileActionQueueStore } = await import("../../governance/action-queue.js");
  const { FileDecisionStore } = await import("../../governance/decision-capture.js");
  const { FileSignalStore } = await import("../../governance/governance-signal.js");
  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { auditActionQueueStore } = await import("../../governance/audit-decorators.js");

  const decisionStore = new FileDecisionStore(cwd);
  const signalStore = new FileSignalStore(cwd);
  const actionQueueStore = auditActionQueueStore(new FileActionQueueStore(cwd), new FileAuditStore(cwd));
  const now = new Date().toISOString();

  const created = await refreshProposals(signalStore, decisionStore, actionQueueStore, now);

  if (jsonMode) {
    console.log(JSON.stringify({ created: created.length, proposals: created }, null, 2));
    return;
  }

  if (created.length === 0) {
    console.log("No new action proposals created. All eligible decisions already have proposals.");
    return;
  }

  console.log(GREEN + `Created ${created.length} new action proposal(s):` + RESET);
  for (const p of created) {
    console.log(`  ${p.proposalId} — ${p.kind} (from ${p.decisionId})`);
  }
  console.log(BAR);
  console.log(DIM + "Proposals are advisory and not executed." + RESET);
}

async function runActionsMarkExecuted(cwd: string, args: string[], jsonMode: boolean): Promise<void> {
  const subIdx = args.findIndex((a) => isActionsSubcommand(a));
  const proposalId = subIdx >= 0 ? args.slice(subIdx + 1).find((a) => !a.startsWith("-")) : undefined;
  if (!proposalId) {
    console.error("Usage: alix governance actions mark-executed <proposal-id> --ref <reference> [--json]");
    process.exit(1);
  }

  const executionRef = parseInlineFlag(args, "--ref");
  if (!executionRef) {
    console.error("--ref is required for mark-executed");
    process.exit(1);
  }

  const { FileActionQueueStore, deriveEffectiveStatus } = await import("../../governance/action-queue.js");
  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { auditActionQueueStore } = await import("../../governance/audit-decorators.js");
  const store = auditActionQueueStore(new FileActionQueueStore(cwd), new FileAuditStore(cwd));

  const proposal = await store.getById(proposalId);
  if (!proposal) {
    console.error(`Proposal not found: ${proposalId}`);
    process.exit(1);
  }

  const transitions = await store.getTransitions(proposalId);
  if (transitions.length > 0) {
    const current = deriveEffectiveStatus(proposal, transitions);
    console.error(`Proposal ${proposalId} already has terminal status: ${current}. Cannot change status.`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const tid = transitionId(now, proposalId);

  const transition: ActionProposalStatusTransition = {
    transitionId: tid,
    proposalId,
    status: "marked_executed_elsewhere",
    reason: null,
    executionRef,
    createdAt: now,
  };

  await store.appendStatusTransition(transition);

  if (jsonMode) {
    console.log(JSON.stringify({ transition, proposal }, null, 2));
    return;
  }

  console.log(GREEN + "Proposal marked as executed elsewhere" + RESET);
  console.log(`${DIM}Proposal:${RESET} ${proposalId} (${proposal.title})`);
  console.log(`${DIM}Ref:${RESET} ${executionRef}`);
  console.log(`${DIM}Transition:${RESET} ${tid}`);
}

async function runActionsDismiss(cwd: string, args: string[], jsonMode: boolean): Promise<void> {
  const subIdx = args.findIndex((a) => isActionsSubcommand(a));
  const proposalId = subIdx >= 0 ? args.slice(subIdx + 1).find((a) => !a.startsWith("-")) : undefined;
  if (!proposalId) {
    console.error("Usage: alix governance actions dismiss <proposal-id> --reason \"...\" [--json]");
    process.exit(1);
  }

  const reason = parseInlineFlag(args, "--reason");
  if (!reason || !reason.trim()) {
    console.error("--reason is required for dismiss");
    process.exit(1);
  }

  const { FileActionQueueStore, deriveEffectiveStatus } = await import("../../governance/action-queue.js");
  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { auditActionQueueStore } = await import("../../governance/audit-decorators.js");
  const store = auditActionQueueStore(new FileActionQueueStore(cwd), new FileAuditStore(cwd));

  const proposal = await store.getById(proposalId);
  if (!proposal) {
    console.error(`Proposal not found: ${proposalId}`);
    process.exit(1);
  }

  const transitions = await store.getTransitions(proposalId);
  if (transitions.length > 0) {
    const current = deriveEffectiveStatus(proposal, transitions);
    console.error(`Proposal ${proposalId} already has terminal status: ${current}. Cannot dismiss.`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const tid = transitionId(now, proposalId);

  const transition: ActionProposalStatusTransition = {
    transitionId: tid,
    proposalId,
    status: "dismissed",
    reason: reason.trim(),
    executionRef: null,
    createdAt: now,
  };

  await store.appendStatusTransition(transition);

  if (jsonMode) {
    console.log(JSON.stringify({ transition, proposal }, null, 2));
    return;
  }

  console.log(YELLOW + "Proposal dismissed" + RESET);
  console.log(`${DIM}Proposal:${RESET} ${proposalId} (${proposal.title})`);
  console.log(`${DIM}Reason:${RESET} ${reason.trim()}`);
  console.log(`${DIM}Transition:${RESET} ${tid}`);
}

// ---------------------------------------------------------------------------
// P17.5 — Execution report subcommands
// ---------------------------------------------------------------------------

async function runExecution(args: string[]): Promise<void> {
  const sub = args[0];
  const jsonMode = args.includes("--json");

  switch (sub) {
    case "report":
      return runExecutionReport(args.slice(1), jsonMode);
    default:
      console.log("Unknown execution subcommand. Usage:");
      console.log("  alix governance execution report [--since <iso>] [--until <iso>] [--json]");
  }
}

async function runExecutionReport(args: string[], jsonMode: boolean): Promise<void> {
  const { buildExecutionReport } = await import("../../governance/execution-report.js");
  const { ExecutionStore } = await import("../../governance/execution-store.js");

  const cwd = process.cwd();
  const since = parseInlineFlag(args, "--since") ?? undefined;
  const until = parseInlineFlag(args, "--until") ?? undefined;

  // Load available data from stores.
  // Note: stores for remediation proposals and execution plans not yet implemented —
  // these are currently pure-function modules without persistence. The report builder
  // accepts empty arrays for those inputs until their respective stores are added.
  const attemptStore = new ExecutionStore(cwd);
  const attempts = await attemptStore.list();

  // Build the report with whatever data is available
  const report = buildExecutionReport({
    remediations: [],
    executionPlans: [],
    approvals: [],
    attempts,
    options: {
      since,
      until,
      now: new Date().toISOString(),
    },
  });

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Text output
  const { GREEN: G, RED: R, YELLOW: Y, CYAN: C, DIM: D, RESET: X } = {
    GREEN: "\x1b[32m",
    RED: "\x1b[31m",
    YELLOW: "\x1b[33m",
    CYAN: "\x1b[36m",
    DIM: "\x1b[2m",
    RESET: "\x1b[0m",
  };

  const t = report.totals;
  console.log(`\n  ${C}Execution Report${X}`);
  console.log(`  ${D}${report.windowStart} — ${report.windowEnd}${X}`);
  console.log("");
  console.log(`  ${D}Totals:${X}`);
  console.log(`    Accepted:     ${t.accepted}`);
  console.log(`    Planned:      ${t.planned}`);
  console.log(`    Approved:     ${t.approved}`);
  console.log(`    Rejected:     ${t.rejected}`);
  console.log(`    Executed:     ${t.executed}`);
  console.log(`    Failed:       ${t.failed}`);
  console.log(`    Partial:      ${t.partial}`);
  console.log(`    Reverted:     ${t.reverted}`);
  console.log(`    Unresolved:   ${t.unresolved}`);
  console.log(`    Superseded:   ${t.superseded}`);

  if (report.items.length === 0) return;

  console.log(`\n  ${D}Items:${X}`);
  for (const item of report.items) {
    const attention = item.requiresAttention ? R + " ATTENTION" + X : "";
    const state = colorForState(item.executionState);
    console.log(
      `  ${D}${item.remediationId}${X}` +
      `  ${state}${item.executionState ?? "no_plan"}${X}` +
      attention
    );
    console.log(`    ${D}Status:${X} ${item.remediationStatus}  ${D}Plan:${X} ${item.planId ?? "—"}`);
    console.log(`    ${D}Updated:${X} ${item.updatedAt}`);
    if (item.unresolved) console.log(`    ${Y}Unresolved${X}`);
  }
}

// ---------------------------------------------------------------------------
// P18 — Governance Workbench CLI handlers
// ---------------------------------------------------------------------------

const WK_CYAN = "\x1b[36m";
const WK_DIM = "\x1b[2m";
const WK_RED = "\x1b[31m";
const WK_YELLOW = "\x1b[33m";
const WK_GREEN = "\x1b[32m";
const WK_RESET = "\x1b[0m";

const QUEUE_LABELS: Record<string, string> = {
  needs_acceptance: "Needs Acceptance",
  needs_planning: "Needs Planning",
  needs_approval: "Needs Approval",
  needs_followup: "Needs Follow-up",
};

async function runWorkbench(args: string[]): Promise<void> {
  const sub = args[0] ?? "";
  const jsonMode = args.includes("--json");

  switch (sub) {
    case "queue":
      return runWorkbenchQueue(jsonMode);
    case "trace":
      return runWorkbenchTrace(args.slice(1), jsonMode);
    case "summary":
      return runWorkbenchSummary(jsonMode);
    default:
      console.log("Unknown workbench subcommand. Usage:");
      console.log("  alix governance workbench queue [--json]");
      console.log("  alix governance workbench trace <remediationId> [--json]");
      console.log("  alix governance workbench summary [--json]");
  }
}

async function loadWorkbenchSnapshot() {
  const { buildWorkbenchSnapshot } = await import("../../governance/governance-workbench.js");
  const { ExecutionStore } = await import("../../governance/execution-store.js");

  const cwd = process.cwd();
  const attemptStore = new ExecutionStore(cwd);
  const attempts = await attemptStore.list();

  // TODO: Load remediation, plan, and approval stores when they are
  // implemented. Until then, pass empty arrays — behavior stays deterministic.
  return buildWorkbenchSnapshot({
    remediations: [],
    executionPlans: [],
    approvals: [],
    attempts,
    options: { now: new Date().toISOString() },
  });
}

// ---------------------------------------------------------------------------
// runWorkbenchQueue
// ---------------------------------------------------------------------------

async function runWorkbenchQueue(jsonMode: boolean): Promise<void> {
  const snapshot = await loadWorkbenchSnapshot();

  if (jsonMode) {
    console.log(JSON.stringify({ queue: snapshot.queue, summary: snapshot.summary }, null, 2));
    return;
  }

  const total = snapshot.summary.queueCounts.total;
  if (total === 0) {
    console.log(`${WK_GREEN}No pending items. All remediations resolved.${WK_RESET}`);
    return;
  }

  for (const [queueName, items] of Object.entries(snapshot.queue)) {
    if (items.length === 0) continue;
    console.log(`\n${WK_CYAN}${QUEUE_LABELS[queueName] ?? queueName} (${items.length})${WK_RESET}`);
    console.log(`${WK_DIM}${"—".repeat(60)}${WK_RESET}`);
    for (const item of items) {
      const sevColor = item.severity === "critical" ? WK_RED
        : item.severity === "warning" ? WK_YELLOW
        : WK_DIM;
      console.log(`  ${sevColor}${item.severity.toUpperCase()}${WK_RESET} ${item.remediationId}`);
      console.log(`    ${WK_DIM}Reason:${WK_RESET} ${item.reason}`);
      console.log(`    ${WK_DIM}Plan:${WK_RESET} ${item.planId ?? "—"}  ${WK_DIM}Approval:${WK_RESET} ${item.approvalId ?? "—"}`);
      console.log(`    ${WK_DIM}Created:${WK_RESET} ${item.createdAt}`);
    }
  }
}

// ---------------------------------------------------------------------------
// runWorkbenchTrace
// ---------------------------------------------------------------------------

async function runWorkbenchTrace(args: string[], jsonMode: boolean): Promise<void> {
  const remediationId = args.find((a) => !a.startsWith("--"));
  if (!remediationId) {
    console.error("Usage: alix governance workbench trace <remediationId> [--json]");
    return;
  }

  const { ExecutionStore } = await import("../../governance/execution-store.js");
  const { buildWorkbenchSnapshot, buildLifecycleTrace }
    = await import("../../governance/governance-workbench.js");

  const cwd = process.cwd();
  const attemptStore = new ExecutionStore(cwd);
  const attempts = await attemptStore.list();

  // Load snapshot for summary context; build trace via the exported pure function
  // with whatever store data is available. The read model handles all lifecycle
  // classification — the CLI only renders. Currently only ExecutionStore has
  // persistence; other stores pass empty arrays with TODO for when they land.
  /* TODO: Load remediation, plan, and approval stores when implemented */
  const snapshot = buildWorkbenchSnapshot({
    remediations: [],
    executionPlans: [],
    approvals: [],
    attempts,
    options: { now: new Date().toISOString() },
  });

  // Build index maps from available data for buildLifecycleTrace
  const attemptsByPlan = new Map();
  for (const attempt of attempts) {
    const existing = attemptsByPlan.get(attempt.planId);
    if (existing === undefined || attempt.startedAt >= existing.startedAt) {
      attemptsByPlan.set(attempt.planId, attempt);
    }
  }

  const trace = buildLifecycleTrace(
    remediationId,
    [],                                              // remediations — TODO
    new Map(),                                       // plansByRemediation — TODO
    new Map(),                                       // approvalsByPlan — TODO
    attemptsByPlan,
    new Map(),                                       // signalsById — TODO
    new Map(),                                       // investigationsById — TODO
    new Map(),                                       // reportItemsByRemediation — TODO
  );

  if (jsonMode) {
    console.log(JSON.stringify({ trace }, null, 2));
    return;
  }

  console.log(`\n${WK_CYAN}Lifecycle Trace: ${remediationId}${WK_RESET}`);
  console.log(`${WK_DIM}${"—".repeat(60)}${WK_RESET}`);

  if (!trace || trace.hops.length === 0) {
    console.log(`${WK_DIM}Remediation not found: ${remediationId}${WK_RESET}`);
    return;
  }

  // All hops would be gaps when no stores are populated — show a clear message
  const allGaps = trace.hops.every((h) => h.gap);
  if (allGaps) {
    console.log(`${WK_DIM}No lifecycle data found for: ${remediationId}${WK_RESET}`);
    console.log(`${WK_DIM}Cause: remediation stores not yet available from CLI (attempts: ${attempts.length})${WK_RESET}`);
    return;
  }

  for (const hop of trace.hops) {
    const marker = hop.gap ? `${WK_DIM}○${WK_RESET}` : "●";
    const color = hop.gap ? WK_DIM : WK_RESET;
    const id = hop.id || "—";
    const status = hop.status || "—";
    console.log(`  ${hop.kind.padEnd(12)} ${marker} ${color}${id}${WK_RESET}  ${WK_DIM}${status}${WK_RESET}  ${color}${hop.summary}${WK_RESET}`);
  }
}

// ---------------------------------------------------------------------------
// runWorkbenchSummary
// ---------------------------------------------------------------------------

async function runWorkbenchSummary(jsonMode: boolean): Promise<void> {
  const snapshot = await loadWorkbenchSnapshot();

  if (jsonMode) {
    console.log(JSON.stringify(snapshot.summary, null, 2));
    return;
  }

  const s = snapshot.summary;

  console.log(`\n${WK_CYAN}Governance Workbench Summary${WK_RESET}`);
  console.log(`${WK_DIM}${"—".repeat(60)}${WK_RESET}`);
  console.log(`  ${WK_DIM}Queues:${WK_RESET}`);
  console.log(`    ${s.queueCounts.needs_acceptance} needs acceptance`);
  console.log(`    ${s.queueCounts.needs_planning} needs planning`);
  console.log(`    ${s.queueCounts.needs_approval} needs approval`);
  console.log(`    ${s.queueCounts.needs_followup} needs follow-up`);
  console.log(`    ${WK_GREEN}${s.queueCounts.total}${WK_RESET} total pending`);

  console.log(`\n  ${WK_DIM}Lifecycle Totals:${WK_RESET}`);
  console.log(`    ${s.lifecycleTotals.accepted} accepted`);
  console.log(`    ${s.lifecycleTotals.planned} planned`);
  console.log(`    ${s.lifecycleTotals.executed} executed`);
  console.log(`    ${s.lifecycleTotals.failed} failed`);
  console.log(`    ${s.lifecycleTotals.partial} partial`);
  console.log(`    ${s.lifecycleTotals.reverted} reverted`);
  console.log(`    ${s.lifecycleTotals.unresolved} unresolved`);

  if (s.oldestItems.length > 0) {
    console.log(`\n  ${WK_DIM}Oldest pending items:${WK_RESET}`);
    for (const item of s.oldestItems) {
      console.log(`    ${item.remediationId} — ${item.reason}`);
    }
  }
}

function colorForState(state: string | null): string {
  switch (state) {
    case "executed": return "\x1b[32m";  // GREEN
    case "failed":
    case "partial":  return "\x1b[31m";  // RED
    case "reverted": return "\x1b[33m";  // YELLOW
    case "approved": return "\x1b[36m";  // CYAN
    case "rejected": return "\x1b[31m";  // RED
    case "draft":    return "\x1b[2m";   // DIM
    default:         return "\x1b[0m";   // RESET
  }
}

// P19-READINESS-START
// ---------------------------------------------------------------------------
// P19 — Readiness Report CLI
// ---------------------------------------------------------------------------

function readinessFlag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

async function readReadinessBundle(inputPath: string) {
  const { readFileSync, existsSync } = await import("node:fs");
  if (!existsSync(inputPath)) {
    throw new Error(`readiness input not found: "${inputPath}"`);
  }
  const parsed = JSON.parse(readFileSync(inputPath, "utf-8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("readiness input must be a JSON object");
  }
  if (!parsed.workbench || !parsed.policy) {
    throw new Error("readiness input requires workbench and policy");
  }
  return parsed;
}

function readinessPlan(bundle: any, planId: string) {
  const plan = bundle.workbench.executionPlans.find(
    (p: any) => p.planId === planId,
  );
  if (!plan) throw new Error(`execution plan "${planId}" not found`);
  const approvals = bundle.workbench.approvals
    .filter((a: any) => a.planId === planId && a.decision === "approved")
    .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
  if (!approvals.length) {
    throw new Error(`approved approval for plan "${planId}" not found`);
  }
  return { plan, approval: approvals[0] };
}

async function readinessTrace(bundle: any, planId: string) {
  const { buildLifecycleTrace } = await import(
    "../../governance/governance-workbench.js"
  );
  const { plan } = readinessPlan(bundle, planId);
  const plans = new Map<string, import("../../governance/execution-plans.js").GovernanceExecutionPlan>(
    (bundle.workbench.executionPlans ?? []).map((p: any) => [p.remediationId, p]),
  );
  const approvals = new Map<string, import("../../governance/execution-approval.js").GovernanceExecutionApproval>(
    (bundle.workbench.approvals ?? [])
      .slice()
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
      .map((a: any) => [a.planId, a]),
  );
  const attempts = new Map<string, import("../../governance/execution-recorder.js").GovernanceExecutionAttempt>(
    (bundle.workbench.attempts ?? [])
      .slice()
      .sort((a: any, b: any) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))
      .map((a: any) => [a.planId, a]),
  );
  const signals = new Map<string, import("../../governance/governance-signal.js").GovernanceSignal>(
    (bundle.workbench.signals ?? []).map((s: any) => [s.signalId, s]),
  );
  const investigations = new Map<string, import("../../governance/investigation-types.js").InvestigationRecommendation>(
    (bundle.workbench.investigations ?? []).map((i: any) => [i.id, i]),
  );
  return buildLifecycleTrace(
    plan.remediationId,
    bundle.workbench.remediations ?? [],
    plans, approvals, attempts, signals, investigations,
    new Map<string, import("../../governance/execution-report.js").GovernanceExecutionReportItem>(),
  );
}

async function computeReadiness(bundle: any, planId: string) {
  const now = new Date().toISOString();
  const { plan, approval } = readinessPlan(bundle, planId);
  const { classifyExecutionReadiness } = await import(
    "../../governance/execution-readiness.js"
  );
  const { simulateExecutionPlan } = await import(
    "../../governance/dry-run-simulator.js"
  );
  const { evaluateReadinessGate } = await import(
    "../../governance/readiness-policy-gate.js"
  );
  const assessment = classifyExecutionReadiness(plan, approval, { now });
  const simulation = simulateExecutionPlan(plan, approval, assessment, { now });
  const lifecycleTrace = await readinessTrace(bundle, planId);
  const decision = evaluateReadinessGate({
    plan, approval, assessment, simulation,
    policy: bundle.policy,
    visibility: {
      remediationId: plan.remediationId,
      planId: plan.planId,
      approvalId: approval.approvalId,
      lifecycleTrace,
    },
    options: { now },
  });
  return { assessment, simulation, decision, lifecycleTrace };
}

function renderReadinessAssessment(assessment: any): void {
  console.log("Readiness Assessment");
  console.log(`  ID: ${assessment.assessmentId}`);
  console.log(`  Plan: ${assessment.planId} | Remediation: ${assessment.remediationId}`);
  console.log(`  Level: ${assessment.readinessLevel}`);
  console.log(`  Assessed: ${assessment.assessedAt}`);
  console.log("  Reasons:");
  for (const r of assessment.reasons) {
    console.log(`    ${r.code} — ${r.summary}`);
  }
}

function renderReadinessSimulation(simulation: any): void {
  console.log("Dry-Run Simulation");
  console.log(`  ID: ${simulation.simulationId}`);
  console.log(`  Status: ${simulation.status}`);
  console.log("  Actions:");
  for (const p of simulation.actionProjections) {
    console.log(`    ${p.actionId}: ${p.kind} → ${p.status}`);
    console.log(`      ${p.expectedEffect}`);
  }
  if (simulation.rollbackNotes.length) {
    console.log(`  Rollback: ${simulation.rollbackNotes.join("; ")}`);
  }
}

function renderReadinessDecision(decision: any): void {
  console.log("Gate Decision");
  console.log(`  ID: ${decision.decisionId}`);
  console.log(`  Disposition: ${decision.disposition}`);
  console.log(`  Reasons: ${decision.reasonCodes.join(", ")}`);
  console.log(`  Authorization: ${decision.controlledExecutionAuthorization}`);
}

function renderReadinessReport(report: any): void {
  console.log(`Readiness Report (${report.items.length} items)`);
  console.log(`  Window: ${report.windowStart} — ${report.windowEnd}`);
  console.log("  Totals:");
  console.log(`    Blocked: ${report.totals.blocked}`);
  console.log(`    Manual only: ${report.totals.manualOnly}`);
  console.log(`    Dry-run allowed: ${report.totals.dryRunAllowed}`);
  console.log(`    Not evaluated: ${report.totals.notEvaluated}`);
  console.log(`    Missing P18 visibility: ${report.totals.missingP18Visibility}`);
  console.log(`    Future candidates: ${report.totals.futureCandidates}`);
  for (const item of report.items) {
    const flag = item.requiresAttention ? " ⚠" : "  ";
    console.log(`${flag} ${item.remediationId} | ${item.disposition}`);
    console.log(`     Plan: ${item.planId} | P18:${item.p18TracePresent}`);
  }
}

async function runReadiness(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const jsonMode = args.includes("--json");

  try {
    const inputPath = readinessFlag(args, "--input");
    if (!inputPath) {
      throw new Error("--input is required (path to readiness input bundle)");
    }
    const bundle = await readReadinessBundle(inputPath);

    if (subcommand === "report") {
      const { buildExecutionReadinessReport } = await import(
        "../../governance/execution-readiness-report.js"
      );
      const results = [];
      for (const plan of bundle.workbench.executionPlans) {
        if (bundle.workbench.approvals.some(
          (a: any) => a.planId === plan.planId && a.decision === "approved",
        )) {
          results.push(await computeReadiness(bundle, plan.planId));
        }
      }
      const report = buildExecutionReadinessReport({
        assessments: results.map((r: any) => r.assessment),
        simulations: results.map((r: any) => r.simulation),
        decisions: results.map((r: any) => r.decision),
        lifecycleTraces: results.map((r: any) => r.lifecycleTrace),
        options: {
          since: parseInlineFlag(args, "--since") ?? undefined,
          until: parseInlineFlag(args, "--until") ?? undefined,
          now: new Date().toISOString(),
        },
      });
      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        renderReadinessReport(report);
      }
      return;
    }

    if (!["classify", "simulate", "evaluate"].includes(subcommand)) {
      throw new Error(
        "usage: alix governance readiness {classify|simulate|evaluate} <plan-id> --input <path> [--json]\n" +
        "       alix governance readiness report --input <path> [--json] [--since <iso>] [--until <iso>]",
      );
    }

    const planId = args[1];
    if (!planId) {
      throw new Error(`readiness "${subcommand}" requires a plan ID`);
    }

    if (subcommand === "classify") {
      const { plan, approval } = readinessPlan(bundle, planId);
      const { classifyExecutionReadiness } = await import(
        "../../governance/execution-readiness.js"
      );
      const assessment = classifyExecutionReadiness(plan, approval, {
        now: new Date().toISOString(),
      });
      if (jsonMode) {
        console.log(JSON.stringify(assessment, null, 2));
      } else {
        renderReadinessAssessment(assessment);
      }
      return;
    }

    const result = await computeReadiness(bundle, planId);

    if (subcommand === "simulate") {
      if (jsonMode) {
        console.log(JSON.stringify(result.simulation, null, 2));
      } else {
        renderReadinessSimulation(result.simulation);
      }
      return;
    }

    if (subcommand === "evaluate") {
      if (jsonMode) {
        console.log(JSON.stringify(result.decision, null, 2));
      } else {
        renderReadinessDecision(result.decision);
      }
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, code: "readiness_error", message }));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

// P19-READINESS-END

// P20-HANDOFF-START
// ---------------------------------------------------------------------------
// P20 — Handoff CLI
// ---------------------------------------------------------------------------

function handoffFlag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function renderHandoffReport(report: any): void {
  console.log(`Handoff Report (${report.items.length} items)`);
  console.log(`  Window: ${report.windowStart} — ${report.windowEnd}`);
  console.log("  Totals:");
  console.log(`    Pending: ${report.totals.pending}`);
  console.log(`    Completed: ${report.totals.completed}`);
  console.log(`    Failed: ${report.totals.failed}`);
  console.log(`    Evidence missing: ${report.totals.evidenceMissing}`);
  for (const item of report.items) {
    console.log(`  ${item.handoffId} | ${item.status} | ${item.planId} | ${item.actionCount} actions`);
  }
}

async function runHandoff(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const jsonMode = args.includes("--json");

  try {
    if (subcommand === "report") {
      const { buildHandoffReport } = await import("../../governance/handoff-report.js");
      const { readFileSync, existsSync } = await import("node:fs");
      const inputPath = handoffFlag(args, "--input");
      if (!inputPath) throw new Error("--input is required");
      if (!existsSync(inputPath)) throw new Error(`input not found: "${inputPath}"`);

      const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));
      const report = buildHandoffReport(
        bundle.handoffs ?? [],
        bundle.validations ?? [],
        bundle.attempts ?? [],
        {
          since: handoffFlag(args, "--since") ?? undefined,
          until: handoffFlag(args, "--until") ?? undefined,
          now: new Date().toISOString(),
        },
      );
      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        renderHandoffReport(report);
      }
      return;
    }

    if (!["build", "validate", "prepare-record"].includes(subcommand)) {
      throw new Error(
        "usage: alix governance handoff {build|validate|prepare-record|report} <plan-id> --input <path> [--json]",
      );
    }

    const planId = args[1];
    if (!planId) throw new Error(`handoff "${subcommand}" requires a plan ID`);

    const inputPath = handoffFlag(args, "--input");
    if (!inputPath) throw new Error("--input is required");

    const { readFileSync, existsSync } = await import("node:fs");
    if (!existsSync(inputPath)) throw new Error(`input not found: "${inputPath}"`);

    const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));

    if (subcommand === "build") {
      const { buildHandoffPackage } = await import("../../governance/handoff-builder.js");
      const { classifyExecutionReadiness } = await import("../../governance/execution-readiness.js");
      const { simulateExecutionPlan } = await import("../../governance/dry-run-simulator.js");
      const { evaluateReadinessGate } = await import("../../governance/readiness-policy-gate.js");
      const { buildLifecycleTrace } = await import("../../governance/governance-workbench.js");

      const plan = bundle.executionPlans?.find((p: any) => p.planId === planId);
      if (!plan) throw new Error(`plan "${planId}" not found`);
      const approval = bundle.approvals?.find(
        (a: any) => a.planId === planId && a.decision === "approved",
      );
      if (!approval) throw new Error(`approved approval for "${planId}" not found`);

      const now = new Date().toISOString();
      const assessment = classifyExecutionReadiness(plan, approval, { now });
      const simulation = simulateExecutionPlan(plan, approval, assessment, { now });
      const plansMap = new Map<string, any>(bundle.executionPlans?.map((p: any) => [p.remediationId, p]) ?? []);
      const approvalsMap = new Map<string, any>(bundle.approvals?.map((a: any) => [a.planId, a]) ?? []);
      const lifecycleTrace = buildLifecycleTrace(
        plan.remediationId, bundle.remediations ?? [],
        plansMap, approvalsMap, new Map(), new Map(), new Map(), new Map(),
      );
      const decision = evaluateReadinessGate({
        plan, approval, assessment, simulation,
        policy: bundle.policy,
        visibility: { remediationId: plan.remediationId, planId: plan.planId, approvalId: approval.approvalId, lifecycleTrace },
        options: { now },
      });
      const pkg = buildHandoffPackage({ plan, approval, assessment, simulation, decision, lifecycleTrace }, { now });

      if (jsonMode) {
        console.log(JSON.stringify(pkg, null, 2));
      } else {
        console.log("Handoff Package");
        console.log(`  ID: ${pkg.handoffId}`);
        console.log(`  Plan: ${pkg.planId} | Disposition: ${pkg.disposition}`);
        console.log(`  Actions: ${pkg.actions.length}`);
        console.log(`  Status: ${pkg.status} | Manual only: ${pkg.explicitlyManualOnly}`);
      }
      return;
    }

    if (subcommand === "validate") {
      const { validateHandoffEvidence } = await import("../../governance/handoff-evidence.js");
      const handoffs = bundle.handoffs ?? [];
      const handoff = handoffs.find((h: any) => h.handoffId === planId);
      if (!handoff) throw new Error(`handoff "${planId}" not found`);
      const evidencePath = handoffFlag(args, "--evidence");
      if (!evidencePath || !existsSync(evidencePath)) throw new Error("--evidence path required");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf-8"));
      const requiredRefs = (handoff.evidence ?? []).filter((e: any) => e.required).map((e: any) => e.ref);
      const result = validateHandoffEvidence(requiredRefs, evidence);

      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Evidence Validation: ${result.valid ? "PASS" : "FAIL"}`);
        console.log(`  Required: ${result.totalRequired} Captured: ${result.totalCaptured}`);
        if (result.missingRefs.length) console.log(`  Missing: ${result.missingRefs.join(", ")}`);
      }
      return;
    }

    if (subcommand === "prepare-record") {
      const { prepareHandoffRecord } = await import("../../governance/handoff-recorder.js");
      const handoffs = bundle.handoffs ?? [];
      const handoff = handoffs.find((h: any) => h.handoffId === planId);
      if (!handoff) throw new Error(`handoff "${planId}" not found`);
      const evidencePath = handoffFlag(args, "--evidence");
      if (!evidencePath || !existsSync(evidencePath)) throw new Error("--evidence path required");

      const evidence = JSON.parse(readFileSync(evidencePath, "utf-8"));
      const record = prepareHandoffRecord(handoff, evidence, { now: new Date().toISOString() });

      if (jsonMode) {
        console.log(JSON.stringify(record, null, 2));
      } else {
        console.log("Handoff Record (not persisted)");
        console.log(`  Attempt: ${record.attemptId}`);
        console.log(`  Status: ${record.status}`);
        console.log(`  Actions: ${record.actionResults.length}`);
        console.log(`  Executed by: ${record.executedBy}`);
      }
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, code: "handoff_error", message }));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

// P20-HANDOFF-END

// P21-CLOSURE-START
// ---------------------------------------------------------------------------
// P21 — Closure CLI
// ---------------------------------------------------------------------------

async function runClosureEvidenceAppend(args: string[], bundle: any): Promise<void> {
  const ref = {
    evidenceId: args[2] ?? "",
    handoffId: args[1] ?? "",
    preparedRecordId: null,
    kind: "manual_verification_note" as const,
    uri: null,
    label: "",
    summary: "",
    submittedBy: "",
    submittedAt: new Date().toISOString(),
    contentHash: null,
    auditRefs: [],
  };
  throw new Error("Usage: alix governance handoff evidence append --handoff <id> --kind <kind> --label <text> --summary <text> --submitted-by <op> [--uri <url>] [--prepared-record <id>] [--content-hash <hash>] [--json]");
}

async function runHandoffClosureAction(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const jsonMode = args.includes("--json");

  try {
    if (!["evidence", "closure"].includes(subcommand)) {
      throw new Error("usage: alix governance handoff {evidence|closure} ...");
    }

    if (subcommand === "closure" && args[1] === "report") {
      const { buildHumanExecutionClosureReport } = await import(
        "../../governance/human-execution-closure-report.js"
      );
      const { readFileSync, existsSync } = await import("node:fs");
      const inputPath = closureFlag(args, "--input");
      if (!inputPath) throw new Error("--input is required");
      if (!existsSync(inputPath)) throw new Error(`input not found: "${inputPath}"`);

      const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));
      const report = buildHumanExecutionClosureReport(
        bundle.handoffRefs ?? [],
        bundle.evidenceRefs ?? [],
        bundle.closureReviews ?? [],
        {
          since: closureFlag(args, "--since") ?? undefined,
          until: closureFlag(args, "--until") ?? undefined,
          now: new Date().toISOString(),
        },
      );

      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Closure Report (${report.items.length} items)`);
        console.log(`  Window: ${report.windowStart} — ${report.windowEnd}`);
        console.log("  Totals:");
        console.log(`    Awaiting evidence: ${report.totals.awaitingEvidence}`);
        console.log(`    Evidence submitted: ${report.totals.withEvidence - report.totals.accepted - report.totals.rejected - report.totals.incomplete - report.totals.needsFollowUp}`);
        console.log(`    Accepted: ${report.totals.accepted}`);
        console.log(`    Rejected: ${report.totals.rejected}`);
        console.log(`    Incomplete: ${report.totals.incomplete}`);
        console.log(`    Needs follow-up: ${report.totals.needsFollowUp}`);
        for (const item of report.items) {
          const flag = item.followUpRequired ? " ⚠" : "  ";
          console.log(`${flag} ${item.handoffId} | ${item.status} | ${item.evidenceCount} ev`);
        }
      }
      return;
    }

    if (subcommand === "evidence" && args[1] === "append") {
      const handoffId = closureFlag(args, "--handoff");
      const kind = closureFlag(args, "--kind");
      const label = closureFlag(args, "--label");
      const summary = closureFlag(args, "--summary");
      const submittedBy = closureFlag(args, "--submitted-by");
      const uri = closureFlag(args, "--uri");
      const preparedRecordId = closureFlag(args, "--prepared-record");
      const contentHash = closureFlag(args, "--content-hash");
      const inputPath = closureFlag(args, "--input");

      if (!handoffId) throw new Error("--handoff is required");
      if (!kind) throw new Error("--kind is required");
      if (!label) throw new Error("--label is required");
      if (!summary) throw new Error("--summary is required");
      if (!submittedBy) throw new Error("--submitted-by is required");

      const { readFileSync, existsSync } = await import("node:fs");
      if (!inputPath || !existsSync(inputPath)) throw new Error("--input path required (bundle with store config)");
      const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));

      const { FileEvidenceLedgerStore } = await import("../../governance/human-execution-evidence-ledger.js");
      const { FileClosureReviewStore } = await import("../../governance/human-execution-closure-review.js");
      const { AuditedClosureRecorder } = await import("../../governance/audited-human-execution-closure.js");
      const { mkdirSync, existsSync: dirExists } = await import("node:fs");
      const { dirname } = await import("node:path");

      const storeDir = bundle.storeDir ?? ".alix/governance";
      const evPath = `${storeDir}/human-execution-evidence-ledger.jsonl`;
      const revPath = `${storeDir}/human-execution-closure-reviews.jsonl`;
      const auditPath = `${storeDir}/p21-audit-events.jsonl`;

      const evStore = new FileEvidenceLedgerStore(evPath);
      const revStore = new FileClosureReviewStore(revPath, () => evStore.listEvidence());
      const recorder = new AuditedClosureRecorder(evStore, revStore, auditPath);

      const evidenceRef = {
        evidenceId: `${handoffId}-${kind}-${Date.now()}`,
        handoffId,
        preparedRecordId: preparedRecordId ?? null,
        kind: kind as any,
        uri: uri ?? null,
        label,
        summary,
        submittedBy,
        submittedAt: new Date().toISOString(),
        contentHash: contentHash ?? null,
        auditRefs: [],
      };

      const result = await recorder.appendEvidence(evidenceRef);
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Evidence appended: ${result.evidenceId}`);
        console.log(`  Handoff: ${result.handoffId}`);
        console.log(`  Audit refs: ${result.auditRefs.join(", ")}`);
      }
      return;
    }

    if (subcommand === "closure" && args[1] === "review") {
      const handoffId = closureFlag(args, "--handoff");
      const decision = closureFlag(args, "--decision");
      const rationale = closureFlag(args, "--rationale");
      const reviewedBy = closureFlag(args, "--reviewed-by");
      const evidenceIdsRaw = closureFlag(args, "--evidence");
      const followUpSummary = closureFlag(args, "--follow-up-summary");
      const inputPath = closureFlag(args, "--input");

      if (!handoffId) throw new Error("--handoff is required");
      if (!decision) throw new Error("--decision is required");
      if (!rationale) throw new Error("--rationale is required");
      if (!reviewedBy) throw new Error("--reviewed-by is required");
      if (!evidenceIdsRaw) throw new Error("--evidence is required (comma-separated IDs)");

      const { readFileSync, existsSync } = await import("node:fs");
      if (!inputPath || !existsSync(inputPath)) throw new Error("--input path required");
      const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));

      const { FileEvidenceLedgerStore } = await import("../../governance/human-execution-evidence-ledger.js");
      const { FileClosureReviewStore } = await import("../../governance/human-execution-closure-review.js");
      const { AuditedClosureRecorder } = await import("../../governance/audited-human-execution-closure.js");

      const storeDir = bundle.storeDir ?? ".alix/governance";
      const evPath = `${storeDir}/human-execution-evidence-ledger.jsonl`;
      const revPath = `${storeDir}/human-execution-closure-reviews.jsonl`;
      const auditPath = `${storeDir}/p21-audit-events.jsonl`;

      const evStore = new FileEvidenceLedgerStore(evPath);
      const revStore = new FileClosureReviewStore(revPath, () => evStore.listEvidence());
      const recorder = new AuditedClosureRecorder(evStore, revStore, auditPath);

      const evidenceIds = evidenceIdsRaw.split(",").map((s: string) => s.trim());
      const internalDecision = decision.replace(/-/g, "_");

      const review = {
        closureReviewId: `cr-${handoffId}-${Date.now()}`,
        handoffId,
        preparedRecordId: closureFlag(args, "--prepared-record") ?? null,
        decision: internalDecision as any,
        rationale,
        reviewedBy,
        reviewedAt: new Date().toISOString(),
        evidenceIds,
        followUpRequired: internalDecision === "needs_follow_up" || internalDecision === "incomplete",
        followUpSummary: followUpSummary ?? null,
        auditRefs: [],
      };

      const result = await recorder.appendReview(review);
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Closure review recorded: ${result.closureReviewId}`);
        console.log(`  Handoff: ${result.handoffId}`);
        console.log(`  Decision: ${result.decision}`);
        console.log(`  Audit refs: ${result.auditRefs.join(", ")}`);
      }
      return;
    }

    throw new Error("usage: alix governance handoff {evidence append ...|closure review ...|closure report ...}");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, code: "closure_error", message }));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

function closureFlag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

// P21-CLOSURE-END

// P22-INTELLIGENCE-START
// ---------------------------------------------------------------------------
// P22 — Intelligence CLI (read-only)
// ---------------------------------------------------------------------------

async function runIntelligence(args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";
  const jsonMode = args.includes("--json");

  try {
    const inputPath = intelligenceFlag(args, "--input") ?? intelligenceFlag(args, "-i");
    if (!inputPath) throw new Error("--input is required");
    const { readFileSync, existsSync } = await import("node:fs");
    if (!existsSync(inputPath)) throw new Error(`input not found: "${inputPath}"`);

    const bundle = JSON.parse(readFileSync(inputPath, "utf-8"));
    const handoffRefs = bundle.handoffRefs ?? [];
    const evidenceRefs = bundle.evidenceRefs ?? [];
    const closureReviews = bundle.closureReviews ?? [];
    const now = new Date().toISOString();

    if (subcommand === "outcomes") {
      const { aggregateClosureOutcomes } = await import("../../governance/handoff-outcome-aggregate.js");
      const since = intelligenceFlag(args, "--since") ?? new Date(Date.parse(now) - 7 * 86400000).toISOString();
      const until = intelligenceFlag(args, "--until") ?? now;
      const result = aggregateClosureOutcomes(handoffRefs, evidenceRefs, closureReviews, since, until);
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Closure Outcomes (${result.periodStart} — ${result.periodEnd})`);
        console.log(`  Total handoffs: ${result.totalHandoffs}`);
        console.log(`  Accepted: ${result.byStatus.accepted}`);
        console.log(`  Rejected: ${result.byStatus.rejected}`);
        console.log(`  Incomplete: ${result.byStatus.incomplete}`);
        console.log(`  Needs follow-up: ${result.byStatus.needsFollowUp}`);
        console.log(`  Awaiting evidence: ${result.byStatus.awaitingEvidence}`);
      }
      return;
    }

    if (subcommand === "signals") {
      const { detectHandoffQualitySignals } = await import("../../governance/handoff-quality-signals.js");
      const slowClosureDays = Number(intelligenceFlag(args, "--slow-closure-days") ?? "14");
      const signals = detectHandoffQualitySignals(handoffRefs, evidenceRefs, closureReviews, {
        slowClosureDays, detectedAt: now,
      });
      const severityFilter = intelligenceFlag(args, "--severity");
      const filtered = severityFilter ? signals.filter((s: any) => s.severity === severityFilter) : signals;

      if (jsonMode) {
        console.log(JSON.stringify(filtered, null, 2));
      } else {
        console.log(`Quality Signals (${filtered.length})`);
        for (const s of filtered) {
          console.log(`  [${s.severity}] ${s.signalCode} — ${s.handoffId}`);
          console.log(`    ${s.summary}`);
        }
      }
      return;
    }

    if (subcommand === "calibration") {
      const { calibrateReadiness } = await import("../../governance/handoff-readiness-calibration.js");
      const result = calibrateReadiness(handoffRefs, closureReviews);
      if (jsonMode) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Readiness Calibration (${result.length} signals)`);
        const over = result.filter((s: any) => s.calibration === "overconfident").length;
        const under = result.filter((s: any) => s.calibration === "underconfident").length;
        const acc = result.filter((s: any) => s.calibration === "accurate").length;
        console.log(`  Overconfident: ${over}`);
        console.log(`  Underconfident: ${under}`);
        console.log(`  Accurate: ${acc}`);
      }
      return;
    }

    if (subcommand === "report") {
      const { buildHandoffIntelligenceReport } = await import("../../governance/handoff-intelligence-report.js");
      const since = intelligenceFlag(args, "--since") ?? undefined;
      const until = intelligenceFlag(args, "--until") ?? undefined;
      const slowClosureDays = Number(intelligenceFlag(args, "--slow-closure-days") ?? "14");
      const report = buildHandoffIntelligenceReport(handoffRefs, evidenceRefs, closureReviews, {
        since, until, now, slowClosureDays,
      });
      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`Intelligence Report v${report.schemaVersion}`);
        console.log(`  Window: ${report.windowStart} — ${report.windowEnd}`);
        console.log(`  Total handoffs: ${report.outcomeAggregate.totalHandoffs}`);
        console.log(`  Quality signals: ${report.summary.totalQualitySignals} (${report.summary.criticalSignals} critical, ${report.summary.warningSignals} warning, ${report.summary.infoSignals} info)`);
        console.log(`  Calibration: ${report.summary.totalCalibrationSignals} (${report.summary.overconfidentCount} overconfident, ${report.summary.underconfidentCount} underconfident, ${report.summary.accurateCount} accurate)`);
      }
      return;
    }

    throw new Error("usage: alix governance intelligence {outcomes|signals|calibration|report} --input <path> [--json] [--since <iso>] [--until <iso>]");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode) {
      console.log(JSON.stringify({ ok: false, code: "intelligence_error", message }));
    } else {
      console.error(message);
    }
    process.exit(1);
  }
}

function intelligenceFlag(args: string[], name: string): string | null {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

// P22-INTELLIGENCE-END

const EVENT_TYPE_COLORS: Record<string, string> = {
  policy_evaluated: CYAN,
  action_allowed: GREEN,
  action_denied: RED,
  action_escalated: YELLOW,
  human_approval_requested: CYAN,
  human_approval_granted: GREEN,
  human_approval_denied: RED,
  override_applied: MAGENTA,
};

function eventTypeColor(eventType: string): string {
  return EVENT_TYPE_COLORS[eventType] ?? RESET;
}

async function runAudit(rawArgs: string[]): Promise<void> {
  const args = rawArgs.slice(); // copy
  const jsonMode = args.includes("--json");

  const sub = args.shift();
  // Remove --json so subcommand handlers don't see it
  if (jsonMode) {
    const idx = args.indexOf("--json");
    if (idx >= 0) args.splice(idx, 1);
  }

  const cwd = process.cwd();

  switch (sub) {
    case undefined:
      printAuditHelp();
      return;
    case "list":
      return runAuditList(cwd, args, jsonMode);
    case "show":
      return runAuditShow(cwd, args, jsonMode);
    case "trace":
      return runAuditTrace(cwd, args, jsonMode);
    case "timeline":
      return runAuditTimeline(cwd, args, jsonMode);
    case "stats":
      return runAuditStats(cwd, args, jsonMode);
    case "anomalies":
      return runAuditAnomalies(cwd, args, jsonMode);
    case "effectiveness":
      return runAuditEffectiveness(cwd, args, jsonMode);
    case "report":
      return runAuditReport(cwd, args, jsonMode);
    case "actor":
      return runAuditActor(cwd, args, jsonMode);
    case "policy":
      return runAuditPolicy(cwd, args, jsonMode);
    case "verify":
      return runAuditVerify(cwd, jsonMode);
    case "export":
      return runAuditExport(cwd, args, jsonMode);
    default:
      console.log(
        RED +
          'Unknown audit subcommand "' +
          sub +
          '". Expected: list, show, trace, timeline, stats, anomalies, effectiveness, report, actor, policy, verify, export' +
          RESET,
      );
      process.exit(1);
  }
}

/**
 * P14.8 — Help for bare `alix governance audit` (no subcommand).
 * Prints the subcommand surface + examples; exits 0.
 */
function printAuditHelp(): void {
  console.log(BOLD + "alix governance audit — Governance Audit Trail inspection" + RESET);
  console.log("");
  console.log(DIM + "Subcommands:" + RESET);
  console.log("  list       List audit events (filters: --limit, --event-type, --subject,");
  console.log("             --risk, --decision, --actor-type, --actor-id, --policy, --trace, --from, --to)");
  console.log("  show       Show a single event in detail (--related for correlated events)");
  console.log("  trace      Events for a trace id");
  console.log("  timeline   Compact chronological timeline (--trace, --actor-id, --limit)");
  console.log("  actor      Events for an actor id (--actor-type)");
  console.log("  policy     Events for a policy id");
  console.log("  verify     Verify the hash chain");
  console.log("  export     Export the audit trail to a file");
  console.log("  stats      Governance metrics (--window, --from, --to, --top)");
  console.log("  anomalies      Detect anomalies (--recent, --baseline, --severity, --type)");
  console.log("  effectiveness  Operator outcome signals (--since, --until, --stale-days)");
  console.log("  report     Governance observability report (--section, --since, --until, --json)");
  console.log("");
  console.log(DIM + "All subcommands accept --json for machine-readable output." + RESET);
  console.log("");
  console.log(DIM + "Examples:" + RESET);
  console.log("  alix governance audit list --limit 20 --event-type action_escalated");
  console.log("  alix governance audit timeline --trace req-123");
  console.log("  alix governance audit show aud-abc123 --related");
}

// ---------------------------------------------------------------------------
// P14.8 — Pure format helpers (unit-testable; return strings, no console I/O)
// ---------------------------------------------------------------------------

/** Structural subset of GovernanceAuditEvent needed for timeline rendering. */
interface TimelineEvent {
  timestamp: string;
  eventType: string;
  actorType: string;
  actorId: string;
  subjectType: string;
  subjectId: string | null;
  traceId: string | null;
  decision: string;
}

/**
 * Render a metadata object as indented key:value lines.
 * Scalar values render as `key: value`; nested objects/arrays fall back to
 * compact JSON so nothing is silently dropped. Returns "" for empty metadata.
 */
export function formatMetadata(metadata: Record<string, unknown>): string {
  const keys = Object.keys(metadata);
  if (keys.length === 0) return "";
  return keys
    .map((k) => {
      const v = metadata[k];
      const rendered =
        v === null || v === undefined
          ? "-"
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
      return `  ${k}: ${rendered}`;
    })
    .join("\n");
}

/**
 * Render one compact timeline line for an event.
 * Format: <timestamp>  <eventType>  <actorType>:<actorId>  <subjectType>:<subjectId>  <decision/traceId>
 */
export function formatTimelineLine(ev: TimelineEvent): string {
  const ts = ev.timestamp.slice(0, 19).replace("T", " ");
  const subject = ev.subjectId ? `${ev.subjectType}:${ev.subjectId}` : ev.subjectType;
  const tail = ev.traceId ?? ev.decision;
  return `${ts}  ${ev.eventType}  ${ev.actorType}:${ev.actorId}  ${subject}  ${tail}`;
}

/**
 * P14.8 `show --related` — compute correlated events deterministically.
 * Order: (1) same traceId, (2) same sessionId, (3) parent/child via parentEventId,
 * (4) de-dup by eventId, (5) chronological, (6) exclude the event itself.
 * Pure: takes all events + the focal event id, returns the related list.
 */
export function computeRelatedEvents<
  T extends { eventId: string; traceId: string | null; sessionId: string | null; parentEventId: string | null; timestamp: string },
>(all: T[], focalId: string): T[] {
  const focal = all.find((e) => e.eventId === focalId);
  if (!focal) return [];

  const seen = new Set<string>([focalId]);
  const matches = new Set<string>();

  for (const e of all) {
    if (e.eventId === focalId) continue;
    const sameTrace = focal.traceId !== null && e.traceId === focal.traceId;
    const sameSession = focal.sessionId !== null && e.sessionId === focal.sessionId;
    const parentChild =
      (focal.parentEventId !== null && e.eventId === focal.parentEventId) ||
      (e.parentEventId !== null && e.parentEventId === focalId);
    if (sameTrace || sameSession || parentChild) {
      if (!seen.has(e.eventId)) {
        seen.add(e.eventId);
        matches.add(e.eventId);
      }
    }
  }

  return all
    .filter((e) => matches.has(e.eventId))
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

async function runAuditList(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const {
    queryByActor,
    queryByPolicy,
    queryByTraceId,
    queryByDecision,
    queryByTimeRange,
  } = await import("../../governance/audit-query.js");

  const store = new FileAuditStore(cwd);
  let events = await store.list();

  // Parse filters
  const decisionFilter = parseInlineFlag(args, "--decision");
  const actorTypeFilter = parseInlineFlag(args, "--actor-type");
  const actorIdFilter = parseInlineFlag(args, "--actor-id");
  const policyFilter = parseInlineFlag(args, "--policy");
  const traceFilter = parseInlineFlag(args, "--trace");
  const fromFilter = parseInlineFlag(args, "--from");
  const toFilter = parseInlineFlag(args, "--to");
  const eventTypeFilter = parseInlineFlag(args, "--event-type");
  const subjectFilter = parseInlineFlag(args, "--subject");
  const riskFilter = parseInlineFlag(args, "--risk");
  const limitArg = parseInlineFlag(args, "--limit");

  // P14.8 — validate enum filters against the canonical sets
  if (eventTypeFilter) {
    const { VALID_EVENT_TYPES } = await import("../../governance/audit-types.js");
    if (!(VALID_EVENT_TYPES as readonly string[]).includes(eventTypeFilter)) {
      console.log(RED + `Invalid --event-type "${eventTypeFilter}". Valid: ${VALID_EVENT_TYPES.join(", ")}` + RESET);
      process.exit(1);
    }
  }
  if (riskFilter) {
    const { VALID_RISK_LEVELS } = await import("../../governance/audit-types.js");
    if (!(VALID_RISK_LEVELS as readonly string[]).includes(riskFilter)) {
      console.log(RED + `Invalid --risk "${riskFilter}". Valid: ${VALID_RISK_LEVELS.join(", ")}` + RESET);
      process.exit(1);
    }
  }

  // P14.8 --limit: positive integer, default 50, reject 0/negative/non-number
  let limit = 50;
  if (limitArg !== null) {
    const parsed = Number(limitArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.log(RED + `Invalid --limit "${limitArg}". Must be a positive integer.` + RESET);
      process.exit(1);
    }
    limit = parsed;
  }

  if (decisionFilter) {
    events = queryByDecision(events, decisionFilter as any);
  }
  if (actorTypeFilter) {
    events = queryByActor(events, actorTypeFilter as any, actorIdFilter ?? undefined);
  } else if (actorIdFilter) {
    events = events.filter((e) => e.actorId === actorIdFilter);
  }
  if (policyFilter) {
    events = queryByPolicy(events, policyFilter);
  }
  if (traceFilter) {
    events = queryByTraceId(events, traceFilter);
  }
  if (fromFilter || toFilter) {
    events = queryByTimeRange(events, fromFilter ?? undefined, toFilter ?? undefined);
  }
  // P14.8 — exact-match filters (case-sensitive, consistent with existing filters)
  if (eventTypeFilter) {
    events = events.filter((e) => e.eventType === eventTypeFilter);
  }
  if (subjectFilter) {
    // matches subjectId OR subjectType
    events = events.filter((e) => e.subjectId === subjectFilter || e.subjectType === subjectFilter);
  }
  if (riskFilter) {
    events = events.filter((e) => e.riskLevel === riskFilter);
  }

  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(DIM + "No audit events found" + RESET);
    return;
  }

  console.log(
    BOLD + "Governance Audit Events (" + events.length + ")" + RESET,
  );
  console.log("");

  for (const ev of events.slice(0, limit)) {
    const color = eventTypeColor(ev.eventType);
    const tag = ev.eventType.padEnd(30);
    console.log(
      color + tag + RESET +
      ev.timestamp.slice(0, 19).replace("T", " ") + "  " +
      DIM + ev.eventId + RESET,
    );
    console.log(
      "  " + BOLD + ev.decision + RESET +
      "  " + DIM + ev.actorType + "/" + ev.actorId + RESET,
    );
    if (ev.policyId) {
      console.log("  " + DIM + "policy: " + ev.policyId + (ev.policyVersion ? " v" + ev.policyVersion : "") + RESET);
    }
    console.log("  " + ev.reason.slice(0, 120));
    console.log("");
  }

  if (events.length > limit) {
    console.log(DIM + "... and " + (events.length - limit) + " more" + RESET);
  }
}

async function runAuditShow(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const eventId = args.find((a) => !a.startsWith("--"));
  if (!eventId) {
    console.log(RED + "Usage: alix governance audit show <event-id> [--related]" + RESET);
    process.exit(1);
  }

  const relatedRequested = args.includes("--related");

  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const store = new FileAuditStore(cwd);
  const event = await store.getById(eventId);

  if (!event) {
    console.log(RED + "Audit event not found: " + eventId + RESET);
    process.exit(1);
  }

  // P14.8 — related events (deterministic correlation via computeRelatedEvents)
  const related = relatedRequested ? computeRelatedEvents(await store.list(), event.eventId) : [];

  if (jsonMode) {
    console.log(JSON.stringify(relatedRequested ? { ...event, related } : event, null, 2));
    return;
  }

  const color = eventTypeColor(event.eventType);
  console.log("");
  console.log(BOLD + "Event: " + event.eventId + RESET);
  console.log("");
  console.log( BOLD + "Type:" + RESET + "      " + color + event.eventType + RESET);
  console.log( BOLD + "Timestamp:" + RESET + " " + event.timestamp);
  console.log("");
  console.log( BOLD + "Actor:" + RESET + "     " + event.actorType + "/" + event.actorId);
  console.log( BOLD + "Subject:" + RESET + "   " + event.subjectType + (event.subjectId ? " (" + event.subjectId + ")" : ""));
  console.log("");
  console.log( BOLD + "Action:" + RESET + "   " + event.action);
  console.log( BOLD + "Decision:" + RESET + " " + event.decision);
  console.log( BOLD + "Risk:" + RESET + "     " + event.riskLevel + (event.requiresHumanReview ? " (requires human review)" : ""));
  console.log("");

  if (event.policyId) {
    console.log( BOLD + "Policy:" + RESET + "   " + event.policyId + (event.policyVersion ? " v" + event.policyVersion : ""));
    if (event.ruleId) console.log("  Rule: " + event.ruleId);
  }

  console.log( BOLD + "Reason:" + RESET + "   " + event.reason);
  if (event.evidenceRefs.length > 0) {
    console.log( BOLD + "Evidence:" + RESET + "  " + event.evidenceRefs.join(", "));
  }

  if (event.requestId || event.traceId || event.sessionId) {
    console.log("");
    console.log( BOLD + "Trace:" + RESET + "     " + (event.traceId ?? "-"));
    console.log( BOLD + "Request:" + RESET + "   " + (event.requestId ?? "-"));
    console.log( BOLD + "Session:" + RESET + "   " + (event.sessionId ?? "-"));
  }

  if (Object.keys(event.metadata).length > 0) {
    console.log("");
    console.log( BOLD + "Metadata:" + RESET);
    console.log(formatMetadata(event.metadata));
  }

  if (relatedRequested) {
    console.log("");
    console.log( BOLD + "Related events (" + related.length + "):" + RESET);
    if (related.length === 0) {
      console.log(DIM + "  (none)" + RESET);
    } else {
      for (const r of related) {
        console.log("  " + eventTypeColor(r.eventType) + r.eventType + RESET + "  " +
          r.timestamp.slice(0, 19).replace("T", " ") + "  " + DIM + r.eventId + RESET);
      }
    }
  }

  console.log("");
  console.log( BOLD + "Chain:" + RESET);
  console.log( "  Hash:          " + event.eventHash);
  console.log( "  Previous hash: " + (event.previousHash ?? DIM + "(none)" + RESET));
  console.log("");
}

async function runAuditTrace(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const traceId = args.find((a) => !a.startsWith("--"));
  if (!traceId) {
    console.log(RED + "Usage: alix governance audit trace <trace-id>" + RESET);
    process.exit(1);
  }

  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { queryByTraceId } = await import("../../governance/audit-query.js");

  const store = new FileAuditStore(cwd);
  const events = queryByTraceId(await store.list(), traceId);

  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(DIM + "No events found for trace: " + traceId + RESET);
    return;
  }

  console.log(
    BOLD + "Trace: " + traceId + " (" + events.length + " events)" + RESET,
  );
  console.log("");

  for (const ev of events) {
    const color = eventTypeColor(ev.eventType);
    console.log(
      color + ev.eventType.padEnd(28) + RESET +
      ev.timestamp.slice(0, 19).replace("T", " ") + "  " +
      ev.eventId,
    );
    console.log(
      "  " + BOLD + ev.decision + RESET +
      "  " + ev.reason.slice(0, 100),
    );
    console.log("");
  }
}

/**
 * P14.8 — `audit timeline`: compact chronological view (oldest→newest).
 * Optional --trace / --actor-id / --limit. Presentation only.
 */
async function runAuditTimeline(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const traceFilter = parseInlineFlag(args, "--trace");
  const actorIdFilter = parseInlineFlag(args, "--actor-id");
  const limitArg = parseInlineFlag(args, "--limit");

  let limit = 50;
  if (limitArg !== null) {
    const parsed = Number(limitArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.log(RED + `Invalid --limit "${limitArg}". Must be a positive integer.` + RESET);
      process.exit(1);
    }
    limit = parsed;
  }

  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { queryByTraceId } = await import("../../governance/audit-query.js");
  const store = new FileAuditStore(cwd);

  let events = await store.listChronological(); // oldest → newest
  if (traceFilter) events = queryByTraceId(events, traceFilter);
  if (actorIdFilter) events = events.filter((e) => e.actorId === actorIdFilter);
  events = events.slice(0, limit);

  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(DIM + "No audit events" + RESET);
    return;
  }

  console.log(BOLD + "Governance Audit Timeline (" + events.length + ")" + RESET);
  console.log(DIM + "time  eventType  actor  subject  ref   (oldest → newest)" + RESET);
  for (const ev of events) {
    console.log(eventTypeColor(ev.eventType) + formatTimelineLine(ev) + RESET);
  }
  console.log("");
}

/**
 * P15.1 — `audit stats`: governance audit metrics and diagnostics.
 *
 * Sub-subcommand: `before-after <bf> <bt> <af> <at>` for two-window comparison.
 * Flags: --window (minutes, default 60), --from, --to, --top (default 10), --json.
 */
async function runAuditStats(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  // Detect before-after sub-subcommand
  if (args.includes("before-after")) {
    const idx = args.indexOf("before-after");
    const isoArgs = [args[idx + 1], args[idx + 2], args[idx + 3], args[idx + 4]];
    if (isoArgs.some((a) => !a)) {
      console.log(RED + "Usage: alix governance audit stats before-after <bf> <bt> <af> <at> [--json]" + RESET);
      process.exit(1);
    }
    for (const a of isoArgs) {
      if (Number.isNaN(new Date(a).getTime())) {
        console.log(RED + `Invalid ISO timestamp: "${a}"` + RESET);
        process.exit(1);
      }
    }

    const { FileAuditStore } = await import("../../governance/audit-store.js");
    const { beforeAfterComparison } = await import("../../governance/audit-metrics.js");
    const store = new FileAuditStore(cwd);
    const events = await store.list();
    const result = beforeAfterComparison(events, isoArgs[0]!, isoArgs[1]!, isoArgs[2]!, isoArgs[3]!);

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(BOLD + "Governance Audit — Before/After" + RESET);
    console.log(`  ${DIM}Before:${RESET} ${isoArgs[0]} → ${isoArgs[1]}  (${result.before.totalEvents} events)`);
    console.log(`  ${DIM}After:${RESET}  ${isoArgs[2]} → ${isoArgs[3]}  (${result.after.totalEvents} events)`);
    console.log("");
    console.log(BOLD + "Delta:" + RESET);
    console.log(`  totalEvents:    ${deltaSign(result.delta.totalEvents)}${result.delta.totalEvents}`);
    console.log(`  allowed rate:   ${deltaSign(result.delta.decisionRates.allowed)}${result.delta.decisionRates.allowed.toFixed(3)}`);
    console.log(`  denied rate:    ${deltaSign(result.delta.decisionRates.denied)}${result.delta.decisionRates.denied.toFixed(3)}`);
    console.log(`  escalated rate: ${deltaSign(result.delta.decisionRates.escalated)}${result.delta.decisionRates.escalated.toFixed(3)}`);
    console.log(`  overridden rate:${deltaSign(result.delta.decisionRates.overridden)}${result.delta.decisionRates.overridden.toFixed(3)}`);
    if (result.delta.riskDistribution && Object.keys(result.delta.riskDistribution).length > 0) {
      console.log("  risk delta:");
      for (const [k, v] of Object.entries(result.delta.riskDistribution).sort()) {
        console.log(`    ${k}: ${deltaSign(v)}${v}`);
      }
    }
    console.log("");
    return;
  }

  // Standard stats
  const windowArg = parseInlineFlag(args, "--window");
  const fromArg = parseInlineFlag(args, "--from");
  const toArg = parseInlineFlag(args, "--to");
  const topArg = parseInlineFlag(args, "--top");

  // Validate
  let windowMs = 60 * 60 * 1000; // default 60 minutes
  if (windowArg !== null) {
    const parsed = Number(windowArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.log(RED + `Invalid --window "${windowArg}". Must be a positive integer of minutes.` + RESET);
      process.exit(1);
    }
    windowMs = parsed * 60 * 1000;
  }

  if (fromArg !== null && Number.isNaN(new Date(fromArg).getTime())) {
    console.log(RED + `Invalid --from "${fromArg}". Must be an ISO timestamp.` + RESET);
    process.exit(1);
  }
  if (toArg !== null && Number.isNaN(new Date(toArg).getTime())) {
    console.log(RED + `Invalid --to "${toArg}". Must be an ISO timestamp.` + RESET);
    process.exit(1);
  }

  let topN = 10;
  if (topArg !== null) {
    const parsed = Number(topArg);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.log(RED + `Invalid --top "${topArg}". Must be a positive integer.` + RESET);
      process.exit(1);
    }
    topN = parsed;
  }

  // Fetch events
  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const store = new FileAuditStore(cwd);
  let events = await store.list();

  // Apply time filter (inclusive lower, exclusive upper)
  if (fromArg !== null) {
    events = events.filter((e) => e.timestamp >= fromArg!);
  }
  if (toArg !== null) {
    events = events.filter((e) => e.timestamp < toArg!);
  }

  // Compute metrics
  const {
    eventTypeDistribution,
    decisionRates,
    riskDistribution,
    timeWindowedCounts,
    topActors,
    topSubjects,
    policyActivity,
    traceVolume,
  } = await import("../../governance/audit-metrics.js");

  const dist = eventTypeDistribution(events);
  const rates = decisionRates(events);
  const risk = riskDistribution(events);
  const buckets = timeWindowedCounts(events, windowMs);
  const actors = topActors(events, topN);
  const subjects = topSubjects(events, topN);
  const policies = policyActivity(events);
  const trace = traceVolume(events);

  // Render
  if (jsonMode) {
    console.log(JSON.stringify({
      totalEvents: events.length,
      eventTypeDistribution: dist,
      decisionRates: rates,
      riskDistribution: risk,
      timeBuckets: buckets,
      actors,
      subjects,
      policies,
      traceVolume: trace,
    }, null, 2));
    return;
  }

  console.log(BOLD + `Governance Audit Metrics (${events.length} events, ${windowArg ?? "60"}m window)` + RESET);
  console.log(DIM + "─".repeat(50) + RESET);
  console.log("");

  // Event type distribution
  const sortedTypes = Object.entries(dist).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(BOLD + "Event type distribution:" + RESET);
  for (const [type, count] of sortedTypes) {
    const color = eventTypeColor(type as any);
    console.log(`  ${color}${type.padEnd(25)}${RESET} ${count}`);
  }
  console.log("");

  // Decision rates
  console.log(BOLD + "Decision rates:" + RESET);
  for (const [k, v] of Object.entries(rates)) {
    console.log(`  ${k.padEnd(12)} ${(v as number).toFixed(3)}`);
  }
  console.log("");

  // Risk distribution
  const sortedRisk = Object.entries(risk).sort((a, b) => a[0].localeCompare(b[0]));
  console.log(BOLD + "Risk distribution:" + RESET);
  for (const [level, count] of sortedRisk) {
    const color = level === "critical" ? RED : level === "high" ? YELLOW : level === "medium" ? "" : DIM;
    console.log(`  ${color}${level.padEnd(10)}${RESET} ${count}`);
  }
  console.log("");

  // Top actors
  console.log(BOLD + `Top actors (${actors.length}):` + RESET);
  for (const a of actors) {
    console.log(`  ${a.actorId.padEnd(30)} ${a.count}  ${DIM}last: ${a.lastSeen.slice(0, 19).replace("T", " ")}${RESET}`);
  }
  console.log("");

  // Top subjects
  if (subjects.length > 0) {
    console.log(BOLD + `Top subjects (${subjects.length}):` + RESET);
    for (const s of subjects) {
      console.log(`  ${s.subjectType}/${s.subjectId.padEnd(20)} ${s.count}`);
    }
    console.log("");
  }

  // Policy activity
  if (policies.length > 0) {
    console.log(BOLD + `Policy activity (${policies.length}):` + RESET);
    for (const p of policies) {
      console.log(`  ${p.policyId.padEnd(25)} ${p.count}`);
    }
    console.log("");
  }

  // Trace volume
  if (events.length > 0) {
    console.log(BOLD + "Trace volume:" + RESET);
    console.log(`  with trace:  ${trace.eventsWithTrace}  (${(trace.traceRatio * 100).toFixed(0)}%)`);
    console.log(`  without:     ${trace.totalEvents - trace.eventsWithTrace}`);
    console.log("");
  }

  // Time buckets
  if (buckets.length > 0) {
    console.log(BOLD + "Time buckets (" + (windowArg ?? "60") + "m intervals):" + RESET);
    for (const b of buckets) {
      console.log(`  ${b.windowStart.slice(0, 19).replace("T", " ")}  ${b.count}`);
    }
    console.log("");
  }

  // Time window summary
  if (events.length > 0) {
    console.log(DIM + `Time window: ${events.reduce((a, b) => a.timestamp < b.timestamp ? a : b).timestamp.slice(0, 19).replace("T", " ")} → ${events.reduce((a, b) => a.timestamp > b.timestamp ? a : b).timestamp.slice(0, 19).replace("T", " ")}` + RESET);
    console.log("");
  }
}

/** Format a signed delta for display. */
function deltaSign(v: number): string {
  return v > 0 ? "+" : v < 0 ? "" : " ";
}

/**
 * P15.2 — `audit anomalies`: deterministic, explainable anomaly detection.
 * Computed on demand — no persistent anomaly store.
 *
 * Flags: --recent (min, default 60), --baseline (min, default 1440),
 *        --since, --until, --severity, --type, --json.
 */
async function runAuditAnomalies(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const { detectAnomalies } = await import("../../governance/audit-anomalies.js");

  const recentArg = parseInlineFlag(args, "--recent");
  const baselineArg = parseInlineFlag(args, "--baseline");
  const sinceArg = parseInlineFlag(args, "--since");
  const untilArg = parseInlineFlag(args, "--until");
  const severityFilter = parseInlineFlag(args, "--severity");
  const typeFilter = parseInlineFlag(args, "--type");

  // Determine time boundaries
  const now = new Date().toISOString();
  let recentMinutes = 60;
  let baselineMinutes = 1440;

  if (recentArg !== null) {
    const p = Number(recentArg);
    if (!Number.isInteger(p) || p <= 0) {
      console.log(RED + `Invalid --recent "${recentArg}". Must be a positive integer of minutes.` + RESET);
      process.exit(1);
    }
    recentMinutes = p;
  }
  if (baselineArg !== null) {
    const p = Number(baselineArg);
    if (!Number.isInteger(p) || p <= 0) {
      console.log(RED + `Invalid --baseline "${baselineArg}". Must be a positive integer of minutes.` + RESET);
      process.exit(1);
    }
    baselineMinutes = p;
  }

  let recentStart: string;
  let recentEnd: string;
  let baselineStart: string | undefined;
  let baselineEnd: string | undefined;

  if (sinceArg !== null) {
    if (Number.isNaN(new Date(sinceArg).getTime())) {
      console.log(RED + `Invalid --since "${sinceArg}". Must be an ISO timestamp.` + RESET);
      process.exit(1);
    }
    recentStart = sinceArg;
    recentEnd = untilArg ?? now;
    // Baseline is the window of baselineMinutes immediately before recentStart
    const baselineMs = new Date(recentStart).getTime() - baselineMinutes * 60 * 1000;
    baselineStart = new Date(baselineMs).toISOString();
    baselineEnd = recentStart;
  } else {
    recentEnd = now;
    recentStart = new Date(new Date(now).getTime() - recentMinutes * 60 * 1000).toISOString();
    baselineEnd = recentStart;
    baselineStart = new Date(new Date(now).getTime() - (recentMinutes + baselineMinutes) * 60 * 1000).toISOString();
  }

  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const store = new FileAuditStore(cwd);
  const allEvents = await store.list();

  // Filter recent window (inclusive lower, exclusive upper)
  const recentEvents = allEvents.filter(
    (e) => e.timestamp >= recentStart && e.timestamp < recentEnd,
  );

  // Filter baseline window
  const baselineEvents = baselineStart
    ? allEvents.filter((e) => e.timestamp >= baselineStart! && e.timestamp < baselineEnd!)
    : [];

  const includeBaseline = baselineEvents.length > 0;

  const anomalies = detectAnomalies(recentEvents, includeBaseline ? baselineEvents : undefined);

  // Client-side filters
  let filtered = anomalies;
  if (severityFilter) {
    const allowed = ["critical", "warning", "info"];
    if (!(allowed as string[]).includes(severityFilter)) {
      console.log(RED + `Invalid --severity "${severityFilter}". Valid: ${allowed.join(", ")}` + RESET);
      process.exit(1);
    }
    filtered = filtered.filter((a) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] >= order[severityFilter as "critical" | "warning" | "info"];
    });
  }
  if (typeFilter) {
    filtered = filtered.filter((a) => a.type === typeFilter);
  }

  if (jsonMode) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  if (filtered.length === 0) {
    console.log(DIM + "No anomalies detected" + RESET);
    return;
  }

  console.log(BOLD + `Governance Audit Anomalies (${filtered.length} found)` + RESET);
  console.log(DIM + "─".repeat(50) + RESET);
  console.log("");

  let currentSeverity = "";
  for (const a of filtered) {
    if (a.severity !== currentSeverity) {
      currentSeverity = a.severity;
      const sevLabel = a.severity === "critical" ? RED + "CRITICAL" : a.severity === "warning" ? YELLOW + "WARNING" : BOLD + "INFO";
      console.log(sevLabel + RESET + ":");
    }
    console.log(`  ${a.type} — ${a.reason}`);
    console.log(`  ${DIM}Evidence: ${a.evidenceEventIds.join(", ") || "(none)"}${RESET}`);
    console.log(`  ${DIM}Window: ${a.windowStart.slice(0, 19).replace("T", " ")} → ${a.windowEnd.slice(0, 19).replace("T", " ")}${RESET}`);
    console.log("");
  }
}

/**
 * P15.3a — `audit effectiveness`: operator outcome signals.
 * Decision stability, escalation effectiveness, review completeness,
 * stale/stuck deferrals, throughput context (no ranking).
 *
 * Flags: --since, --until, --stale-days, --json.
 */
async function runAuditEffectiveness(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const sinceArg = parseInlineFlag(args, "--since");
  const untilArg = parseInlineFlag(args, "--until");
  const staleArg = parseInlineFlag(args, "--stale-days");
  const now = new Date().toISOString();

  const staleThresholdDays = staleArg !== null ? (() => {
    const p = Number(staleArg);
    if (!Number.isInteger(p) || p <= 0) {
      console.log(RED + `Invalid --stale-days "${staleArg}". Must be a positive integer.` + RESET);
      process.exit(1);
    }
    return p;
  })() : 7;

  // Default: last 7 days
  const since = sinceArg ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const until = untilArg ?? now;

  if (sinceArg !== null && Number.isNaN(new Date(sinceArg).getTime())) {
    console.log(RED + `Invalid --since "${sinceArg}". Must be an ISO timestamp.` + RESET);
    process.exit(1);
  }
  if (untilArg !== null && Number.isNaN(new Date(untilArg).getTime())) {
    console.log(RED + `Invalid --until "${untilArg}". Must be an ISO timestamp.` + RESET);
    process.exit(1);
  }

  // Audit lookahead: include events up to until + staleThresholdDays
  const auditUntil = new Date(new Date(until).getTime() + staleThresholdDays * 86_400_000).toISOString();

  const [
    { FileAuditStore },
    { FileDecisionStore },
    { FileReviewStore },
    { FileActionQueueStore },
    { computeEffectiveness },
  ] = await Promise.all([
    import("../../governance/audit-store.js"),
    import("../../governance/decision-capture.js"),
    import("../../governance/operator-review.js"),
    import("../../governance/action-queue.js"),
    import("../../governance/operator-effectiveness.js"),
  ]);

  const auditStore = new FileAuditStore(cwd);
  const decisionStore = new FileDecisionStore(cwd);
  const reviewStore = new FileReviewStore(cwd);
  const actionStore = new FileActionQueueStore(cwd);

  const allProposalsList = await actionStore.list();
  const allTransitionsFull = [];
  for (const p of allProposalsList) {
    const txns = await actionStore.getTransitions(p.proposalId);
    allTransitionsFull.push(...txns);
  }
  const [allEvents, allDecisions, allReviews] = await Promise.all([
    auditStore.list(),
    decisionStore.list(),
    reviewStore.list(),
  ]);

  // Filter decisions/reviews by [since, until)
  const filteredDecisions = allDecisions.filter(
    (d: { createdAt: string }) => d.createdAt >= since && d.createdAt < until,
  );
  const filteredReviews = allReviews.filter(
    (r: { createdAt: string }) => r.createdAt >= since && r.createdAt < until,
  );
  const filteredEvents = allEvents.filter(
    (e: { timestamp: string }) => e.timestamp >= since && e.timestamp < auditUntil,
  );

  const report = computeEffectiveness(
    filteredEvents,
    filteredDecisions,
    filteredReviews,
    allProposalsList,
    allTransitionsFull,
    { staleThresholdDays, now },
  );

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human output
  console.log(BOLD + `Operator Effectiveness (${since.slice(0, 10)} → ${until.slice(0, 10)})` + RESET);
  console.log(DIM + "─".repeat(50) + RESET);
  console.log("");

  console.log(BOLD + "Decision stability:" + RESET);
  console.log(`  total decisions: ${report.decisionStability.totalDecisions}`);
  console.log(`  reversal rate:   ${(report.decisionStability.reversalRate * 100).toFixed(1)}% (${report.decisionStability.reversed}/${report.decisionStability.totalDecisions})`);
  console.log(`  by kind:         ${Object.entries(report.decisionStability.decisionCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log("");

  console.log(BOLD + "Escalation effectiveness:" + RESET);
  console.log(`  total escalations:        ${report.escalationEffectiveness.totalEscalations}`);
  console.log(`  → proposal rate:          ${(report.escalationEffectiveness.escalationToActionRate * 100).toFixed(0)}%`);
  console.log(`  → resolution rate:        ${(report.escalationEffectiveness.resolutionRate * 100).toFixed(0)}%`);
  console.log(`  → pending:                ${report.escalationEffectiveness.pendingEscalations}`);
  if (report.escalationEffectiveness.medianResolutionMs !== null) {
    console.log(`  → median time to resolve:  ${(report.escalationEffectiveness.medianResolutionMs / 60000).toFixed(0)}m`);
  }
  console.log("");

  console.log(BOLD + "Review completeness:" + RESET);
  console.log(`  total reviews:      ${report.reviewCompleteness.totalReviews}`);
  console.log(`  with notes:         ${report.reviewCompleteness.withNotes}`);
  console.log(`  with classif.:      ${report.reviewCompleteness.withClassification}`);
  console.log(`  with both:          ${report.reviewCompleteness.withBoth}`);
  console.log(`  completeness rate:  ${(report.reviewCompleteness.completenessRate * 100).toFixed(0)}%`);
  console.log("");

  console.log(BOLD + "Stale decisions:" + RESET);
  console.log(`  total deferred:  ${report.staleDecisions.totalDeferred}`);
  console.log(`  stale (≥${report.staleDecisions.staleThresholdDays}d): ${report.staleDecisions.staleCount}`);
  if (report.staleDecisions.averageStaleDays !== null) {
    console.log(`  avg stale age:   ${report.staleDecisions.averageStaleDays.toFixed(1)}d`);
  }
  console.log("");

  console.log(BOLD + "Throughput (descriptive):" + RESET);
  for (const op of report.throughputContext.decisionsByOperator) {
    console.log(`  ${op.operatorId}: ${op.count} decisions`);
  }
  for (const op of report.throughputContext.reviewsByOperator) {
    console.log(`  ${op.operatorId}: ${op.count} reviews`);
  }
  console.log("");
}

/**
 * P15.4 — `alix governance audit report`.
 * Composition layer: aggregates P15.1 trends, P15.2 anomalies, P15.3a effectiveness.
 */
async function runAuditReport(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const sinceArg = parseInlineFlag(args, "--since");
  const untilArg = parseInlineFlag(args, "--until");
  const sectionArg = parseInlineFlag(args, "--section");
  const now = new Date().toISOString();

  const sections = sectionArg !== null
    ? sectionArg === "all"
      ? ["trends", "anomalies", "effectiveness"]
      : [sectionArg]
    : ["trends", "anomalies", "effectiveness"];

  const since = sinceArg ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const until = untilArg ?? now;

  const [
    { FileAuditStore },
    { FileDecisionStore },
    { FileReviewStore },
    { FileActionQueueStore },
    { buildReport },
  ] = await Promise.all([
    import("../../governance/audit-store.js"),
    import("../../governance/decision-capture.js"),
    import("../../governance/operator-review.js"),
    import("../../governance/action-queue.js"),
    import("../../governance/report-orchestrator.js"),
  ]);

  const auditStore = new FileAuditStore(cwd);
  const decisionStore = new FileDecisionStore(cwd);
  const reviewStore = new FileReviewStore(cwd);
  const actionStore = new FileActionQueueStore(cwd);

  const allProposals = await actionStore.list();
  const allTransitions: ActionProposalStatusTransition[] = [];
  for (const p of allProposals) {
    const t = await actionStore.getTransitions(p.proposalId);
    allTransitions.push(...t);
  }

  const [allEvents, allDecisions, allReviews] = await Promise.all([
    auditStore.list(),
    decisionStore.list(),
    reviewStore.list(),
  ]);

  const report = buildReport(
    allEvents, allDecisions, allReviews,
    allProposals, allTransitions,
    { since, until, now, staleThresholdDays: 7, sections: sections as any },
  );

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(BOLD + `Governance Audit Report (${since.slice(0, 10)} → ${until.slice(0, 10)})` + RESET);
  console.log(DIM + "═".repeat(50) + RESET);
  console.log("");

  if (report.trends) {
    const t = report.trends;
    console.log(BOLD + "Trends:" + RESET);
    console.log(`  events: ${t.totalEvents}`);
    if (t.eventTypeDistribution) {
      const et = Object.entries(t.eventTypeDistribution as Record<string, number>).sort();
      for (const [k, v] of et) console.log(`  ${k}: ${v}`);
    }
    console.log("");
  }

  if (report.anomalies) {
    const list = report.anomalies as any[];
    console.log(BOLD + "Anomalies:" + RESET + (list.length > 0 ? "" : DIM + " none detected" + RESET));
    for (const a of list) {
      const s = a.severity === "critical" ? RED + "CRITICAL" : a.severity === "warning" ? YELLOW + "WARNING" : "INFO";
      console.log(`  ${s + RESET} ${a.type} — ${a.reason}`);
    }
    console.log("");
  }

  if (report.effectiveness) {
    const e = report.effectiveness as any;
    console.log(BOLD + "Effectiveness:" + RESET);
    console.log(`  stability:     ${((e.decisionStability?.reversalRate ?? 0) * 100).toFixed(0)}% reversal`);
    console.log(`  escalation:    ${((e.escalationEffectiveness?.escalationToActionRate ?? 0) * 100).toFixed(0)}% to action`);
    console.log(`  completeness:  ${((e.reviewCompleteness?.completenessRate ?? 0) * 100).toFixed(0)}% with notes+class`);
    console.log(`  stale deferred: ${e.staleDecisions?.staleCount ?? 0} > ${e.staleDecisions?.staleThresholdDays ?? 7}d`);
    console.log("");
  }
}

async function runAuditActor(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const actorId = args.find((a) => !a.startsWith("--"));
  if (!actorId) {
    console.log(RED + "Usage: alix governance audit actor <actor-id> [--actor-type <type>]" + RESET);
    process.exit(1);
  }

  const actorTypeFilter = parseInlineFlag(args, "--actor-type");

  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { queryByActor } = await import("../../governance/audit-query.js");

  const store = new FileAuditStore(cwd);
  const all = await store.list();
  const events = actorTypeFilter
    ? queryByActor(all, actorTypeFilter as any, actorId)
    : all.filter((e) => e.actorId === actorId);

  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(DIM + "No events found for actor: " + actorId + RESET);
    return;
  }

  console.log(
    BOLD + "Actor: " + actorId + " (" + events.length + " events)" + RESET,
  );
  console.log("");

  for (const ev of events) {
    const color = eventTypeColor(ev.eventType);
    console.log(
      color + ev.eventType.padEnd(28) + RESET +
      ev.timestamp.slice(0, 19).replace("T", " ") + "  " +
      ev.eventId,
    );
    console.log(
      "  " + BOLD + ev.decision + RESET +
      "  " + DIM + ev.actorType + RESET +
      "  " + ev.reason.slice(0, 100),
    );
    console.log("");
  }
}

async function runAuditPolicy(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const policyId = args.find((a) => !a.startsWith("--"));
  if (!policyId) {
    console.log(RED + "Usage: alix governance audit policy <policy-id>" + RESET);
    process.exit(1);
  }

  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { queryByPolicy } = await import("../../governance/audit-query.js");

  const store = new FileAuditStore(cwd);
  const events = queryByPolicy(await store.list(), policyId);

  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  if (events.length === 0) {
    console.log(DIM + "No events found for policy: " + policyId + RESET);
    return;
  }

  console.log(
    BOLD + "Policy: " + policyId + " (" + events.length + " events)" + RESET,
  );
  console.log("");

  for (const ev of events) {
    const color = eventTypeColor(ev.eventType);
    console.log(
      color + ev.eventType.padEnd(28) + RESET +
      ev.timestamp.slice(0, 19).replace("T", " ") + "  " +
      ev.eventId,
    );
    console.log(
      "  " + BOLD + ev.decision + RESET +
      "  " + DIM + ev.actorType + "/" + ev.actorId + RESET +
      "  " + ev.reason.slice(0, 100),
    );
    console.log("");
  }
}

async function runAuditVerify(
  cwd: string,
  jsonMode: boolean,
): Promise<void> {
  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { verifyChain } = await import("../../governance/audit-chain.js");

  const store = new FileAuditStore(cwd);
  const events = await store.listChronological();
  const result = verifyChain(events);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.valid) {
    console.log(GREEN + BOLD + "Chain integrity verified" + RESET);
    console.log(DIM + "Events: " + result.eventCount + RESET);
  } else {
    console.log(RED + BOLD + "Chain integrity FAILED" + RESET);
    console.log(DIM + "Events: " + result.eventCount + " | Findings: " + result.findings.length + RESET);
    for (const f of result.findings) {
      console.log(
        "  " + RED + f.type + RESET +
        "  " + DIM + f.eventId + RESET +
        "  " + f.detail,
      );
    }
  }
}

async function runAuditExport(
  cwd: string,
  args: string[],
  jsonMode: boolean,
): Promise<void> {
  const formatFlag = parseInlineFlag(args, "--format") ?? "jsonl";
  const format = formatFlag === "json" ? "json" : "jsonl";
  const doRedact = args.includes("--redact");
  const outputFlag = parseInlineFlag(args, "--output");

  const { FileAuditStore } = await import("../../governance/audit-store.js");
  const { exportEvents } = await import("../../governance/audit-export.js");

  const store = new FileAuditStore(cwd);
  const events = await store.list();
  const output = exportEvents(events, format, {
    redact: doRedact,
    pretty: format === "json",
  });

  if (outputFlag) {
    // Delegate file write to separate export module (preserves P8 store invariant)
    const { exportAuditEventsToFile } = await import("./governance-audit-exporter.js");
    const result = await exportAuditEventsToFile(outputFlag, output, format, doRedact);

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(
        GREEN + "Exported " + result.count + " events to " + result.exported + RESET,
      );
    }
  } else {
    // Print to stdout (use console.log to avoid P8 sentinel false positive)
    console.log(output);
  }
}

function parseInlineFlag(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return null;
  const value = args[idx + 1];
  if (value.startsWith("--")) return null; // next arg is another flag, not a value
  return value;
}

/**
 * Extract a positional argument from args, skipping over flag values consumed
 * by parseInlineFlag for the given known value-taking flags.
 *
 * Unlike args.find(a => !a.startsWith("-")), this correctly skips flag values
 * even when they don't start with "-".
 */
function extractPositionalArg(args: string[], valueFlags: string[]): string | undefined {
  const consumed = new Set<number>();
  for (const flag of valueFlags) {
    const idx = args.indexOf(flag);
    if (idx !== -1) {
      consumed.add(idx);
      if (idx + 1 < args.length) consumed.add(idx + 1);
    }
  }
  return args.find((a, i) => !a.startsWith("-") && !consumed.has(i));
}
