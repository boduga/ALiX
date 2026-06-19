/**
 * P5.2b.1 — Windowed metrics snapshot.
 *
 * Extracts ReflectionMetrics computation so it can be recomputed over an
 * arbitrary [after, before] window — the foundation for P5.2b before/after
 * effectiveness measurement. No window ⇒ identical to the original all-time
 * computation (behavior-preserving refactor of ReflectionAgent.computeMetrics).
 *
 * Windowing semantics are delegated to {@link EvidenceStore.query}, which uses
 * `timestamp > after` (exclusive) and `timestamp < before` (exclusive) — see
 * `EvidenceStore.matches()`.
 *
 * @module
 */

import type { EvidenceStore } from "../security/evidence/evidence-store.js";
import type { EvidenceQuery } from "../security/evidence/evidence-types.js";
import type { ReflectionMetrics } from "./reflection-types.js";

/**
 * Optional time window for {@link computeMetricsSnapshot}.
 *
 * Both bounds are ISO 8601 strings. A record is counted only if its timestamp
 * is strictly greater than `after` and strictly less than `before`.
 */
export interface MetricsWindow {
  /** ISO 8601 — only records with `timestamp > after` are counted. */
  after?: string;
  /** ISO 8601 — only records with `timestamp < before` are counted. */
  before?: string;
}

/**
 * Upper bound on the number of records loaded for payload inspection
 * (capability routing and review queries). Matches the original constant used
 * in ReflectionAgent.computeMetrics.
 */
const PAYLOAD_LIMIT = 5000;

/**
 * Compute {@link ReflectionMetrics} from an {@link EvidenceStore}, optionally
 * restricted to a time window.
 *
 * The queries are targeted by type so we avoid a full scan:
 * - `merge_completed`     → workflowsCompleted
 * - `workflow_blocked`    → workflowsBlocked
 * - `workflow_aborted`    → workflowsAborted
 * - `capability_routed`   → capabilitiesRequested, unresolvedCapabilities
 * - `review_completed`    → reviewApprovalRate
 *
 * When `window` is omitted the result is byte-for-byte identical to the
 * previous all-time computation performed by ReflectionAgent.computeMetrics.
 *
 * @param store  - EvidenceStore to query.
 * @param window - Optional { after, before } bounds (exclusive on both ends).
 * @returns A populated {@link ReflectionMetrics} object.
 */
export async function computeMetricsSnapshot(
  store: EvidenceStore,
  window?: MetricsWindow,
): Promise<ReflectionMetrics> {
  const base: EvidenceQuery = {};
  if (window?.after) base.after = window.after;
  if (window?.before) base.before = window.before;

  // Workflow counts — only need totals, so limit=1 is sufficient.
  const completed = await store.query({ type: "merge_completed", limit: 1, ...base });
  const blocked = await store.query({ type: "workflow_blocked", limit: 1, ...base });
  const aborted = await store.query({ type: "workflow_aborted", limit: 1, ...base });

  // Capability and review queries need the full record set to inspect payloads.
  const routed = await store.query({ type: "capability_routed", limit: PAYLOAD_LIMIT, ...base });
  const reviews = await store.query({ type: "review_completed", limit: PAYLOAD_LIMIT, ...base });

  const unresolvedRouted = routed.records.filter(
    (r) => (r.payload.candidates as number) === 0,
  );
  const approvedReviews = reviews.records.filter(
    (r) => r.payload.verdict === "approve",
  ).length;

  return {
    workflowsCompleted: completed.total,
    workflowsBlocked: blocked.total,
    workflowsAborted: aborted.total,
    capabilitiesRequested: routed.total,
    unresolvedCapabilities: unresolvedRouted.length,
    reviewApprovalRate: reviews.total > 0 ? approvedReviews / reviews.total : 1,
  };
}
