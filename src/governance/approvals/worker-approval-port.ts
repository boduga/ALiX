/**
 * worker-approval-port.ts — a RESTRICTED view of the authoritative approval
 * ledger for isolated coordination worker processes.
 *
 * A subagent worker runs as its own OS process, so it cannot receive the
 * parent's in-memory `ApprovalStore`. It needs the durable ledger to request
 * and observe tool-level approvals — but handing a child a full `ApprovalStore`
 * would let it call `resolve(...)` and APPROVE ITS OWN REQUEST, which is
 * authority escalation (a compromised worker could grant itself any
 * capability).
 *
 * This port exposes exactly the operations a worker legitimately needs and
 * nothing else:
 *
 *   allowed   read a record by id / binding key / pending capability
 *             create-or-reuse a pending request bound to this worker
 *             atomically consume an APPROVED record it is authorized to use
 *             report its own execution outcome
 *
 *   forbidden approve / deny / revoke / invalidate / group resolution /
 *             mutating another worker's record
 *
 * Consumption is NOT reimplemented here: `consumeApproved` runs inside the
 * store's cross-process lock and re-validates status, expiry, binding key and
 * invocation under that lock, so two processes cannot both consume one
 * single-use approval. The port is a narrowing layer, never a second authority:
 * it always delegates to a store instance opened on the SAME workspace.
 *
 * Decisions stay operator-controlled: `resolve`, `resolveWithEvidence`,
 * `resolveGroup`, `revoke` and `invalidate` are not reachable, so no method on
 * this port can move a request to `approved`. A worker CAN report the outcome of
 * an execution it performed, but only for a record it owns — see
 * `recordExecutionOutcome` below.
 */

import type { ApprovalStore } from "../../governance/approvals/approval-store.js";
import type { ApprovalRecord } from "../../governance/approvals/approval-types.js";
/** The operations a worker process may perform against the ledger. */
export interface WorkerApprovalPort {
  /** Current durable record, or undefined when it does not exist. */
  get(id: string): ApprovalRecord | undefined;
  /** Authoritative re-read from the ledger (cross-process visibility). */
  loadFresh(id: string): Promise<ApprovalRecord | undefined>;
  /** Look up by the exact binding key an approval was created with. */
  findExact(bindingKey: string): ApprovalRecord | undefined;
  /** A pending approval for this binding key, if one exists. */
  findPendingByBindingKey(bindingKey: string): ApprovalRecord | undefined;
  /** A pending approval for a capability (legacy, non-coordination path). */
  findPending(query: { capability: string }): ApprovalRecord | undefined;
  /**
   * Most recent NON-pending record for a graph/node/capability. Read-only.
   * Needed by the auto-mode branch, which reuses a prior resolution.
   */
  findResolved(opts: { graphId?: string; nodeId?: string; capability?: string }): ApprovalRecord | undefined;
  /**
   * Most recent record for a stable request id (typically the toolCallId).
   *
   * Required by `PolicyGate`'s legacy de-dup branch: after the operator approves,
   * the agent loop re-evaluates the SAME tool call, and without this lookup it
   * mints a second approval instead of honouring the first — the
   * "many pending approvals pile up" failure. Optional chaining at the call site
   * means omitting it here fails SILENTLY, so it must be exposed.
   */
  findByRequestId(requestId: string): ApprovalRecord | undefined;
  /**
   * Create a fresh PENDING approval (legacy capability path).
   *
   * Safe for a worker: it can only ever mint `pending`. Reconciliation of that
   * request requires an operator decision through a path this port does not
   * expose.
   */
  request(opts: Parameters<ApprovalStore["request"]>[0]): Promise<ApprovalRecord>;
  /** Create-or-reuse the pending request for an exact binding. */
  requestOrReusePending(input: Parameters<ApprovalStore["requestOrReusePending"]>[0]): Promise<ApprovalRecord>;
  /** Atomically claim an approved record. Single-use across processes. */
  consumeApproved: ApprovalStore["consumeApproved"];
  /**
   * Report the outcome of an execution THIS worker performed.
   *
   * Scope-limited by the worker identity and optional attempt captured at
   * construction: original and consumption bindings must all match. Only
   * records without either binding retain legacy access. Without this, a worker
   * holding a consumed id could falsify another worker's receipt. The store checks this
   * trusted scope against fresh ledger state inside its mutation lock.
   *
   * Returns the store's own boolean: `true` only when the transition landed.
   */
  recordExecutionOutcome(
    id: string,
    outcome: "succeeded" | "failed" | "cancelled",
  ): Promise<boolean>;
  /** Re-read the ledger so cross-process decisions become visible. */
  load(): Promise<void>;
  /**
   * Classify a still-`pending` consumed claim as `unverified` (terminal,
   * fail-closed). Exposed so `PolicyGate`'s consumed-replay branch can report an
   * exact reason instead of silently degrading to "already consumed".
   */
  markExecutionUnverified?(id: string): Promise<"unverified" | "pending" | "terminal" | "missing">;
}

/**
 * Open the restricted worker view for an isolated process.
 *
 * This is the ONE sanctioned ApprovalStore construction seam for worker
 * processes (pinned by the R1 boundary freeze): a child cannot receive the
 * parent's in-memory store, so it opens its own instance on the SAME
 * authoritative workspace. Callers pass the workspace they were spawned in —
 * never a config-derived or guessed path — so a worker can never accidentally
 * read a different `.alix` directory.
 *
 * Throws when the ledger cannot be opened or loaded; callers must treat that
 * as "no approval authority" and keep gated operations denied.
 */
export async function openWorkerApprovalPort(
  workspace: string,
  options: { eventLog?: unknown; workerId?: string; workerAttempt?: number } = {},
): Promise<WorkerApprovalPort> {
  const { ApprovalStore } = await import("../../governance/approvals/approval-store.js");
  const store = new ApprovalStore(
    workspace,
    options.eventLog ? { eventLog: options.eventLog as never } : {},
  );
  await store.load();
  return createWorkerApprovalPort(store, { workerId: options.workerId, workerAttempt: options.workerAttempt });
}

/** Methods that would let a worker authorize its own operations. */
const FORBIDDEN = [
  "resolve",
  "resolveWithEvidence",
  "resolveGroup",
  "revoke",
  "invalidate",
  "append",
  "mutate",
] as const;

/**
 * Throw if a candidate worker view exposes any decision-recording method.
 *
 * Exported so it can be exercised directly. The previous version of this check
 * lived inline and its test constructed a port from a CLEAN store and asserted
 * the methods were absent — which is true by construction, so the test passed
 * even with this function deleted. A reviewer deleted the guard and all 14 tests
 * stayed green (Gate E review, vacuous assertion #1).
 *
 * A guard that cannot be made to fire is not a guard. Testing it needs a
 * contaminated candidate, and that is what the export exists for.
 */
export function assertNoForbiddenDecisionMethods(candidate: object): void {
  for (const method of FORBIDDEN) {
    if (method in candidate) {
      throw new Error(`WorkerApprovalPort must not expose "${method}"`);
    }
  }
}

/**
 * Build the restricted worker view over a store instance opened on the worker's
 * own authoritative workspace.
 *
 * The returned object is a plain facade with only the allowed methods, so a
 * worker's tool executor and PolicyGate behave exactly as they do in the parent
 * without ever holding a decision-recording handle.
 */
export function createWorkerApprovalPort(
  store: ApprovalStore,
  options: { workerId?: string; workerAttempt?: number } = {},
): WorkerApprovalPort {
  const boundWorkerId = options.workerId;
  const boundWorkerAttempt = options.workerAttempt;
  // A bound worker can only observe its own records and explicitly legacy
  // unbound approvals. An unbound compatibility port cannot observe records
  // owned by any worker. Do not leak metadata via alternate lookup methods.
  const visible = (record: ApprovalRecord | undefined): ApprovalRecord | undefined =>
    record && (boundWorkerId ? record.workerId === boundWorkerId && (boundWorkerAttempt === undefined || record.workerAttempt === boundWorkerAttempt) : !record.workerId) ? record : undefined;
  const port: WorkerApprovalPort = {
    get: (id) => visible(store.get(id)),
    loadFresh: async (id) => visible(await store.loadFresh(id)),
    findExact: (bindingKey) => visible(store.findExact(bindingKey)),
    findPendingByBindingKey: (bindingKey) => visible(store.findPendingByBindingKey(bindingKey)),
    findPending: (query) => visible(store.findPending(query)),
    findResolved: (opts) => visible(store.findResolved(opts)),
    findByRequestId: (requestId) => visible(store.findByRequestId(requestId)),
    request: (opts) => store.request(boundWorkerId ? { ...opts, workerId: boundWorkerId, workerAttempt: boundWorkerAttempt } : opts),
    requestOrReusePending: (input) => {
      if (boundWorkerId && input.workerId && input.workerId !== boundWorkerId) {
        throw new Error("worker approval request identity mismatch");
      }
      return store.requestOrReusePending(boundWorkerId ? { ...input, workerId: boundWorkerId, workerAttempt: boundWorkerAttempt } : input);
    },
    consumeApproved: (id, bindingKey, consumer, invocation) => {
      if (boundWorkerId && consumer.workerId && consumer.workerId !== boundWorkerId) {
        return Promise.resolve({ consumed: false, reason: "worker mismatch" });
      }
      if (boundWorkerId && !visible(store.get(id))) return Promise.resolve({ consumed: false, reason: "worker scope mismatch" });
      return store.consumeApproved(id, bindingKey, boundWorkerId ? { ...consumer, workerId: boundWorkerId, workerAttempt: boundWorkerAttempt } : consumer, invocation);
    },
    recordExecutionOutcome: (id, outcome) =>
      store.recordExecutionOutcome(id, outcome, { workerId: boundWorkerId, workerAttempt: boundWorkerAttempt }),
    load: () => store.load(),
    markExecutionUnverified: (id) =>
      store.markExecutionUnverified(id, { workerId: boundWorkerId, workerAttempt: boundWorkerAttempt }),
  };

  // Structural guarantee, not a convention: no forbidden method is reachable
  // from the object a worker receives. A future refactor that added one would
  // fail this check immediately.
  assertNoForbiddenDecisionMethods(port);
  return port;
}
