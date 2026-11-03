/**
 * GE-04 experimental governance-owned approval authority.
 * This port does not mint approvals or permit operator decisions.
 * It must not be accepted as a caller-injected structural interface.
 */
import { ApprovalStore } from "./approval-store.js";
import type { ApprovalRecord } from "./approval-types.js";


const trustedGe04Approvals = new WeakSet<object>();

export type Ge04ApprovalAuthority = Readonly<{
  load(): Promise<void>;
  get(id: string): ApprovalRecord | undefined;
  consumeApproved: ApprovalStore["consumeApproved"];
  recordExecutionOutcome: ApprovalStore["recordExecutionOutcome"];
  listUncertainConsumptions(): ApprovalRecord[];
}>;

/** Only the governance factory may mint a trusted port backed by a real store. */
export function createGe04ApprovalAuthority(store: ApprovalStore): Ge04ApprovalAuthority {
  if (!(store instanceof ApprovalStore)) {
    throw new Error("GE-04: real approval store required");
  }
  const port: Ge04ApprovalAuthority = {
    load: () => store.load(),
    get: (id: string) => store.get(id),
    consumeApproved: store.consumeApproved.bind(store),
    recordExecutionOutcome: store.recordExecutionOutcome.bind(store),
    listUncertainConsumptions: () => store.listUncertainConsumptions(),
  };
  trustedGe04Approvals.add(port);
  return Object.freeze(port);
}

/** An unbranded, structurally identical caller object is never trusted. */
export function isTrustedGe04ApprovalAuthority(value: unknown): value is Ge04ApprovalAuthority {
  return typeof value === "object" && value !== null &&
    trustedGe04Approvals.has(value);
}
