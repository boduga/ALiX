/**
 * GE-04 final-effect authorization contract — INERT and non-authorizing.
 *
 * This module is not wired to the production scoped-mutation factory.
 * A JavaScript process cannot establish independently administered approval,
 * lease, release and kernel-effect authority. The only decision returned by
 * this API is DENY. Even matching fixture evidence never produces a permit.
 *
 * Future native final-effect authorization needs an independently administered
 * process and syscall-adjacent, one-time revalidation; this module does not
 * implement those properties or authorize filesystem I/O.
 */
import { createHash, timingSafeEqual } from "node:crypto";

const HASH = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const SAFE = Number.isSafeInteger;

export const FINAL_EFFECT_DENIED = "GE04_FINAL_EFFECT_UNQUALIFIED" as const;
export const FINAL_EFFECT_PROTOCOL = "ALIX_GE04_FINAL_EFFECT_V1" as const;

export type ClaimedMutation = Readonly<{
  protocol: typeof FINAL_EFFECT_PROTOCOL;
  attemptId: string;
  workerId: string;
  policyRevision: string;
  approvalId: string;
  leaseId: string;
  requestSha256: string;
  releaseSha256: string;
  expiresAtMs: number;
}>;

export type StoreObservation = Readonly<{
  // *Untrusted* fixture evidence. Not a substitute for protected store reads.
  attemptId: string;
  workerId: string;
  policyRevision: string;
  approvalId: string;
  approvalStatus: "approved" | "pending" | "denied" | "consumed" | "revoked";
  approvalConsumed: boolean;
  leaseId: string;
  leaseStatus: "active" | "revoked" | "expired" | "released";
  requestSha256: string;
  releaseSha256: string;
  expiresAtMs: number;
  policyAllows: boolean;
}>;

export type FinalEffectAssessment = Readonly<{
  disposition: "DENY";
  code: typeof FINAL_EFFECT_DENIED;
  checksMatched: boolean;
  reasons: readonly string[];
  // Never include a capability token, permit, unlock or apply function.
}>;

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validId(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function equalSha256(a: unknown, b: unknown): boolean {
  if (!validHash(a) || !validHash(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

const claimedKeys = [
  "protocol", "attemptId", "workerId", "policyRevision", "approvalId",
  "leaseId", "requestSha256", "releaseSha256", "expiresAtMs",
] as const;
const observedKeys = [
  "attemptId", "workerId", "policyRevision", "approvalId", "approvalStatus",
  "approvalConsumed", "leaseId", "leaseStatus", "requestSha256",
  "releaseSha256", "expiresAtMs", "policyAllows",
] as const;

/**
 * Test-only canonical request framing. The caller supplies raw exact payload
 * bytes: never hash a parsed/re-serialized object and mistake it for the bytes
 * the kernel will ultimately apply. A native supervisor must establish its own
 * provenance of these bytes and bind them to the final syscall.
 */
export function requestDigest(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("GE-04 request digest requires exact binary bytes");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Compare fixture store observations with the claimed request.
 * Even when every check matches, the result remains DENY: the observation
 * is caller-originated and the verified effect boundary does not exist.
 *
 * Clock is injected only to test expiry failure deterministically. A future
 * implementation must use a trusted supervisor clock at final effect time.
 */
export function assessFinalEffect(
  claim: unknown,
  observation: unknown,
  exactRequestBytes: unknown,
  nowMs: unknown,
): FinalEffectAssessment {
  const reasons: string[] = [];
  if (!hasExactKeys(claim, claimedKeys)) reasons.push("claim_schema");
  if (!hasExactKeys(observation, observedKeys)) reasons.push("observation_schema");
  if (!(exactRequestBytes instanceof Uint8Array) || exactRequestBytes.byteLength > 1024 * 1024) {
    reasons.push("request_bytes");
  }
  if (!SAFE(nowMs) || (nowMs as number) < 0) reasons.push("time_invalid");

  if (reasons.length === 0) {
    const c = claim as unknown as ClaimedMutation;
    const o = observation as unknown as StoreObservation;
    if (c.protocol !== FINAL_EFFECT_PROTOCOL) reasons.push("protocol");
    for (const key of ["attemptId", "workerId", "policyRevision", "approvalId", "leaseId"] as const) {
      if (!validId(c[key]) || !validId(o[key]) || c[key] !== o[key]) reasons.push(key);
    }
    if (!validHash(c.requestSha256) || !validHash(o.requestSha256) ||
        !equalSha256(c.requestSha256, o.requestSha256) ||
        !equalSha256(c.requestSha256, requestDigest(exactRequestBytes as Uint8Array))) {
      reasons.push("request_digest");
    }
    if (!validHash(c.releaseSha256) || !validHash(o.releaseSha256) ||
        !equalSha256(c.releaseSha256, o.releaseSha256)) reasons.push("release_digest");
    if (!SAFE(c.expiresAtMs) || !SAFE(o.expiresAtMs) ||
        c.expiresAtMs <= (nowMs as number) || o.expiresAtMs <= (nowMs as number) ||
        c.expiresAtMs !== o.expiresAtMs) reasons.push("expired_or_mismatched");
    if (o.approvalStatus !== "approved" || o.approvalConsumed !== false) reasons.push("approval_state");
    if (o.leaseStatus !== "active") reasons.push("lease_state");
    if (o.policyAllows !== true) reasons.push("policy_denied");
  }

  // This module never returns ALLOW or authorizes a mutation, regardless of
  // matched evidence, claimed urgency, platform, or policy/approval state.
  return Object.freeze({
    disposition: "DENY" as const,
    code: FINAL_EFFECT_DENIED,
    checksMatched: reasons.length === 0,
    reasons: Object.freeze(reasons),
  });
}
