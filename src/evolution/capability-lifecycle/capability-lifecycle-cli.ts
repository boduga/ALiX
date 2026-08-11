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
import type { CapabilityRegistry } from "../../capability/registry.js";
import { CapabilityEvolutionStore } from "../../adaptation/capability-evolution-store.js";
import { CapabilityLifecycleApplier } from "./capability-lifecycle-applier.js";
import { CapabilityLifecycleMeasurer } from "./capability-lifecycle-measurer.js";

export interface CapabilitiesCLIDeps {
  cwd?: string;
  ledger?: CapabilityLifecycleLedger;
  registry?: CapabilityRegistry;
  store?: CapabilityEvolutionStore;
  generateDecision?: typeof generateDecision;
  policyConfig?: GovernancePolicyConfig;
}

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
].join("\n");

export async function handleCapabilitiesCommand(
  args: string[],
  deps: CapabilitiesCLIDeps = {},
): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  const jsonMode = rest.includes("--json");
  const cwd = deps.cwd ?? process.cwd();
  const ledger = deps.ledger ?? new JsonlCapabilityLifecycleLedger(DEFAULT_CAPABILITY_LIFECYCLE_FILE);
  const registry = deps.registry;
  const store = deps.store ?? new CapabilityEvolutionStore(join(cwd, ".alix", "capability-evolution"));

  switch (sub) {
    case "list":
      return renderList(registry, ledger, jsonMode);
    case "inspect":
      return renderInspect(rest[0], registry, ledger, jsonMode);
    case "history":
      return renderHistory(rest[0], ledger, jsonMode);
    case "health":
      return renderHealth(store, jsonMode);
    case "recommend":
      return runRecommend(registry, store, ledger, jsonMode);
    case "propose":
      return runPropose(registry, store, ledger, deps, jsonMode);
    case "apply":
      return runApply(rest[0], ledger, registry, jsonMode);
    case "measure":
      return runMeasure(rest[0], ledger, store, jsonMode);
    default:
      console.error(USAGE);
      process.exitCode = 1;
      process.exit(1);
  }
}

async function buildSignalInputs(
  registry: CapabilityRegistry | undefined,
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
  registry: CapabilityRegistry | undefined,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  const rows = [];
  const capabilities = registry ? registry.list() : [];
  for (const cap of capabilities) {
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
  registry: CapabilityRegistry | undefined,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  if (!id) {
    console.error("Usage: alix capabilities inspect <id>");
    process.exitCode = 1;
    process.exit(1);
  }
  const cap = registry?.find(id);
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
  registry: CapabilityRegistry | undefined,
  store: CapabilityEvolutionStore,
  ledger: CapabilityLifecycleLedger,
  jsonMode: boolean,
): Promise<void> {
  const inputs = await buildSignalInputs(registry, store, ledger);
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
  registry: CapabilityRegistry | undefined,
  store: CapabilityEvolutionStore,
  ledger: CapabilityLifecycleLedger,
  deps: CapabilitiesCLIDeps,
  jsonMode: boolean,
): Promise<void> {
  const inputs = await buildSignalInputs(registry, store, ledger);
  const candidates = analyzeCapabilityLifecycle(inputs);
  if (candidates.length === 0) {
    if (jsonMode) console.log(JSON.stringify({ ok: true, proposals: [] }));
    else console.log("No capability lifecycle proposals.");
    return;
  }

  const signalEvidenceRefs = [{ evidenceId: "a7-p55-report", source: "p55" }];
  const artifacts = buildCapabilityProposals(candidates, signalEvidenceRefs);
  const results = [];

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

async function runApply(
  id: string | undefined,
  ledger: CapabilityLifecycleLedger,
  registry: CapabilityRegistry | undefined,
  jsonMode: boolean,
): Promise<void> {
  if (!id) {
    console.error("Usage: alix capabilities apply <id>");
    process.exitCode = 1;
    process.exit(1);
    return;
  }
  if (!registry) {
    const msg = "Capability registry unavailable — cannot apply";
    if (jsonMode) console.log(JSON.stringify({ ok: false, reason: msg }));
    else { console.error(msg); process.exitCode = 1; process.exit(1); }
    return;
  }
  const applier = new CapabilityLifecycleApplier({ ledger, registry, requestId: `req-${id}` });
  let res;
  try { res = await applier.apply(id); } // append-failure THROWS (post-commit rollback ran)
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jsonMode) console.log(JSON.stringify({ ok: false, reason: msg }));
    else { console.error(msg); process.exitCode = 1; process.exit(1); }
    return;
  }
  if (res.status === "blocked") {
    if (jsonMode) console.log(JSON.stringify({ ok: false, reason: res.reason }));
    else { console.error(res.reason); process.exitCode = 1; process.exit(1); }
    return;
  }
  if (jsonMode) console.log(JSON.stringify({ ok: true, capabilityId: id, executionId: res.executionId }));
  else console.log(`applied ${id} (execution ${res.executionId})`);
}

async function runMeasure(
  id: string | undefined,
  ledger: CapabilityLifecycleLedger,
  store: CapabilityEvolutionStore,
  jsonMode: boolean,
): Promise<void> {
  if (!id) {
    console.error("Usage: alix capabilities measure <id>");
    process.exitCode = 1;
    process.exit(1);
    return;
  }
  const measurer = new CapabilityLifecycleMeasurer({ ledger, store });
  let res;
  try { res = await measurer.measure(id); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jsonMode) console.log(JSON.stringify({ ok: false, reason: msg }));
    else { console.error(msg); process.exitCode = 1; process.exit(1); }
    return;
  }
  if (res.status === "blocked") {
    if (jsonMode) console.log(JSON.stringify({ ok: false, reason: res.reason }));
    else { console.error(res.reason); process.exitCode = 1; process.exit(1); }
    return;
  }
  if (jsonMode) console.log(JSON.stringify({ ok: true, capabilityId: id, measurementId: res.measurementId, stateTransition: res.stateTransition }));
  else console.log(`measured ${id}: ${res.stateTransition} (measurement ${res.measurementId})`);
}
