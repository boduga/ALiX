import {
  type DiscoveredModel,
  discoverOpenRouterModels,
} from "./model-discovery.js";

import {
  listModels,
} from "./catalog.js";

import {
  accessRestrictedModelIds,
} from "./access-restriction-registry.js";

import type {
  NormalizedRequest,
  ModelCapabilities,
} from "./types.js";

import type {
  ModelSelectionPolicy,
  ModelCapabilityName,
} from "../config/schema.js";

/** Maps a policy capability name onto the `DiscoveredModel` support flag that gates it. */
const CAPABILITY_SUPPORT_FLAG: Record<
  ModelCapabilityName,
  "supportsTools" | "supportsStructuredOutput" | "supportsVision"
> = {
  tools: "supportsTools",
  structured_output: "supportsStructuredOutput",
  vision: "supportsVision",
};

export type ModelSelectionRequirements = {
  needsTools: boolean;
  needsStructuredOutput: boolean;
  needsVision: boolean;
  maxInputTokens?: number;
};

/** A concrete model id resolved from a selection policy. */
export type ResolvedModel = { id: string };

/** Primary tie-break shared by every selector: context descending, then id ascending. */
function byContextThenId(
  a: DiscoveredModel,
  b: DiscoveredModel,
): number {
  const contextDifference =
    (b.inputContextLimit ?? -1) -
    (a.inputContextLimit ?? -1);

  if (contextDifference !== 0) {
    return contextDifference;
  }

  return a.id.localeCompare(b.id);
}

/** Map a catalog `ModelInfo` onto a `DiscoveredModel` (context-only projection). */
function toDiscoveredModel(
  provider: string,
  model: { id: string; maxInputTokens?: number },
): DiscoveredModel {
  return {
    id: model.id,
    provider,

    ...(model.maxInputTokens !== undefined
      ? {
          inputContextLimit:
            model.maxInputTokens,
        }
      : {}),
  };
}

export function deriveRequestRequirements(
  request: NormalizedRequest,
  maxInputTokens?: number,
): ModelSelectionRequirements {
  return {
    needsTools:
      !!(
        request.tools &&
        request.tools.length > 0
      ),

    needsStructuredOutput:
      request.structuredOutputSchema !==
      undefined,

    needsVision:
      Array.isArray(request.messages) &&
      request.messages.some((message) =>
        Array.isArray(message.content) &&
        message.content.some(
          (content) =>
            content.type === "image" ||
            content.type === "file",
        ),
      ),

    ...(maxInputTokens !== undefined
      ? { maxInputTokens }
      : {}),
  };
}

export function supportsRequest(
  capabilities: ModelCapabilities,
  requirements: ModelSelectionRequirements,
): boolean {
  if (
    requirements.needsTools &&
    !capabilities.supportsTools
  ) {
    return false;
  }

  if (
    requirements.needsStructuredOutput &&
    !capabilities.supportsStructuredOutput
  ) {
    return false;
  }

  if (
    requirements.needsVision &&
    !capabilities.supportsVision
  ) {
    return false;
  }

  if (
    requirements.maxInputTokens !== undefined &&
    capabilities.inputTokenLimit <
      requirements.maxInputTokens
  ) {
    return false;
  }

  return true;
}

export async function discoverProviderModels(
  provider: string,
  apiKey?: string,
): Promise<DiscoveredModel[]> {
  const listed = await listModels(
    provider,
    apiKey ?? "",
  );

  return listed.map((model) =>
    toDiscoveredModel(provider, model),
  );
}

export function selectModelFromDiscovery(
  policy: ModelSelectionPolicy,
  models: DiscoveredModel[],
  exclude: Set<string> = new Set(),
): DiscoveredModel | undefined {
  const sourceHasCost = models.some(
    (model) =>
      model.costPerMTokIn !== undefined,
  );

  const sourceHasCapabilities =
    models.some(
      (model) =>
        model.supportsTools !== undefined ||
        model.supportsStructuredOutput !==
          undefined ||
        model.supportsVision !== undefined,
    );

  const eligible = models.filter(
    (model) => {
      if (exclude.has(model.id)) {
        return false;
      }

      if (
        policy.minContext !== undefined &&
        model.inputContextLimit !==
          undefined &&
        model.inputContextLimit <
          policy.minContext
      ) {
        return false;
      }

      if (
        sourceHasCost &&
        policy.cost !== undefined
      ) {
        if (
          policy.cost === "free" &&
          model.costPerMTokIn !== 0
        ) {
          return false;
        }

        if (
          policy.cost === "paid" &&
          (
            model.costPerMTokIn ===
              undefined ||
            model.costPerMTokIn <= 0
          )
        ) {
          return false;
        }
      }

      if (
        sourceHasCapabilities &&
        policy.capabilities
      ) {
        for (const capability of policy.capabilities) {
          const flag =
            CAPABILITY_SUPPORT_FLAG[capability];

          if (model[flag] !== true) {
            return false;
          }
        }
      }

      return true;
    },
  );

  if (eligible.length === 0) {
    return undefined;
  }

  const hasKnownCost = eligible.some(
    (model) =>
      model.costPerMTokIn !== undefined,
  );

  return [...eligible].sort(
    (a, b) => {
      if (hasKnownCost) {
        const aHasCost =
          a.costPerMTokIn !== undefined;

        const bHasCost =
          b.costPerMTokIn !== undefined;

        if (aHasCost && !bHasCost) {
          return -1;
        }

        if (!aHasCost && bHasCost) {
          return 1;
        }

        if (
          aHasCost &&
          bHasCost &&
          a.costPerMTokIn !==
            b.costPerMTokIn
        ) {
          return (
            a.costPerMTokIn! -
            b.costPerMTokIn!
          );
        }
      }

      return byContextThenId(a, b);
    },
  )[0];
}

export async function resolveModelSelectionId(
  policy: ModelSelectionPolicy,
  opts: {
    apiKey?: string;
  } = {},
): Promise<
  ResolvedModel | undefined
> {
  const provider =
    policy.provider ?? "openrouter";

  const models =
    provider === "openrouter"
      ? await discoverOpenRouterModels({
          apiKey: opts.apiKey,
        })
      : await discoverProviderModels(
          provider,
          opts.apiKey,
        );

  const resolved =
    selectModelFromDiscovery(
      policy,
      models,
      accessRestrictedModelIds(),
    );

  return resolved
    ? { id: resolved.id }
    : undefined;
}

// Map a discovered model onto the ONE capability vocabulary (`supportsRequest`)
// shared with the routing layer. Unknown context maps to `-1` so a concrete
// context requirement conservatively rejects an unknown-context model.
function discoveredCapabilities(
  model: DiscoveredModel,
): ModelCapabilities {
  return {
    provider: model.provider,
    model: model.id,
    inputTokenLimit: model.inputContextLimit ?? -1,
    outputTokenLimit: 0,
    supportsTools: model.supportsTools ?? false,
    supportsStreaming: true,
    supportsStructuredOutput:
      model.supportsStructuredOutput ?? false,
    supportsVision: model.supportsVision ?? false,
  };
}

/**
 * Free-route helper — REQUEST-DERIVED requirements, largest-context ranking.
 * Preserves the existing `openrouter/free` semantics (openrouter-provider.ts
 * `resolveConcreteModel`) where `needsTools` is forced true for the agent tab
 * and vision/structured-output come from the request. This is NOT policy
 * selection (which uses `selectModelFromDiscovery`). Broadened input type
 * from `DiscoveredModel[]` only.
 */
export function resolveConcreteFreeModel(
  models: DiscoveredModel[],
  requirements: ModelSelectionRequirements,
  exclude: Set<string> = new Set(),
): DiscoveredModel | undefined {
  const eligible = models.filter(
    (model) =>
      !exclude.has(model.id) &&
      supportsRequest(
        discoveredCapabilities(model),
        requirements,
      ),
  );

  if (eligible.length === 0) {
    return undefined;
  }

  return [...eligible].sort(byContextThenId)[0];
}
