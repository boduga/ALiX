/**
 * P10.7c — Executive bridge CLI handler.
 *
 * Bridges eligible ExecutiveRecommendations from a persisted
 * RecommendationReport into governance proposals (action:
 * "create_improvement_issue"), then patches the report with the canonical
 * proposalId + governanceStatus: "proposed".
 *
 * Read-only by default; writes only:
 *   - .alix/adaptation/proposals/<id>.json (one per eligible rec)
 *   - .alix/executive/recommendations/<id>.json (overwrite with patched bridge fields)
 *
 * Uses instance-based store access (proposalStore.save, lowercase) which
 * keeps the executive purity sentinel clean.
 *
 * @module
 */

import { join } from "node:path";
import { RecommendationReportStore } from "../../executive/recommendation-report-store.js";
import { computeExecutiveProposals } from "../../executive/executive-bridge-recommendations.js";
import { ProposalStore } from "../../adaptation/proposal-store.js";
import { nextProposalId } from "../../adaptation/recommendation-to-proposal.js";
import type { RecommendationReport } from "../../executive/recommendation-report-store.js";

// ---------------------------------------------------------------------------
// CLI handler
// ---------------------------------------------------------------------------

export async function handleBridgeCommand(args: string[]): Promise<void> {
  const reportIndex = args.indexOf("--report");
  const reportIdArg =
    reportIndex !== -1 && reportIndex + 1 < args.length ? args[reportIndex + 1] : undefined;
  const useJson = args.includes("--json");

  const cwd = process.cwd();
  const recommendationStore = new RecommendationReportStore(
    join(cwd, ".alix", "executive", "recommendations"),
  );

  // Resolve report id (explicit --report or latest)
  let reportId: string | undefined = reportIdArg;
  if (!reportId) {
    const metas = recommendationStore.list();
    if (metas.length === 0) {
      const reason = "No recommendation reports to bridge.";
      if (useJson) console.log(JSON.stringify({ ok: false, reason }));
      else console.error(reason);
      return;
    }
    reportId = metas[0].reportId;
  }

  let loaded: RecommendationReport;
  try {
    const result = recommendationStore.load(reportId);
    if (!result) {
      const reason = `Report not found: ${reportId}`;
      if (useJson) console.log(JSON.stringify({ ok: false, reason }));
      else console.error(reason);
      return;
    }
    loaded = result;
  } catch (e: any) {
    // RecommendationReportStore.load throws RecommendationReportIntegrityError on
    // hash mismatch / bad JSON / unknown schema. Surface distinctly from "not found".
    const reason = `Report integrity failure for ${reportId}: ${e.message}`;
    if (useJson) console.log(JSON.stringify({ ok: false, reason }));
    else console.error(reason);
    return;
  }

  const generatedAt = new Date().toISOString();
  // generatedAt is captured exactly once before any I/O and reused throughout
  // the bridge operation (passed to computeExecutiveProposals, reused as the
  // updated report's savedAt context). Prevents timestamps drifting across
  // long bridge runs that span multiple proposal saves.
  const result = computeExecutiveProposals(loaded, generatedAt);

  // No-op short-circuit: zero eligible drafts → no writes at all
  if (result.drafts.length === 0) {
    if (useJson) {
      console.log(
        JSON.stringify({
          ok: true,
          reportId,
          createdProposalIds: [],
          skippedCount: result.skippedCount,
        }),
      );
    } else {
      console.log(
        `No eligible recommendations to bridge. (${result.skippedCount} skipped)`,
      );
    }
    return;
  }

  // Save proposals (partial-failure contract: stop on first throw, no report rewrite)
  const proposalStore = new ProposalStore(join(cwd, ".alix", "adaptation", "proposals"));
  const collected: { recIndex: number; proposalId: string; status: "proposed" }[] = [];
  for (const draft of result.drafts) {
    draft.proposal.id = nextProposalId();
    try {
      await proposalStore.save(draft.proposal);
    } catch (e: any) {
      const reason = `Failed to save proposal for recIndex ${draft.recIndex}: ${e.message}`;
      if (useJson) {
        console.log(
          JSON.stringify({
            ok: false,
            reason,
            partial: collected.map((c) => c.proposalId),
          }),
        );
      } else {
        console.error(reason);
      }
      return;
    }
    collected.push({
      recIndex: draft.recIndex,
      proposalId: draft.proposal.id,
      status: "proposed",
    });
  }

  // Build updated report via copy-on-write (loaded report object never mutated)
  const updatedReport: RecommendationReport = {
    ...loaded,
    report: {
      ...loaded.report,
      recommendations: loaded.report.recommendations.map((rec, i) => {
        const update = collected.find((u) => u.recIndex === i);
        return update
          ? { ...rec, proposalId: update.proposalId, governanceStatus: update.status }
          : rec;
      }),
    },
  };

  // Save the updated report (pass inner payload to match save(NewRecommendationReport))
  recommendationStore.save(updatedReport.report);

  // Summary
  const createdProposalIds = collected.map((c) => c.proposalId);
  if (useJson) {
    console.log(
      JSON.stringify({
        ok: true,
        reportId,
        createdProposalIds,
        skippedCount: result.skippedCount,
      }),
    );
  } else {
    console.log(
      `Bridged ${createdProposalIds.length} recommendation(s) from report ${reportId}.`,
    );
    for (const id of createdProposalIds) {
      console.log(`  Proposal: ${id}`);
    }
    if (result.skippedCount > 0) {
      console.log(`Skipped: ${result.skippedCount}`);
    }
    console.log("");
    console.log(`Review and approve:`);
    console.log(`  alix governance explain <proposalId>`);
    console.log(`  alix adaptation approve <proposalId>`);
  }
}
