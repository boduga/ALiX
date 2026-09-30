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

// ─── Owned-write scopes (single authority) ─────────────────────────────

/**
 * Grants that mean "the whole workspace". Listed exhaustively rather than
 * pattern-matched: a bare `**` reduced to a literal `**` path segment matches
 * nothing, which is how a workspace-wide ownership grant silently stopped
 * working. Both the policy gate and the file router consult this — they are
 * two enforcement points for ONE contract, so they must normalize identically.
 */
const WORKSPACE_WIDE_GRANTS: ReadonlySet<string> = new Set([
  ".", "./", "*", "**", "/*", "/**",
  "./*", "./**", "./**/*", "**/*", "**/**",
]);

/**
 * Reduce an owned-path entry to the absolute directory prefix it authorizes,
 * or `undefined` when the entry cannot be reduced safely.
 *
 * Accepts a path, a directory (`docs/`), a recursive scope (`docs/**`), or any
 * of {@link WORKSPACE_WIDE_GRANTS}. Fails closed on `..` traversal and on
 * wildcards it cannot interpret — an uninterpretable grant authorizes nothing
 * rather than everything.
 */
export function resolveOwnedScopePrefix(raw: string, cwd: string): string | undefined {
  const normalized = raw.trim().replace(/\\/g, "/");
  if (normalized.length === 0) return undefined;
  // `resolve` normalizes a trailing separator, so a cwd of "/tmp/" cannot
  // silently disable a workspace-wide grant.
  if (WORKSPACE_WIDE_GRANTS.has(normalized)) return resolve(cwd);

  const stripped = normalized
    .replace(/\/\*\*$/, "")
    .replace(/\*\*\/$/, "")
    .replace(/\/+$/, "");
  if (stripped.length === 0) return resolve(cwd);

  const segments = stripped.split("/").filter(Boolean);
  if (segments.some(segment => segment === "..")) return undefined;
  if (/[*?[\]{}]/.test(stripped)) return undefined;
  return resolve(cwd, stripped);
}

/**
 * True when `resolvedTarget` sits inside one of the caller's owned scopes.
 * The single ownership matcher: the policy gate and the file router MUST both
 * call this, or one of them will authorize (or deny) something the other
 * disagrees with.
 */
export function isWithinOwnedScope(
  resolvedTarget: string,
  ownedPaths: readonly string[],
  cwd: string,
): boolean {
  return ownedPaths.some(raw => {
    const prefix = resolveOwnedScopePrefix(raw, cwd);
    return prefix !== undefined && isInside(prefix, resolvedTarget);
  });
}
