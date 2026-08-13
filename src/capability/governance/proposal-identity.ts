// src/capability/governance/proposal-identity.ts
import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { CapabilityEvolutionCandidate } from "../../adaptation/capability-evolution-types.js";

/** Domain prefix isolates proposal ids from other canonical hashes
 *  (e.g. CAP-6 artifactId uses `alix-capability-mutation-v1:`). */
const DOMAIN_PREFIX = "alix-capability-proposal-v1:";

/**
 * Compute a deterministic SHA-256 hex proposal id from a candidate body.
 *
 * Same proposal body → same id (idempotency ruling #21). Different key
 * ordering in the input object produces the same id (canonical-JSON normalizes
 * key order). Pure function — no I/O, no clock.
 */
export function computeProposalId(candidate: CapabilityEvolutionCandidate): string {
  const canonical = canonicalStringify(candidate);
  return createHash("sha256").update(DOMAIN_PREFIX).update(canonical).digest("hex");
}

/** Runtime guard: 64 lowercase hex chars. */
export function isValidProposalId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
