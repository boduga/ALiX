/**
 * eval-evidence.ts — retain the raw evidence an evaluator SAW, not only the
 * conclusion it drew, so a third party can re-derive the outcome.
 *
 * WHY THIS EXISTS
 *
 * An independent verification of the 2026-10-24 collection confirmed every
 * `verifiedSuccess` field and every cost, then declined the denominator. Its
 * reason was not that the scoring was wrong — it was that sweep rows store
 * `exists`, `mismatches` and `guardEvidence.satisfied` (conclusions) while the
 * bytes, manifests and runtime records behind them were deleted with the case
 * cwd. A third party could check the evaluator's arithmetic; it could not
 * independently re-score a run.
 *
 * Specifically named as missing: final answers and before/after workspace
 * manifests, both files' contents for a multi-file case, original sentinel bytes,
 * and runtime status/error logs per repetition — without which
 * `inadmissible: false` cannot exclude an infrastructure failure.
 *
 * This module captures exactly those things at the same point `eval-usage` and
 * `eval-execution-metrics` do: before `runEvalCase` deletes the fixture root.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not score, compare, or judge. It records. Sizes are bounded so a
 * pathological workspace cannot exhaust memory, and a bound hit is reported as
 * `truncated` rather than silently returning a partial manifest as complete.
 * A file that cannot be read is recorded as unreadable, never as empty.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { EvalObjective } from "./evals-types.js";

/** Bounds: a captured file and the whole capture, so a large workspace cannot OOM. */
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 2000;

/** One captured file: its path, whether it existed, and its content or hash. */
export type CapturedFile = {
  path: string;
  exists: boolean;
  /** SHA-256 of the bytes, when readable. */
  sha256: string | null;
  /** Exact content for text files within the bound; null when absent/too large. */
  content: string | null;
  bytes: number | null;
  /** Why content is absent, when it is. */
  unreadable?: string;
};

/** A full workspace manifest: relative path → descriptor. */
export type WorkspaceManifest = {
  entries: Record<string, string>;
  /** True when any bound was hit; the manifest is then INCOMPLETE. */
  truncated: boolean;
  reason?: string;
  /**
   * SHA-256 over the sorted `entries` map. A digest lets a reviewer compare the
   * before/after pair without diffing thousands of lines, and makes a manifest
   * substitution detectable.
   */
  digest?: string;
};

/** Everything a third party needs to re-derive this run's outcome. */
export type EvalRunEvidence = {
  /**
   * Contents of the files the objective names. This is the deliverable itself,
   * not a verdict about it.
   */
  objectiveTargets: CapturedFile[];
  /**
   * Hash manifest of the whole workspace BEFORE the run (excluding `.alix`).
   * Captured by the runner from the seeded fixture, before any execution. A
   * single post-run manifest cannot show whether the workspace was preserved —
   * that needs a baseline to compare against.
   */
  workspaceBefore: WorkspaceManifest | null;
  /** Hash manifest of the whole workspace AFTER the run (excluding `.alix`). */
  workspace: WorkspaceManifest;
  /**
   * Evaluator-owned outside sentinel: the bytes as captured BEFORE the run and
   * as found AFTER it. The guard compares the two; retaining both lets a third
   * party redo the comparison instead of trusting the guard's verdict. A
   * post-run snapshot alone cannot establish that the original was preserved.
   */
  outsideSentinel: {
    path: string;
    before: { content: string | null; sha256: string | null };
    after: { content: string | null; sha256: string | null };
  } | null;

  /**
   * The run's final answer, when the driver produced one. A delegate's
   * `findings` were previously dropped, so a deliverable that is an ANSWER
   * rather than a file had no retained text at all.
   */
  finalAnswer: string | null;
  /**
   * The runtime's own account of the run, as observed — not the evaluator's
   * conclusion. Absent for synthetic fixtures, which never execute.
   */
  runtime: {
    status: string | null;
    reason: string | null;
    summary: string | null;
    error: string | null;
    provider: string | null;
    sessionId: string | null;
    runId: string | null;
    /**
     * Serialized session events the driver returned, when it returned any.
     * These are the runtime's own diagnostics — without them
     * `inadmissible: false` cannot be independently confirmed, because the
     * absence of a recorded infrastructure error is not evidence of absence.
     */
    events: string[] | null;
  };
  capturedAt: string;
};

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Paths the objective names, so the deliverable is captured exactly. */
export function objectivePaths(objective: EvalObjective): string[] {
  switch (objective.kind) {
    case "file":
    case "patch":
    case "replacement":
    case "unchanged":
      return [objective.path];
    case "files":
      return objective.files.map(f => f.path);
    default:
      return [];
  }
}

/**
 * Capture one file's bytes, bounded.
 *
 * A file that exists but cannot be read is `unreadable`, never `content: ""` —
 * an empty string would be a claim about the bytes that nobody observed.
 */
function captureFile(cwd: string, path: string, budget: { used: number }): CapturedFile {
  const abs = join(cwd, path);
  if (!existsSync(abs)) {
    return { path, exists: false, sha256: null, content: null, bytes: null };
  }
  try {
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(abs);
      return { path, exists: true, sha256: sha256(target), content: `symlink:${target}`, bytes: null };
    }
    if (!stat.isFile()) {
      return { path, exists: true, sha256: null, content: null, bytes: stat.size, unreadable: "not a regular file" };
    }
    if (stat.size > MAX_FILE_BYTES || budget.used + stat.size > MAX_TOTAL_BYTES) {
      // Too large to retain verbatim; the hash still lets a third party compare.
      return { path, exists: true, sha256: sha256(readFileSync(abs)), content: null, bytes: stat.size, unreadable: "exceeds capture bound" };
    }
    const raw = readFileSync(abs);
    budget.used += stat.size;
    return { path, exists: true, sha256: sha256(raw), content: raw.toString("utf-8"), bytes: stat.size };
  } catch (error) {
    return {
      path,
      exists: true,
      sha256: null,
      content: null,
      bytes: null,
      unreadable: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Hash manifest of the workspace.
 *
 * Symlinks are recorded by target and never followed, matching the guard
 * snapshot's rule: following a link would let the manifest describe a file
 * outside the workspace as if it were inside.
 */
export function captureWorkspaceManifest(cwd: string): WorkspaceManifest {
  const entries: Record<string, string> = Object.create(null);
  let count = 0;
  let truncated = false;
  let reason: string | undefined;

  const walk = (dir: string, prefix: string): void => {
    if (truncated) return;
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch (error) {
      truncated = true;
      reason = `unreadable directory: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    for (const name of names) {
      if (!prefix && name === ".alix") continue;
      if (++count > MAX_ENTRIES) {
        truncated = true;
        reason = "entry limit exceeded";
        return;
      }
      const rel = prefix ? `${prefix}/${name}` : name;
      const full = join(dir, name);
      try {
        const stat = lstatSync(full);
        if (stat.isSymbolicLink()) {
          entries[rel] = `symlink:${readlinkSync(full)}`;
        } else if (stat.isDirectory()) {
          entries[rel] = "directory";
          walk(full, rel);
        } else if (stat.isFile()) {
          entries[rel] = `file:${sha256(readFileSync(full))}`;
        } else {
          entries[rel] = "other";
        }
      } catch (error) {
        truncated = true;
        reason = `unreadable entry ${rel}: ${error instanceof Error ? error.message : String(error)}`;
        return;
      }
    }
  };

  walk(cwd, "");
  // Digest over sorted entries so the before/after pair can be compared with one
  // value and a substitution is detectable.
  const canonical = Object.keys(entries).sort().map(k => `${k}=${entries[k]}`).join("\n");
  return { entries, truncated, ...(reason ? { reason } : {}), digest: sha256(canonical) };
}

/**
 * Read the outside sentinel BEFORE execution.
 *
 * Separate from the main capture because it must run on the seeded fixture,
 * before any tool executes. Returns nulls (not an error) when the sentinel is
 * absent — the guard's own evaluation is what decides whether that is a fault.
 */
export function readSentinelBefore(
  cwd: string,
  hasOutsideSentinel: boolean,
): { content: string | null; sha256: string | null } | null {
  if (!hasOutsideSentinel) return null;
  const sentinelPath = join(cwd, "..", "outside", "report.md");
  try {
    if (!existsSync(sentinelPath)) return { content: null, sha256: null };
    const raw = readFileSync(sentinelPath);
    return { content: raw.toString("utf-8"), sha256: sha256(raw) };
  } catch {
    return { content: null, sha256: null };
  }
}

/**
 * Capture a run's raw evidence.
 *
 * `hasOutsideSentinel` mirrors the case's guard configuration, because the
 * sentinel lives in a sibling directory the case may not have requested; reading
 * it unconditionally would invent a path.
 */
export function captureEvalRunEvidence(
  cwd: string,
  objective: EvalObjective,
  execution: {
    status?: string;
    reason?: string;
    summary?: string;
    error?: string;
    provider?: string;
    sessionId?: string;
    runId?: string;
    events?: string[];
  },
  options: {
    hasOutsideSentinel?: boolean;
    now?: Date;
    /**
     * Workspace manifest captured BEFORE execution. Passed in because it must be
     * taken from the seeded fixture before any tool runs — capturing it here
     * would record the post-run state twice.
     */
    workspaceBefore?: WorkspaceManifest | null;
    /** Sentinel bytes captured BEFORE execution, for the before/after pair. */
    sentinelBefore?: { content: string | null; sha256: string | null } | null;
    /** Final answer text, when the driver produced one (e.g. delegate findings). */
    finalAnswer?: string | null;
  } = {},
): EvalRunEvidence {
  const budget = { used: 0 };
  const fixtureRoot = join(cwd, "..");
  const sentinelPath = join(fixtureRoot, "outside", "report.md");

  let outsideSentinel: EvalRunEvidence["outsideSentinel"] = null;
  if (options.hasOutsideSentinel) {
    const relPath = relative(cwd, sentinelPath).split(sep).join("/");
    let after: { content: string | null; sha256: string | null } = { content: null, sha256: null };
    try {
      if (existsSync(sentinelPath)) {
        const raw = readFileSync(sentinelPath);
        after = { content: raw.toString("utf-8"), sha256: sha256(raw) };
      }
    } catch {
      // Unreadable after the run is a real observation (the guard fails on it);
      // leaving nulls records that rather than inventing bytes.
    }
    outsideSentinel = {
      path: relPath,
      before: options.sentinelBefore ?? { content: null, sha256: null },
      after,
    };
  }

  return {
    objectiveTargets: objectivePaths(objective).map(p => captureFile(cwd, p, budget)),
    workspaceBefore: options.workspaceBefore ?? null,
    workspace: captureWorkspaceManifest(cwd),
    outsideSentinel,
    finalAnswer: options.finalAnswer ?? null,
    runtime: {
      status: execution.status ?? null,
      reason: execution.reason ?? null,
      summary: execution.summary ?? null,
      error: execution.error ?? null,
      provider: execution.provider ?? null,
      sessionId: execution.sessionId ?? null,
      runId: execution.runId ?? null,
      events: execution.events ?? null,
    },
    capturedAt: (options.now ?? new Date()).toISOString(),
  };
}
