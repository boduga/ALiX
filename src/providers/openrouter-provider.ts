import { BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import { fetchFreeModelCatalog } from "./free-model-catalog.js";
import { resolveConcreteFreeModel, deriveRequestRequirements } from "./free-model-resolver.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OpenRouterConfig = {
  apiKey?: string;
  model?: string;
};

export const FREE_ROUTE_MODEL = "openrouter/free";

function isFreeRoute(model: string): boolean {
  return model === FREE_ROUTE_MODEL || model.endsWith(":free");
}

async function resolveConcreteModel(request: NormalizedRequest): Promise<string> {
  const catalog = await fetchFreeModelCatalog();
  // The agent tab always runs tool loops, so the free route must always land
  // on a tools-capable model regardless of the request's tools array.
  const requirements = { ...deriveRequestRequirements(request), needsTools: true };
  const resolved = resolveConcreteFreeModel(catalog, requirements);
  if (!resolved) {
    throw new Error("No OpenRouter free model satisfies the request requirements");
  }
  return resolved.id;
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
    const model = isFreeRoute(this._model) ? await resolveConcreteModel(request) : this._model;
    return complete("openrouter", model, request, { apiKey: this._apiKey });
  }

  async *stream(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    const model = isFreeRoute(this._model) ? await resolveConcreteModel(request) : this._model;
    yield* stream("openrouter", model, request, { apiKey: this._apiKey });
  }
}
