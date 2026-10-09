/**
 * ownership-claim-compiler.ts — Convert glob patterns to portable ownership claims.
 *
 * Conservative conversion: unrepresentable wildcards widen scope to the
 * nearest safe parent directory. This may reduce concurrency but never
 * under-protects the workspace.
 *
 * Known limit: claims are directory/prefix scopes, not patterns. A root-level
 * wildcard therefore conflicts with other root-level claims (and with `**`),
 * but not with a claim on a specific root file it could match
 * (`Dockerfile*` vs `Dockerfile.dev`). Pattern-aware overlap would need the
 * raw pattern persisted on the ownership record.
 *
 * Security: traversal patterns, absolute paths, and empty paths are rejected.
 */

import type { WorkerOwnershipClaim } from "./coordination-types.js";

export type OwnershipClaimCompileResult = {
  claims: WorkerOwnershipClaim[];
  warnings: string[];
};

/**
 * Compile glob patterns into portable WorkerOwnershipClaim objects.
 *
 * Conversion rules:
 *   src/**                → path=src, recursive=true
 *   docs/**               → path=docs, recursive=true
 *   package.json          → path=package.json, recursive=false
 *   README.md             → path=README.md, recursive=false
 *   .github/**            → path=.github, recursive=true
 *   **                    → path=., recursive=true
 *   src/*.ts              → path=src, recursive=true   (literal dir prefix)
 *   Dockerfile*           → path=., recursive=false    (root entries only)
 *   docker-compose*.yml   → path=., recursive=false
 *   unsupported wildcard  → literal dir prefix, "."
 */
export function compileOwnershipClaims(patterns: string[]): OwnershipClaimCompileResult {
  const claims: WorkerOwnershipClaim[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // Security: reject dangerous patterns
    if (!pattern || pattern.length === 0) {
      warnings.push('Empty pattern skipped');
      continue;
    }
    if (pattern.includes('\0')) {
      warnings.push(`Pattern contains NUL character, skipping: ${pattern}`);
      continue;
    }
    if (pattern.startsWith('/')) {
      warnings.push(`Absolute path rejected: ${pattern}`);
      continue;
    }
    if (pattern.startsWith('~')) {
      warnings.push(`Tilde path rejected: ${pattern}`);
      continue;
    }
    if (pattern.startsWith('../') || pattern === '..' || pattern.includes('/../')) {
      warnings.push(`Traversal path rejected: ${pattern}`);
      continue;
    }

    let claim: WorkerOwnershipClaim | null = null;

    // Match against known patterns
    if (pattern === '**') {
      claim = { path: '.', recursive: true, sourcePattern: pattern };
    } else if (pattern.endsWith('/**')) {
      const base = pattern.slice(0, -3);
      claim = { path: base, recursive: true, sourcePattern: pattern };
    } else if (pattern.includes('*') || pattern.includes('?')) {
      // A wildcard can only match inside the directory formed by the literal
      // segments before its first wildcard segment. Claiming that directory
      // recursively is the safe over-approximation. A wildcard with no literal
      // directory ("Dockerfile*", "*.yml") matches root entries only — widening
      // it to a recursive claim on "." would reserve the whole workspace, so it
      // stays non-recursive: it still conflicts with every other root-level
      // claim (and with `**`), and with nothing outside the root.
      const segments = pattern.split('/');
      const wildcardAt = segments.findIndex(segment => segment.includes('*') || segment.includes('?'));
      const literalDir = segments.slice(0, wildcardAt).filter(segment => segment.length > 0).join('/');
      claim = literalDir.length > 0
        ? { path: literalDir, recursive: true, sourcePattern: pattern }
        : { path: '.', recursive: false, sourcePattern: pattern };
      warnings.push(`Wildcard "${pattern}" compiled to path="${claim.path}" recursive=${claim.recursive}`);
    } else {
      // Plain path, no wildcards
      claim = { path: pattern, recursive: false, sourcePattern: pattern };
    }

    if (claim && !seen.has(claim.path + claim.recursive)) {
      claims.push(claim);
      seen.add(claim.path + claim.recursive);
    }
  }

  return { claims, warnings };
}
