/**
 * A9 — real EnrichedProposal[] source factory (code-review Spec #3).
 *
 * The evidence-completeness detector consumes `EnrichedProposal[]`. The A9
 * CLI seam and the CapabilityPlatform composition root previously supplied
 * `[]`, silently disabling that detector on every real surface. This module
 * derives REAL data from the standard `.alix` adaptation stores via the
 * P10.8a pipeline (`ProposalLifecycleAnalyzer`) — the same canonical source
 * the `alix adaptation intelligence` command consumes.
 *
 * The supplier is LAZY: constructing it does no I/O; the analyzer only runs
 * when the adapter's `.list()` is first called (composition root stays lazy).
 * A derivation failure contributes nothing (Phase 20): the supplier falls back
 * to `[]` rather than throwing, so a broken source never destroys the run.
 *
 * @module evolution/forecast/adapters/enriched-proposals-source
 */

import { join } from "node:path";
import type { EnrichedProposal } from "../../../adaptation/intelligence-types.js";

const PROPOSALS_DIR = join(".alix", "adaptation", "proposals");
const EFFECTIVENESS_DIR = join(".alix", "adaptation", "effectiveness");
const EVIDENCE_DIR = join(".alix", "security");

/**
 * Build a lazy supplier of real `EnrichedProposal[]` over the standard
 * `.alix` layout rooted at `cwd`. Fail-closed: a source failure yields `[]`
 * (never throws), so an unreadable store contributes no findings rather than
 * killing the run (Phase 20).
 */
export function createEnrichedProposalsSource(
  cwd: string,
): () => Promise<ReadonlyArray<EnrichedProposal>> {
  return async () => {
    try {
      const { ProposalStore } = await import("../../../adaptation/proposal-store.js");
      const { EffectivenessStore } = await import("../../../adaptation/effectiveness-store.js");
      const { EvidenceStore } = await import("../../../security/evidence/evidence-store.js");
      const { ProposalLifecycleAnalyzer } = await import(
        "../../../adaptation/proposal-lifecycle-analyzer.js"
      );
      const analyzer = new ProposalLifecycleAnalyzer(
        new ProposalStore(join(cwd, PROPOSALS_DIR)),
        new EffectivenessStore(join(cwd, EFFECTIVENESS_DIR)),
        new EvidenceStore({ storeDir: join(cwd, EVIDENCE_DIR) }),
      );
      return await analyzer.analyze();
    } catch {
      // Phase 20 — a failed source contributes nothing; the run continues.
      return [];
    }
  };
}
