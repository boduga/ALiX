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
      if (!exists) {
        mismatches.push(`file missing: ${objective.path}`);
      } else if (actualContent === undefined) {
        mismatches.push(`could not read: ${objective.path}`);
      } else if (!actualContent.includes(objective.expectedContent)) {
        mismatches.push(`expected content not present: ${objective.expectedContent}`);
      }
      return {
        landed: mismatches.length === 0,
        evidence: {
          path: objective.path,
          exists,
          changed: true,
          expected: { contentEquals: objective.expectedContent },
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
        if (!report.toLowerCase().includes(needle.toLowerCase())) {
          mismatches.push(`final report does not state: ${needle}`);
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
