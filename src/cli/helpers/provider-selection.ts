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

/**
 * Test seam: clear ONLY `_modelCache` (preserves `_modelWarned`).
 *
 * Use this to verify that the warn-once guard survives across separate
 * uncached failure attempts for the same provider. `_resetModelCache` is
 * the existing teardown helper that clears BOTH caches.
 */
export function _clearModelCache(): void {
  _modelCache.clear();
}

/** Test seam: was a provider's fallback warning already emitted in this process? */
export function _wasModelWarned(providerId: string): boolean {
  return _modelWarned.has(providerId);
}

/**
 * Mark the given provider as warned this process.
 * Returns `true` when this call newly added the entry, `false` when it was already present.
 * The caller must honor the return value to preserve the warn-once invariant.
 */
function recordWarn(providerId: string): boolean {
  if (_modelWarned.has(providerId)) return false;
  _modelWarned.add(providerId);
  return true;
}

/**
 * Classify whether a `listModels()` failure is worth retrying.
 *
 * Retryable (transient):
 *   - HTTP 5xx server errors
 *   - Network failures (TypeError from undici/fetch when DNS/connect fails)
 *   - Timeouts (AbortError / DOMException with name "AbortError")
 *
 * NOT retryable (permanent):
 *   - HTTP 4xx client errors (auth, not-found, rate-limit-wait)
 *   - "Unknown provider" programming errors (catalog gaps)
 *
 * The status is parsed from the canonical `API error ${status}` message
 * thrown by `listModels()` in `src/providers/catalog.ts`.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true;             // network failure
  if (err instanceof Error && err.name === "AbortError") return true; // timeout
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.startsWith("Unknown provider")) return false;
    const m = /^API error (\d{3})$/.exec(msg);
    if (m) {
      const status = Number(m[1]);
      return status >= 500;
    }
    return true; // unknown error shape — be conservative and retry
  }
  return true;
}

/**
 * Live model discovery with caching, one-shot retry, and graceful default
 * fallback (spec §8, §14).
 *
 * Behaviour:
 *   - First call for `providerId` runs `listModels(providerId, apiKey)`.
 *   - On transient failure (HTTP 5xx, network error, timeout), retries exactly once.
 *   - On permanent failure (HTTP 4xx, "Unknown provider"), does NOT retry.
 *   - If the (possibly retried) call still fails, returns `[{ id: getDefaultModel(providerId) }]`
 *     and warns to stderr ONCE per provider per process.
 *   - Success (live or fallback) is cached until the process exits.
 *
 * Caching strategy: the cache is keyed by `providerId` alone. The api key is
 * resolved fresh per call from env/user-config. Consequently, two callers
 * with different api keys for the same provider will see the FIRST call's
 * result cached for the rest of the process — this is an intentional
 * simplification (key race is not supported; spec §14 allows it).
 * `_clearModelCache()` clears the result cache but preserves the warn-once
 * guard; `_resetModelCache()` clears both (process-wide teardown).
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
      // Permanent failures must not be retried — spec §14.
      if (!isRetryable(err)) break;
    }
  }

  // Success path: cache the live list and return.
  if (models !== undefined) {
    _modelCache.set(providerId, { models });
    return models;
  }

  // Both attempts failed (or failure was permanent on the first try) —
  // fall back to DEFAULT_MODELS single entry. Warn-once guard: only emit
  // the stderr line if `recordWarn` reports this is a NEW warning.
  const def = getDefaultModel(providerId);
  const fallback: ModelInfo[] = def ? [{ id: def, displayName: def }] : [];
  if (recordWarn(providerId)) {
    process.stderr.write(
      `Warning: could not fetch live models for ${providerId} (${lastErr instanceof Error ? lastErr.message : String(lastErr)}). Using default model.\n`,
    );
  }
  _modelCache.set(providerId, { models: fallback });
  return fallback;
}
