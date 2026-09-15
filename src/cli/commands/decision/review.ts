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
import { RiskScoreBuilder } from "../../../adaptation/risk-score-builder.js";
import { RecommendationEngine } from "../../../adaptation/recommendation-engine.js";
import "../../../adaptation/strategic-brief-types.js";
import { ProviderCatalogAdapter } from "../../../adaptation/provider-catalog-adapter.js";
import { LLMLensAgent } from "../../../adaptation/llm-lens-agent.js";
import { GovernanceReviewCouncil } from "../../../adaptation/governance-review-council.js";
import type { LensName, GovernanceReview } from "../../../adaptation/governance-review-types.js";
import type { GovernanceReviewInput } from "../../../adaptation/governance-review-types.js";
import { detectProvider, PROVIDERS } from "../../../providers/catalog.js";
import { createProvider } from "../../../providers/registry.js";
import { isKeylessProvider } from "../../../providers/keyless-providers.js";
import { GovernanceReviewStore } from "../../../adaptation/governance-review-store.js";
import "../../../adaptation/execution-intent-types.js";
import { buildDecisionInfrastructure } from "./shared.js";

// ---------------------------------------------------------------------------
// Constants — .alix path conventions (matches adaptation.ts pattern)
// ---------------------------------------------------------------------------

export async function runReview(args: string[]): Promise<void> {
  // Parse arguments
  const id = args[0];
  if (!id) {
    console.error("Usage: alix decision review <proposal-id> [--json] [--lens <name>]");
    process.exit(1);
  }

  const jsonMode = args.includes("--json");
  const lensIdx = args.indexOf("--lens");
  let targetLens: LensName | undefined;
  if (lensIdx !== -1) {
    if (lensIdx + 1 >= args.length) {
      console.error("Error: --lens requires a lens name (red_team, historian, policy_auditor, confidence_critic)");
      process.exit(1);
    }
    const lensArg = args[lensIdx + 1];
    if (!["red_team", "historian", "policy_auditor", "confidence_critic"].includes(lensArg)) {
      console.error(`Error: invalid lens name "${lensArg}". Valid: red_team, historian, policy_auditor, confidence_critic`);
      process.exit(1);
    }
    targetLens = lensArg as LensName;
  }

  // ---- Provider setup (before any I/O) ----

  const detected = detectProvider();
  const providerInfo = PROVIDERS.find(p => p.id === detected.provider);
  if (!providerInfo) {
    console.error(`Error: unknown provider "${detected.provider}"`);
    process.exit(1);
  }
  const apiKey = process.env[providerInfo.env] ?? "";
  // Skip API key check for keyless providers (local, no key needed)
  if (!apiKey && !isKeylessProvider(detected.provider)) {
    console.error(`Error: no API key found for provider "${detected.provider}". Set ${providerInfo.env}`);
    process.exit(1);
  }

  const modelAdapter = await createProvider(
    { provider: detected.provider, model: detected.model },
    apiKey || undefined,
  );
  const llmAdapter = new ProviderCatalogAdapter(modelAdapter, detected);

  // ---- Decision pipeline (fail fast) ----

  const cwd = process.cwd();
  const infra = buildDecisionInfrastructure(cwd);
  const riskBuilder = new RiskScoreBuilder();
  const recEngine = new RecommendationEngine();

  const ctx = await infra.contextBuilder.build(id);
  const risk = riskBuilder.build(ctx);
  const recommendation = recEngine.recommend(ctx, risk);

  // ---- Assemble lens input ----

  const input: GovernanceReviewInput = {
    recommendation,
    decisionContext: ctx,
    riskScore: risk,
  };

  // ---- Create and run lens agents ----

  const ALL_LENSES: LensName[] = ["red_team", "historian", "policy_auditor", "confidence_critic"];
  const lensesToRun = targetLens ? [targetLens] : ALL_LENSES;
  const agents = lensesToRun.map(lens => new LLMLensAgent(llmAdapter, lens));

  // Run in parallel
  const scores = await Promise.all(agents.map(l => l.run(input)));

  // ---- Aggregate ----

  const council = new GovernanceReviewCouncil();
  const reviewId = `review-${id}-${Date.now()}`;
  const review = council.aggregate(reviewId, id, recommendation.id, scores, input);

  // ---- Persist review (best-effort, P7.5p.3b) ----
  // Order invariant: lens-run → aggregate → append → render.
  // Append is best-effort: log-and-continue on failure; never block render.
  await new GovernanceReviewStore().append(review).catch((err) =>
    console.warn(
      `Warning: failed to persist governance review ${reviewId}:`,
      err instanceof Error ? err.message : String(err),
    ),
  );

  // ---- Render ----

  if (jsonMode) {
    console.log(JSON.stringify(review, null, 2));
    return;
  }

  renderReview(review, targetLens);
}

// ---------------------------------------------------------------------------
// renderReview — Terminal renderer for GovernanceReview
// ---------------------------------------------------------------------------

export function renderReview(review: GovernanceReview, singleLens?: LensName): void {
  const verdictIcon =
    review.verdict === "agree" ? "✅" :
    review.verdict === "agree_with_concerns" ? "⚠️" :
    review.verdict === "challenge" ? "🟠" :
    "❓";

  console.log(`Governance Review: ${review.proposalId}`);
  console.log(`────────────────────────────────────────`);
  console.log(`${verdictIcon} Council verdict: ${review.verdict}`);
  console.log(`   Confidence: ${(review.confidence * 100).toFixed(0)}%`);
  console.log(``);

  if (singleLens) {
    console.log(`Lens: ${singleLens} (single-lens mode)`);
  } else {
    console.log(`Lens scores (${review.lensScores.length}):`);
  }

  for (const s of review.lensScores) {
    const lensIcon =
      s.recommendedVerdict === "agree" ? "✅" :
      s.recommendedVerdict === "agree_with_concerns" ? "⚠️" :
      s.recommendedVerdict === "challenge" ? "🟠" :
      "❓";
    const providerInfo = s.provider ? ` [${s.provider}${s.model ? `/${s.model}` : ""}]` : "";
    console.log(` ${lensIcon} ${s.lens}: ${s.recommendedVerdict} (${(s.confidence * 100).toFixed(0)}%)${providerInfo}`);
    console.log(`    ${s.rationale}`);
  }
  console.log(``);

  console.log(`Council vote: agree=${review.councilVote.agree} agree_with_concerns=${review.councilVote.agreeWithConcerns} challenge=${review.councilVote.challenge} insufficient=${review.councilVote.insufficientInformation}`);
  console.log(``);

  if (review.concerns.length > 0) {
    console.log(`Concerns raised (${review.concerns.length}):`);
    for (const c of review.concerns) {
      console.log(` · ${c}`);
    }
    console.log(``);
  }

  if (review.blindSpots.length > 0) {
    console.log(`Blind spots (${review.blindSpots.length}):`);
    for (const b of review.blindSpots) {
      console.log(` · ${b}`);
    }
    console.log(``);
  }

  if (review.historicalAnalogies.length > 0) {
    console.log(`Historical analogies (${review.historicalAnalogies.length}):`);
    for (const h of review.historicalAnalogies) {
      console.log(` · ${h}`);
    }
    console.log(``);
  }

  console.log(`Sources: ${review.sourceArtifacts.length} artifact(s)`);
}

// ---------------------------------------------------------------------------
// runOutcome — Outcome Tracking CLI (P7a)
// ---------------------------------------------------------------------------
