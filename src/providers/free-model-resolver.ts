// src/providers/free-model-resolver.ts
//
// Pure capability-aware free-model resolver. Selects a concrete free model
// from the catalog for a request. Also hosts the ONE capability vocabulary
// (`deriveRequestRequirements` / `supportsRequest`) shared with the routing
// layer so the free route and routing candidates filter on identical rules.

import type { FreeModelInfo } from "./free-model-catalog.js";
import type { NormalizedRequest, ModelCapabilities } from "./types.js";

export type FreeModelRequirements = {
  needsTools: boolean;
  needsStructuredOutput: boolean;
  needsVision: boolean;
  maxInputTokens?: number;
};

/**
 * Derive the capability requirements of a normalized request from the EXISTING
 * request vocabulary — no second capability vocabulary.
 */
export function deriveRequestRequirements(
  request: NormalizedRequest,
  maxInputTokens?: number,
): FreeModelRequirements {
  return {
    needsTools: !!(request.tools && request.tools.length > 0),
    needsStructuredOutput: request.structuredOutputSchema !== undefined,
    needsVision: Array.isArray(request.messages) && request.messages.some((m) =>
      Array.isArray(m.content) && m.content.some((c) => c.type === "image" || c.type === "file")),
    ...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
  };
}

/**
 * Whether a candidate with these capabilities can serve the requirements.
 * `ModelCapabilities.inputTokenLimit` is `number` (never undefined) — the
 * unknown-context rule lives where unknown context can occur, in the catalog
 * resolver (see resolveConcreteFreeModel).
 */
export function supportsRequest(
  capabilities: ModelCapabilities,
  requirements: FreeModelRequirements,
): boolean {
  if (requirements.needsTools && !capabilities.supportsTools) return false;
  if (requirements.needsStructuredOutput && !capabilities.supportsStructuredOutput) return false;
  if (requirements.needsVision && !capabilities.supportsVision) return false;
  if (requirements.maxInputTokens !== undefined && capabilities.inputTokenLimit < requirements.maxInputTokens) return false;
  return true;
}

/**
 * Select the concrete free model for the given requirements.
 *
 * Eligibility: tools / structured-output / vision requirements plus context
 * capacity. Unknown context capacity is NOT treated as verified capacity — an
 * unknown-context model is ineligible when a concrete context requirement
 * exists (conservative rule).
 *
 * Selection is deterministic: largest verified input context first, then
 * lexical model-ID tie-break.
 *
 * Returns undefined when no model is eligible. The selection is computed per
 * call — it is never cached (the catalog is cached, the choice is not).
 */
export function resolveConcreteFreeModel(
  catalog: FreeModelInfo[],
  requirements: FreeModelRequirements,
): FreeModelInfo | undefined {
  const eligible = catalog.filter((m) => {
    if (requirements.needsTools && !m.supportsTools) return false;
    if (requirements.needsStructuredOutput && !m.supportsStructuredOutput) return false;
    if (requirements.needsVision && !m.supportsVision) return false;
    if (
      requirements.maxInputTokens !== undefined &&
      (m.inputTokenLimit === undefined || m.inputTokenLimit < requirements.maxInputTokens)
    ) {
      return false;
    }
    return true;
  });

  if (eligible.length === 0) return undefined;

  return [...eligible].sort((a, b) =>
    (b.inputTokenLimit ?? -1) - (a.inputTokenLimit ?? -1) || a.id.localeCompare(b.id),
  )[0];
}