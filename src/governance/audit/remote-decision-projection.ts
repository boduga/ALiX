/**
 * SRAP-1 — audit-owned idempotent projection of remote approval decisions.
 *
 * The authoritative decision evidence lives in the approvals ledger's
 * `approval.updated` event (ADR-0015). This module projects each committed
 * remote decision ONCE into the audit chain, keyed idempotently by
 * `decisionId`. The projection is one-way (ledger → audit), at-least-once with
 * a `decisionId` dedup key (effectively exactly-once), and adds no authority:
 * it can never authorize, reverse, or weaken an approval.
 *
 * Crash consistency (src/governance/audit/AGENTS.md):
 * - the dedup index and the projection cursor (last projected `ledger_seq`) are
 *   ADVISORY; the authoritative source is the verified JSONL chain;
 * - the cursor MUST NOT advance past evidence provably present in the verified
 *   chain. Before trusting the cursor we verify the chain; on any structural
 *   finding we refuse (fail closed) rather than project from an unverified log;
 * - a missing/duplicate `decisionId` is re-derived by verifying the chain plus a
 *   bounded scan, never trusted from the cursor alone;
 * - an `approval.updated` that PRESENTS an evidence field failing validation is
 *   a projection failure: it is counted and holds the cursor, never silently
 *   skipped (a silent skip would durably acknowledge evidence never projected).
 *
 * The generic `runtime_outbox.delivered_at` is NOT projection state and is
 * never marked here.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { AuditStore } from "./audit-store.js";
import { verifyAuditLog } from "../security/audit/audit-verifier.js";
import { getSharedLedger } from "../../runtime-state/storage/runtime-ledger.js";
import { readJsonFileSync, writeJsonFileAtomicSync } from "../../runtime-state/storage/jsonl-store.js";
import type { RuntimeEvent } from "../../runtime-state/contracts/runtime-event.js";
import type { RemoteDecisionEvidence } from "../approvals/approval-types.js";

/** Entity type the remote evidence rides on. */
const APPROVAL_ENTITY_TYPE = "approval";

/** Bounded re-scan overlap so a crash-just-before-checkpoint is absorbed. */
const RESCAN_OVERLAP_WINDOW = 100;

/**
 * Cap on retained decisionIds in the advisory dedup index. The authoritative
 * dedup source is the verified audit chain (seeded below); this bound only keeps
 * the advisory file small. Loss of old ids here is safe: the chain re-supplies
 * them.
 */
const MAX_RETAINED_DECISION_IDS = 5_000;

/** Projection state file (advisory) beside the audit log. */
const PROJECTION_STATE_FILENAME = "projection-state.json";

/** Counters surfaced for observability (snake_case, matching the contract). */
export interface ProjectionCounters {
  projected: number;
  skipped_duplicate: number;
  projection_failed: number;
  /** ledger high-water `ledger_seq` − cursor. */
  lag: number;
}

/** Advisory projection state. */
interface ProjectionState {
  /** Last fully-projected ledger_seq. */
  cursor: number;
  /** decisionIds already projected (bounded by retention). */
  decisionIds: string[];
}

export interface ProjectionResult {
  ok: boolean;
  counters: ProjectionCounters;
  /** Set when the projection refused (fail-closed) — e.g. chain not verifiable. */
  refused?: string;
}

// ---------------------------------------------------------------------------
// Advisory state persistence
// ---------------------------------------------------------------------------

function statePath(auditDir: string): string {
  return join(auditDir, PROJECTION_STATE_FILENAME);
}

function readState(auditDir: string): ProjectionState {
  const parsed = readJsonFileSync<ProjectionState>(statePath(auditDir));
  if (parsed === null) return { cursor: 0, decisionIds: [] };
  return {
    cursor: typeof parsed.cursor === "number" ? parsed.cursor : 0,
    decisionIds: Array.isArray(parsed.decisionIds) ? parsed.decisionIds : [],
  };
}

function writeState(auditDir: string, state: ProjectionState): void {
  writeJsonFileAtomicSync(statePath(auditDir), state);
}

// ---------------------------------------------------------------------------
// Evidence extraction
// ---------------------------------------------------------------------------

/** Pull bounded remote evidence out of an `approval.updated` ledger event. */
type EvidenceExtraction =
  | { kind: "none" }
  | { kind: "malformed" }
  | { kind: "ok"; evidence: RemoteDecisionEvidence };

/**
 * Extract bounded remote evidence from a committed approval ledger event.
 *
 * Only `approval.updated` carries evidence (ADR-0015); `approval.created`,
 * `approval.removed`, and non-approval events are `none`. An `approval.updated`
 * that PRESENTS an evidence field which then fails validation is `malformed`:
 * the caller must not silently skip it, or the durable cursor would advance
 * past evidence that was never projected.
 */
function evidenceFromEvent(event: RuntimeEvent): EvidenceExtraction {
  if (event.entityType !== APPROVAL_ENTITY_TYPE) return { kind: "none" };
  if (event.eventType !== "approval.updated") return { kind: "none" };
  const payload = event.payload as { approval?: { remoteDecisionEvidence?: unknown } } | null;
  const raw = payload?.approval?.remoteDecisionEvidence;
  if (raw === undefined || raw === null) return { kind: "none" };
  if (typeof raw !== "object") return { kind: "malformed" };
  const e = raw as Record<string, unknown>;
  if (
    typeof e.decisionId !== "string" ||
    typeof e.principalId !== "string" ||
    typeof e.credentialRef !== "string" ||
    (e.decision !== "approved" && e.decision !== "denied") ||
    typeof e.nonce !== "string" ||
    typeof e.decidedAt !== "string" ||
    (e.transport !== "direct-tls" && e.transport !== "proxy-tls")
  ) {
    return { kind: "malformed" };
  }
  // `credentialRef` is stored verbatim in the audit chain (the chain redactor
  // allowlists it as non-secret). Enforce the documented shape here so a
  // non-conforming value (e.g. a raw secret wrongly placed under this key)
  // fails closed as `malformed` rather than being written verbatim.
  if (!/^hmac-sha256:v\d+:[A-Za-z0-9_-]+$/.test(e.credentialRef)) {
    return { kind: "malformed" };
  }
  return {
    kind: "ok",
    evidence: {
      decisionId: e.decisionId,
      principalId: e.principalId,
      credentialRef: e.credentialRef,
      decision: e.decision,
      nonce: e.nonce,
      decidedAt: e.decidedAt,
      transport: e.transport,
    },
  };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Project committed remote-decision evidence into the audit chain.
 *
 * Idempotent by `decisionId`. Refuses (fail-closed) when the audit chain is not
 * verifiable, so the cursor never advances past unverified evidence.
 */
export async function projectRemoteDecisions(cwd: string): Promise<ProjectionResult> {
  const auditDir = join(cwd, ".alix", "audit");
  const counters: ProjectionCounters = { projected: 0, skipped_duplicate: 0, projection_failed: 0, lag: 0 };

  // 1. Fail closed unless the audit chain verifies. The cursor must never pass
  //    unverified evidence.
  const auditStore = new AuditStore(cwd);
  // Fail closed unless the chain verifies. If the chain was never activated
  // (no head sidecar) the log carries no tamper-evidence at all, so we refuse
  // rather than project into an unverified log.
  if (!existsSync(join(auditDir, "head.json"))) {
    return { ok: false, counters, refused: "audit chain not activated (no head sidecar); refusing to project" };
  }
  const verified = await verifyAuditLog({ auditDir });
  // `head_mismatch` here means the sidecar and the persisted tip disagree — a
  // stale/conflicting head, i.e. exactly the recovery window. That is not safe
  // to project past, so it refuses like any other structural finding.
  if (verified.findings.length > 0) {
    return { ok: false, counters, refused: `audit chain not verifiable: ${verified.findings.map((f) => f.type).join(", ")}` };
  }

  // 2. Read advisory state and the ledger events since (cursor − overlap).
  const state = readState(auditDir);
  const since = Math.max(0, state.cursor - RESCAN_OVERLAP_WINDOW);
  const events = getSharedLedger(cwd).readEvents({ sinceSeq: since });
  const highWater = events.length > 0 ? events[events.length - 1].ledgerSeq : state.cursor;
  counters.lag = Math.max(0, highWater - state.cursor);

  const known = new Set(state.decisionIds);

  // Chain-anchored dedup: the advisory state is not trusted alone. Seed the
  // known-decision set from the audit chain itself, so a lost/corrupt
  // checkpoint cannot cause a duplicate append.
  const existing = await auditStore.list(10_000);
  for (const rec of existing) {
    const did = rec.details?.remoteDecision?.decisionId;
    if (typeof did === "string") known.add(did);
  }

  let cursor = state.cursor;

  for (const event of events) {
    const extracted = evidenceFromEvent(event);
    if (extracted.kind === "malformed") {
      // An `approval.updated` that presents evidence but fails validation must
      // NOT be silently acknowledged. Count it and stop before the cursor moves
      // past it, so a later run re-attempts (the evidence is not durably
      // dropped by an advanced cursor).
      counters.projection_failed += 1;
      break;
    }
    if (extracted.kind === "ok") {
      const evidence = extracted.evidence;
      if (known.has(evidence.decisionId)) {
        counters.skipped_duplicate += 1;
      } else {
        try {
          await auditStore.append({
            action: evidence.decision === "approved" ? "approval.approved" : "approval.denied",
            actor: evidence.principalId,
            details: {
              approvalId: event.entityId,
              // Bounded evidence only — no raw token/cookie/credential id.
              remoteDecision: {
                decisionId: evidence.decisionId,
                principalId: evidence.principalId,
                credentialRef: evidence.credentialRef,
                transport: evidence.transport,
                decidedAt: evidence.decidedAt,
              },
              source: "srap-remote-projection",
            },
          });
          known.add(evidence.decisionId);
          counters.projected += 1;
        } catch {
          counters.projection_failed += 1;
          // Do NOT advance the cursor past a failed projection; retry next run.
          break;
        }
      }
    }
    // Monotonic: advance only forward, only to events fully considered.
    if (event.ledgerSeq > cursor) cursor = event.ledgerSeq;
  }

  // 3. Persist advisory state atomically (cursor + bounded dedup index).
  const retained = [...known].slice(-MAX_RETAINED_DECISION_IDS);
  writeState(auditDir, { cursor, decisionIds: retained });
  return { ok: counters.projection_failed === 0, counters };
}
