// src/providers/access-restriction-registry.ts
//
// Bounded-lifetime registry of OpenRouter models refused by access-control
// (e.g. a `:free` model restricted to recognized agentic harnesses, or a model
// blocked by a content-filter guardrail). Unlike an account rejection (a
// backing provider not opted into — self-healing, per-request) or a circuit
// breaker (transient 429/5xx), an access-control refusal is a stable policy
// statement for that model/endpoint: it must be excluded from candidate
// selection across requests — but only for a BOUNDED lifetime, because
// OpenRouter's policy and catalog change over time (an account setting flips,
// a model becomes open, a harness is registered). After the TTL expires the
// model is revalidated: recorded again only if it is refused again.

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

let ttlMs = DEFAULT_TTL_MS;
const restricted = new Map<string, { until: number }>();

/**
 * Record that `modelId` was refused by an access-control 403, effective from
 * `now` until `now + TTL`. Re-asserting (a subsequent refusal before expiry)
 * simply refreshes the deadline.
 */
export function recordAccessRestricted(
  modelId: string,
  now: number = Date.now(),
): void {
  restricted.set(modelId, { until: now + ttlMs });
}

/**
 * Ids currently within their restriction window. Expired entries are pruned in
 * place (a model is implicitly revalidated once its deadline passes and it is
 * no longer reported as restricted).
 */
export function accessRestrictedModelIds(now: number = Date.now()): Set<string> {
  const ids = new Set<string>();
  for (const [id, { until }] of restricted) {
    if (until > now) {
      ids.add(id);
    } else {
      restricted.delete(id);
    }
  }
  return ids;
}

/** Clear all recorded restrictions (used on reset/teardown). */
export function clearAccessRestrictions(): void {
  restricted.clear();
}

// Test hooks — mirror the catalog cache seam (_resetCatalogCacheForTesting).
/** Test seam: reset all recorded restrictions. */
export function _resetAccessRestrictionRegistryForTesting(): void {
  restricted.clear();
  ttlMs = DEFAULT_TTL_MS;
}

/** Test seam: shrink the TTL so expiry can be exercised without waiting. */
export function _setAccessRestrictionTtlForTesting(ms: number): void {
  ttlMs = ms;
}
