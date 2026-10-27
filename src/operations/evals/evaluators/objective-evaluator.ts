/**
 * objective-evaluator.ts — Independently verifies a filesystem objective
 * against the post-run filesystem state of the eval's temporary `cwd`.
 *
 * The filesystem is authoritative. This evaluator must never derive "landed"
 * from model narrative, worker findings, or runtime-reported status.
 *
 * @module
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, sep } from "node:path";
import type { EvalExecutionResult, EvalObjective, ObjectiveOutcome } from "../evals-types.js";

/** Thrown when an objective path escapes (or illegitimately targets) the cwd. */
export class ObjectivePathEscapeError extends Error {
  constructor(path: string) {
    super(`objective path escapes eval cwd: ${path}`);
    this.name = "ObjectivePathEscapeError";
  }
}

/**
 * Resolve an objective path against `cwd` and reject it if it escapes.
 * Absolute paths outside `cwd`, or relative paths traversing above `cwd`,
 * are rejected.
 */
export function resolveObjectivePath(cwd: string, path: string): string {
  const joined = isAbsolute(path) ? path : resolve(cwd, path);
  const cwdResolved = resolve(cwd);
  if (joined !== cwdResolved && !joined.startsWith(cwdResolved + sep)) {
    throw new ObjectivePathEscapeError(path);
  }
  return joined;
}

function contentMatches(actual: string | undefined, expected?: string): string | undefined {
  if (expected === undefined) return undefined;
  if (actual === expected) return undefined;
  return `content mismatch: expected "${expected}"`;
}

function contentIncludesCheck(actual: string | undefined, includes?: string[]): string[] {
  const mismatches: string[] = [];
  for (const needle of includes ?? []) {
    if (actual === undefined || !actual.includes(needle)) {
      mismatches.push(`missing expected content: ${needle}`);
    }
  }
  return mismatches;
}

/**
 * Decide whether a report ASSERTS a value, rather than merely containing it.
 *
 * THE DEFECT THIS FIXES
 *
 * `answerIncludes` was a substring test, so a report reading
 * "x is NOT kestrel-9; x is raven-2" satisfied `answerIncludes: ["kestrel-9"]`.
 * A model could state the exact opposite of the truth and pass, which made the
 * read-only and navigation oracles unsound.
 *
 * The rule: find each occurrence of the needle, take the clause it sits in, and
 * reject the occurrence when the clause negates or corrects it. Anything else is
 * treated as an assertion — an unrecognised phrasing stays accepted, because
 * discarding a genuine answer is the worse error.
 */
/**
 * Negation markers that invert a clause ABOUT THE VALUE.
 *
 * Applied to both sides, and deliberately narrow:
 *
 *  - "x is NOT kestrel-9"                        -> negated (upstream)
 *  - "kestrel-9? No, it is raven-2"              -> negated (downstream)
 *  - "kestrel-9, not raven-2"                    -> ASSERTED: the negation governs
 *                                                   the alternative, not the value
 *  - "lantern-4 (a string, not a number)"        -> ASSERTED: `not` disambiguates
 *                                                   the TYPE
 *
 * A detector that flags any nearby `not` fails honest work, which is its own
 * unsoundness — measured on two real navigation runs.
 */
const NEGATION_BEFORE =
  /\b(?:not|isn't|isnt|aren't|arent|wasn't|wasnt|never|no longer|incorrect|wrong|false|rather than|other than|instead of)\b|n't\b/;

/** Negation that follows the value and denies it by naming a replacement. */
const NEGATION_AFTER =
  /^\s*(?:\?|,)?\s*\b(?:no\b|nope\b|actually\b|rather\b|instead\b)/;

/** Words that make a following `not` a clarification of type or category. */
const BENIGN_AFTER =
  /^[^.;\n]{0,20}?not\s+(?:a|an|the)?\s*(?:number|string|boolean|array|object|file|directory|function|class|constant|error)/;

export function answerAsserts(report: string, needle: string): "asserted" | "negated" | "absent" {
  const haystack = report.toLowerCase();
  const want = needle.toLowerCase();
  let from = 0;
  let sawNegated = false;
  for (;;) {
    const at = haystack.indexOf(want, from);
    if (at < 0) break;
    const { before, after } = clausePanels(haystack, at, want.length);
    from = at + want.length;
    if (NEGATION_BEFORE.test(before)) {
      sawNegated = true;
      continue;
    }
    // A `not` after the value denies it only when it names a replacement. A `not`
    // that clarifies type ("a string, not a number") leaves the value asserted.
    if (!BENIGN_AFTER.test(after) && NEGATION_AFTER.test(after)) {
      sawNegated = true;
      continue;
    }
    return "asserted";
  }
  return sawNegated ? "negated" : "absent";
}

/**
 * Text before and after an occurrence, bounded by sentence breaks and
 * semicolons, so a negation elsewhere in the report cannot contaminate it.
 *
 * The AFTER panel crosses at most one `?` or `!`, because a correction can be
 * phrased as a question ("... kestrel-9? No, it is raven-2"). It does NOT cross a
 * `.` or a newline: "The value is kestrel-9. No files were modified." is two
 * assertions, and the second one says nothing about the value. Crossing it would
 * fail an honest report, which is the failure mode this whole function exists to
 * avoid in the other direction.
 */
function clausePanels(text: string, at: number, length: number): { before: string; after: string } {
  const delimiters = /[.;!?\n]/;
  let start = at;
  while (start > 0 && !delimiters.test(text[start - 1]!)) start--;
  let end = at + length;
  while (end < text.length && !delimiters.test(text[end]!)) end++;

  const terminator = end < text.length ? text[end]! : "";
  let afterEnd = Math.min(end + 1, text.length);
  if (terminator === "?" || terminator === "!") {
    while (afterEnd < text.length && !delimiters.test(text[afterEnd]!)) afterEnd++;
  }
  return { before: text.slice(start, at), after: text.slice(at + length, afterEnd) };
}

/**
 * Evaluate a filesystem objective. Never throws on I/O absence — reports not-landed.
 *
 * `execution` is optional and only consulted by objectives whose deliverable is
 * a REPORT rather than a file. It is never trusted for the filesystem half.
 */
export function evaluateObjective(
  cwd: string,
  objective: EvalObjective,
  execution?: Pick<EvalExecutionResult, "summary">,
): ObjectiveOutcome {
  switch (objective.kind) {
    case "file": {
      const abs = resolveObjectivePath(cwd, objective.path);
      const exists = existsSync(abs);
      let actualContent: string | undefined;
      if (exists && existsSync(abs)) {
        try {
          actualContent = readFileSync(abs, "utf-8");
        } catch {
          actualContent = undefined;
        }
      }
      const mismatches: string[] = [];
      if (exists !== objective.exists) {
        mismatches.push(objective.exists ? `file missing: ${objective.path}` : `file present but expected absent: ${objective.path}`);
      }
      if (objective.contentEquals !== undefined) {
        const err = contentMatches(actualContent, objective.contentEquals);
        if (err) mismatches.push(err);
      }
      mismatches.push(...contentIncludesCheck(actualContent, objective.contentIncludes));
      const landed = mismatches.length === 0;
      return {
        landed,
        evidence: {
          path: objective.path,
          exists,
          expected: {
            contentIncludes: objective.contentIncludes,
            contentEquals: objective.contentEquals,
          },
          actual: actualContent !== undefined ? { content: actualContent } : undefined,
          mismatches,
        },
      };
    }
    case "patch":
    case "replacement": {
      const abs = resolveObjectivePath(cwd, objective.path);
      let actualContent: string | undefined;
      let exists = false;
      if (existsSync(abs)) {
        exists = true;
        try {
          actualContent = readFileSync(abs, "utf-8");
        } catch {
          actualContent = undefined;
        }
      }
      const mismatches: string[] = [];
      const expected = objective.expectedContent;
      if (!exists) {
        mismatches.push(`file missing: ${objective.path}`);
      } else if (actualContent === undefined) {
        mismatches.push(`could not read: ${objective.path}`);
      } else if (actualContent !== expected) {
        // EXACT final content, not "contains".
        //
        // A substring test accepted `const x = 1;` plus `// export const x = 2;`
        // as a repaired file: the fix was present, as a COMMENT, and the bug was
        // still there. The objective is the file's state after the repair, so the
        // comparison is byte-exact.
        mismatches.push(`final content differs from expected (${actualContent.length} vs ${expected.length} bytes)`);
      }
      return {
        landed: mismatches.length === 0,
        evidence: {
          path: objective.path,
          exists,
          // `changed` is DERIVED, never hardcoded: a caller reading it must not be
          // told a file changed when it may not have.
          changed: undefined,
          expected: { contentEquals: expected },
          actual: actualContent !== undefined ? { content: actualContent } : undefined,
          mismatches,
        },
      };
    }
    case "unchanged": {
      const abs = resolveObjectivePath(cwd, objective.path);
      const mismatches: string[] = [];
      const exists = existsSync(abs);
      if (!exists) {
        mismatches.push(`file missing: ${objective.path}`);
      } else {
        const actual = readFileSync(abs, "utf-8");
        const mismatch = contentMatches(actual, objective.contentEquals);
        if (mismatch) mismatches.push(`${objective.path}: ${mismatch}`);
      }
      for (const [path, expected] of Object.entries(objective.unchanged ?? {})) {
        const otherAbs = resolveObjectivePath(cwd, path);
        if (!existsSync(otherAbs)) {
          mismatches.push(`file missing: ${path}`);
          continue;
        }
        const actual = readFileSync(otherAbs, "utf-8");
        const mismatch = contentMatches(actual, expected);
        if (mismatch) mismatches.push(`${path}: ${mismatch}`);
      }
      const report = execution?.summary ?? "";
      for (const needle of objective.answerIncludes ?? []) {
        const verdict = answerAsserts(report, needle);
        if (verdict !== "asserted") {
          mismatches.push(`final report does not state: ${needle}${verdict === "negated" ? " (found only in a negated clause)" : ""}`);
        }
      }
      return {
        landed: mismatches.length === 0,
        evidence: {
          path: objective.path,
          exists,
          changed: false,
          ...(mismatches.length > 0 ? { mismatches } : {}),
        },
      };
    }
    case "files": {
      // Composite: delegate each entry to the SAME single-file evaluation and
      // AND the results. No second scoring engine, no independent truth.
      const outcomes = objective.files.map(entry => ({
        entry,
        outcome: evaluateObjective(cwd, {
          kind: "file",
          path: entry.path,
          exists: entry.exists ?? true,
          ...(entry.contentEquals !== undefined ? { contentEquals: entry.contentEquals } : {}),
          ...(entry.contentIncludes !== undefined ? { contentIncludes: entry.contentIncludes } : {}),
        }),
      }));
      // A single-file outcome reports its own path in evidence, but a composite
      // has several — so every mismatch must name the file it came from or the
      // operator cannot tell which of N files failed.
      const mismatches = outcomes.flatMap(({ entry, outcome }) =>
        (outcome.evidence.mismatches ?? []).map(m => `${entry.path}: ${m}`),
      );
      return {
        landed: outcomes.every(({ outcome }) => outcome.landed),
        evidence: {
          // No single path: the composite covers several.
          path: objective.files.map(f => f.path).join(", "),
          exists: outcomes.every(({ outcome }) => outcome.evidence.exists),
          changed: true,
          mismatches,
        },
      };
    }
  }
}
