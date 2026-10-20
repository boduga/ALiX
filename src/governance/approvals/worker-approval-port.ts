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
 * Decisions stay operator-controlled because there is simply no reachable
 * method that records one.
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
  /** Report the outcome of an execution this worker performed. */
  recordExecutionOutcome: ApprovalStore["recordExecutionOutcome"];
  /** Re-read the ledger so cross-process decisions become visible. */
  load(): Promise<void>;
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
  options: { eventLog?: unknown } = {},
): Promise<WorkerApprovalPort> {
  const { ApprovalStore } = await import("../../governance/approvals/approval-store.js");
  const store = new ApprovalStore(
    workspace,
    options.eventLog ? { eventLog: options.eventLog as never } : {},
  );
  await store.load();
  return createWorkerApprovalPort(store);
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
 * Build the restricted worker view over a store instance opened on the worker's
 * own authoritative workspace.
 *
 * The returned object is a plain facade with only the allowed methods, so a
 * worker's tool executor and PolicyGate behave exactly as they do in the parent
 * without ever holding a decision-recording handle.
 */
export function createWorkerApprovalPort(store: ApprovalStore): WorkerApprovalPort {
  const port: WorkerApprovalPort = {
    get: (id) => store.get(id),
    loadFresh: (id) => store.loadFresh(id),
    findExact: (bindingKey) => store.findExact(bindingKey),
    findPendingByBindingKey: (bindingKey) => store.findPendingByBindingKey(bindingKey),
    findPending: (query) => store.findPending(query),
    findResolved: (opts) => store.findResolved(opts),
    request: (opts) => store.request(opts),
    requestOrReusePending: (input) => store.requestOrReusePending(input),
    consumeApproved: store.consumeApproved.bind(store),
    recordExecutionOutcome: store.recordExecutionOutcome.bind(store),
    load: () => store.load(),
  };

  // Structural guarantee, not a convention: no forbidden method is reachable
  // from the object a worker receives. A future refactor that added one would
  // fail this check immediately.
  for (const method of FORBIDDEN) {
    if (method in port) {
      throw new Error(`WorkerApprovalPort must not expose "${method}"`);
    }
  }
  return port;
}
