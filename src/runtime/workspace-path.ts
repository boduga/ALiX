/**
 * workspace-path.ts — Central file-path safety resolver.
 *
 * All file tools, patch operations, and policy checks should resolve
 * paths through this single resolver instead of duplicating logic.
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolvedPath = {
  absolute: string;
  insideWorkspace: boolean;
  protected: boolean;
  sensitive: boolean;
  reason?: string;
};

function relativeIsInside(rel: string): boolean {
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function isCanonicalPathWithinWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const resolvedRoot = resolve(workspaceRoot);
  if (!existsSync(resolvedRoot)) {
    const rel = relative(resolvedRoot, resolve(targetPath));
    return relativeIsInside(rel);
  }
  const canonicalRoot = realpathSync.native(resolvedRoot);
  let existing = resolve(targetPath);
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return false;
    existing = parent;
  }
  const canonicalExisting = realpathSync.native(existing);
  const rel = relative(canonicalRoot, canonicalExisting);
  return relativeIsInside(rel);
}

// ---------------------------------------------------------------------------
// Sensitive path patterns
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
  /(^|\/)\.ssh($|\/)/,
  /(^|\/)\.gnupg($|\/)/,
  /(^|\/)\..*rc($|\/)/,
  /(^|\/)\.env(\..*)?$/,
  /(^|\/)known_hosts$/,
  /(^|\/)id_rsa/,
  /(^|\/)id_ed25519/,
  /(^|\/)\.alix($|\/)/,
  /(^|\/)\.git($|\/)/,
];

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export class WorkspacePathResolver {
  constructor(
    private readonly workspaceRoot: string,
    private readonly protectedPaths: string[] = [],
  ) {}

  resolve(rawPath: string): string {
    if (isAbsolute(rawPath)) return rawPath;
    if (rawPath.startsWith("~")) return resolve(homedir(), rawPath.replace(/^~/, homedir()));
    return resolve(this.workspaceRoot, rawPath);
  }

  isInWorkspace(absolutePath: string): boolean {
    const rel = relative(resolve(this.workspaceRoot), resolve(absolutePath));
    return relativeIsInside(rel);
  }

  /** Reject lexical escapes and symlink traversal outside the workspace. */
  isCanonicalInWorkspace(absolutePath: string): boolean {
    return isCanonicalPathWithinWorkspace(this.workspaceRoot, absolutePath);
  }

  isProtected(absolutePath: string): boolean {
    const relative = absolutePath.startsWith(this.workspaceRoot)
      ? absolutePath.slice(this.workspaceRoot.length + 1)
      : absolutePath;
    for (const pattern of this.protectedPaths) {
      if (this.matchesPattern(absolutePath, pattern)) return true;
      if (this.matchesPattern(relative, pattern)) return true;
    }
    return false;
  }

  isSensitive(absolutePath: string): boolean {
    return SENSITIVE_PATTERNS.some((re) => re.test(absolutePath));
  }

  check(rawPath: string): ResolvedPath {
    const absolute = this.resolve(rawPath);
    const sensitive = this.isSensitive(absolute);
    const insideWorkspace = this.isInWorkspace(absolute);
    const protected_ = this.isProtected(absolute);

    if (sensitive) {
      return { absolute, insideWorkspace, protected: protected_, sensitive, reason: "Path matches a sensitive system pattern" };
    }
    if (protected_ && insideWorkspace) {
      return { absolute, insideWorkspace, protected: true, sensitive: false, reason: "Path matches a protected pattern" };
    }
    return { absolute, insideWorkspace, protected: false, sensitive: false };
  }

  isTraversalSafe(rawPath: string): boolean {
    if (rawPath.startsWith("..")) return false;
    if (isAbsolute(rawPath)) return this.isInWorkspace(rawPath);
    if (rawPath.includes("../")) return false;
    if (rawPath.startsWith("~")) return false;
    if (rawPath.startsWith("$")) return false;
    return true;
  }

  private matchesPattern(path: string, pattern: string): boolean {
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return path === prefix || path.startsWith(prefix + "/");
    }
    if (pattern.endsWith(".*")) {
      return path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1));
    }
    return path === pattern;
  }
}
