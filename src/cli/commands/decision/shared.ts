/**
 * P6.0a — decision CLI command.
 *
 * Provides:
 * - `alix decision context <proposal-id>` — render DecisionContext as formatted terminal output
 * - `alix decision context <proposal-id> --json` — output DecisionContext as JSON
 * - `alix decision risk <proposal-id>` — render RiskScore (P6.0b)
 * - `alix decision recommend <proposal-id>` — render ApprovalRecommendation (P6.1)
 * - `alix decision queue` — render prioritized operator queue (P6.2)
 * - `alix decision brief` — render strategic brief (P6.3)
 * - `alix decision status` — render pipeline health report (P6.6a)
 * - `alix decision review <proposal-id>` — live governance lens review (P6.5b)
 * - `alix decision outcome record <subject-id>` — record a decision outcome (P7a)
 * - `alix decision outcome show <subject-id>` — show recorded outcomes (P7a)
 * - `alix decision outcome report [--window N] [--json]` — accuracy report (P7b)
 *
 * @module
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { AdaptationProposalStore } from "../../../adaptation/adaptation-proposal-store.js";
import { EvidenceStore } from "../../../security/evidence/evidence-store.js";
import { LineageBuilder } from "../../../adaptation/lineage-builder.js";
import { EffectivenessStore } from "../../../adaptation/effectiveness-store.js";
import { IntelligenceStore } from "../../../adaptation/intelligence-store.js";
import { DecisionContextBuilder } from "../../../adaptation/decision-context-builder.js";
import "../../../adaptation/strategic-brief-types.js";
import "../../../adaptation/execution-intent-types.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions (matches adaptation.ts pattern)
// ---------------------------------------------------------------------------


export const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");
export const EVIDENCE_DIR = join(".alix", "security");
export const EFFECTIVENESS_DIR = join(".alix", "adaptation", "effectiveness");
export const INTELLIGENCE_DIR = join(".alix", "adaptation", "intelligence");
export const OUTCOMES_DIR = join(".alix", "adaptation", "outcomes");
export const INTENTS_DIR = join(homedir(), ".alix", "execution", "intents");

// ---------------------------------------------------------------------------
// Shared infrastructure factory
// ---------------------------------------------------------------------------

export interface DecisionInfrastructure {
  proposalStore: AdaptationProposalStore;
  evidenceStore: EvidenceStore;
  effectivenessStore: EffectivenessStore;
  intelligenceStore: IntelligenceStore;
  lineageBuilder: LineageBuilder;
  contextBuilder: DecisionContextBuilder;
}

export function buildDecisionInfrastructure(cwd: string): DecisionInfrastructure {
  const proposalStore = new AdaptationProposalStore(join(cwd, PROPOSALS_DIR));
  const evidenceStore = new EvidenceStore({ storeDir: join(cwd, EVIDENCE_DIR) });
  const effectivenessStore = new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR));
  const intelligenceStore = new IntelligenceStore(join(cwd, INTELLIGENCE_DIR));
  const lineageBuilder = new LineageBuilder(proposalStore, evidenceStore, effectivenessStore, intelligenceStore);
  const contextBuilder = new DecisionContextBuilder(
    proposalStore, evidenceStore, lineageBuilder, effectivenessStore, intelligenceStore,
  );
  return { proposalStore, evidenceStore, effectivenessStore, intelligenceStore, lineageBuilder, contextBuilder };
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------
