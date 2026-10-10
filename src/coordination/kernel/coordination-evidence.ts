/**
 * coordination-evidence.ts — run-level workspace-mutation evidence.
 *
 * A worker's terminal status says nothing about whether it changed the
 * workspace: a completed worker can write nothing, and a worker that fails
 * after writing a file still wrote it. Run evidence is therefore derived from
 * **explicit mutation records** only:
 *
 * - `file.created` / `file.deleted` / `patch.changed_files` events, which the
 *   file and patch tools emit when they actually write; and
 * - mutation paths a worker explicitly reported.
 *
 * Worker status is deliberately not an input to this module, and neither is
 * `ownershipScopes`: an assigned path is a claim about where a worker *may*
 * write, not evidence that it did. Worker-supplied strings are untrusted —
 * every path is normalized and containment-checked through the workspace path
 * resolver before it can become evidence.
 *
 * Two evidence concepts are kept separate:
 * - `workspaceMutationEvidence` — paths something wrote in the workspace;
 * - `artifactEvidence` — ALiX's own artifact/tool-output files. These prove the
 *   agent produced an artifact, not that the workspace changed, so they do not
 *   populate `changedFiles` (pass `artifactsAssertWorkspaceChange` to treat an
 *   explicitly created/updated artifact as mutation evidence too).
 */

import { relative, resolve, sep } from "node:path";
import { relativeEscapesRoot, WorkspacePathResolver } from "../../runtime-state/runtime/workspace-path.js";

/** Event types that record an actual filesystem write. */
export const MUTATION_EVENT_TYPES = ["file.created", "file.deleted", "patch.changed_files"] as const;

export type CoordinationEvidenceEvent = {
  type: string;
  payload?: {
    path?: unknown;
    paths?: unknown;
    files?: unknown;
    resolvedPath?: unknown;
  };
};

export type WorkerMutationReport = {
  workerId: string;
  /** Paths this worker explicitly reported as changed. */
  changedFiles?: readonly string[];
};

export type CoordinationEvidenceInput = {
  /** Session events (any subset; only mutation/artifact types are read). */
  events?: readonly CoordinationEvidenceEvent[];
  /** Explicit per-worker mutation reports. */
  workerReports?: readonly WorkerMutationReport[];
  /** Treat an artifact explicitly marked created/updated as mutation evidence. */
  artifactsAssertWorkspaceChange?: boolean;
};

export type CoordinationEvidence = {
  /** Explicit workspace mutation paths, normalized, contained, deduped. */
  workspaceMutationEvidence: string[];
  /** ALiX artifact paths (tool-output files), kept separate from mutations. */
  artifactEvidence: string[];
  /** What consumers read as "the run changed these files". */
  changedFiles: string[];
};

export type CoordinationEvidenceOptions = {
  cwd?: string;
  /** Injectable for tests; defaults to a resolver rooted at `cwd`. */
  pathResolver?: Pick<WorkspacePathResolver, "resolve" | "isInWorkspace" | "isCanonicalInWorkspace">;
};

function collectPaths(payload: CoordinationEvidenceEvent["payload"]): string[] {
  if (!payload) return [];
  const out: string[] = [];
  if (typeof payload.path === "string") out.push(payload.path);
  for (const key of ["paths", "files"] as const) {
    const value = payload[key];
    if (Array.isArray(value)) out.push(...value.filter((entry): entry is string => typeof entry === "string"));
  }
  return out;
}

/**
 * Normalize a candidate path to a workspace-relative posix string, or reject
 * it. Rejections are silent by design: evidence is "paths we can prove are
 * workspace mutations", and an unprovable path simply is not evidence.
 */
function normalizeEvidencePath(
  raw: string,
  resolver: Pick<WorkspacePathResolver, "resolve" | "isInWorkspace" | "isCanonicalInWorkspace">,
  workspaceRoot: string,
): string | undefined {
  const candidate = raw.trim();
  if (!candidate) return undefined;
  // Glob/pattern entries describe intended scopes, not written files.
  if (/[*?[\]{}]/.test(candidate)) return undefined;
  let absolute: string;
  try {
    absolute = resolver.resolve(candidate);
  } catch {
    return undefined;
  }
  if (!resolver.isInWorkspace(absolute) || !resolver.isCanonicalInWorkspace(absolute)) return undefined;
  const rel = relative(resolve(workspaceRoot), resolve(absolute));
  if (!rel || rel === "." || relativeEscapesRoot(rel)) return undefined;
  return sep === "/" ? rel : rel.split(sep).join("/");
}

/**
 * Derive run-level changed-file evidence. Deterministic: normalized, contained,
 * deduplicated and sorted, so two runs over the same facts produce the same
 * list and two workers reporting the same path collapse to one entry.
 */
export function deriveCoordinationEvidence(
  input: CoordinationEvidenceInput,
  options: CoordinationEvidenceOptions = {},
): CoordinationEvidence {
  const workspaceRoot = options.cwd ?? process.cwd();
  const resolver = options.pathResolver ?? new WorkspacePathResolver(workspaceRoot);
  const normalize = (raw: string): string | undefined =>
    normalizeEvidencePath(raw, resolver, workspaceRoot);

  const mutations = new Set<string>();
  const artifacts = new Set<string>();

  for (const event of input.events ?? []) {
    if (event.type === "artifact.created") {
      for (const raw of collectPaths(event.payload)) {
        const normalized = normalize(raw);
        if (normalized) artifacts.add(normalized);
      }
      continue;
    }
    if (!(MUTATION_EVENT_TYPES as readonly string[]).includes(event.type)) continue;
    for (const raw of collectPaths(event.payload)) {
      const normalized = normalize(raw);
      if (normalized) mutations.add(normalized);
    }
  }

  for (const report of input.workerReports ?? []) {
    for (const raw of report.changedFiles ?? []) {
      const normalized = normalize(raw);
      if (normalized) mutations.add(normalized);
    }
  }

  const changedFiles = new Set(mutations);
  if (input.artifactsAssertWorkspaceChange) {
    for (const artifact of artifacts) changedFiles.add(artifact);
  }

  return {
    workspaceMutationEvidence: [...mutations].sort(),
    artifactEvidence: [...artifacts].sort(),
    changedFiles: [...changedFiles].sort(),
  };
}

/** Convenience: just the list consumers read as changed files. */
export function deriveCoordinationChangedFiles(
  input: CoordinationEvidenceInput,
  options: CoordinationEvidenceOptions = {},
): string[] {
  return deriveCoordinationEvidence(input, options).changedFiles;
}
