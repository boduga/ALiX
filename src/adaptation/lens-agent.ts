/**
 * P6.5 — LensAgent interface and prompt templates.
 *
 * Defines the LensAgent contract and standard prompt templates for each of
 * the four governance review lenses. LensAgent is an interface (not a class)
 * to avoid baking in a specific LLM provider — real agents and test doubles
 * both implement it.
 *
 * @module
 */

import type { GovernanceReviewInput, LensScore, LensName } from "./governance-review-types.js";

// ---------------------------------------------------------------------------
// LensAgent interface
// ---------------------------------------------------------------------------

/**
 * A single governance review lens.
 * Stateless — all context is in the input. No side effects.
 */
export interface LensAgent {
  /** Run the lens and return its score. */
  run(input: GovernanceReviewInput): Promise<LensScore>;
}

// ---------------------------------------------------------------------------
// Default prompt templates
// ---------------------------------------------------------------------------

/**
 * Each lens has one job, one prompt, one output.
 * Prompts must stay in critique-only territory — no decision language.
 */
export const LENS_PROMPTS: Record<LensName, string> = {
  red_team:
    `You are a red-team reviewer. Given a recommendation and its context, identify ` +
    `concrete failure scenarios the deterministic model may have missed. ` +
    `Do not make a decision — only surface risks. Focus on: operational failures, ` +
    `edge cases, human factors, adversarial misuse.`,

  historian:
    `You are a historian reviewer. Given a recommendation and historical context, ` +
    `identify relevant past analogs, their outcomes, and lessons learned. ` +
    `Look for: similar action types with poor outcomes, capability areas with ` +
    `elevated revert rates, patterns that suggest repeating past mistakes.`,

  policy_auditor:
    `You are a policy auditor. Given a recommendation and governance context, ` +
    `identify any policy violations. Be precise — cite the violated rule. ` +
    `Check: Recommend≠Decide invariant, human approval requirements, ` +
    `capability routing constraints, constitutional rules.`,

  confidence_critic:
    `You are a confidence critic. Given a recommendation and its evidence base, ` +
    `identify what evidence is missing, weak, or stale. Focus on: context completeness, ` +
    `sample sizes, data freshness, unwarranted confidence levels.`,
};

/**
 * Centralized JSON-only suffix appended to every lens prompt.
 * Keeps sentinel testing simple and avoids duplicating text.
 */
export const LENS_JSON_SUFFIX =
  "Return ONLY valid JSON. Do not include markdown, prose, or code fences.\n" +
  "Do not approve, reject, apply, execute, or make a final decision.";
