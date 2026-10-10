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

import { resolve, relative, normalize } from "node:path";
import { relativeIsOutside } from "../../runtime-state/runtime/workspace-path.js";
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
 *   src/runtime-state/runtime/         → { root: "/abs/src/runtime", recursive: true }
 *   src/runtime-state/runtime/**       → { root: "/abs/src/runtime", recursive: true }
 *   /absolute/path       → { root: "/absolute/path", recursive: false }
 *   src/runtime-state/runtime/executor.ts → { root: "/abs/src/runtime-state/runtime/executor.ts", recursive: false }
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
  return rel !== "" && !relativeIsOutside(rel);
}

/** Get a display-friendly scope string. */
export function formatScope(scope: PathScope): string {
  return scope.recursive ? `${scope.root}/**` : scope.root;
}

// ─── Owned-write scopes (single authority) ─────────────────────────────

/**
 * True when an owned-path entry is a workspace-wide grant: `.`, or a pattern
 * whose every non-empty segment is `*` or `**`.
 *
 * This is a RULE, not an enumeration. An enumerated list of spellings was
 * incomplete — several multi-star forms fell through to the reject branch, and
 * only a future edit would have added them. Deriving it means a spelling nobody
 * thought of still resolves to the workspace rather than to nothing.
 *
 * The rule must be a strict SUPERSET of any list it replaces. An earlier
 * version split on the separator and demanded every segment be a star, which
 * silently narrowed the grant: the dot-slash spellings (dot-slash-star and
 * dot-slash-globstar-slash-star) were both workspace-wide and began denying.
 * A leading dot-slash and a leading slash are cosmetic, so both are stripped
 * before the segments are examined — treating them as scope is the bug.
 */
function isWorkspaceWideGrant(normalized: string): boolean {
  const trimmed = normalized.trim();
  if (trimmed === "." || trimmed === "./" || trimmed === "/") return true;
  // Strip cosmetic prefixes and suffixes — a leading dot-slash, a leading
  // slash, and any trailing slashes. All of them mean the same workspace-wide
  // grant. Anything left that is not a star segment (a real directory name)
  // makes this an ordinary scoped path instead.
  const bare = trimmed
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");
  return bare.length > 0 && bare.split("/").every(segment => segment === "*" || segment === "**");
}

/**
 * Reduce an owned-path entry to the absolute directory prefix it authorizes,
 * or `undefined` when the entry cannot be reduced safely.
 *
 * Accepts a path, a directory (`docs/`), a recursive scope (`docs/**`), or a
 * workspace-wide grant (see {@link isWorkspaceWideGrant}). Fails closed on `..` traversal and on
 * wildcards it cannot interpret — an uninterpretable grant authorizes nothing
 * rather than everything.
 */
export function resolveOwnedScopePrefix(raw: string, cwd: string): string | undefined {
  const normalized = raw.trim().replace(/\\/g, "/");
  if (normalized.length === 0) return undefined;
  // Fail closed on Windows drive spellings on every platform: on Windows they
  // can name locations outside the workspace, and on POSIX they would otherwise
  // create surprising literal `C:` entries under the workspace.
  if (/^[A-Za-z]:(?:[\/]|$)/.test(normalized)) return undefined;
  // `resolve` normalizes a trailing separator, so a cwd of "/tmp/" cannot
  // silently disable a workspace-wide grant.
  if (isWorkspaceWideGrant(normalized)) return resolve(cwd);

  const stripped = normalized
    .replace(/\/\*\*$/, "")
    .replace(/\*\*\/$/, "")
    .replace(/\/+$/, "");
  if (stripped.length === 0) return resolve(cwd);

  const segments = stripped.split("/").filter(Boolean);
  if (segments.some(segment => segment === "..")) return undefined;
  if (/[*?[\]{}]/.test(stripped)) return undefined;
  const absolute = resolve(cwd, stripped);
  // An owned entry that resolves OUTSIDE the workspace is not an owned scope —
  // the sibling `normalizePathScope` rejects the same case, and silently
  // authorizing `/etc` because a worker wrote it in `ownedPaths` would be a
  // privilege escalation dressed as a convenience.
  const rel = relative(resolve(cwd), absolute);
  if (relativeIsOutside(rel)) return undefined;
  return absolute;
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

// ─── Planning-side claim overlap ───────────────────────────────────────

export type RawOwnershipClaim = { path: string; recursive: boolean };

/**
 * True when two workspace-relative planning claims can both cover some path.
 * The planner's overlap question lives HERE (one matcher module) so planning
 * serialization, lease conflicts, and runtime authorization cannot drift into
 * three disagreeing answers. `path === "."` is the workspace-wide claim.
 * Inputs are workspace-relative strings as captured by the planner; absolute
 * or `..` shapes are rejected at claim-capture time, not here.
 */
export function claimScopesOverlap(a: RawOwnershipClaim, b: RawOwnershipClaim): boolean {
  const contains = (claim: RawOwnershipClaim, path: string): boolean =>
    claim.path === "." || claim.path === path || (claim.recursive && path.startsWith(`${claim.path}/`));
  return contains(a, b.path) || contains(b, a.path);
}
