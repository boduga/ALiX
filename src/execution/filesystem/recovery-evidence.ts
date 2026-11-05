/**
 * GE-04 recovery and receipt provenance — OFFLINE, DENY-ONLY evidence examiner.
 *
 * A self-hashed transcript is not independently authenticated. A coordinator
 * can rewrite the entire hash chain, fabricate a receipt, or roll back its
 * claimed anchor. No trusted effect/custodian authority exists in this module.
 * Do not treat a structurally consistent journal as permission to replay or
 * as proof that the kernel performed an operation.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const GE04_RECOVERY_PROTOCOL = "ALIX_GE04_RECOVERY_V1";
export const GE04_RECOVERY_DENIAL = "GE04_RECOVERY_NOT_QUALIFIED";
export const GENESIS_HASH = "0".repeat(64);
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MAX_EVENTS = 4096;

export type RecoveryPhase = "prepared" | "effect_entered" | "receipt_reported";
export type ClaimedOutcome = "success" | "failed" | "unknown" | null;

export type RecoveryEvent = Readonly<{
  protocol: typeof GE04_RECOVERY_PROTOCOL;
  sequence: number;
  previousHash: string;
  attemptId: string;
  workerId: string;
  policyRevision: string;
  approvalId: string;
  leaseId: string;
  requestSha256: string;
  releaseSha256: string;
  phase: RecoveryPhase;
  claimedOutcome: ClaimedOutcome;
  claimedEffectSha256: string | null;
  hash: string;
}>;

export type EvidencePayload = Omit<RecoveryEvent, "hash">;

export type EvidenceCheckpoint = Readonly<{
  count: number;
  headHash: string;
}>;

export type RecoveryDecision = Readonly<{
  disposition: "DENY";
  code: typeof GE04_RECOVERY_DENIAL;
  status: "QUARANTINED" | "UNVERIFIED";
  syntacticallyConsistent: boolean;
  reasons: readonly string[];
  observedAttempts: readonly string[];
  // No replay token, receipt, success statement or mutation capability.
}>;

const FIELDS = [
  "protocol", "sequence", "previousHash", "attemptId", "workerId",
  "policyRevision", "approvalId", "leaseId", "requestSha256",
  "releaseSha256", "phase", "claimedOutcome", "claimedEffectSha256",
] as const;

function objectWithKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function sameHash(left: string, right: string): boolean {
  return HASH.test(left) && HASH.test(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function canonicalBytes(payload: EvidencePayload): Buffer {
  return Buffer.from(JSON.stringify({
    protocol: payload.protocol,
    sequence: payload.sequence,
    previousHash: payload.previousHash,
    attemptId: payload.attemptId,
    workerId: payload.workerId,
    policyRevision: payload.policyRevision,
    approvalId: payload.approvalId,
    leaseId: payload.leaseId,
    requestSha256: payload.requestSha256,
    releaseSha256: payload.releaseSha256,
    phase: payload.phase,
    claimedOutcome: payload.claimedOutcome,
    claimedEffectSha256: payload.claimedEffectSha256,
  }) + "\n", "utf8");
}

function digest(payload: EvidencePayload): string {
  return createHash("sha256").update(canonicalBytes(payload)).digest("hex");
}

function validPayload(value: unknown): value is EvidencePayload {
  if (!objectWithKeys(value, FIELDS)) return false;
  if (value.protocol !== GE04_RECOVERY_PROTOCOL) return false;
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return false;
  if (typeof value.previousHash !== "string" || !HASH.test(value.previousHash)) return false;
  for (const key of ["attemptId", "workerId", "policyRevision", "approvalId", "leaseId"]) {
    if (typeof value[key] !== "string" || !ID.test(value[key])) return false;
  }
  if (typeof value.requestSha256 !== "string" || !HASH.test(value.requestSha256)) return false;
  if (typeof value.releaseSha256 !== "string" || !HASH.test(value.releaseSha256)) return false;
  if (!["prepared", "effect_entered", "receipt_reported"].includes(String(value.phase))) return false;
  if (value.phase === "receipt_reported") {
    if (!["success", "failed", "unknown"].includes(String(value.claimedOutcome))) return false;
    if (typeof value.claimedEffectSha256 !== "string" || !HASH.test(value.claimedEffectSha256)) return false;
  } else if (value.claimedOutcome !== null || value.claimedEffectSha256 !== null) return false;
  return true;
}

/**
 * Deterministic journal fixture generator; no disk write, signing or privilege.
 * A hash produced here is NOT a receipt or independent authentication.
 */
export function fixtureAppend(
  previous: readonly RecoveryEvent[],
  event: Omit<EvidencePayload, "protocol" | "sequence" | "previousHash">,
): RecoveryEvent {
  if (previous.length >= MAX_EVENTS) throw new Error("GE-04 fixture journal size exceeded");
  const payload = {
    ...event, protocol: GE04_RECOVERY_PROTOCOL,
    sequence: previous.length + 1,
    previousHash: previous.length ? previous[previous.length - 1]!.hash : GENESIS_HASH,
  } as EvidencePayload;
  if (!validPayload(payload)) throw new Error("Invalid GE-04 fixture recovery event");
  return Object.freeze({ ...payload, hash: digest(payload) });
}

/**
 * Read-only recovery examination. Every observed attempt is quarantined
 * against *automatic* replay. Even a complete self-hashed receipt is untrusted.
 *
 * expectedAnchor is an external-value comparison only: this JS function
 * cannot prove that the supplied checkpoint was kept by an independent,
 * append-only, rollback-resistant custodian.
 */
export function examineRecovery(
  journal: unknown,
  expectedAnchor: unknown,
  replayAttemptId: unknown,
): RecoveryDecision {
  const reasons: string[] = [];
  const attempts = new Set<string>();
  if (!Array.isArray(journal) || journal.length > MAX_EVENTS) {
    return Object.freeze({
      disposition: "DENY", code: GE04_RECOVERY_DENIAL,
      status: "UNVERIFIED", syntacticallyConsistent: false,
      reasons: Object.freeze(["invalid_journal"]), observedAttempts: Object.freeze([]),
    });
  }
  let head = GENESIS_HASH;
  const stages = new Map<string, { phase: RecoveryPhase; identity: string }>();
  for (const [index, entry] of journal.entries()) {
    if (!objectWithKeys(entry, [...FIELDS, "hash"])) {
      reasons.push("event_schema");
      break;
    }
    const { hash, ...payload } = entry;
    if (!validPayload(payload) || typeof hash !== "string" || !HASH.test(hash)) {
      reasons.push("event_payload");
      break;
    }
    attempts.add(payload.attemptId);
    if (payload.sequence !== index + 1 || !sameHash(payload.previousHash, head) ||
        !sameHash(hash, digest(payload))) {
      reasons.push("journal_chain");
      break;
    }
    const identity = [
      payload.workerId, payload.policyRevision, payload.approvalId,
      payload.leaseId, payload.requestSha256, payload.releaseSha256,
    ].join("|");
    const prior = stages.get(payload.attemptId);
    if (!prior) {
      if (payload.phase !== "prepared") reasons.push("missing_preparation");
    } else if (identity !== prior.identity || (prior.phase === "prepared" && payload.phase !== "effect_entered") ||
      (prior.phase === "effect_entered" && payload.phase !== "receipt_reported") ||
      prior.phase === "receipt_reported") {
      reasons.push("phase_or_identity_rewrite");
    }
    if (reasons.length) break;
    stages.set(payload.attemptId, { phase: payload.phase, identity });
    head = hash;
  }
  if (!objectWithKeys(expectedAnchor, ["count", "headHash"]) ||
      !Number.isSafeInteger(expectedAnchor.count) ||
      expectedAnchor.count !== journal.length ||
      typeof expectedAnchor.headHash !== "string" ||
      !sameHash(expectedAnchor.headHash, head)) reasons.push("checkpoint_mismatch_or_missing");
  if (typeof replayAttemptId !== "string" || !ID.test(replayAttemptId)) reasons.push("invalid_attempt_id");
  const present = typeof replayAttemptId === "string" && attempts.has(replayAttemptId);
  if (present) reasons.push("attempt_replay_quarantined");
  if (journal.length === 0) reasons.push("empty_journal_no_provenance");
  // A self-authored receipt can never establish a kernel effect. Even an
  // independently stored anchor would attest transcript continuity only.
  reasons.push("independent_effect_provenance_not_demonstrated");
  return Object.freeze({
    disposition: "DENY" as const,
    code: GE04_RECOVERY_DENIAL,
    status: present ? "QUARANTINED" as const : "UNVERIFIED" as const,
    syntacticallyConsistent: reasons.every(reason =>
      !["invalid_journal", "event_schema", "event_payload", "journal_chain",
        "missing_preparation", "phase_or_identity_rewrite",
        "checkpoint_mismatch_or_missing"].includes(reason)),
    reasons: Object.freeze(reasons),
    observedAttempts: Object.freeze([...attempts].sort()),
  });
}

export function fixtureCheckpoint(events: readonly RecoveryEvent[]): EvidenceCheckpoint {
  return Object.freeze({ count: events.length, headHash: events.at(-1)?.hash ?? GENESIS_HASH });
}
