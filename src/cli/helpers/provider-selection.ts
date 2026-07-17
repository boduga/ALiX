/**
 * Provider + model discovery and interactive selection for `alix init`
 * and `alix config set-default-model`. Mirrors spec §6–§8, §13.
 *
 * Public surface (extended by Tasks 3 and 5):
 *   - ProviderAvailability
 *   - resolveProviders()
 *   - getAvailableModels()
 *   - selectFromList()            (Task 3)
 *   - selectProviderInteractive() (Task 3)
 *   - selectModelInteractive()    (Task 3)
 *   - resolveInitialProviderAndModel() (Task 5)
 */
import { PROVIDERS, getInstalledOllamaModels, getDefaultModel, listModels, type ModelInfo } from "../../providers/catalog.js";
import { getApiKey } from "./api-keys.js";

export interface ProviderAvailability {
  id: string;
  name: string;
  env: string;
  hint: string;
  available: boolean;
  apiKeySource: "environment" | "user-config" | "ollama" | "none";
  reason?: string;
}

/**
 * Determine availability for every PROVIDERS entry without filtering.
 * Spec §6: "Provider discovery determines availability but does not
 * filter providers. Consumers decide how to display or filter the list."
 *
 * For ollama, "available" reflects both key-emptiness (always true; ollama
 * may run keyless) AND the existence of a running ollama instance with
 * installed models. `reason` explains why ollama might not be usable.
 */
export async function resolveProviders(): Promise<ProviderAvailability[]> {
  const ollamaInstalled = getInstalledOllamaModels();
  const out: ProviderAvailability[] = [];

  for (const p of PROVIDERS) {
    const key = await getApiKey(p.id);
    if (p.id === "ollama") {
      out.push({
        id: p.id,
        name: p.name,
        env: p.env,
        hint: p.hint,
        available: ollamaInstalled.length > 0,
        apiKeySource: "ollama",
        reason: ollamaInstalled.length === 0 ? "Ollama not running or no installed models" : undefined,
      });
      continue;
    }
    if (key === undefined) {
      out.push({ id: p.id, name: p.name, env: p.env, hint: p.hint, available: false, apiKeySource: "none" });
      continue;
    }
    // Distinguish env vs user-config by checking env first.
    if (process.env[p.env]) {
      out.push({ id: p.id, name: p.name, env: p.env, hint: p.hint, available: true, apiKeySource: "environment" });
    } else {
      out.push({ id: p.id, name: p.name, env: p.env, hint: p.hint, available: true, apiKeySource: "user-config" });
    }
  }
  return out;
}

// ─── Process-scoped cache + warn-once ────────────────────────────────────────

interface CacheEntry { models: ModelInfo[] }
const _modelCache: Map<string, CacheEntry> = new Map();
const _modelWarned: Set<string> = new Set();

export function _resetModelCache(): void {
  _modelCache.clear();
  _modelWarned.clear();
}

/** Test seam: was a provider's fallback warning already emitted in this process? */
export function _wasModelWarned(providerId: string): boolean {
  return _modelWarned.has(providerId);
}

function recordWarn(providerId: string): void {
  if (_modelWarned.has(providerId)) return;
  _modelWarned.add(providerId);
}

/**
 * Live model discovery with caching, one-shot retry, and graceful default
 * fallback (spec §8, §14).
 *
 * Behaviour:
 *   - First call for `(providerId, apiKey)` runs `listModels(providerId, apiKey)`.
 *   - On network / 5xx / timeout, retries exactly once.
 *   - If still failing, returns `[{ id: getDefaultModel(providerId) }]`
 *     and warns to stderr ONCE per provider per process.
 *   - Success is cached until the process exits (cleared by `_resetModelCache`).
 *
 * `@param fetchFn` is a test seam; defaults to global `fetch`.
 */
export async function getAvailableModels(
  providerId: string,
  fetchFn: typeof fetch = fetch,
): Promise<ModelInfo[]> {
  const cached = _modelCache.get(providerId);
  if (cached) return cached.models;

  // Resolve the api key once per call (callers may have a key from env already;
  // passing it in would be redundant — listModels needs it as second arg).
  const apiKey = (await getApiKey(providerId)) ?? "";

  const callOnce = async () => {
    // Spec: tests inject `fetchFn`; production forwards to global `fetch`.
    const effectiveFetch = fetchFn;
    // listModels uses module-scoped fetch — we don't modify catalog.ts in
    // this plan. Instead we wrap the fetch into globalThis so listModels
    // sees it for the duration of this call.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = effectiveFetch;
    try {
      return await listModels(providerId, apiKey);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  let lastErr: unknown;
  let models: ModelInfo[] | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      models = await callOnce();
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  // Success path: cache the live list and return.
  if (models !== undefined) {
    _modelCache.set(providerId, { models });
    return models;
  }

  // Both attempts failed — fall back to DEFAULT_MODELS single entry.
  const def = getDefaultModel(providerId);
  const fallback: ModelInfo[] = def ? [{ id: def, displayName: def }] : [];
  recordWarn(providerId);
  process.stderr.write(
    `Warning: could not fetch live models for ${providerId} (${lastErr instanceof Error ? lastErr.message : String(lastErr)}). Using default model.\n`,
  );
  _modelCache.set(providerId, { models: fallback });
  return fallback;
}