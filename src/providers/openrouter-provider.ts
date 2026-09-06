import { ApiError, BaseProvider } from "./base.js";
import { complete, stream } from "./unified-complete.js";
import { discoverOpenRouterModels, isFreeModel } from "./model-discovery.js";
import { resolveConcreteFreeModel, deriveRequestRequirements } from "./model-resolver.js";
import { recordAccessRestricted, accessRestrictedModelIds } from "./access-restriction-registry.js";
import type { DiscoveredModel } from "./model-discovery.js";
import type { NormalizedRequest, NormalizedResponse, StreamChunk } from "./types.js";

export type OpenRouterConfig = {
  apiKey?: string;
  model?: string;
};

export const FREE_ROUTE_MODEL = "openrouter/free";

/**
 * Only the `openrouter/free` alias triggers free-route re-resolution. A
 * concrete `:free` model configured in the default (e.g. via
 * `alix models set-default`) is an explicit pin: it is sent directly and its
 * id becomes the resolvedModel, bypassing the largest-context free resolver.
 */
function isFreeRoute(model: string): boolean {
  return model === FREE_ROUTE_MODEL;
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

/**
 * Whether a classified refusal is an access-control class (vs. account
 * rejection, which self-heals per-request, or unknown). Access-control classes
 * are what the bounded-lifetime restriction registry records.
 */
function isAccessControlClass(c: ProviderAccessClass): boolean {
  return c === "model_access_restricted" || c === "guardrail_blocked";
}

/**
 * Access-control classification for OpenRouter refusal responses. These are
 * distinct failure classes that ALiX's fallback/governance must not conflate:
 *
 *  - `model_access_restricted`: the model's OWN access policy refuses this
 *    endpoint/client — e.g. a `:free` model restricted to recognized agentic
 *    harnesses ("only available for agentic harnesses"). A request-payload
 *    change cannot fix it; blindly re-resolving to another free model and
 *    resending is the wrong recovery.
 *  - `guardrail_blocked`: a content filter / prompt-injection detector blocked
 *    the request ("Request blocked: ..."). Should surface to the user, not be
 *    blindly retried/fallback.
 *  - `account_rejection`: a free model's backing provider is not opted into by
 *    the account ("allowed-providers") — the self-healing free route re-resolves.
 *  - `unknown`: anything else.
 */
export type ProviderAccessClass =
  | "model_access_restricted"
  | "guardrail_blocked"
  | "account_rejection"
  | "unknown";

/** Recognize the class of an OpenRouter access-control refusal. */
export function classifyProviderAccess(status: number, detail: string): ProviderAccessClass {
  const msg = detail ?? "";
  if (status === 403 && /agentic harness/i.test(msg)) return "model_access_restricted";
  if (status === 403 && /^Request blocked:/i.test(msg.trim())) return "guardrail_blocked";
  if ((status === 403 || status === 404) && isAccountRejection(msg)) return "account_rejection";
  return "unknown";
}

/**
 * A provider access-control error that carries its classification so
 * fallback/governance can decide the right recovery instead of treating every
 * 403 as equivalent. Extends `ApiError` so existing `instanceof ApiError`
 * checks (routing adapter, retry logic) keep working unchanged.
 */
export class ProviderAccessError extends ApiError {
  constructor(
    status: number,
    detail: string,
    public readonly accessClass: ProviderAccessClass,
  ) {
    super(status, detail);
  }
}


/** Resolve a concrete free model for the request, excluding already-tried ids. */
async function resolveConcreteModel(
  request: NormalizedRequest,
  exclude: Set<string> = new Set(),
): Promise<DiscoveredModel | undefined> {
  const ALL = await discoverOpenRouterModels();
  // free route considers only free models (discovery returns full catalog)
  const catalog = ALL.filter(isFreeModel);
  // The agent tab always runs tool loops, so the free route must always land
  // on a tools-capable model regardless of the request's tools array.
  const requirements = { ...deriveRequestRequirements(request), needsTools: true };
  // Merge bounded-lifetime access-control exclusions so a model refused by an
  // access-control 403 stays out of the pool (across requests) until its TTL
  // expires — while never excluding it permanently.
  const excludeAll = new Set<string>([...exclude, ...accessRestrictedModelIds()]);
  return resolveConcreteFreeModel(catalog, requirements, excludeAll);
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
      parallelToolCalls: this.parallelToolCallsResolved,
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
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          if (isAccountRejection(err.detail)) {
            // Account-opt-in mismatch: self-heal by excluding this model.
            tried.push(resolved.id);
            continue;
          }
          // Access-control refusal (harness restriction, guardrail block, or an
          // unresolved 403): record as bounded-lifetime access-restricted so it
          // is excluded from future selection until the TTL expires, then
          // propagate with a distinct classification so fallback/governance do
          // not blindly re-resolve and resend.
          const accessClass = classifyProviderAccess(err.status, err.detail);
          if (isAccessControlClass(accessClass)) recordAccessRestricted(resolved.id);
          throw err instanceof ProviderAccessError
            ? err
            : new ProviderAccessError(err.status, err.detail, accessClass);
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
        // Any other access-control refusal (harness restriction, guardrail) that
        // precedes streamed tokens propagates as a classified error rather than
        // being re-resolved, so fallback/governance treat it distinctly.
        if (chunk.type === "error" && !committed) {
          const accessClass = classifyProviderAccess(403, chunk.error);
          if (accessClass !== "unknown") {
            if (isAccessControlClass(accessClass)) recordAccessRestricted(resolved.id);
            throw new ProviderAccessError(403, chunk.error, accessClass);
          }
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
