/**
 * P5.1g — adaptation CLI command.
 *
 * Closes the reflection → propose → approve → apply loop:
 *
 *   ReflectionReport
 *     → `propose` converts recommendations into pending proposals
 *     → `approve`/`reject` route through ApprovalGate (records evidence)
 *     → `apply` routes through ApprovalGate, which dispatches to the
 *       AgentCardApplier or SkillApplier selected by `proposal.target.kind`
 *
 * Governance invariant (owned by ApprovalGate, not this module): **no approval,
 * no mutation**. The CLI never calls an applier directly — it selects the
 * applier by target kind and hands it to the gate, which is the sole owner of
 * status transitions and evidence recording for approve/reject/apply. Only the
 * `propose` step records evidence itself (`adaptation_proposed`), because that
 * happens before any gate involvement.
 *
 * Subcommands:
 *   list [--status <status>]       List proposals (optionally filtered by status)
 *   show <id>                      Show full proposal details
 *   propose <report.json>          Convert a ReflectionReport into proposals
 *   approve <id1> [id2] ... [--by <actor>]  Approve one or more pending proposals
 *   reject <id> [--reason <text>]  Reject a pending proposal
 *   apply <id>                     Apply an approved proposal
 *   revert <id> [--reason <text>]  Create a revert proposal for an applied proposal
 *
 *   intelligence [--since] [--until] [--min-bucket-size <n>] [--min-confidence <n>] [--json]
 * @module
 */

import { join } from "node:path";
import "../../../../planning/adaptation/adaptation-proposal-store.js";
import "../../../../planning/adaptation/recommendation-to-proposal.js";
import "../../../../planning/adaptation/approval-gate.js";
import "../../../../planning/adaptation/appliers/agent-card-applier.js";
import "../../../../planning/adaptation/appliers/skill-applier.js";
import "../../../../planning/adaptation/revert-applier.js";
import "../../../../planning/adaptation/appliers/governance-change-applier.js";
import "../../../../planning/adaptation/snapshot-store.js";
import "../../../../planning/adaptation/recommendation-to-proposal.js";
import "../../../../planning/adaptation/effectiveness-reporter.js";
import "../../../../planning/adaptation/effectiveness-store.js";
import "../../../../planning/adaptation/auto-proposal-generator.js";
import "../../../../governance/security/evidence/evidence-store.js";
import "../../../../coordination/workflow/evidence-writer.js";
import "../../../../planning/adaptation/intelligence-reporter.js";
import "../../../../planning/adaptation/intelligence-store.js";
import "../../../../planning/adaptation/proposal-lifecycle-analyzer.js";
import "../../../../planning/adaptation/proposal-scorer.js";
import "../../../../planning/adaptation/priority-store.js";
import "../../../../planning/adaptation/effectiveness-trend-analyzer.js";
import "../../../../planning/adaptation/bucket-aggregator.js";
import "../../../../planning/adaptation/revert-signal-analyzer.js";
import "../../../../planning/adaptation/confidence-calibration-analyzer.js";
import "../../../../planning/adaptation/capability-evolution-store.js";
import "../../../../planning/adaptation/capability-evolution-proposal-generator.js";
import "../../../../planning/adaptation/capability-evolution-reporter.js";
import "../../../../planning/adaptation/lineage-builder.js";
import "../../../../planning/adaptation/proposal-readiness.js";
import "../../../../execution/executive/executive-orchestrator.js";
import "../../../../execution/executive/execution-state-store.js";
import "../../../../execution/executive/execution-engine.js";
import "../../../../execution/executive/plan-store.js";
import "../../../../execution/executive/step-runner.js";
// ---------------------------------------------------------------------------
// Constants — .alix path conventions (mirror the appliers' docstrings)
// ---------------------------------------------------------------------------

/** Append-only proposal JSON store (P5.1b). */
export const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");
export const EFFECTIVENESS_DIR = join(".alix", "adaptation", "effectiveness");
export const INTELLIGENCE_DIR = join(".alix", "adaptation", "intelligence");

/** Evidence store directory relative to cwd (P4.4 convention). */
export const EVIDENCE_DIR = join(".alix", "security");

/** Agent cards directory (P5.1e). */
export const CARDS_DIR = join(".alix", "cards", "agents");

/** Skill definitions directory (P5.1f). */
export const SKILLS_DIR = join(".alix", "skills", "workflow");

/** Snapshots directory (P5.2e). */
export const SNAPSHOTS_DIR = join(".alix", "adaptation", "snapshots");


/** Best-effort actor identity from the environment. */
export function detectActor(): string {
  return process.env.USER || process.env.USERNAME || "cli-user";
}
