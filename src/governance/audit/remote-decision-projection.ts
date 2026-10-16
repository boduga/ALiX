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
 *   bounded scan, never trusted from the cursor alone.
 *
 * The generic `runtime_outbox.delivered_at` is NOT projection state and is
 * never marked here.
 *
 * @module
 */

import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { AuditStore } from "./audit-store.js";
import { verifyAuditLog } from "../security/audit/audit-verifier.js";
import { getSharedLedger } from "../../runtime-state/storage/runtime-ledger.js";
import type { RuntimeEvent } from "../../runtime-state/contracts/runtime-event.js";
import type { RemoteDecisionEvidence } from "../approvals/approval-types.js";

/** Entity type the remote evidence rides on. */
const APPROVAL_ENTITY_TYPE = "approval";

/** Bounded re-scan overlap so a crash-just-before-checkpoint is absorbed. */
const RESCAN_OVERLAP_WINDOW = 100;

/** Projection state file (advisory) beside the audit log. */
const PROJECTION_STATE_FILENAME = "projection-state.json";

/** Counters surfaced for observability. */
export interface ProjectionCounters {
  projected: number;
  skippedDuplicate: number;
  projectionFailed: number;
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
  const p = statePath(auditDir);
  if (!existsSync(p)) return { cursor: 0, decisionIds: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8")) as ProjectionState;
    return {
      cursor: typeof parsed.cursor === "number" ? parsed.cursor : 0,
      decisionIds: Array.isArray(parsed.decisionIds) ? parsed.decisionIds : [],
    };
  } catch {
    return { cursor: 0, decisionIds: [] };
  }
}

function writeState(auditDir: string, state: ProjectionState): void {
  mkdirSync(dirname(statePath(auditDir)), { recursive: true });
  const tmp = `${statePath(auditDir)}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), { encoding: "utf-8", flag: "wx" });
  renameSync(tmp, statePath(auditDir));
}

// ---------------------------------------------------------------------------
// Evidence extraction
// ---------------------------------------------------------------------------

/** Pull bounded remote evidence out of an `approval.updated` ledger event. */
function evidenceFromEvent(event: RuntimeEvent): RemoteDecisionEvidence | null {
  if (event.entityType !== APPROVAL_ENTITY_TYPE) return null;
  if (event.eventType !== "approval.updated" && event.eventType !== "approval.created") return null;
  const payload = event.payload as { approval?: { remoteDecisionEvidence?: unknown } } | null;
  const raw = payload?.approval?.remoteDecisionEvidence;
  if (!raw || typeof raw !== "object") return null;
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
    return null;
  }
  return {
    decisionId: e.decisionId,
    principalId: e.principalId,
    credentialRef: e.credentialRef,
    decision: e.decision,
    nonce: e.nonce,
    decidedAt: e.decidedAt,
    transport: e.transport,
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
  const counters: ProjectionCounters = { projected: 0, skippedDuplicate: 0, projectionFailed: 0, lag: 0 };

  // 1. Fail closed unless the audit chain verifies. The cursor must never pass
  //    unverified evidence.
  const auditStore = new AuditStore(cwd);
  const active = existsSync(join(auditDir, "head.json"));
  if (active) {
    const verified = await verifyAuditLog({ auditDir });
    const structural = verified.findings.filter((f) => f.type !== "head_mismatch");
    if (structural.length > 0) {
      return { ok: false, counters, refused: `audit chain not verifiable: ${structural.map((f) => f.type).join(", ")}` };
    }
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
    const did = rec.details?.decisionId;
    if (typeof did === "string") known.add(did);
  }

  let cursor = state.cursor;

  for (const event of events) {
    const evidence = evidenceFromEvent(event);
    if (evidence !== null) {
      if (known.has(evidence.decisionId)) {
        counters.skippedDuplicate += 1;
      } else {
        try {
          await auditStore.append({
            action: evidence.decision === "approved" ? "approval.approved" : "approval.denied",
            actor: evidence.principalId,
            details: {
              approvalId: event.entityId,
              // Bounded evidence only — no raw token/cookie/credential id.
              decisionId: evidence.decisionId,
              principalId: evidence.principalId,
              credentialRef: evidence.credentialRef,
              transport: evidence.transport,
              decidedAt: evidence.decidedAt,
              source: "srap-remote-projection",
            },
          });
          known.add(evidence.decisionId);
          counters.projected += 1;
        } catch {
          counters.projectionFailed += 1;
          // Do NOT advance the cursor past a failed projection; retry next run.
          break;
        }
      }
    }
    // Advance the cursor only to events we have fully considered.
    cursor = event.ledgerSeq;
  }

  // 3. Persist advisory state atomically (cursor + dedup index).
  writeState(auditDir, { cursor, decisionIds: [...known] });
  return { ok: counters.projectionFailed === 0, counters };
}
