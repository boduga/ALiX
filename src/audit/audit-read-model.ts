/**
 * audit-read-model.ts — Unified cross-domain audit read model (#713 G2.1).
 *
 * RuntimeIndex and the Inspector Audit tab read only `.alix/audit/audit.jsonl`,
 * so governance events were invisible to operators. This module projects each
 * audit store onto one row shape and merges them newest-first, without
 * touching the write paths or the two integrity chains.
 *
 * Scope: runtime + governance are project-scoped and read by default. The
 * Inspector auth audit is user-scoped (`<stateDir>/auth/audit.jsonl`), so it
 * is opt-in via `includeAuth` and never injected into a project index by
 * default.
 *
 * Bounded: governance/auth are streamed with a capped ring buffer; the
 * runtime store streams internally. Never full-reads a hot path.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { AuditStore } from "./audit-store.js";
import type { AuditRecord } from "./audit-types.js";
import { parseJsonlLine, streamJsonlLines } from "../storage/jsonl-store.js";
import { normalizeGovernanceEventType } from "../governance/audit-types.js";
import type { GovernanceAuditEvent } from "../governance/audit-types.js";
import { getUserStatePaths } from "../security/platform/user-state-paths.js";

export type AuditDomain = "runtime" | "governance" | "auth";

/** One normalized audit row across every audit domain. */
export type UnifiedAuditRow = {
  id: string;
  timestamp: string;
  domain: AuditDomain;
  action: string;
  actor?: string;
  summary?: string;
  details?: Record<string, unknown>;
};

export const GOVERNANCE_AUDIT_FILE = join(".alix", "governance", "governance-audit-events.jsonl");
export const DEFAULT_UNIFIED_AUDIT_LIMIT = 100;
export const MAX_UNIFIED_AUDIT_LIMIT = 5_000;

export function authAuditPath(): string {
  return join(getUserStatePaths().authStateDir, "audit.jsonl");
}

export function projectRuntimeRecord(record: AuditRecord): UnifiedAuditRow {
  return {
    id: record.id,
    timestamp: record.timestamp,
    domain: "runtime",
    action: record.action,
    ...(record.actor !== undefined ? { actor: record.actor } : {}),
    summary: record.action,
    details: record.details as Record<string, unknown>,
  };
}

export function projectGovernanceEvent(event: GovernanceAuditEvent): UnifiedAuditRow {
  const action = normalizeGovernanceEventType(String(event.eventType)) ?? String(event.eventType);
  return {
    id: event.eventId,
    timestamp: event.timestamp,
    domain: "governance",
    action,
    actor: event.actorId,
    summary: `${event.decision}: ${event.reason}`,
    details: {
      decision: event.decision,
      subjectType: event.subjectType,
      subjectId: event.subjectId,
      policyId: event.policyId,
      policyVersion: event.policyVersion,
      ruleId: event.ruleId,
      riskLevel: event.riskLevel,
      requiresHumanReview: event.requiresHumanReview,
      evidenceRefs: event.evidenceRefs,
    },
  };
}

export function projectAuthRecord(record: {
  id: string;
  timestamp: string;
  action: string;
  tokenId: string;
  details?: Record<string, unknown>;
}): UnifiedAuditRow {
  return {
    id: record.id,
    timestamp: record.timestamp,
    domain: "auth",
    action: record.action,
    actor: record.tokenId,
    summary: record.action,
    ...(record.details !== undefined ? { details: record.details } : {}),
  };
}

/** Stream a JSONL file, projecting each parseable record into a capped ring. */
async function streamProjected<T>(
  filePath: string,
  project: (record: T) => UnifiedAuditRow,
  limit: number,
): Promise<UnifiedAuditRow[]> {
  if (!existsSync(filePath)) return [];
  const ring: UnifiedAuditRow[] = [];
  for await (const { line } of streamJsonlLines(filePath)) {
    const parsed = parseJsonlLine<T>(line);
    if (!("record" in parsed)) continue;
    if (ring.length >= limit) ring.shift();
    ring.push(project(parsed.record));
  }
  return ring;
}

async function readRuntime(cwd: string, limit: number): Promise<UnifiedAuditRow[]> {
  const records = await new AuditStore(cwd).list(limit);
  return records.map(projectRuntimeRecord);
}

function readGovernance(cwd: string, limit: number): Promise<UnifiedAuditRow[]> {
  return streamProjected<GovernanceAuditEvent>(
    join(cwd, GOVERNANCE_AUDIT_FILE),
    projectGovernanceEvent,
    limit,
  );
}

/** Project-scoped governance audit rows (newest-first not guaranteed here). */
export function readGovernanceAudit(cwd: string, limit = DEFAULT_UNIFIED_AUDIT_LIMIT): Promise<UnifiedAuditRow[]> {
  return readGovernance(cwd, limit);
}

function readAuth(limit: number): Promise<UnifiedAuditRow[]> {
  return streamProjected(authAuditPath(), projectAuthRecord, limit);
}

export type UnifiedAuditOptions = {
  limit?: number;
  /** Include the user-scoped Inspector auth audit (default false). */
  includeAuth?: boolean;
};

/**
 * Read every audit domain, newest-first. Project-scoped by default
 * (runtime + governance); pass `includeAuth` to add the user auth audit.
 */
export async function readUnifiedAudit(
  cwd: string,
  options: UnifiedAuditOptions = {},
): Promise<UnifiedAuditRow[]> {
  const limit = Math.min(options.limit ?? DEFAULT_UNIFIED_AUDIT_LIMIT, MAX_UNIFIED_AUDIT_LIMIT);
  const [runtime, governance, auth] = await Promise.all([
    readRuntime(cwd, limit),
    readGovernance(cwd, limit),
    options.includeAuth ? readAuth(limit) : Promise.resolve([] as UnifiedAuditRow[]),
  ]);
  return [...runtime, ...governance, ...auth]
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
    .slice(0, limit);
}
