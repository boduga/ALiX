// src/providers/free-model-catalog.ts
//
// OpenRouter free-model catalog. Fetches `/models`, filters to free models,
// and caches the catalog (NOT the selected concrete model — that choice is
// per-request in free-model-resolver.ts).

export type FreeModelInfo = {
  id: string;
  name: string;
  inputTokenLimit: number | undefined;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
};

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const TTL_MS = 60 * 60 * 1000; // 1 hour

let _fetch: typeof fetch = globalThis.fetch;
export function _setCatalogFetchForTesting(f: typeof fetch) { _fetch = f; }

let cache: { models: FreeModelInfo[]; fetchedAt: number } | undefined;
export function _resetCatalogCacheForTesting() { cache = undefined; }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFree(m: unknown): boolean {
  if (!isRecord(m)) return false;
  const pricing = m.pricing;
  if (!isRecord(pricing)) return false;
  return pricing.prompt === "0" && pricing.request === "0";
}

function toFreeModelInfo(m: Record<string, unknown>): FreeModelInfo {
  const params = isRecord(m.supported_parameters) ? m.supported_parameters : {};
  const inputTokenLimit = typeof m.context_length === "number" ? m.context_length : undefined;
  return {
    id: typeof m.id === "string" ? m.id : "",
    name: typeof m.name === "string" ? m.name : "",
    inputTokenLimit,
    supportsTools: params.tools === true,
    supportsStructuredOutput: params.structured_outputs === true,
    supportsVision: params.vision === true,
  };
}

/**
 * Fetch the OpenRouter model catalog and return the free models.
 *
 * Cache policy: the catalog is cached for 1 hour. A non-expired cache is used
 * when a fetch fails; a fetch failure with no cache propagates. Stale data is
 * never used indefinitely (expired cache is discarded).
 */
export async function fetchFreeModelCatalog(): Promise<FreeModelInfo[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.models;

  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const res = await _fetch(CATALOG_URL, {
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });

  if (!res.ok) {
    throw new Error(`OpenRouter catalog request failed: ${res.status}`);
  }

  const json = (await res.json()) as { data?: unknown };
  const models = Array.isArray(json.data)
    ? json.data.filter(isFree).map((m) => toFreeModelInfo(m as Record<string, unknown>))
    : [];

  cache = { models, fetchedAt: Date.now() };
  return models;
}