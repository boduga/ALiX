export type DiscoveredModel = {
  id: string;
  provider: string;
  inputContextLimit?: number;
  costPerMTokIn?: number;
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
  supportsVision?: boolean;
};

const CATALOG_URL =
  "https://openrouter.ai/api/v1/models";

const TTL_MS = 60 * 60 * 1000;

let _fetch: typeof fetch = globalThis.fetch;

export function _setOpenRouterDiscoveryFetch(
  f: typeof fetch,
): void {
  _fetch = f;
}

let cache:
  | {
      models: DiscoveredModel[];
      fetchedAt: number;
    }
  | undefined;

export function _resetOpenRouterDiscoveryCache(): void {
  cache = undefined;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function supports(
  name: string,
  params: unknown,
): boolean {
  if (Array.isArray(params)) {
    return params.includes(name);
  }

  if (isRecord(params)) {
    return params[name] === true;
  }

  return false;
}

function toDiscoveredModel(
  model: Record<string, unknown>,
): DiscoveredModel {
  const params = model.supported_parameters;

  const pricing = isRecord(model.pricing)
    ? model.pricing
    : {};

  const promptPerToken =
    typeof pricing.prompt === "string"
      ? parseFloat(pricing.prompt)
      : NaN;

  const costPerMTokIn =
    Number.isFinite(promptPerToken)
      ? promptPerToken * 1_000_000
      : undefined;

  const id =
    typeof model.id === "string"
      ? model.id
      : "";

  return {
    id,
    provider: "openrouter",

    ...(typeof model.context_length === "number"
      ? {
          inputContextLimit:
            model.context_length,
        }
      : {}),

    ...(costPerMTokIn !== undefined
      ? {
          costPerMTokIn,
        }
      : {}),

    supportsTools: supports(
      "tools",
      params,
    ),

    supportsStructuredOutput: supports(
      "structured_outputs",
      params,
    ),

    supportsVision: supports(
      "vision",
      params,
    ),
  };
}

export async function discoverOpenRouterModels(
  opts: { apiKey?: string } = {},
): Promise<DiscoveredModel[]> {
  if (
    cache &&
    Date.now() - cache.fetchedAt < TTL_MS
  ) {
    return cache.models;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (opts.apiKey) {
    headers.Authorization =
      `Bearer ${opts.apiKey}`;
  }

  const response = await _fetch(
    CATALOG_URL,
    { headers },
  );

  if (!response.ok) {
    throw new Error(
      `OpenRouter catalog request failed: ${response.status}`,
    );
  }

  const json =
    (await response.json()) as {
      data?: unknown;
    };

  const models = Array.isArray(json.data)
    ? json.data
        .filter(isRecord)
        .map((model) =>
          toDiscoveredModel(model),
        )
        .filter((model) =>
          model.id.length > 0,
        )
    : [];

  cache = {
    models,
    fetchedAt: Date.now(),
  };

  return models;
}
