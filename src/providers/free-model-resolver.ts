// src/providers/free-model-resolver.ts
//
// Pure capability-aware free-model resolver. Selects a concrete free model
// from the catalog for a request. Also hosts the ONE capability vocabulary
// (`deriveRequestRequirements` / `supportsRequest`) shared with the routing
// layer so the free route and routing candidates filter on identical rules.

import { fetchFreeModelCatalog, type FreeModelInfo } from "./free-model-catalog.js";
import { accessRestrictedModelIds } from "./access-restriction-registry.js";
import type { NormalizedRequest, ModelCapabilities } from "./types.js";
import type { ModelSelectionPolicy } from "../config/schema.js";

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
 * Map a catalog entry onto the capability vocabulary shared with `supportsRequest`.
 *
 * `ModelCapabilities.inputTokenLimit` is `number` (never undefined); unknown
 * catalog context maps to `-1` so the conservative rule in `supportsRequest`
 * ("unknown context + required context → rejected") fires without re-implementing
 * the eligibility checks here. This keeps the eligibility logic in ONE place
 * (`supportsRequest`) shared by the free route and the routing candidates.
 */
function freeModelCapabilities(m: FreeModelInfo): ModelCapabilities {
  return {
    provider: "openrouter",
    model: m.id,
    inputTokenLimit: m.inputTokenLimit ?? -1,
    outputTokenLimit: 0,
    supportsTools: m.supportsTools,
    supportsStreaming: true,
    supportsStructuredOutput: m.supportsStructuredOutput,
    supportsVision: m.supportsVision,
  };
}

/**
 * Select the concrete free model for the given requirements.
 *
 * Eligibility is delegated to `supportsRequest` (the ONE capability vocabulary),
 * with unknown context capacity treated as not-verified via the `-1` mapping in
 * `freeModelCapabilities` — an unknown-context model is ineligible when a concrete
 * context requirement exists (conservative rule).
 *
 * Selection is deterministic: largest verified input context first, then
 * lexical model-ID tie-break.
 *
 * `exclude` holds model ids already attempted in this request's self-healing
 * retry loop (openrouter-provider free route) and must not be re-selected.
 *
 * Returns undefined when no model is eligible. The selection is computed per
 * call — it is never cached (the catalog is cached, the choice is not).
 */
export function resolveConcreteFreeModel(
  catalog: FreeModelInfo[],
  requirements: FreeModelRequirements,
  exclude: Set<string> = new Set(),
): FreeModelInfo | undefined {
  const eligible = catalog.filter(
    (m) => !exclude.has(m.id) && supportsRequest(freeModelCapabilities(m), requirements),
  );

  if (eligible.length === 0) return undefined;

  return [...eligible].sort((a, b) =>
    (b.inputTokenLimit ?? -1) - (a.inputTokenLimit ?? -1) || a.id.localeCompare(b.id),
  )[0];
}

/**
 * Resolve a `ModelSelectionPolicy` to a concrete model from the catalog.
 *
 * Maps the policy onto the ONE capability vocabulary (`supportsRequest`):
 *   - `capabilities` → the corresponding `needs*` flags
 *   - `minContext`   → `maxInputTokens` (conservative lower bound on context)
 *   - `cost: "free"` is served by the (already free-filtered) catalog;
 *     `cost: "paid"` cannot be served here and yields `undefined`.
 *   - a `provider` other than `openrouter` is unsupported by the free catalog
 *     and yields `undefined`.
 *
 * Configuration expresses requirements; discovery supplies the model id. The
 * free-model list is never hard-coded — "free" is derived from catalog pricing.
 */
export function resolveModelBySelectionPolicy(
  policy: ModelSelectionPolicy,
  catalog: FreeModelInfo[],
  exclude: Set<string> = new Set(),
): FreeModelInfo | undefined {
  if (policy.provider !== undefined && policy.provider !== "openrouter") return undefined;
  if (policy.cost === "paid") return undefined;

  const requirements: FreeModelRequirements = {
    needsTools: policy.capabilities?.includes("tools") ?? false,
    needsStructuredOutput: policy.capabilities?.includes("structured_output") ?? false,
    needsVision: policy.capabilities?.includes("vision") ?? false,
    ...(policy.minContext !== undefined ? { maxInputTokens: policy.minContext } : {}),
  };
  return resolveConcreteFreeModel(catalog, requirements, exclude);
}

/**
 * Resolve a `ModelSelectionPolicy` to a concrete model id by fetching the
 * current OpenRouter catalog and excluding models in the bounded-lifetime
 * access-restriction registry. Returns `undefined` when the policy is
 * unsatisfiable (no eligible concrete free model, `cost: paid`, or a non-
 * openrouter provider).
 *
 * The single discovery seam shared by `createProvider` (registry) and
 * `buildRoutingAdapter` (routing), so policy resolution behaves identically
 * across every consumer. Discovery is only ever invoked here — callers that
 * lack a policy never pay a catalog round-trip.
 */
export async function resolveModelSelectionId(
  policy: ModelSelectionPolicy,
): Promise<{ id: string } | undefined> {
  const catalog = await fetchFreeModelCatalog();
  const resolved = resolveModelBySelectionPolicy(policy, catalog, accessRestrictedModelIds());
  return resolved ? { id: resolved.id } : undefined;
}
