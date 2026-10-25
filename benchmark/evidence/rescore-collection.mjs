/**
 * rescore-collection.mjs — re-derive a retained eval collection against the
 * CURRENT oracle, without making a single model call.
 *
 * WHY THIS EXISTS
 *
 * An independent review found the evaluator admitted false passes
 * (`docs/audits/2026-10-24-gb01-oracle-review.md`). The oracle was corrected. The
 * question that decides whether previously reported figures still stand is: does
 * the corrected oracle reach the same verdict on the evidence already retained?
 *
 * This script answers that from the committed artifacts alone. It is deliberately
 * independent of the collection code path: it reads the case definitions from the
 * build, re-applies their objectives to the retained per-run evidence, and reports
 * every disagreement rather than a summary that could hide one.
 *
 * WHAT IT CAN AND CANNOT CHECK
 *
 *  - `unchanged` / `file` with `contentEquals`: checked EXACTLY, by comparing the
 *    retained after-run sha256 against sha256(expected content). A digest match is
 *    a stronger check than the string containment the old checker used.
 *  - `answerIncludes`: checked with the corrected `answerAsserts`, which rejects a
 *    value found only in a negated or corrected clause.
 *  - `contentIncludes`: NOT re-derivable. The retained workspace manifest stores
 *    digests, not content, so "the file contains X" cannot be re-tested after the
 *    fact. These rows are counted as `notReDerivable` and are never reported as
 *    confirmed by this script.
 *  - Admissibility: re-classified only for runs that retained error text.
 *
 * Usage: node benchmark/evidence/rescore-collection.mjs <collection-dir>
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const collectionDir = process.argv[2];
if (!collectionDir) {
  console.error("usage: rescore-collection.mjs <collection-dir>");
  process.exit(2);
}

const repoRoot = resolve(here, "..", "..");
const { BEHAVIORAL_CASES, SYNTHETIC_CASES } = await import(
  join(repoRoot, "dist", "src", "operations", "evals", "cases", "index.js")
);
const { answerAsserts } = await import(
  join(repoRoot, "dist", "src", "operations", "evals", "evaluators", "objective-evaluator.js")
);
const { classifyInadmissible } = await import(
  join(repoRoot, "dist", "src", "operations", "evals", "eval-admissibility.js")
);

const cases = new Map([...BEHAVIORAL_CASES, ...SYNTHETIC_CASES].map(c => [c.id, c]));

const sha256 = text => createHash("sha256").update(text).digest("hex");

/** The file paths an objective asserts, with what it asserts about them. */
function objectiveFiles(objective) {
  if (objective.kind === "files") {
    return objective.files.map(f => ({ path: f.path, contentEquals: f.contentEquals, contentIncludes: f.contentIncludes }));
  }
  if (objective.kind === "file" || objective.kind === "unchanged" || objective.kind === "patch" || objective.kind === "replacement") {
    return [{
      path: objective.path,
      contentEquals: objective.contentEquals ?? objective.expectedContent,
      contentIncludes: objective.contentIncludes,
      answerIncludes: objective.answerIncludes,
    }];
  }
  return [];
}

const rows = [];
for (const file of readdirSync(collectionDir).filter(n => n.endsWith(".json"))) {
  const collection = JSON.parse(readFileSync(join(collectionDir, file), "utf-8"));
  for (const row of collection.results) {
    rows.push({ file, row });
  }
}

const report = {
  rows: rows.length,
  verifiedRecorded: 0,
  verdictsReDerived: 0,
  verdictChanged: [],
  fileObjectivesChecked: 0,
  fileObjectiveMismatch: [],
  answerAssertionsChecked: 0,
  answerAssertionMismatch: [],
  notReDerivable: [],
  admissibilityChecked: 0,
  admissibilityFlips: [],
  unknownCase: [],
};

for (const { file, row } of rows) {
  if (row.verifiedSuccess) report.verifiedRecorded += 1;

  const evalCase = cases.get(row.caseId);
  if (!evalCase) {
    report.unknownCase.push(`${file}:${row.caseId}`);
    continue;
  }

  const entries = row.evidence?.workspace?.entries ?? {};
  let objectiveHolds = true;
  let anyCheck = false;

  for (const target of objectiveFiles(evalCase.objective)) {
    const digestEntry = entries[target.path];
    if (typeof target.contentEquals === "string") {
      anyCheck = true;
      report.fileObjectivesChecked += 1;
      const want = sha256(target.contentEquals);
      const got = typeof digestEntry === "string" && digestEntry.startsWith("file:")
        ? digestEntry.slice("file:".length)
        : null;
      if (got !== want) {
        objectiveHolds = false;
        report.fileObjectiveMismatch.push(
          `${file}:${row.caseId}:${target.path} recorded=${row.verifiedSuccess} digest=${got ?? "absent"} expected=${want}`
        );
      }
    } else if (target.contentIncludes) {
      // Digest-only evidence cannot settle "contains". Say so instead of guessing.
      report.notReDerivable.push(`${file}:${row.caseId}:${target.path} (contentIncludes)`);
    }

    for (const needle of target.answerIncludes ?? []) {
      anyCheck = true;
      report.answerAssertionsChecked += 1;
      const verdict = answerAsserts(row.evidence?.finalAnswer ?? "", needle);
      if (verdict !== "asserted") {
        objectiveHolds = false;
        report.answerAssertionMismatch.push(
          `${file}:${row.caseId}:${needle} -> ${verdict} (recorded verified=${row.verifiedSuccess})`
        );
      }
    }
  }

  if (anyCheck) {
    report.verdictsReDerived += 1;
    // `verifiedSuccess` is objective AND status-honesty AND guards, held to the
    // SAME conjunction the collector uses (`eval-case-sweep.mjs`). Only the
    // objective axis is re-derived here; the status and guard axes are read from
    // the retained record, because they are not the thing under review.
    const guardsHold = evalCase.guards ? row.guardEvidence?.satisfied === true : true;
    const reDerived = !row.inadmissible && objectiveHolds && guardsHold && row.statusHonest === true;
    if (reDerived !== Boolean(row.verifiedSuccess)) {
      report.verdictChanged.push(
        `${file}:${row.caseId} recorded=${row.verifiedSuccess} re-derived=${reDerived}` +
          ` (objective=${objectiveHolds} guards=${guardsHold} statusHonest=${row.statusHonest})`
      );
    }
  }

  const error = row.evidence?.runtime?.error;
  if (typeof error === "string" && error.trim()) {
    report.admissibilityChecked += 1;
    const now = classifyInadmissible(error);
    if (!now.admissible && !row.inadmissible) {
      report.admissibilityFlips.push(`${file}:${row.caseId} newly ${now.reason}`);
    }
    if (now.admissible && row.inadmissible) {
      report.admissibilityFlips.push(`${file}:${row.caseId} previously excluded, now admissible`);
    }
  }
}

const emit = (label, value) => console.log(`${label.padEnd(34)} ${value}`);
console.log(`collection: ${collectionDir}`);
emit("rows", report.rows);
emit("recorded verified", report.verifiedRecorded);
emit("verdicts re-derived", report.verdictsReDerived);
emit("  verdict changed", report.verdictChanged.length);
emit("exact-content objectives checked", report.fileObjectivesChecked);
emit("  mismatched", report.fileObjectiveMismatch.length);
emit("answer assertions checked", report.answerAssertionsChecked);
emit("  mismatched", report.answerAssertionMismatch.length);
emit("admissibility re-checked", report.admissibilityChecked);
emit("  flips", report.admissibilityFlips.length);
emit("not re-derivable (digest-only)", report.notReDerivable.length);
emit("unknown cases", report.unknownCase.length);

for (const line of [
  ...report.verdictChanged,
  ...report.fileObjectiveMismatch,
  ...report.answerAssertionMismatch,
  ...report.admissibilityFlips,
  ...report.unknownCase,
]) {
  console.log(`  ! ${line}`);
}

const clean =
  report.verdictChanged.length === 0 &&
  report.fileObjectiveMismatch.length === 0 &&
  report.answerAssertionMismatch.length === 0 &&
  report.admissibilityFlips.length === 0 &&
  report.unknownCase.length === 0;

console.log(clean ? "RESULT: every re-derivable verdict is unchanged" : "RESULT: DISAGREEMENT");
process.exit(clean ? 0 : 1);
