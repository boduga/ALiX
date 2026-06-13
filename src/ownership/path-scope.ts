/**
 * path-scope.ts — Deterministic path scope overlap detection.
 *
 * Uses constrained PathScope (root + recursive) instead of heuristic
 * minimatch intersection. Two operations:
 *
 * 1. `pathScopesOverlap(a, b)` — SYMMETRIC. Returns true if there exists
 *    any real path that falls under both scopes.
 *
 * 2. `scopeContains(scope, target)` — DIRECTIONAL. Returns true if the
 *    scope covers the specific target path.
 */

import { resolve, relative, sep, normalize, isAbsolute } from "node:path";
import type { PathScope } from "./ownership-types.js";

/**
 * Check whether two path scopes overlap (SYMMETRIC).
 */
export function pathScopesOverlap(a: PathScope, b: PathScope): boolean {
  if (a.root === b.root) return true;

  // A is recursive and B's root sits inside A
  if (a.recursive && isInside(a.root, b.root)) return true;

  // B is recursive and A's root sits inside B
  if (b.recursive && isInside(b.root, a.root)) return true;

  // Both recursive, one is a prefix of the other
  if (a.recursive && b.recursive) {
    return a.root.startsWith(b.root + sep) || b.root.startsWith(a.root + sep);
  }

  return false;
}

/**
 * Check whether a scope contains a specific target path (DIRECTIONAL).
 */
export function scopeContains(scope: PathScope, targetPath: string): boolean {
  const target = normalize(targetPath);

  if (target === scope.root) return true;
  if (!scope.recursive) return false;

  return isInside(scope.root, target);
}

/**
 * Alias for scopeContains — kept for compatibility.
 */
export function pathInScope(scope: PathScope, targetPath: string): boolean {
  return scopeContains(scope, targetPath);
}

/**
 * Normalize a raw pattern into a PathScope.
 *
 * Accepted patterns (constrained for M0.75):
 *   src/runtime          → { root: "/abs/src/runtime", recursive: false }
 *   src/runtime/         → { root: "/abs/src/runtime", recursive: true }
 *   src/runtime/**       → { root: "/abs/src/runtime", recursive: true }
 *   /absolute/path       → { root: "/absolute/path", recursive: false }
 *   src/runtime/executor.ts → { root: "/abs/src/runtime/executor.ts", recursive: false }
 *
 * Rejected:
 *   src/../              — segment traversal
 *   empty string
 *   /outside/workspace   — absolute paths outside workspace root
 */
export function normalizePathScope(pattern: string, cwd: string, workspaceRoot?: string): PathScope {
  const trimmed = pattern.trim();

  // Reject empty/blank scopes
  if (!trimmed) {
    throw new Error("Path scope must not be empty");
  }

  // Normalize backslashes (platform support)
  const normalized = trimmed.replace(/\\/g, "/");

  // Reject .. path segments (not substring ".." — src/foo..bar is valid)
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some(s => s === "..")) {
    throw new Error(`Path scope must not contain ".." traversal: ${trimmed}`);
  }

  // Reject unsupported wildcards: *, ?, {}, []
  // Allow only /** as a suffix
  const stripped = normalized.replace(/\/\*\*$/, "");
  if (/[*?[\]{}]/.test(stripped)) {
    throw new Error(`Unsupported wildcard pattern: ${trimmed}. Accepted: path, path/, path/**`);
  }

  // Determine if recursive
  const isRecursive = normalized.endsWith("/**") || normalized.endsWith("/");

  // Strip /** suffix to get root directory
  let root = normalized
    .replace(/\/\*\*$/, "")
    .replace(/\/$/, "");

  // Resolve relative paths against cwd
  const absolute = resolve(cwd, root);

  // Reject absolute paths outside workspace
  if (workspaceRoot && !isInside(workspaceRoot, absolute)) {
    throw new Error(`Path scope ${trimmed} resolves outside workspace (${workspaceRoot})`);
  }

  return {
    kind: "path" as const,
    root: absolute,
    recursive: isRecursive,
  };
}

function isInside(parent: string, child: string): boolean {
  // Same path is inside (allows workspace root as scope)
  if (parent === child) return true;
  const rel = relative(parent, child);
  return rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel);
}

/** Get a display-friendly scope string. */
export function formatScope(scope: PathScope): string {
  return scope.recursive ? `${scope.root}/**` : scope.root;
}
