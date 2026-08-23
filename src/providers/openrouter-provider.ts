import { ApiError, BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import { fetchFreeModelCatalog } from "./free-model-catalog.js";
import { resolveConcreteFreeModel, deriveRequestRequirements } from "./free-model-resolver.js";
import type { FreeModelInfo } from "./free-model-catalog.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OpenRouterConfig = {
  apiKey?: string;
  model?: string;
};

export const FREE_ROUTE_MODEL = "openrouter/free";

function isFreeRoute(model: string): boolean {
  return model === FREE_ROUTE_MODEL || model.endsWith(":free");
}

/**
 * OpenRouter returns 403/404 naming the model's backing provider (e.g. `stealth`)
 * and the account's `allowed-providers` when a free model is served by a provider
 * the account has not opted into. That is a *rejection*, not a terminal not-found:
 * the free route is self-healing and should re-resolve to a different concrete
 * free model and retry (free-tier model/account-mismatch resilience).
 */
const ACCOUNT_REJECTION_RE = /allowed-providers|No allowed providers are available/i;

function isAccountRejection(message: string): boolean {
  return ACCOUNT_REJECTION_RE.test(message ?? "");
}

/** Resolve a concrete free model for the request, excluding already-tried ids. */
async function resolveConcreteModel(
  request: NormalizedRequest,
  exclude: Set<string> = new Set(),
): Promise<FreeModelInfo | undefined> {
  const catalog = await fetchFreeModelCatalog();
  // The agent tab always runs tool loops, so the free route must always land
  // on a tools-capable model regardless of the request's tools array.
  const requirements = { ...deriveRequestRequirements(request), needsTools: true };
  return resolveConcreteFreeModel(catalog, requirements, exclude);
}

export class OpenRouterProvider extends BaseProvider {
  id = "openrouter";
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  get capabilities() {
    return {
      provider: "openrouter",
      model: this._model,
      inputTokenLimit: 200_000,
      outputTokenLimit: 8_192,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
    };
  }

  constructor(config: OpenRouterConfig = {}) {
    super({
      apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY ?? "",
      model: config.model ?? "openai/gpt-4o",
      baseUrl: "https://openrouter.ai/api",
      timeoutMs: 120_000,
    });
  }

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    if (!isFreeRoute(this._model)) {
      return complete("openrouter", this._model, request, { apiKey: this._apiKey });
    }
    // Self-healing free route: if OpenRouter rejects the resolved model because
    // the account disallows its backing provider, drop it and re-resolve to a
    // different concrete free model. The catalog is cached; only the selection
    // changes. Non-rejection errors propagate immediately.
    const tried: string[] = [];
    for (;;) {
      const resolved = await resolveConcreteModel(request, new Set(tried));
      if (!resolved) {
        throw new Error("No OpenRouter free model satisfies the request requirements");
      }
      try {
        const res = await complete("openrouter", resolved.id, request, { apiKey: this._apiKey });
        if (!res.resolvedModel) res.resolvedModel = resolved.id;
        return res;
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.status === 403 || err.status === 404) &&
          isAccountRejection(err.detail)
        ) {
          tried.push(resolved.id);
          continue;
        }
        throw err;
      }
    }
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    if (!isFreeRoute(this._model)) {
      yield* stream("openrouter", this._model, request, { apiKey: this._apiKey });
      return;
    }
    const tried: string[] = [];
    for (;;) {
      const resolved = await resolveConcreteModel(request, new Set(tried));
      if (!resolved) {
        throw new Error("No OpenRouter free model satisfies the request requirements");
      }
      let committed = false;
      let rejectedByAccount = false;
      for await (const chunk of stream("openrouter", resolved.id, request, {
        apiKey: this._apiKey,
      })) {
        // Any non-terminal content chunk means the stream is committed.
        if (chunk.type !== "done" && chunk.type !== "error") committed = true;
        // An account-rejection surfaces as an early error chunk (404/403) before
        // any tokens are streamed — re-resolve excluding this model and retry.
        if (chunk.type === "error" && !committed && isAccountRejection(chunk.error)) {
          rejectedByAccount = true;
          break;
        }
        yield chunk;
      }
      if (rejectedByAccount) {
        tried.push(resolved.id);
        continue;
      }
      return;
    }
  }
}
