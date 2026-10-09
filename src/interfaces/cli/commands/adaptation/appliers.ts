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
import type { Applier } from "../../../../planning/adaptation/approval-gate.js";
import { AgentCardApplier } from "../../../../planning/adaptation/appliers/agent-card-applier.js";
import { SkillApplier } from "../../../../planning/adaptation/appliers/skill-applier.js";
import { RevertApplier } from "../../../../planning/adaptation/revert-applier.js";
import { GovernanceChangeApplier } from "../../../../planning/adaptation/appliers/governance-change-applier.js";
import { SnapshotStore } from "../../../../planning/adaptation/snapshot-store.js";
import "../../../../planning/adaptation/recommendation-to-proposal.js";
import "../../../../planning/adaptation/effectiveness-reporter.js";
import "../../../../planning/adaptation/effectiveness-store.js";
import "../../../../planning/adaptation/auto-proposal-generator.js";
import "../../../../governance/security/evidence/evidence-store.js";
import { EvidenceEventWriter } from "../../../../coordination/workflow/evidence-writer.js";
import type { AdaptationProposal } from "../../../../planning/adaptation/adaptation-types.js";
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
import { CARDS_DIR, SKILLS_DIR, SNAPSHOTS_DIR } from "./shared.js";

// ---------------------------------------------------------------------------
// Applier selection
// ---------------------------------------------------------------------------

/**
 * Select the Applier callback for a proposal by `target.kind`.
 *
 * The gate owns the no-approval-no-mutation invariant; this function only
 * decides WHICH applier to hand the gate.
 *
 * Recognized manual-action kinds ("capability", "issue", "routing_weight")
 * are intercepted in runApply before this function is reached and surfaced
 * as human guidance. selectApplier's default throw therefore only fires for
 * genuinely unexpected target kinds — the gate never runs for them, so no
 * mutation occurs.
 */
/** @internal Exported for test access only. */
export function selectApplier(
  cwd: string,
  proposal: AdaptationProposal,
  writer: EvidenceEventWriter,
): Applier {
  const cardsDir = join(cwd, CARDS_DIR);
  const skillsDir = join(cwd, SKILLS_DIR);
  const snapshotsDir = join(cwd, SNAPSHOTS_DIR);
  const snapshotStore = new SnapshotStore(snapshotsDir);

  switch (proposal.target.kind) {
    case "agent_card": {
      const applier = new AgentCardApplier(cardsDir, snapshotStore, writer);
      return (p) => applier.apply(p);
    }
    case "skill": {
      const applier = new SkillApplier(skillsDir, snapshotStore, writer);
      return (p) => applier.apply(p);
    }
    case "revert": {
      const revertApplier = new RevertApplier(snapshotsDir, writer);
      return (p) => revertApplier.apply(p);
    }
    case "governance": {
      const applier = new GovernanceChangeApplier(cwd, snapshotStore, writer);
      return (p) => applier.apply(p);
    }
    case "learning": {
      // P8.5 — learning calibration appliers are deferred to P8.9/P9.
      // An approved learning_adjustment proposal is recorded as operator
      // intent, but no calibration file is written in P8. The gate never
      // receives an applier, so zero mutation occurs.
      throw new Error(
        `No applier for learning proposal ${proposal.id} (area "${proposal.target.area}"). ` +
          `Learning calibration application is deferred to P8.9/P9. ` +
          `The approved proposal is recorded as operator intent.`,
      );
    }
    default:
      throw new Error(
        `No applier registered for target.kind "${proposal.target.kind}" (proposal ${proposal.id}). ` +
          `Supports "agent_card", "skill", "revert", and "governance".`,
      );
  }
}
