#!/usr/bin/env node
/**
 * tool-selection-label.mjs — T3-b/T3-c: blind disagreement labelling and
 * objective-gap-closure labelling (dev CLI, read/write on local files only).
 *
 * Track A (selection-time appropriateness) is labelled BLIND: the card shows the
 * frozen selection-time context with the two candidates as A and B, in a
 * rotation derived from the scope key, and says nothing about which came from
 * the model and which from the alternative. The reveal happens after the labels
 * are committed, and the committed record keeps only what was judged.
 *
 * Track B (objective-gap closure) is a separate label on the same scope; it is
 * never derived from the live loop's own evidence signal.
 *
 * Usage:
 *   node scripts/tool-selection-label.mjs --corpus /tmp/corpus.json --list
 *   node scripts/tool-selection-label.mjs --corpus /tmp/corpus.json --card <scopeKey>
 *   node scripts/tool-selection-label.mjs --corpus /tmp/corpus.json --label <scopeKey> --a appropriate --b unclear
 *   node scripts/tool-selection-label.mjs --corpus /tmp/corpus.json --gap <scopeKey> --closure closed
 *   node scripts/tool-selection-label.mjs --corpus /tmp/corpus.json --report
 *
 * The label store defaults to .alix/t3-labels.jsonl (local, append-only); pass
 * --store to keep it somewhere durable.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const DEFAULT_STORE = join(ROOT, ".alix", "t3-labels.jsonl");

const {
  APPROPRIATENESS_LABELS,
  GAP_CLOSURE_LABELS,
  buildBlindLabellingCard,
  objectiveHash,
  parseLabelRecord,
  resolveDisagreementLabels,
  summarizeCorpus,
} = await import(`${ROOT}/dist/src/planning/decision/tool-selection-corpus.js`);
const { extractToolSelectionScopes } = await import(
  `${ROOT}/dist/src/planning/decision/tool-selection-replay.js`
);

function parseArgs(argv) {
  const out = { store: DEFAULT_STORE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--corpus") out.corpus = argv[++i];
    else if (arg === "--store") out.store = argv[++i];
    else if (arg === "--list") out.list = true;
    else if (arg === "--card") out.card = argv[++i];
    else if (arg === "--label") out.label = argv[++i];
    else if (arg === "--gap") out.gap = argv[++i];
    else if (arg === "--closure") out.closure = argv[++i];
    else if (arg === "--a") out.a = argv[++i];
    else if (arg === "--b") out.b = argv[++i];
    else if (arg === "--report") out.report = true;
    else if (arg === "--relabel") out.relabel = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function readStore(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => parseLabelRecord(JSON.parse(line)));
}

function appendStore(path, record) {
  parseLabelRecord(record);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.corpus) {
  console.error(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(args.help ? 0 : 1);
}

const corpus = JSON.parse(readFileSync(args.corpus, "utf8"));
const rows = corpus.rows ?? [];
const labels = readStore(args.store);
const scopeKeyOf = (row) => `${row.sessionId}:${row.scopeId}`;
const rowFor = (scopeKey) => rows.find((row) => scopeKeyOf(row) === scopeKey);

/** The frozen scope behind a corpus row, rebuilt from the recorded trace. */
function scopeFor(row) {
  const path = join(ROOT, ".alix", "sessions", row.sessionId, "events.jsonl");
  if (!existsSync(path)) throw new Error(`recorded trace missing: ${path}`);
  const events = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
  const scope = extractToolSelectionScopes(events).find((entry) => entry.scopeId === row.scopeId);
  if (!scope) throw new Error(`scope ${row.scopeId} not found in ${path}`);
  return scope;
}

/** Scopes where the actual choice and the alternative top differ. */
function disagreements() {
  return rows
    .filter((row) => row.eligibility?.selection === "eligible")
    .filter((row) => row.alternative?.ranking?.[0] && row.actual?.candidateId)
    .filter((row) => row.alternative.ranking[0] !== row.actual.candidateId)
    .map((row) => ({
      row,
      scopeKey: scopeKeyOf(row),
      actualId: row.actual.candidateId,
      alternativeId: row.alternative.ranking[0],
    }));
}

function renderCard(row, scope) {
  const actualId = row.actual.candidateId;
  const alternativeId = row.alternative.ranking[0];
  const card = buildBlindLabellingCard({
    scopeKey: scopeKeyOf(row),
    objective: row.objective,
    scope,
    candidates: [actualId, alternativeId],
  });
  console.log(`Scope: ${card.scopeKey}\n`);
  console.log(`Objective:\n  ${card.objective}\n`);
  console.log("Judge each candidate on its own — multiple next actions may be reasonable.\n");
  for (const slot of card.slots) {
    console.log(`Candidate ${slot.slot}:`);
    console.log(`  ${slot.label} [${slot.candidateId}]`);
    if (slot.description) console.log(`  ${slot.description}`);
    if (slot.reasons?.length) console.log(`  closes detected requirement: ${slot.reasons.join(", ")}`);
    console.log(`  ${slot.slot}: appropriate / inappropriate / unclear\n`);
  }
  console.log(`Commit: --label ${card.scopeKey} --a <label> --b <label>`);
}

if (args.list) {
  const pending = disagreements().filter(
    (entry) => !labels.some((record) => record.kind === "disagreement" && record.scopeKey === entry.scopeKey),
  );
  console.log(`${disagreements().length} disagreement(s); ${pending.length} awaiting a label\n`);
  for (const entry of disagreements()) {
    const record = labels.find(
      (candidate) => candidate.kind === "disagreement" && candidate.scopeKey === entry.scopeKey,
    );
    console.log(
      `  ${entry.scopeKey}  actual=${entry.actualId}  alternative=${entry.alternativeId}  ` +
        `${record ? `labelled a=${record.labels.a} b=${record.labels.b}` : "PENDING"}`,
    );
  }
  process.exit(0);
}

if (args.label) {
  const row = rowFor(args.label);
  if (!row) throw new Error(`unknown scopeKey: ${args.label} (is it in ${args.corpus}?)`);
  if (!row.alternative?.ranking?.[0]) throw new Error(`${args.label} has no alternative ordering`);
  const existing = labels.find(
    (record) => record.kind === "disagreement" && record.scopeKey === args.label,
  );
  if (existing && !args.relabel) {
    throw new Error(`${args.label} already labelled (a=${existing.labels.a} b=${existing.labels.b}); pass --relabel to add a new record`);
  }
  if (args.relabel && !existing) {
    console.log("--relabel given but the scope has no earlier label; recording the first one.\n");
  }
  const scope = scopeFor(row);
  const actualId = row.actual.candidateId;
  const alternativeId = row.alternative.ranking[0];
  // Derive A/B exactly as the card does, so a mismatch cannot be committed.
  const card = buildBlindLabellingCard({
    scopeKey: args.label,
    objective: row.objective,
    scope,
    candidates: [actualId, alternativeId],
  });
  const [slotA, slotB] = card.slots.map((slot) => slot.candidateId);
  const record = {
    kind: "disagreement",
    scopeKey: args.label,
    objectiveHash: objectiveHash(row.objective),
    order: [slotA, slotB],
    labels: { a: args.a, b: args.b },
    labelledAt: new Date().toISOString(),
  };
  appendStore(args.store, record);
  console.error(`recorded ${args.label} in ${args.store}\n`);
  console.log("Reveal (labels are already committed):");
  const resolved = resolveDisagreementLabels(row, parseLabelRecord(record));
  console.log(`  actual (model)    ${actualId} -> ${resolved?.actual}`);
  console.log(`  alternative (jev) ${alternativeId} -> ${resolved?.alternative}`);
  process.exit(0);
}

if (args.gap) {
  const row = rowFor(args.gap);
  if (!row) throw new Error(`unknown scopeKey: ${args.gap}`);
  if (row.eligibility?.outcome !== "eligible") {
    throw new Error(
      `${args.gap} has an ineligible outcome track (${row.eligibility?.reason}) — gap closure cannot be judged from it`,
    );
  }
  appendStore(args.store, {
    kind: "gap-closure",
    scopeKey: args.gap,
    detectedRequirements: row.detectedRequirements ?? [],
    gapClosure: args.closure,
    labelledAt: new Date().toISOString(),
  });
  console.error(`recorded gap closure ${args.closure} for ${args.gap} in ${args.store}`);
  process.exit(0);
}

if (args.card) {
  const row = rowFor(args.card);
  if (!row) throw new Error(`unknown scopeKey: ${args.card}`);
  renderCard(row, scopeFor(row));
  process.exit(0);
}

if (args.report) {
  const summary = summarizeCorpus({ rows, labels });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

console.error("nothing to do: pass --list, --card, --label, --gap or --report");
process.exit(1);
