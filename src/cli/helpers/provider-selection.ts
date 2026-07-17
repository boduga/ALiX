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
import { PROVIDERS, getInstalledOllamaModels, getDefaultModel, listModels, detectProvider, type ModelInfo } from "../../providers/catalog.js";
import { getApiKey } from "./api-keys.js";
import type { ParsedInitArgs } from "./init-args.js";

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

// ─── Interactive selection (Task 3) ───────────────────────────────────────────

import { prompt as defaultPrompt } from "../commands/prompt.js";

const isInteractive = () => Boolean(process.stdin?.isTTY);

async function reAsk(promptFn: (q: string) => Promise<string>, q: string, tries = 3): Promise<string | null> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    last = (await promptFn(q)).trim();
    if (last !== "") return last;
  }
  return last;
}

/**
 * Generic numbered-list picker. Returns the selected item, or `null` on
 * cancellation (user types `0`) or when the list is empty.
 *
 * - Re-prompts on empty / non-numeric / out-of-range input.
 * - `promptFn` is a test seam; defaults to the global `prompt()` from
 *   `src/cli/commands/prompt.ts`.
 */
export async function selectFromList<T>(
  items: T[],
  label: (item: T) => string,
  opts: { promptFn?: (q: string) => Promise<string>; header?: string } = {},
): Promise<T | null> {
  if (items.length === 0) {
    process.stderr.write("Warning: no items available to select.\n");
    return null;
  }
  const promptFn = opts.promptFn ?? defaultPrompt;

  const header = opts.header ? `${opts.header}\n` : "";
  let body = header;
  for (let i = 0; i < items.length; i++) {
    body += ` ${i + 1}. ${label(items[i]!)}\n`;
  }

  // Try until we get a valid 1..N integer.
  // Cancellation is signalled by 0 (or after N tries of empty/invalid input).
  let answer: string | null = "";
  for (let tries = 0; tries < 10; tries++) {
    answer = await reAsk(promptFn, `${body}\nSelect (1-${items.length}, 0 cancel): `);
    const num = Number.parseInt(answer ?? "", 10);
    if (num === 0) return null;
    if (Number.isInteger(num) && num >= 1 && num <= items.length) {
      return items[num - 1]!;
    }
  }
  return null;
}

/**
 * Interactive provider picker — only considers providers with
 * `available === true`. Returns the chosen provider id or `null`.
 *
 * Ordering (spec §13): environment → user-config → ollama. Within each
 * tier, original `avail` array order (i.e. PROVIDERS array order) is
 * preserved.
 */
const SOURCE_PRIORITY: Record<ProviderAvailability["apiKeySource"], number> = {
  environment: 0,
  "user-config": 1,
  ollama: 2,
  none: 3,
};

export async function selectProviderInteractive(
  avail: ProviderAvailability[],
  promptFn?: (q: string) => Promise<string>,
): Promise<string | null> {
  const available = avail
    .filter((p) => p.available)
    .slice() // copy so we don't mutate caller's array
    .sort((a, b) => {
      const pa = SOURCE_PRIORITY[a.apiKeySource];
      const pb = SOURCE_PRIORITY[b.apiKeySource];
      if (pa !== pb) return pa - pb;
      // Within same tier, preserve original PROVIDERS order via the input array index.
      return avail.indexOf(a) - avail.indexOf(b);
    });
  const picked = await selectFromList(
    available,
    (p) => {
      const reason = p.reason ? ` (${p.reason})` : "";
      return `${p.name} — ${p.apiKeySource}${reason}`;
    },
    { promptFn, header: "Choose a provider:" },
  );
  return picked?.id ?? null;
}

/**
 * Interactive model picker. Shows up to 50 models and lets the user pick by
 * number — see spec §15 for the same `MAX_SHOWN` truncation rule used by
 * `set-default-model`. Returns the chosen `ModelInfo` or `null`.
 */
export async function selectModelInteractive(
  models: ModelInfo[],
  promptFn?: (q: string) => Promise<string>,
): Promise<ModelInfo | null> {
  const MAX_SHOWN = 50;
  const shown = models.slice(0, MAX_SHOWN);
  const picked = await selectFromList(
    shown,
    (m) => {
      const tokens = m.maxInputTokens ? ` (in: ${(m.maxInputTokens / 1000).toFixed(0)}k)` : "";
      return `${m.displayName}${tokens}`;
    },
    { promptFn, header: "Choose a model:" },
  );
  if (picked && models.length > MAX_SHOWN) {
    process.stderr.write(`(Showing first ${MAX_SHOWN} of ${models.length} models.)\n`);
  }
  return picked;
}

// ─── Orchestrator (Task 5) ────────────────────────────────────────────────────

export interface InitResolution {
  providerId: string;
  modelId: string;
}

/**
 * Top-level orchestrator for `alix init`. Picks the right mode based on
 * the parsed args + TTY state, then returns `{ providerId, modelId }`
 * for `runInit()` to persist.
 *
 * Modes (spec §3, §10, §11):
 *   flagged     — explicit --provider → honor it (works in both TTY and non-TTY).
 *   auto        — no --provider and non-TTY → use detectProvider().
 *   interactive — TTY + no --provider → prompt provider (available-only) + model.
 */
export async function resolveInitialProviderAndModel(
  args: ParsedInitArgs,
  opts: {
    promptFn?: (q: string) => Promise<string>;
    fetchFn?: typeof fetch;
  } = {},
): Promise<InitResolution> {
  // ── Explicit --provider always wins (works in TTY + non-TTY). ─────────
  if (args.provider) {
    return await resolveFlagged(args, opts);
  }

  const interactive = Boolean(process.stdin?.isTTY);

  // ── Auto mode (non-TTY + no flags). ──────────────────────────────────
  if (!interactive) {
    const det = detectProvider();
    return { providerId: det.provider, modelId: det.model };
  }

  // ── Interactive mode (TTY + no flags). ────────────────────────────────
  return await resolveInteractive(opts);
}

async function resolveFlagged(
  args: ParsedInitArgs,
  opts: { promptFn?: (q: string) => Promise<string>; fetchFn?: typeof fetch },
): Promise<InitResolution> {
  const provider = PROVIDERS.find((p) => p.id === args.provider);
  if (!provider) throw new Error(`Unknown provider: ${args.provider}`);

  // Resolve key for live model lookup. Ollama returns "" (always available).
  const key = await getApiKey(provider.id);
  if (key === undefined) {
    throw new Error(`No API key for provider: ${args.provider}`);
  }

  if (args.model) {
    // Validate against live list.
    const models = await getAvailableModels(provider.id, opts.fetchFn);
    const found = models.find((m) => m.id === args.model);
    if (!found) throw new Error(`Model "${args.model}" not found for provider "${args.provider}".`);
    return { providerId: provider.id, modelId: args.model };
  }

  // No --model provided → prompt for it (interactive + flagged coexists
  // per spec §3 row "TTY + --provider X").
  const models = await getAvailableModels(provider.id, opts.fetchFn);
  const picked = await selectModelInteractive(models, opts.promptFn);
  if (!picked) {
    process.stderr.write("Init cancelled.\n");
    process.exit(130);
  }
  return { providerId: provider.id, modelId: picked.id };
}

async function resolveInteractive(opts: {
  promptFn?: (q: string) => Promise<string>;
  fetchFn?: typeof fetch;
}): Promise<InitResolution> {
  const avail = await resolveProviders();
  if (avail.every((p) => !p.available)) {
    throw new Error(
      "No available providers. Set at least one API key (env var or ~/.config/alix/config.json apiKeys) or install Ollama with a model.",
    );
  }
  const pick = await selectProviderInteractive(avail, opts.promptFn);
  if (!pick) {
    process.stderr.write("Init cancelled.\n");
    process.exit(130);
  }
  const models = await getAvailableModels(pick, opts.fetchFn);
  const modelPick = await selectModelInteractive(models, opts.promptFn);
  if (!modelPick) {
    process.stderr.write("Init cancelled.\n");
    process.exit(130);
  }
  return { providerId: pick, modelId: modelPick.id };
}
