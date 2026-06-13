/**
 * mutation-targets.ts — Extract file system mutation targets from tool args.
 *
 * Uses WorkspacePathResolver.check() for proper path resolution and
 * workspace safety validation. Returns classification + targets.
 *
 * Classifications:
 * - "known-write":   targets were successfully identified
 * - "unknown-write": tool is mutates=true but targets cannot be determined (fail closed)
 * - "no-write":      tool does not mutate files (read-only shell commands, etc.)
 */

import type { WorkspacePathResolver } from "../runtime/workspace-path.js";

// Shell commands known to be read-only (no file mutation)
// Only truly read-only commands belong here. Tools that can write
// files (git, npm, npx, node, tsc, etc.) are intentionally excluded
// so they go through ownership enforcement.
const READ_ONLY_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "which",
]);

export type MutationClassification = "known-write" | "unknown-write" | "no-write";

export type MutationTarget = {
  /** The resolved, absolute path */
  path: string;
  /** How this path was found in the args */
  origin: "single" | "source" | "destination" | "header" | "shell" | "glob";
  /** Whether we're confident this is a write target */
  confident: boolean;
};

export type MutationExtraction = {
  classification: MutationClassification;
  targets: MutationTarget[];
};

/**
 * Extract all file mutation targets from tool arguments.
 */
export function extractMutationTargets(
  toolName: string,
  args: Record<string, unknown>,
  resolver: WorkspacePathResolver,
): MutationExtraction {
  const targets: MutationTarget[] = [];

  switch (toolName) {
    case "file.create":
    case "file.delete": {
      const path = asString(args.path);
      if (path) {
        const resolved = resolver.check(path);
        if (resolved.insideWorkspace && !resolved.sensitive && !resolved.protected) {
          targets.push({ path: resolved.absolute, origin: "single", confident: true });
        }
      }
      if (targets.length === 0) return { classification: "unknown-write", targets: [] };
      return { classification: "known-write", targets };
    }

    case "file.rename":
    case "file.copy": {
      const source = asString(args.source);
      const dest = asString(args.destination);
      // Both source and dest are required for rename/copy
      if (!source || !dest) return { classification: "unknown-write", targets: [] };
      const sResolved = resolver.check(source);
      const dResolved = resolver.check(dest);
      if (
        !sResolved.insideWorkspace || sResolved.sensitive || sResolved.protected ||
        !dResolved.insideWorkspace || dResolved.sensitive || dResolved.protected
      ) {
        return { classification: "unknown-write", targets: [] };
      }
      targets.push({ path: sResolved.absolute, origin: "source", confident: true });
      targets.push({ path: dResolved.absolute, origin: "destination", confident: true });
      return { classification: "known-write", targets };
    }

    case "patch.apply": {
      // Real patch tool args: root, format, patchText
      const patchText = asString(args.patchText);
      const root = asString(args.root);
      if (patchText && root) {
        const headerPaths = extractPatchPaths(patchText, resolver, root);
        targets.push(...headerPaths);
      }
      if (targets.length === 0) return { classification: "unknown-write", targets: [] };
      return { classification: "known-write", targets };
    }

    case "shell.run": {
      const command = asString(args.command);
      if (!command) return { classification: "unknown-write", targets: [] };

      // Known read-only commands -> no-write
      const cmdName = command.trim().split(/\s+/)[0] ?? "";
      if (READ_ONLY_COMMANDS.has(cmdName)) {
        return { classification: "no-write", targets: [] };
      }

      // For M0.75: unknown shell commands are unknown-write.
      // Future: integrate full shell command path extraction.
      return { classification: "unknown-write", targets: [] };
    }

    default: {
      // Generic tool: try known path fields
      const path = asString(args.path);
      if (path) {
        const resolved = resolver.check(path);
        if (resolved.insideWorkspace) {
          targets.push({ path: resolved.absolute, origin: "single", confident: false });
        }
      }
      const root = asString(args.root);
      if (root) {
        const resolved = resolver.check(root);
        if (resolved.insideWorkspace) {
          targets.push({ path: resolved.absolute, origin: "glob", confident: false });
        }
      }
      return { classification: targets.length > 0 ? "known-write" : "unknown-write", targets };
    }
  }
}

/** Extract file paths from unified diff patch headers. */
function extractPatchPaths(
  patchText: string,
  resolver: WorkspacePathResolver,
  root: string,
): MutationTarget[] {
  const targets: MutationTarget[] = [];
  // Match unified diff headers: --- a/path  and  +++ b/path
  const headerRe = /^[+-]{3}\s+(?:[ab]\/)?(.+)$/gm;
  const seen = new Set<string>();
  let match;
  while ((match = headerRe.exec(patchText)) !== null) {
    const rawPath = match[1].trim();
    if (!rawPath || seen.has(rawPath)) continue;
    seen.add(rawPath);
    const resolved = resolver.check(rawPath);
    if (resolved.insideWorkspace) {
      targets.push({ path: resolved.absolute, origin: "header", confident: true });
    }
  }
  return targets;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}
