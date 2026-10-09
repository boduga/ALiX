#!/usr/bin/env node
/**
 * tool-selection-sample.mjs — T3 corpus tooling (read-only, offline).
 *
 * Turns recorded `.alix/sessions/<id>/events.jsonl` traces into a tool-selection
 * corpus: one row per frozen scope, with the recorded actual choice, its
 * outcome, and — when asked — an alternative ordering from a selector.
 *
 * It is a DEV script, not product surface: nothing in src/ imports it, it
 * writes only under the path you pass, and it never touches the live loop.
 *
 * T3 comparison policy (recorded in src/planning/decision/AGENTS.md):
 *   baseline   = what the model actually selected (the component that really
 *                influences next-tool choice today)
 *   context    = the scoper's relevance ordering and, per MCP domain, the MCP
 *                selector's own ordering — neither is a "deterministic
 *                selector", and neither is compared across domains
 *   alternative= opt-in, one candidate at a time, scored under the sealed
 *                experiment subject (`--engine jev`)
 *
 * Usage:
 *   node scripts/tool-selection-sample.mjs --session <id> [--session <id>]...
 *   node scripts/tool-selection-sample.mjs --latest 5
 *   node scripts/tool-selection-sample.mjs --latest 5 --engine jev --out /tmp/corpus.json
 *
 * Output: a JSON corpus on stdout (or --out) plus a human summary on stderr.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const SESSIONS = join(ROOT, ".alix", "sessions");

function parseArgs(argv) {
  const out = { sessions: [], latest: 0, engine: "none", out: undefined, overrides: undefined, summary: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--session") out.sessions.push(argv[++i]);
    else if (arg === "--latest") out.latest = Number(argv[++i]);
    else if (arg === "--engine") out.engine = argv[++i];
    else if (arg === "--out") out.out = argv[++i];
    else if (arg === "--overrides") out.overrides = argv[++i];
    else if (arg === "--summary") out.summary = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function latestSessions(count) {
  return readdirSync(SESSIONS)
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(b) - Number(a))
    .slice(0, count);
}

function readEvents(sessionId) {
  const path = join(SESSIONS, sessionId, "events.jsonl");
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function objectiveOf(events) {
  const message = events.find((event) => event.type === "user.message");
  const content = message?.payload?.content ?? message?.payload?.text;
  return typeof content === "string" ? content : "(objective not recorded)";
}

const {
  extractToolSelectionScopes,
  replayToolSelection,
  candidateFor,
} = await import(`${ROOT}/dist/src/planning/decision/tool-selection-replay.js`);
const { evaluateToolSelection, selectionOutcomeFromObservation } = await import(
  `${ROOT}/dist/src/planning/decision/tool-selection-evaluation.js`
);
const { deriveEvaluationEligibility, summarizeCorpus } = await import(
  `${ROOT}/dist/src/planning/decision/tool-selection-corpus.js`
);

async function selectorFor(options, scope, objective, onRanking) {
  if (options.engine === "none") return undefined;
  if (options.engine !== "jev") throw new Error(`unknown engine: ${options.engine}`);
  const { getSavedApiKey } = await import(`${ROOT}/dist/src/interfaces/cli/helpers/api-keys.js`);
  const { createJevToolSelectionScorer } = await import(
    `${ROOT}/dist/src/planning/decision/tool-selection-jev-mapping.js`
  );
  const apiKey = await getSavedApiKey("typesafe");
  if (!apiKey) throw new Error("no typesafe key in the credential store");
  return createJevToolSelectionScorer({
    apiKey,
    scope,
    objective,
    onRanking,
  });
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.error(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}

const sessionIds = args.sessions.length > 0 ? args.sessions : latestSessions(args.latest || 1);
const rows = [];
const selectorRecords = [];

/**
 * Analyst-assigned exclusions, keyed `${sessionId}:${scopeId}`. Defaults to the
 * in-repo record so a corpus regenerated from the same traces gets the same
 * eligibility; pass --overrides for a different set.
 */
const overridesPath = args.overrides ?? join(ROOT, "scripts", "t3-eligibility.json");
if (args.overrides && !existsSync(args.overrides)) {
  throw new Error(`overrides file not found: ${args.overrides}`);
}
const overrides = existsSync(overridesPath) ? JSON.parse(readFileSync(overridesPath, "utf8")) : {};

for (const sessionId of sessionIds) {
  let events;
  try {
    events = readEvents(sessionId);
  } catch (error) {
    console.error(`skip ${sessionId}: ${error.message}`);
    continue;
  }
  const scopes = extractToolSelectionScopes(events);
  for (const scope of scopes) {
    const payloads = events
      .filter((event) => event.type === "tool.selection.observed" && event.payload?.scopeId === scope.scopeId)
      .map((event) => event.payload);
    const actualCandidateId = scope.actualCandidateIds[0];
    const actualPayload = payloads.find((payload) => payload.chosenCandidateId === actualCandidateId) ?? payloads[0];
    const actualOutcome = actualPayload ? selectionOutcomeFromObservation(actualPayload) : undefined;

    const records = [];
    const objective = objectiveOf(events);
    const selector = await selectorFor({ ...args }, scope, objective, (record) => {
      records.push(record);
      selectorRecords.push({ sessionId, ...record });
    });
    const replay = selector
      ? await replayToolSelection(scope, selector, { timeoutMs: 90_000 })
      : undefined;

    const comparison = await evaluateToolSelection({
      scope,
      ...(actualOutcome ? { actualOutcome } : {}),
      ...(replay?.candidateSetPreserved ? { selectorRanking: replay.selectorRanking, selectorId: replay.selectorId } : {}),
    });

    const scopeKey = `${sessionId}:${scope.scopeId}`;
    const eligibility = deriveEvaluationEligibility({
      scope,
      ...(replay ? { replay: { candidateSetPreserved: replay.candidateSetPreserved, ...(replay.invalidReason ? { invalidReason: replay.invalidReason } : {}) } } : {}),
      ...(overrides[scopeKey] ? { override: overrides[scopeKey] } : {}),
    });
    const detectedRequirements = [
      ...new Set(scope.requirementCandidates.flatMap(entry => entry.reasons)),
    ].sort();
    rows.push({
      sessionId,
      scopeId: scope.scopeId,
      iteration: scope.iteration,
      objective,
      eligibility,
      domains: {
        builtin: scope.candidates.filter((candidate) => candidate.domain === "builtin").length,
        mcp: scope.candidates.filter((candidate) => candidate.domain === "mcp").length,
      },
      requirementCandidates: scope.requirementCandidates,
      detectedRequirements,
      offered: scope.offered,
      // Baseline: what the model actually selected.
      actual: {
        candidateId: actualCandidateId ?? null,
        label: candidateFor(scope, actualCandidateId ?? "")?.label ?? null,
        calls: scope.actualCandidateIds,
        outcome: actualOutcome ?? null,
      },
      // Context orderings, never merged: scoper relevance, MCP selector.
      scoperRanking: scope.scoperRanking.map((entry) => entry.candidateId),
      ...(replay ? { alternative: { selectorId: replay.selectorId, ranking: replay.selectorRanking, candidateSetPreserved: replay.candidateSetPreserved, ...(replay.invalidReason ? { invalidReason: replay.invalidReason } : {}) } } : {}),
      ...(records.length > 0
        ? {
            scoring: {
              calls: records.length,
              latencyMs: records.map((record) => record.latencyMs),
              scorerOutcome: replay?.invalidReason ? "failed" : "complete",
              ...(replay
                ? {
                    attemptedCandidates: replay.attemptedCandidates,
                    failedCandidates: replay.failedCandidates,
                  }
                : {}),
            },
          }
        : {}),
      comparison,
    });

    const actualLabel = candidateFor(scope, actualCandidateId ?? "")?.label ?? "(none)";
    console.error(
      `${sessionId} ${scope.scopeId}: offered ${scope.offered.length} ` +
        `(builtin ${rows.at(-1).domains.builtin}/mcp ${rows.at(-1).domains.mcp}) ` +
        `actual ${actualLabel} ` +
        `${actualOutcome ? `${actualOutcome.execution}/${actualOutcome.selection}/${actualOutcome.evidence}` : "no outcome"} ` +
        `scoperTop ${scope.scoperRanking[0]?.candidateId ?? "(none)"}` +
        (replay ? ` jevTop ${replay.selectorRanking[0] ?? "(none)"} set=${replay.candidateSetPreserved}` : "") +
        ` jevCalls ${records.length}` +
        ` eligibility ${eligibility.selection}/${eligibility.outcome}${eligibility.reason ? ` (${eligibility.reason})` : ""}`,
    );
  }
}

const corpus = {
  generatedAt: new Date().toISOString(),
  engine: args.engine,
  sessions: sessionIds,
  scopes: rows.length,
  rows,
  ...(selectorRecords.length > 0 ? { selectorRecords } : {}),
};

const serialized = JSON.stringify(corpus, null, 2);
if (args.out) writeFileSync(args.out, serialized);
else process.stdout.write(`${serialized}\n`);

const summary = summarizeCorpus({ rows, labels: [] });
console.error(
  `\ncorpus: ${summary.scopes} scope(s) from ${sessionIds.length} session(s); ` +
    `selection-eligible ${summary.eligibility.selectionEligible}, ` +
    `outcome-eligible ${summary.eligibility.outcomeEligible}, ` +
    `agreement ${summary.agreement.agree}/${summary.agreement.comparable}, ` +
    `requirement scopes ${summary.requirementContext.scopesWithRequirementCandidates}, ` +
    `jev calls ${summary.scoring.calls}` +
    (Object.keys(summary.eligibility.byReason).length > 0
      ? `, excluded ${JSON.stringify(summary.eligibility.byReason)}`
      : ""),
);
if (args.summary) console.error(`\n${JSON.stringify(summary, null, 2)}`);
