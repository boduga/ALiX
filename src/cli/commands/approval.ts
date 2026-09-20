/**
 * approval.ts — CLI commands for approval lifecycle management.
 *
 * alix approval list                    — list pending approvals
 * alix approval list --all              — list all approvals
 * alix approval list --run <id>         — list by coordination run
 * alix approval show <id>               — show approval details
 * alix approval approve <id> [--reason "..."] [--by "..."]
 * alix approval deny <id> [--reason "..."]
 * alix approval revoke <id> --reason "..."
 * alix approval expire <id>
 */

import { ApprovalStore } from "../../approvals/approval-store.js";
import { openApprovalStores } from "../helpers/approval-stores.js";

export async function handleApproval(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (!subcommand) {
    console.error("Usage: alix approval <list|show|approve|deny|revoke|expire> [...]");
    process.exit(1);
  }

  // One inbox: schedule proposals (global) + tool approvals (project).
  const { stores, owner } = await openApprovalStores(process.cwd());

  switch (subcommand) {
    case "list":
      return handleList(stores, args.slice(1));
    case "show":
      return handleShow(owner(args[1] ?? ""), args.slice(1));
    case "approve":
      return handleResolve(owner(args[1] ?? ""), args.slice(1), "approved");
    case "deny":
      return handleResolve(owner(args[1] ?? ""), args.slice(1), "denied");
    case "revoke":
      return handleRevoke(owner(args[1] ?? ""), args.slice(1));
    case "expire":
      return handleExpire(stores, args.slice(1));
    default:
      console.error(`Unknown approval subcommand: ${subcommand}`);
      process.exit(1);
  }
}

async function handleList(stores: ApprovalStore[], args: string[]): Promise<void> {
  const showAll = args.includes("--all");
  const jsonMode = args.includes("--json");
  const runFilter = args.find(a => a.startsWith("--run="))?.split("=")[1];

  const seen = new Set<string>();
  let approvals = stores
    .flatMap((s) => s.list())
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  if (!showAll) approvals = approvals.filter(a => a.status === "pending");
  if (runFilter) approvals = approvals.filter(a => a.coordinationRunId === runFilter);

  if (jsonMode) {
    console.log(JSON.stringify(approvals, null, 2));
    return;
  }

  if (approvals.length === 0) {
    console.log("No approvals found.");
    return;
  }

  for (const a of approvals) {
    console.log(
      `${a.id.padEnd(30)} ${a.status.padEnd(12)} ${(a.capabilities ?? []).join(",").padEnd(20)} ${a.coordinationRunId ?? ""}`
    );
  }
}

async function handleShow(store: ApprovalStore, args: string[]): Promise<void> {
  const id = args[0];
  if (!id) { console.error("Usage: alix approval show <id>"); process.exit(1); }
  const record = store.get(id);
  if (!record) { console.error(`Approval not found: ${id}`); process.exit(1); }
  console.log(JSON.stringify(record, null, 2));
}

async function handleResolve(store: ApprovalStore, args: string[], status: "approved" | "denied"): Promise<void> {
  const id = args[0];
  if (!id) { console.error(`Usage: alix approval ${status} <id> [--reason "..."]`); process.exit(1); }
  const reason = args.find(a => a.startsWith("--reason="))?.split("=").slice(1).join("=");
  const record = await store.resolve(id, status, reason);
  if (!record) { console.error(`Approval not found or cannot be resolved: ${id}`); process.exit(1); }
  console.log(`${status.charAt(0).toUpperCase() + status.slice(1)}: ${id}`);
}

async function handleRevoke(store: ApprovalStore, args: string[]): Promise<void> {
  const id = args[0];
  const reasonArg = args.find(a => a.startsWith("--reason="));
  if (!id || !reasonArg) { console.error("Usage: alix approval revoke <id> --reason=\"...\""); process.exit(1); }
  const reason = reasonArg.split("=").slice(1).join("=");
  const record = await store.revoke(id, { actor: "cli", reason });
  if (!record) { console.error(`Approval not found or cannot be revoked: ${id}`); process.exit(1); }
  console.log(`Revoked: ${id}`);
}

async function handleExpire(stores: ApprovalStore[], _args: string[]): Promise<void> {
  let count = 0;
  for (const store of stores) count += (await store.expireDue(new Date())).length;
  console.log(`Expired ${count} approval(s).`);
}
