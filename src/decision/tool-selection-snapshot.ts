/**
 * tool-selection-snapshot.ts — T2-e1: replay a hermetic tool inside an isolated
 * snapshot so a counterfactual produces real evidence without touching the
 * recorded workspace.
 *
 * Isolation rules (enforced here, not documented-only):
 * - Only `hermetic` tools are replayed. Mutating tools would need a snapshot
 *   *and* a mutation policy; external tools would need recorded responses —
 *   both stay `unknown` until T2-e2 supplies fixtures.
 * - Worktree-first: a clean git workspace is snapshotted with `git worktree add`
 *   so the counterfactual sees the same layout and git metadata. A dirty tree
 *   cannot be represented by a worktree (it only contains HEAD), so it falls
 *   back to a copy that includes `.git`.
 * - The snapshot is temporary and removed by `cleanup()`; the runner never
 *   writes to the source root.
 *
 * The tool invocation is supplied by the caller (`execute`). This module owns
 * isolation, provenance and cleanup only — it never imports the tool layer.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { ToolSelectionScope } from "./tool-selection-replay.js";
import type { LocalToolResolver } from "./tool-selection-candidates.js";
import {
  replayabilityOf,
  type CounterfactualReplayRunner,
  type SelectionOutcomeRecord,
} from "./tool-selection-evaluation.js";

const run = promisify(execFile);

export type SnapshotKind = "worktree" | "copy";
export type ReplayEnvironment = "isolated-worktree" | "isolated-copy";

/** Directories omitted from copy snapshots. Recorded in the provenance. */
export const DEFAULT_SNAPSHOT_EXCLUDES = ["node_modules", "dist", ".tmp"];

/**
 * Temp-dir prefix for replay snapshots. Deliberately distinct from
 * `alix-replay-`, which `ReplayExecutor`'s sandbox owns: its tests assert that
 * no `alix-replay-` directory survives an execution, so sharing the prefix
 * would make one subsystem's leftovers look like the other's leak.
 */
export const SNAPSHOT_TEMP_PREFIX = "alix-selection-replay-";

export type ReplaySnapshot = {
  replayId: string;
  kind: SnapshotKind;
  sourceRoot: string;
  /** Isolated workspace root the counterfactual may use. */
  root: string;
  sourceRevision?: string;
  sourceDirty: boolean;
  excluded: string[];
  cleanup(): Promise<void>;
};

async function git(root: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", ["-C", root, ...args]);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Snapshot `sourceRoot` for replay. `strategy: "auto"` uses a worktree when the
 * workspace is a clean git tree, otherwise a copy.
 */
export async function createReplaySnapshot(
  sourceRoot: string,
  options: { strategy?: "auto" | "worktree" | "copy"; excludes?: string[] } = {},
): Promise<ReplaySnapshot> {
  const source = resolve(sourceRoot);
  if (!existsSync(source)) throw new Error(`snapshot source does not exist: ${source}`);
  const strategy = options.strategy ?? "auto";
  const excluded = options.excludes ?? DEFAULT_SNAPSHOT_EXCLUDES;
  const holder = await mkdtemp(join(tmpdir(), SNAPSHOT_TEMP_PREFIX));
  const replayId = `replay_${randomUUID()}`;
  const destination = join(holder, `${basename(source)}-${replayId.slice(-8)}`);

  const cleanupHolder = async (): Promise<void> => {
    await rm(holder, { recursive: true, force: true });
  };

  let insideWorkTree: string | undefined;
  let revision: string | undefined;
  let sourceDirty = false;
  let useWorktree = false;
  try {
    insideWorkTree = await git(source, ["rev-parse", "--is-inside-work-tree"]);
    revision = insideWorkTree === "true" ? await git(source, ["rev-parse", "HEAD"]) : undefined;
    const status = insideWorkTree === "true" ? await git(source, ["status", "--porcelain"]) : undefined;
    // An untracked file counts as dirty: a worktree snapshot contains HEAD only,
    // so it could not represent files the recorded run actually saw.
    sourceDirty = (status ?? "").length > 0;
    useWorktree = strategy === "worktree"
      || (strategy === "auto" && insideWorkTree === "true" && !sourceDirty);
    if (useWorktree && insideWorkTree !== "true") {
      throw new Error(`worktree snapshot requires a git workspace: ${source}`);
    }
    if (useWorktree && sourceDirty && strategy === "worktree") {
      throw new Error("worktree snapshot cannot represent a dirty workspace; use the copy strategy");
    }
  } catch (error) {
    // Never leave an empty holder behind for a refused snapshot.
    await cleanupHolder();
    throw error;
  }

  const cleanupDir = cleanupHolder;

  if (useWorktree) {
    await run("git", ["-C", source, "worktree", "add", "--detach", destination, "HEAD"]);
    return {
      replayId,
      kind: "worktree",
      sourceRoot: source,
      root: destination,
      ...(revision ? { sourceRevision: revision } : {}),
      sourceDirty,
      excluded: [],
      async cleanup() {
        await run("git", ["-C", source, "worktree", "remove", "--force", destination]).catch(() => undefined);
        await run("git", ["-C", source, "worktree", "prune"]).catch(() => undefined);
        await cleanupDir();
      },
    };
  }

  await mkdir(destination, { recursive: true });
  await cp(source, destination, {
    recursive: true,
    force: true,
    filter: (src) => {
      const name = basename(src);
      return !excluded.includes(name);
    },
  });
  return {
    replayId,
    kind: "copy",
    sourceRoot: source,
    root: destination,
    ...(revision ? { sourceRevision: revision } : {}),
    sourceDirty,
    excluded,
    cleanup: cleanupDir,
  };
}

/**
 * Auditable replay record. `network: "disabled"` is enforced by policy — only
 * hermetic tools (no network use) are replayed, so nothing here can reach out.
 */
export type IsolatedReplayResult =
  | {
      replayId: string;
      scopeId: string;
      tool: string;
      basis: "replayed";
      environment: ReplayEnvironment;
      sourceSnapshot: string;
      sourceRevision?: string;
      excluded: string[];
      network: "disabled";
      outcome: SelectionOutcomeRecord;
    }
  | { basis: "unknown"; tool: string; reason: string };

export type IsolatedReplayExecutor = (context: {
  /** Isolated workspace root — never the recorded source root. */
  root: string;
  tool: string;
  scopeId: string;
  snapshot: ReplaySnapshot;
}) => Promise<{ outcome: SelectionOutcomeRecord } | { error: string }>;

/**
 * Replay one hermetic tool against an isolated snapshot. Refuses mutating and
 * external tools before any snapshot work happens; a failed replay is
 * `unknown`, never a fabricated outcome.
 */
export async function replayToolInIsolation(input: {
  scope: ToolSelectionScope;
  tool: string;
  snapshot: ReplaySnapshot;
  execute: IsolatedReplayExecutor;
}): Promise<IsolatedReplayResult> {
  const replayability = replayabilityOf(input.tool);
  if (replayability !== "hermetic") {
    return {
      basis: "unknown",
      tool: input.tool,
      reason: replayability === "mutating"
        ? "mutating tool: requires an isolated snapshot plus a mutation policy"
        : "external tool: replay requires fixtures or recorded responses",
    };
  }
  try {
    const result = await input.execute({
      root: input.snapshot.root,
      tool: input.tool,
      scopeId: input.scope.scopeId,
      snapshot: input.snapshot,
    });
    if ("error" in result) {
      return { basis: "unknown", tool: input.tool, reason: `replay failed: ${result.error}` };
    }
    return {
      replayId: input.snapshot.replayId,
      scopeId: input.scope.scopeId,
      tool: input.tool,
      basis: "replayed",
      environment: input.snapshot.kind === "worktree" ? "isolated-worktree" : "isolated-copy",
      sourceSnapshot: input.snapshot.sourceRoot,
      ...(input.snapshot.sourceRevision ? { sourceRevision: input.snapshot.sourceRevision } : {}),
      excluded: input.snapshot.excluded,
      network: "disabled",
      outcome: result.outcome,
    };
  } catch (error) {
    return {
      basis: "unknown",
      tool: input.tool,
      reason: `replay failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Bind the snapshot runner to the evaluator's counterfactual seam: one fresh
 * snapshot per alternative, cleaned up immediately. Hermetic gating applies
 * twice (here and in `replayToolInIsolation`), so a mutating tool can never be
 * executed against a snapshot by accident.
 */
export function createSnapshotReplayRunner(options: {
  sourceRoot: string;
  execute: IsolatedReplayExecutor;
  strategy?: "auto" | "worktree" | "copy";
  excludes?: string[];
  /**
   * LOCAL ONLY: resolve a frozen candidate id to the tool name the executor
   * understands. Without it the candidate id is used as-is.
   */
  toolFor?: LocalToolResolver;
}): CounterfactualReplayRunner {
  return async ({ scopeId, candidateId }) => {
    const tool = options.toolFor?.(candidateId) ?? candidateId;
    let snapshot: ReplaySnapshot;
    try {
      snapshot = await createReplaySnapshot(options.sourceRoot, {
        ...(options.strategy ? { strategy: options.strategy } : {}),
        ...(options.excludes ? { excludes: options.excludes } : {}),
      });
    } catch (error) {
      return { error: `snapshot failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    try {
      const result = await replayToolInIsolation({
        scope: {
          scopeId,
          iteration: 0,
          candidates: [],
          offered: [candidateId],
          requirementCandidates: [],
          scoperRanking: [],
          actualCandidateIds: [],
        },
        tool,
        snapshot,
        execute: options.execute,
      });
      return result.basis === "replayed"
        ? { outcome: result.outcome, replayId: result.replayId }
        : { error: result.reason };
    } finally {
      await snapshot.cleanup();
    }
  };
}
