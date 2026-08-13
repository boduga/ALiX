// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { join } from "node:path";
import type { CapabilityLifecycleLedger } from "./capability-lifecycle-ledger.js";
import { DEFAULT_CAPABILITY_LIFECYCLE_FILE, JsonlCapabilityLifecycleLedger } from "./capability-lifecycle-ledger.js";
import { analyzeCapabilityLifecycle } from "./capability-lifecycle-analyzer.js";
import type { CapabilitySignalInputs } from "./contracts/lifecycle-contract.js";
import { deriveCapabilityProjectionState } from "./contracts/lifecycle-contract.js";
import { buildCapabilityProposals } from "./capability-proposal-builder.js";
import { runCapabilityGovernance, toLedgerRecord } from "./capability-governance-bridge.js";
import { generateDecision } from "../governance/decision-engine.js";
import type { GovernancePolicyConfig } from "../governance/contracts/decision-contract.js";
import type { CapabilityService } from "../../capability/capability-service.js";
import { CapabilityEvolutionStore } from "../../adaptation/capability-evolution-store.js";
import { CapabilityLifecycleApplier } from "./capability-lifecycle-applier.js";
import { CapabilityLifecycleMeasurer } from "./capability-lifecycle-measurer.js";

/**
 * CapabilityService is the only mandatory capability surface (CAP-8, locked
 * ruling #2). The A7.0 governance applier remains a CAP-11 migration debt
 * until it is itself rewritten to consume the service; until then we accept
 * a structurally-compatible accessor through `registry` so the CLI seam
 * can remain service-mediated while preserving the legacy flow.
 *
 * NOTE: per locked ruling #2 (axis 2), this module MUST NOT import
 * `CapabilityRegistry` or `CapabilityResolver` by name. The applier's
 * internal registry type is reached indirectly through
 * `Parameters<typeof CapabilityLifecycleApplier>[0]["registry"]` to keep
 * the named-type import out of this source file.
 */
export interface CapabilitiesCLIDeps {
  cwd?: string;
  ledger?: CapabilityLifecycleLedger;
  service?: CapabilityService;
  /** Legacy/CAP-11 accessor — typed as `unknown` here so this module avoids
   *  importing `CapabilityRegistry`. The applier accepts any object that
   *  satisfies its full registry shape; the cast happens at the applier
   *  boundary. */
  registry?: unknown;
  store?: CapabilityEvolutionStore;
  generateDecision?: typeof generateDecision;
  policyConfig?: GovernancePolicyConfig;
}

/** Internal: registry type extracted from the applier's constructor without
 *  naming `CapabilityRegistry` in this file. */
type ApplierRegistry = ConstructorParameters<typeof CapabilityLifecycleApplier>[0]["registry"];

const USAGE = [
  "alix capabilities",
  "  list                  List registered capabilities with lifecycle overlay",
  "  inspect <id>          Show one capability in full context",
  "  history <id>          Show ledger events for one capability",
  "  health                Read the P5.5 capability-evolution report",
  "  recommend             (read-only) analyze and display lifecycle candidates",
  "  propose               (governed) submit lifecycle proposals through A3 and record",
  "  apply <id>            (governed) execute a decided capability transition",
  "  measure <id>          (governed) measure a capability post-application",
  "  proposals             (governed) list pending + recent governance proposals via service.governance",
  "  approve <proposalId>  (governed) execute a decided proposal via service.apply({proposalId})",
  "  reject <proposalId> <reason>  (governed) record a proposal rejection via service.reject",
].join("\n");

export async function handleCapabilitiesCommand(
  args: string[],
  deps: CapabilitiesCLIDeps = {},
): Promise<number | void> {
  const sub = args[0];
  const rest = args.slice(1);
  const jsonMode = rest.includes("--json");
  const cwd = deps.cwd ?? process.cwd();
  const ledger = deps.ledger ?? new JsonlCapabilityLifecycleLedger(DEFAULT_CAPABILITY_LIFECYCLE_FILE);
  const service = deps.service;
  const registry = deps.registry;
  const store = deps.store ?? new CapabilityEvolutionStore(join(cwd, ".alix", "capability-evolution"));

  switch (sub) {
    case "list":
      return renderList(service, ledger, jsonMode);
    case "inspect":
      return renderInspect(rest[0], service, ledger, jsonMode);
    case "history":
      return renderHistory(rest[0], ledger, jsonMode);
    case "health":
      return renderHealth(store, jsonMode);
    case "recommend":
      return runRecommend(store, ledger, jsonMode);
    case "propose":
      return runPropose(store, ledger, deps, jsonMode);
    case "apply":
      return runApply(rest[0], ledger, registry, jsonMode);
    case "measure":
      return runMeasure(rest[0], ledger, store, jsonMode);
    case "proposals": {
      // CAP-9 Task 9 — list proposals via service.governance(capabilityId?).
      // Routes exclusively through CapabilityService; no direct catalog access.
      const { capabilityProposalsCommand } = await import("../../cli/commands/capability-proposals.js");
      return capabilityProposalsCommand(rest, { service });
    }
    case "approve": {
      // CAP-9 Task 9 — execute a proposal via service.apply({proposalId}).
      // Mutation execution itself is delegated to CAP-6; CLI is the seam.
      const { capabilityApproveCommand } = await import("../../cli/commands/capability-approve.js");
      return capabilityApproveCommand(rest, { service });
    }
    case "reject": {
      // CAP-9 Task 9 — record a rejection via service.reject(proposalId, reason).
      // Store-level write only; no executor delegation.
      const { capabilityRejectCommand } = await import("../../cli/commands/capability-reject.js");
      return capabilityRejectCommand(rest, { service });
    }
    default:
      console.error(USAGE);
      process.exitCode = 1;
      process.exit(1);
  }
}

async function buildSignalInputs(
  store: CapabilityEvolutionStore,
  ledger: CapabilityLifecycleLedger,
): Promise<CapabilitySignalInputs> {
  const report = await store.loadLatest();
  return {
    health: report?.healthAnalysis ?? [],
    gaps: report?.gapAnalysis ?? [],
    overlap: report?.overlapAnalysis ?? [],
    drift: report?.driftAnalysis ?? [],
    adoption: {},
    outcome: [],
    patterns: [],
  };
}

async function renderList(
  service: CapabilityService | undefined,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  const rows: Array<{ capabilityId: string; lifecycleState: unknown; projection: string }> = [];
  // CAP-8: list comes through the service (AC#2 / AC#5 — `service.list == registry.list`).
  const items = service ? service.list().items : [];
  for (const cap of items) {
    const latest = await ledger.listLatestForCapability(cap.id);
    const projection = latest ? deriveCapabilityProjectionState(latest) : "PROPOSED";
    rows.push({ capabilityId: cap.id, lifecycleState: latest?.observedLifecycleState ?? null, projection });
  }
  if (jsonMode) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log("No capabilities registered.");
    return;
  }
  console.log(`${"capabilityId".padEnd(28)} ${"state".padEnd(12)} projection`);
  for (const r of rows) {
    console.log(`${r.capabilityId.padEnd(28)} ${String(r.lifecycleState ?? "—").padEnd(12)} ${r.projection}`);
  }
}

async function renderInspect(
  id: string | undefined,
  service: CapabilityService | undefined,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  if (!id) {
    console.error("Usage: alix capabilities inspect <id>");
    process.exitCode = 1;
    process.exit(1);
  }
  // CAP-8: inspect comes through the service. service.inspect throws
  // CapabilityNotFoundError for missing ids — translate to the legacy
  // "not found" fatal path so CLI UX is preserved byte-for-byte.
  let cap;
  try {
    cap = service ? service.inspect(id) : undefined;
  } catch {
    cap = undefined;
  }
  if (!cap) {
    if (jsonMode) console.log(JSON.stringify({ ok: false, error: `capability not found: ${id}` }));
    else console.error(`Capability not found: ${id}`);
    process.exitCode = 1;
    process.exit(1);
  }
  const events = await ledger.listByCapability(id);
  if (jsonMode) {
    console.log(JSON.stringify({ capability: cap, events }, null, 2));
    return;
  }
  console.log(`${id}`);
  console.log(`  title:        ${cap.title}`);
  console.log(`  kind:         ${cap.kind}`);
  console.log(`  risk:         ${cap.risk}`);
  console.log(`  lifecycle:    ${events.length} ledger event(s)`);
}

async function renderHistory(
  id: string | undefined,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  if (!id) {
    console.error("Usage: alix capabilities history <id>");
    process.exitCode = 1;
    process.exit(1);
  }
  const events = await ledger.listByCapability(id);
  if (jsonMode) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  if (events.length === 0) {
    console.log(`No lifecycle history for ${id}.`);
    return;
  }
  console.log(`${"event".padEnd(10)} ${"intent".padEnd(12)} ${"decision".padEnd(12)} timestamp`);
  for (const e of events) {
    console.log(`${e.eventType.padEnd(10)} ${e.intent.padEnd(12)} ${String(e.decisionKind ?? "—").padEnd(12)} ${e.timestamp}`);
  }
}

async function renderHealth(store: CapabilityEvolutionStore, jsonMode: boolean): Promise<void> {
  const report = await store.loadLatest();
  if (!report) {
    const msg = "No capability-evolution report — run `alix adaptation capability-evolution` first.";
    if (jsonMode) console.log(JSON.stringify({ ok: false, message: msg }));
    else console.log(msg);
    return;
  }
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Capability health (${report.generatedAt})`);
  console.log(`  total capabilities: ${report.totalCapabilities}`);
  console.log(`  lifecycle: ${JSON.stringify(report.lifecycleDistribution)}`);
  console.log(`  ${report.executiveSummary}`);
}

async function runRecommend(
  store: CapabilityEvolutionStore,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  const inputs = await buildSignalInputs(store, ledger);
  const candidates = analyzeCapabilityLifecycle(inputs);
  if (jsonMode) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }
  if (candidates.length === 0) {
    console.log("No capability lifecycle recommendations.");
    return;
  }
  console.log(`Capability lifecycle recommendations (${candidates.length}):`);
  for (const c of candidates) {
    console.log(`  ${c.intent.padEnd(12)} ${c.target.capabilityId}  (${c.proposedLifecycleState})  conf=${c.confidence.toFixed(2)}`);
  }
}

async function runPropose(
  store: CapabilityEvolutionStore,
  ledger: CapabilityLifecycleLedger,
  deps: CapabilitiesCLIDeps,
  jsonMode: boolean,
): Promise<void> {
  const inputs = await buildSignalInputs(store, ledger);
  const candidates = analyzeCapabilityLifecycle(inputs);
  if (candidates.length === 0) {
    if (jsonMode) console.log(JSON.stringify({ ok: true, proposals: [] }));
    else console.log("No capability lifecycle proposals.");
    return;
  }

  const signalEvidenceRefs = [{ evidenceId: "a7-p55-report", source: "p55" }];
  const artifacts = buildCapabilityProposals(candidates, signalEvidenceRefs);
  const results: Array<{ proposalId: string; intent: string; capabilityId: string; decisionKind: string }> = [];

  for (const { candidate, intent, proposal } of artifacts) {
    await ledger.append(toLedgerRecord("intent", candidate));
    await ledger.append(toLedgerRecord("proposed", candidate, { proposalId: proposal.proposalId }));
    const outcome = runCapabilityGovernance(candidate, proposal.proposalId, {
      policyConfig: deps.policyConfig,
      generateDecision: deps.generateDecision,
    });
    await ledger.append(toLedgerRecord("decided", candidate, { proposalId: proposal.proposalId, outcome }));
    results.push({
      proposalId: proposal.proposalId,
      intent: candidate.intent,
      capabilityId: candidate.target.capabilityId,
      decisionKind: outcome.decision.kind,
    });
  }

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, proposals: results }, null, 2));
    return;
  }
  for (const r of results) {
    console.log(`${r.intent.padEnd(12)} ${r.capabilityId.padEnd(28)} ${r.decisionKind}`);
  }
}

/** Fatal-path reporter: prints the message (JSON on stdout when in jsonMode,
 *  otherwise stderr) and exits 1. process.exit(1) is required — the src/cli.ts
 *  dispatcher's process.exit(0) clobbers a bare exitCode, and fatal capability
 *  errors must be non-zero in BOTH modes (A7.0 86e323f2). Test-safe: capture()
 *  stubs process.exit. */
function failFatal(message: string, jsonMode: boolean): never {
  if (jsonMode) console.log(JSON.stringify({ ok: false, reason: message }));
  else console.error(message);
  process.exitCode = 1;
  process.exit(1);
}

async function runApply(
  id: string | undefined,
  ledger: CapabilityLifecycleLedger,
  registry: unknown,
  jsonMode: boolean,
): Promise<void> {
  if (!id) failFatal("Usage: alix capabilities apply <id>", jsonMode);
  if (registry == null) failFatal("Capability registry unavailable — cannot apply", jsonMode);
  // CAP-11 debt: the applier still uses a CapabilityRegistry directly. The
  // type is reached via the applier's own constructor signature so this
  // module never names CapabilityRegistry itself.
  const applier = new CapabilityLifecycleApplier({
    ledger,
    registry: registry as ApplierRegistry,
    requestId: `req-${id}`,
  });
  let res;
  try { res = await applier.apply(id); } // append-failure THROWS (post-commit rollback ran)
  catch (err) {
    failFatal(err instanceof Error ? err.message : String(err), jsonMode);
  }
  if (res.status === "blocked") failFatal(res.reason, jsonMode);
  if (jsonMode) console.log(JSON.stringify({ ok: true, capabilityId: id, executionId: res.executionId }));
  else console.log(`applied ${id} (execution ${res.executionId})`);
}

async function runMeasure(
  id: string | undefined,
  ledger: CapabilityLifecycleLedger,
  store: CapabilityEvolutionStore,
  jsonMode: boolean,
): Promise<void> {
  if (!id) failFatal("Usage: alix capabilities measure <id>", jsonMode);
  const measurer = new CapabilityLifecycleMeasurer({ ledger, store });
  let res;
  try { res = await measurer.measure(id); }
  catch (err) {
    failFatal(err instanceof Error ? err.message : String(err), jsonMode);
  }
  if (res.status === "blocked") failFatal(res.reason, jsonMode);
  if (jsonMode) console.log(JSON.stringify({ ok: true, capabilityId: id, measurementId: res.measurementId, stateTransition: res.stateTransition }));
  else console.log(`measured ${id}: ${res.stateTransition} (measurement ${res.measurementId})`);
}
