/**
 * P6.5b — LLMLensAgent: LensAgent with real LLM execution.
 *
 * Sends prompts to an LLM via LLMAdapter, parses structured JSON from the
 * response, and detects authority language in the full parsed payload.
 * Any error or suspicious output produces an insufficient_information score
 * with the error message preserved as rationale.
 *
 * @module
 */

import type { LensAgent, LENS_PROMPTS, LENS_JSON_SUFFIX } from "./lens-agent.js";
import type { LLMAdapter } from "./llm-adapter.js";
import type {
  LensScore,
  LensName,
  GovernanceReviewInput,
  GovernanceVerdict,
} from "./governance-review-types.js";
import { LENS_PROMPTS as PROMPTS, LENS_JSON_SUFFIX as JSON_SUFFIX } from "./lens-agent.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Phrases that indicate the LLM is claiming decision authority.
 * Scanned across the entire parsed payload (not just rationale) so a
 * `recommendedVerdict: "must approve"` triggers the same guard as
 * `rationale: "I approve this"`.
 */
const FORBIDDEN_PHRASES = [
  "i approve",
  "i reject",
  "apply this",
  "execute this",
  "final decision",
  "must approve",
  "must reject",
];

const VALID_VERDICTS: readonly GovernanceVerdict[] = [
  "agree",
  "agree_with_concerns",
  "challenge",
  "insufficient_information",
];

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// LLMLensAgent
// ---------------------------------------------------------------------------

export class LLMLensAgent implements LensAgent {
  constructor(
    private adapter: LLMAdapter,
    private lens: LensName,
  ) {}

  async run(input: GovernanceReviewInput): Promise<LensScore> {
    const system = `${PROMPTS[this.lens]}\n\n${JSON_SUFFIX}`;
    const user = this.#buildContext(input);

    try {
      const completion = await this.adapter.complete(
        { system, user },
        { timeoutMs: DEFAULT_TIMEOUT_MS },
      );
      return this.#parseScore(completion.content, completion.provider, completion.model);
    } catch (err) {
      return this.#fallback(
        err instanceof Error ? err.message : "Lens agent failed to produce a result.",
      );
    }
  }

  // ---- private helpers -----------------------------------------------------

  /**
   * Assemble the user message from decision context fields.
   * Provides the LLM with the recommendation and all available context
   * so each lens can perform its specific critique.
   */
  #buildContext(input: GovernanceReviewInput): string {
    const rec = input.recommendation;
    const ctx = input.decisionContext;
    const lines: string[] = [
      `Recommendation: ${rec.recommendation} (confidence: ${(rec.confidence * 100).toFixed(0)}%)`,
      `Action: ${ctx.proposalAction}`,
      `Status: ${ctx.proposalStatus}`,
      `Age: ${ctx.ageDays} days`,
      `Lineage: ${ctx.lineageCompleteness}`,
    ];
    if (ctx.effectivenessTrend) {
      lines.push(
        `Effectiveness keep rate: ${(ctx.effectivenessTrend.keepRate * 100).toFixed(0)}% (n=${ctx.effectivenessTrend.sampleSize})`,
      );
    }
    if (ctx.warnings?.length) {
      lines.push(`Warnings: ${ctx.warnings.map(w => w.message).join("; ")}`);
    }
    return lines.join("\n");
  }

  /**
   * Parse the LLM response into a LensScore.
   *
   * Steps:
   * 1. Strip markdown fences (```json ... ```)
   * 2. JSON.parse
   * 3. Validate verdict is one of the 4 valid GovernanceVerdict values
   * 4. Validate confidence is a number between 0 and 1
   * 5. Validate rationale is a non-empty string
   * 6. Full-payload authority language scan (JSON.stringify whole parsed object)
   *
   * Throws on any validation failure — the caller (run) catches and converts
   * to insufficient_information via #fallback.
   */
  #parseScore(content: string, provider?: string, model?: string): LensScore {
    // Strip markdown fences
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    // Parse JSON
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Failed to parse lens output — response was not valid JSON");
    }

    // Authority language check — full payload scan (before field validation
    // so forbidden phrases in verdict/confidence fields are caught as authority
    // language, not as validation errors)
    const payloadJson = JSON.stringify(parsed).toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      if (payloadJson.includes(phrase)) {
        throw new Error("Authority language detected");
      }
    }

    // Validate verdict
    if (typeof parsed.recommendedVerdict !== "string" ||
        !VALID_VERDICTS.includes(parsed.recommendedVerdict as GovernanceVerdict)) {
      throw new Error("Invalid verdict in lens output");
    }

    // Validate confidence
    if (typeof parsed.confidence !== "number" ||
        parsed.confidence < 0 ||
        parsed.confidence > 1 ||
        Number.isNaN(parsed.confidence)) {
      throw new Error("Invalid confidence in lens output");
    }

    // Validate rationale
    if (typeof parsed.rationale !== "string" || parsed.rationale.trim().length === 0) {
      throw new Error("Missing or empty rationale in lens output");
    }

    return {
      lens: this.lens,
      recommendedVerdict: parsed.recommendedVerdict as GovernanceVerdict,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      provider,
      model,
    };
  }

  /**
   * Produce an insufficient_information score when the LLM fails or produces
   * invalid output. Preserves the error message as rationale for transparency.
   */
  #fallback(rationale: string): LensScore {
    return {
      lens: this.lens,
      recommendedVerdict: "insufficient_information" as const,
      confidence: 0,
      rationale,
    };
  }
}
