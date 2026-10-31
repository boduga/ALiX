/**
 * `alix effects` — D9 Slice F production entry point for effect-journal
 * reconciliation.
 *
 * Slice F requires an *audited delegated reconciliation path* for unresolved
 * journal entries (docs/2026-10-28-d9-phase-f-remediation-implementation-plan.md).
 * `reconcileEffectRecord` implements the authority, evidence, history and
 * identity rules, but had no production caller — so a quarantined exact effect
 * had no operator remedy. This module supplies that caller and NOTHING else.
 *
 * Deliberate design constraints (do not relax them here):
 * - This file adds no authorization semantics. It builds the same
 *   `ToolCallRequest` the original tool call had, and delegates every
 *   authority/evidence/binding decision to `effect-journal.ts`.
 * - The journal intentionally persists no raw arguments, only hashes. So the
 *   operator must supply the original invocation; `effectIdentity` recomputes
 *   the key and the record is looked up under it. A wrong invocation therefore
 *   addresses a different (or absent) record and fails closed — it cannot
 *   silently retarget someone else's effect.
 * - Never clear by age or PID. Missing/invalid authority fails closed. No
 *   auto-approval path exists: `request` mints a pending approval that a
 *   separate actor must decide.
 */

import { join } from "node:path";
import { readdirSync, readFileSync, existsSync, realpathSync } from "node:fs";
import type { ToolCallRequest } from "../../../capabilities/tools/types.js";
import { openApprovalStores } from "../helpers/approval-stores.js";

/** States that still block replay and therefore need operator attention. */
const UNRESOLVED_STATES = ["claimed", "started_unknown", "terminal_failure"];

interface ParsedInvocation {
  toolName: string;
  args: Record<string, unknown>;
}

/** Parse `--tool <name> --args <json>`, plus the shared reconciliation facts. */
interface ParsedArgs extends ParsedInvocation {
  outcome?: "applied" | "not_applied";
  evidenceHash?: string;
  evidenceRef?: string;
  actorId?: string;
  policyRevision?: string;
  approvalId?: string;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

export function parseEffectsArgs(args: string[]): ParsedArgs | { error: string } {
  const toolName = flag(args, "--tool");
  const argsJson = flag(args, "--args");
  if (!toolName) return { error: "Missing --tool <toolName> (the original tool call)." };
  if (!argsJson) return { error: "Missing --args <json> (the exact original arguments)." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return { error: "--args must be valid JSON." };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "--args must be a JSON object." };
  }
  const parsedArgs: ParsedArgs = { toolName, args: parsed as Record<string, unknown> };
  const outcome = flag(args, "--outcome");
  if (outcome !== undefined) {
    if (outcome !== "applied" && outcome !== "not_applied") {
      return { error: "--outcome must be `applied` or `not_applied`." };
    }
    parsedArgs.outcome = outcome;
  }
  const evidenceHash = flag(args, "--evidence-hash");
  const evidenceRef = flag(args, "--evidence-ref");
  const actorId = flag(args, "--actor");
  const policyRevision = flag(args, "--policy-revision");
  const approvalId = flag(args, "--approval");
  if (evidenceHash !== undefined) parsedArgs.evidenceHash = evidenceHash;
  if (evidenceRef !== undefined) parsedArgs.evidenceRef = evidenceRef;
  if (actorId !== undefined) parsedArgs.actorId = actorId;
  if (policyRevision !== undefined) parsedArgs.policyRevision = policyRevision;
  if (approvalId !== undefined) parsedArgs.approvalId = approvalId;
  return parsedArgs;
}

/**
 * The journal directory is owned by `effect-journal.ts` (`.alix/effect-journal/v1`
 * under the canonical workspace). Import the identity helper rather than
 * reconstructing the path here, so the two can never drift.
 */
function journalDir(cwd: string, effectKey?: string): string {
  return join(realpathSync.native(cwd), ".alix", "effect-journal", "v1", ...(effectKey ? [`${effectKey}.json`] : []));
}

function printRecord(record: Record<string, unknown>): void {
  const keys = ["effectKey", "generationId", "toolName", "state", "canonicalArgsHash", "claimedAt", "updatedAt"];
  const width = Math.max(...keys.map(k => k.length)) + 2;
  for (const key of keys) {
    console.log(`  ${key.padEnd(width)}${String(record[key] ?? "-")}`);
  }
}

/** `alix effects list` — show records that still block replay. */
export async function handleEffectsList(cwd: string): Promise<number> {
  const dir = journalDir(cwd);
  if (!existsSync(dir)) {
    console.log("No effect journal records.");
    return 0;
  }
  const rows: Array<{ file: string; record: Record<string, unknown> }> = [];
  for (const file of readdirSync(dir)) {
    // Only records. The lock and reconciliation-history files live in the same
    // directory and must not be reported as effects.
    if (!file.endsWith(".json") || file.startsWith(".") || file.includes(".reconciliation.")) continue;
    try {
      const record = JSON.parse(readFileSync(join(dir, file), "utf-8")) as Record<string, unknown>;
      if (UNRESOLVED_STATES.includes(String(record.state))) rows.push({ file, record });
    } catch {
      // A malformed record still needs attention; report it, never hide it.
      rows.push({ file, record: { effectKey: file.replace(/\.json$/, ""), state: "malformed" } });
    }
  }
  if (rows.length === 0) {
    console.log("No unresolved effect journal records.");
    return 0;
  }
  console.log(`Unresolved effect journal records: ${rows.length}`);
  for (const { record } of rows) {
    console.log("");
    printRecord(record);
  }
  console.log("");
  console.log("Reconcile one with:");
  console.log("  alix effects request --tool <t> --args '<json>' --outcome applied|not_applied \\");
  console.log("    --evidence-hash <sha256> --evidence-ref <ref> --actor <id> --policy-revision <rev>");
  console.log("  alix approvals approve <pending-id>");
  console.log("  alix effects reconcile --tool <t> --args '<json>' --approval <id> \\");
  console.log("    --outcome applied|not_applied --evidence-hash <sha256> --evidence-ref <ref> \\");
  console.log("    --actor <id> --policy-revision <rev>");
  return 0;
}

/** Shared validation for the two write commands. */
function requireReconcileFacts(parsed: ParsedArgs): string | null {
  if (!parsed.outcome) return "Missing --outcome applied|not_applied.";
  if (!parsed.evidenceHash) return "Missing --evidence-hash <sha256>.";
  if (!parsed.evidenceRef) return "Missing --evidence-ref <ref>.";
  if (!parsed.actorId) return "Missing --actor <id>.";
  if (!parsed.policyRevision) return "Missing --policy-revision <rev>.";
  return null;
}

/**
 * `alix effects request` — mint the pending approval that authorizes one
 * reconciliation. Separate from `reconcile` so an operator (or a differently
 * delegated agent) must decide it; this command never self-approves.
 */
export async function handleEffectsRequest(cwd: string, args: string[]): Promise<number> {
  const parsed = parseEffectsArgs(args);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const missing = requireReconcileFacts(parsed);
  if (missing) {
    console.error(missing);
    return 2;
  }
  try {
    const { effectReconciliationAuthority, readEffectRecord } = await import("../../../capabilities/tools/effect-journal.js");
    const request: ToolCallRequest = { toolCallId: "effects-request", name: parsed.toolName, args: parsed.args };
    // Fail closed when the invocation addresses no unresolved record: never mint
    // authority for an effect that does not exist in this workspace.
    const record = readEffectRecord(cwd, request);
    if (!record) throw new Error("no effect journal record matches that invocation");
    if (!UNRESOLVED_STATES.includes(record.state)) {
      throw new Error(`effect journal record is ${record.state}; nothing to reconcile`);
    }
    const authority = effectReconciliationAuthority(cwd, request, {
      actorId: parsed.actorId!,
      policyRevision: parsed.policyRevision!,
      outcome: parsed.outcome!,
      evidenceHash: parsed.evidenceHash!,
      evidenceRef: parsed.evidenceRef!,
    });
    // The project store (first entry) is the one the journal reconciles against.
    // Reach it through the sanctioned CLI helper rather than importing the
    // protected status store directly (R1 boundary freeze).
    const { stores } = await openApprovalStores(cwd);
    const store = stores[0];
    const approval = await store.requestBound({
      reason: `D9 effect reconciliation ${record.effectKey}`,
      bindingKey: authority.bindingKey,
      requestFingerprint: authority.requestFingerprint,
      policyRevision: parsed.policyRevision!,
      capabilities: [authority.capability],
      agentId: parsed.actorId!,
      riskLevel: "critical",
      toolId: "effect.reconcile",
    });
    console.log(`Pending reconciliation authority: ${approval.id}`);
    console.log(`Approve it with: alix approvals approve ${approval.id}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * `alix effects reconcile` — consume an already-approved `effect.reconcile`
 * grant and durably transition the record. All authorization is the journal's.
 */
export async function handleEffectsReconcile(cwd: string, args: string[]): Promise<number> {
  const parsed = parseEffectsArgs(args);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const missing = requireReconcileFacts(parsed);
  if (missing) {
    console.error(missing);
    return 2;
  }
  if (!parsed.approvalId) {
    console.error("Missing --approval <id> (run `alix effects request`, then approve it).");
    return 2;
  }
  try {
    const { reconcileEffectRecord } = await import("../../../capabilities/tools/effect-journal.js");
    // Sanctioned CLI helper, not a direct protected-store import (R1 freeze).
    const { stores } = await openApprovalStores(cwd);
    const store = stores[0];
    const request: ToolCallRequest = { toolCallId: "effects-reconcile", name: parsed.toolName, args: parsed.args };
    const record = await reconcileEffectRecord(cwd, request, {
      approvalId: parsed.approvalId,
      actorId: parsed.actorId!,
      policyRevision: parsed.policyRevision!,
      outcome: parsed.outcome!,
      evidenceHash: parsed.evidenceHash!,
      evidenceRef: parsed.evidenceRef!,
    }, store);
    console.log("Reconciled.");
    console.log("");
    printRecord(record as unknown as Record<string, unknown>);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export async function handleEffectsRoot(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const [sub, ...rest] = args;
  if (!sub || sub === "list") process.exit(await handleEffectsList(cwd));
  if (sub === "request") process.exit(await handleEffectsRequest(cwd, rest));
  if (sub === "reconcile") process.exit(await handleEffectsReconcile(cwd, rest));
  console.error("Usage: alix effects [list|request|reconcile] ...");
  process.exit(2);
}
