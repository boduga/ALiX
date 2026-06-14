# M0.75 — Ownership Registry Implementation Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent two agents from modifying the same resources without coordination, through a lease-based ownership registry with path-aware conflict detection.

**Architecture:** A lock-protected OwnershipRegistry at `.alix/ownership/ownership.json` stores lease records. Scope is constrained to deterministic path-based ownership (root + recursive flag). Conflict enforcement happens atomically at acquisition time. An OwnershipGate sits between PolicyGate and tool execution, enforcing leases before writes. Agent identity is mandatory in ToolCallRequest for governed writes. Tool effects use the existing `mutates` metadata. Events emit only after durable commit. CLI commands manage leases.

**Tech Stack:** TypeScript, existing `node:fs`, existing `EventLog`, existing `ToolExecutor`, existing `ToolCapability.mutates`, Inspector SSE/RuntimeIndex, `node:fs/promises` for atomic writes + lock file, `node:test`.

---

## File Structure

### Create
- `src/ownership/ownership-types.ts` — `OwnershipScope`, `OwnershipMode`, `OwnershipRecord`, ConflictRule matrix, `ConflictResult`
- `src/ownership/path-scope.ts` — Constrained path scope overlap (root + recursive, no heuristic glob intersection)
- `src/ownership/ownership-registry.ts` — Lock-protected, conflict-enforcing `acquire()`, plus `release()`, `renew()`, `list()`, `listActive()`, `listHistory()`, `prune()`
- `src/ownership/ownership-lock.ts` — Lock file with stale-lock recovery and short timeout
- `src/ownership/mutation-targets.ts` — Central `extractMutationTargets()` for tool args → resolved paths
- `src/ownership/ownership-gate.ts` — Gate between PolicyGate and execution; checks ownership, auto-acquires leases
- `src/cli/commands/ownership.ts` — `alix ownership {list|show|acquire|release|renew|conflicts|prune|history}`
- `tests/ownership/path-scope.test.ts`
- `tests/ownership/ownership-registry.test.ts`
- `tests/ownership/ownership-gate.test.ts`
- `tests/ownership/mutation-targets.test.ts`
- `tests/cli/ownership.test.ts`

### Modify
- `src/tools/types.ts` — add `agentId`, `sessionId` to `ToolCallRequest`
- `src/tools/executor.ts` — inject `ToolCapabilityIndex`, integrate OwnershipGate, fix continuation-resume ordering
- `src/events/types.ts` — add ownership event type constants
- `src/runtime/runtime-index.ts` — add ownership events to SESSION_EVENT_ALLOWLIST
- `src/server/server.ts` — add ownership events to VISIBLE_EVENTS
- `src/cli.ts` — add `alix ownership` command dispatch and help text
- `src/runtime/continuation-store.ts` — add `migrationIssue` field, load legacy records gracefully
- `src/runtime/continuation-manager.ts` — surface migration error on resume, quarantine
- `src/config/alix-config-types.ts` — add `ownership` config namespace
- `src/tools/tool-registry.ts` — expose `ToolCapabilityIndex` type for injection
- All test files that construct `ToolCallRequest` — add `agentId` and `sessionId`

---

## Design Decisions

### 0. Execution Order (Corrected)

```
argument repair
→ request logging
→ PolicyGate, unless continuation-resume
→ OwnershipGate, always
→ workspace/path validation
→ tool execution
```

A continuation bypasses only the repeated policy decision. It must still pass ownership and workspace checks. OwnershipGate runs after PolicyGate, not before — this ensures the policy engine has final say on *whether* a tool should run, and ownership controls *where* it can operate.

### 1. Constrained Path Scopes (not heuristic glob intersection)

Replace heuristic minimatch intersection with a deterministic `PathScope` type and two operations:

```typescript
type PathScope = {
  kind: "path";
  root: string;       // resolved absolute path (directory or file)
  recursive: boolean; // if true, covers all descendants
};
```

**`pathScopesOverlap(a, b)` is symmetric** — it returns true if there exists any path that falls under both scopes. Overlap is a symmetric relation.

**`scopeContains(scope, targetPath)` is directional** — it returns true if the scope covers the specific target path. Used for checks like "does my lease cover this file?"

Rules for overlap (symmetric):
- Same `root` → overlap
- Recursive scope A contains scope B's root → overlap (reverse also true — overlap is symmetric)
- Both recursive, one root is a prefix of the other → overlap
- Otherwise → no overlap

Rules for contains (directional):
- Exact root match → true
- Scope is recursive and target is a child → true
- Otherwise → false

No minimatch intersection. No probe-path heuristics.

### 2. Lock File for Atomicity

`OwnershipRegistry` uses a lock file (`.alix/ownership/ownership.lock`) around load → expire → conflict-check → mutate → atomic save → release. Features:
- Short acquisition timeout (5s default, configurable) — for CLI UX
- Lock metadata: `pid:timestamp` stored in the file
- Stale-lock recovery: lock is stale when owning PID is no longer alive (via `/proc/<pid>` on Linux, `kill -0 <pid>` otherwise), OR lock age exceeds a conservative emergency ceiling (120s)
- Five-second acquisition timeout is acceptable for CLI; the stale threshold should be much longer (120s) to avoid breaking valid locks on slow operations or paused processes.
- Lock is acquired BEFORE load, and released in `finally`:
  ```
  acquire lock
  → reload latest store from disk (inside lock, never before)
  → expire stale active leases
  → detect conflicts
  → mutate records
  → atomic save (write tmp + rename)
  → release lock (in finally)
  ```
- Process-exit handlers attempt best-effort release, but the stale-lock recovery handles crashes.

Long-term, ownership moves into the daemon process as the sole writer.

### 3. Conflict Matrix (Directional, Enforced at acquire())

Existing \ Requested | exclusive-write | shared-read | review-only
---|---|---|---
**exclusive-write** | DENY | ALLOW | ALLOW
**shared-read** | DENY | ALLOW | ALLOW
**review-only** | ALLOW | ALLOW | ALLOW
**(no record)** | ALLOW | ALLOW | ALLOW

Ownership protects mutations without blocking repository inspection.

Exported as a standalone function so registry and gate cannot drift:

```typescript
export function modesConflict(
  existing: OwnershipMode,
  requested: OwnershipMode,
): boolean {
  if (existing === "exclusive-write" && requested === "exclusive-write") return true;
  if (existing === "shared-read" && requested === "exclusive-write") return true;
  return false;
}
```

### 4. Terminal Records Preserved with Separate Timestamps

- `save()` does NOT prune anything
- `prune()` only removes terminal records older than a threshold (default 30 days)
- `listActive()` filters to active + non-expired
- `listHistory()` returns all terminal records
- Each status has its own timestamp field for unambiguous audit:

```typescript
export type OwnershipRecord = {
  id: string;
  agentId: string;
  taskId?: string;
  sessionId?: string;
  scope: OwnershipScope;
  mode: OwnershipMode;
  status: OwnershipStatus;
  acquiredAt: string;   // ISO timestamp
  expiresAt: string;    // ISO timestamp — set at creation/renewal, never cleared
  releasedAt?: string;  // set on release()
  revokedAt?: string;   // set on revoke()
  reason?: string;
};
```

Expiration changes `active` → `expired` in-memory and preserves the record.
Pruning removes only terminal records older than retention.
Active records are never removed by prune.

### 5. Agent Identity (Mandatory for Governed Writes)

```typescript
export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  agentId: string;     // mandatory, no fallback
  sessionId: string;   // mandatory for internal execution requests
  replayId?: string;
  source?: string;
};
```

At external boundaries, validate and reject absent identity for mutating operations. Read-only calls may use known system identities:

- `system` — internal runtime operations
- `cli-user` — interactive CLI commands
- `daemon:<taskId>` — daemon task executions
- `agent:<agentId>` — subagent executions

No `agentId?: string` fallback to `"default-agent"` — ownership is meaningless without real identity.

### 6. Events Emitted After Durable Commit

Correct ordering:
```
mutate records (in-memory)
→ atomic save (write tmp + rename)
→ release lock
→ emit lifecycle event
```

For denied acquisitions, emit the conflict event immediately (no state mutation occurred).

Event-write failure must not undo a successfully committed lease — report the event failure but do not roll back.

### 7. Auto-Acquisition with Explicit Config Switch

```typescript
type OwnershipConfig = {
  enabled: boolean;
  autoAcquire: boolean;   // default: false in multi-agent, true in single-agent
  defaultTtlMs?: number;   // default: 30 minutes
  historyRetentionDays?: number; // default: 30
};
```

Connected to `AlixConfig` under a new `ownership` namespace:

```typescript
// In src/config/alix-config-types.ts or equivalent
export type AlixConfig = {
  ownership?: {
    enabled: boolean;
    autoAcquire: boolean;
    defaultTtlMs?: number;
    historyRetentionDays?: number;
  };
  // ... existing fields
};
```

The `ToolExecutor` receives this as part of `ToolExecutorConfig`:
```typescript
export type ToolExecutorConfig = {
  ownership?: OwnershipConfig;
  // ... existing fields
};
```

- `autoAcquire: true` (single-agent default) — the OwnershipGate automatically acquires a lease for each confident mutation target as the tool runs
- `autoAcquire: false` (parallel-agent default) — agents must explicitly acquire leases via CLI or API; the gate only checks, never auto-acquires

Auto-acquisition is convenient but weakens planned ownership semantics. Every auto-acquire must still go through the atomic conflict-check path.

### 8. Mutation-Target Extraction Fails Closed

For a tool marked `mutates: true`:
- If no targets can be extracted → **deny** the operation
- Shell commands that cannot be analyzed return `classification: "unknown-write"` with empty targets, requiring policy escalation
- Do not silently pass through

### 9. Multi-Target Writes Must Be All-or-Nothing

For rename, patch, or commands touching multiple files:
1. Extract every target
2. Check every target for conflicts
3. If any target fails, reject the entire operation
4. If auto-acquiring, acquire coverage for all targets as one logical transaction
5. Execute only if all targets pass

No partial lease sets — acquiring target A and failing target B must not leave orphan leases unless the API supports rollback.

---

## Task Breakdown

---

### Task 1: Ownership Types, Path Scopes, and Event Constants

**Files:**
- Create: `src/ownership/ownership-types.ts`
- Create: `src/ownership/path-scope.ts`
- Modify: `src/events/types.ts`
- Create: `tests/ownership/path-scope.test.ts`

- [ ] **Step 1: Create ownership-types.ts**

```typescript
/**
 * ownership-types.ts — Types for the lease-based ownership registry.
 *
 * Scope is constrained to deterministic path-based ownership.
 * Graph-node and capability scopes are reserved for future versions.
 */

export type OwnershipMode = "exclusive-write" | "shared-read" | "review-only";
export type OwnershipStatus = "active" | "released" | "expired" | "revoked";

export type PathScope = {
  kind: "path";
  root: string;       // resolved absolute path (directory or file)
  recursive: boolean; // if true, covers all descendants
};

// Future: graph-node, capability scopes reserved but not implemented
export type OwnershipScope = PathScope;

export type OwnershipRecord = {
  id: string;
  agentId: string;
  taskId?: string;
  sessionId?: string;
  scope: OwnershipScope;
  mode: OwnershipMode;
  status: OwnershipStatus;
  acquiredAt: string;   // ISO timestamp
  expiresAt: string;    // ISO timestamp
  expiredAt?: string;   // set when expiration transitions active→expired
  releasedAt?: string;  // set on release()
  revokedAt?: string;   // set on revoke()
  reason?: string;
};

/** Conflict matrix result — denied at acquisition time. */
export type AcquireResult = {
  acquired: boolean;
  record?: OwnershipRecord;
  conflict?: {
    reason: string;
    conflictingRecords: OwnershipRecord[];
  };
};

export type OwnershipStore = {
  version: number;
  revision: number;     // incremented on every durable mutation
  records: OwnershipRecord[];
};

/** Asynchronous event sink for ownership lifecycle events. */
export type OwnershipEventSink = {
  emit(event: string, data: Record<string, unknown>): Promise<void>;
};

/**
 * Conflict matrix: existing vs requested.
 * Only exclusive-write conflicts with another exclusive-write or
 * with a prior shared-read that another agent holds.
 */
export function modesConflict(
  existing: OwnershipMode,
  requested: OwnershipMode,
): boolean {
  if (existing === "exclusive-write" && requested === "exclusive-write") return true;
  if (existing === "shared-read" && requested === "exclusive-write") return true;
  return false;
}
```

- [ ] **Step 2: Create path-scope.ts**

```typescript
/**
 * path-scope.ts — Deterministic path scope overlap detection.
 *
 * Uses constrained PathScope (root + recursive) instead of heuristic
 * minimatch intersection. Overlap rules are simple and sound:
 *
 * 1. Same path → overlap
 * 2. Recursive parent contains non-recursive child → overlap
 * 3. Both recursive, one root is prefix of the other → overlap
 * 4. Otherwise → no overlap
 */

import { resolve, relative, sep, normalize, isAbsolute } from "node:path";
import type { PathScope } from "./ownership-types.js";

/**
 * Check whether two path scopes overlap (SYMMETRIC).
 *
 * Returns true if there exists any real path that falls under both scopes.
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
 * Returns true only if the scope covers the target.
 */
export function scopeContains(scope: PathScope, targetPath: string): boolean {
  const target = normalize(targetPath);

  if (target === scope.root) return true;
  if (!scope.recursive) return false;

  return isInside(scope.root, target);
}

/**
 * Alias for scopeContains — kept for compatibility with registry/gate code.
 */
export function pathInScope(scope: PathScope, targetPath: string): boolean {
  return scopeContains(scope, targetPath);
}

/**
 * Normalize a raw pattern into a PathScope.
 *
 * Normalization rules:
 * - Convert backslashes to forward slashes
 * - Remove redundant "." components
 * - Reject ".." path segments (throws)
 * - Reject absolute paths outside workspace
 * - Remove trailing slash except filesystem root
 *
 * Accepted patterns (constrained for M0.75):
 *   src/runtime          → { root: "/abs/src/runtime", recursive: false }
 *   src/runtime/         → { root: "/abs/src/runtime", recursive: true }
 *   src/runtime/**       → { root: "/abs/src/runtime", recursive: true }
 *   /absolute/path       → { root: "/absolute/path", recursive: false }
 *   src/runtime/executor.ts → { root: "/abs/src/runtime/executor.ts", recursive: false }
 *
 * Rejected:
 *   **/*.ts              — wildcard forms other than /** or trailing /
 *   ../                  — segment traversal
 *   /outside/workspace   — absolute paths outside workspace root
 */
export function normalizePathScope(pattern: string, cwd: string, workspaceRoot?: string): PathScope {
  const trimmed = pattern.trim();

  // Reject empty/blank scopes
  if (!trimmed) {
    throw new Error("Path scope must not be empty");
  }

  // Normalize backslashes (Windows support)
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

  // Reject wildcard forms we don't support
  const hasUnsupportedWildcard =
    /\/\*\*\/\*\.\w+$/.test(trimmed) ||   // **/*.ts
    /^\*\*/.test(trimmed) ||                // **/...
    /\*\*\/\*\*/.test(trimmed);             // **/**
  if (hasUnsupportedWildcard) {
    throw new Error(`Unsupported wildcard pattern: ${trimmed}. Accepted: path, path/, path/**`);
  }

  // Determine if recursive
  const isRecursive = trimmed.endsWith("/**") || trimmed.endsWith("/");

  // Strip /** suffix to get root directory
  let root = trimmed
    .replace(/\/\*\*$/, "")
    .replace(/\/$/, "");

  // Resolve relative paths against cwd
  const absolute = resolve(cwd, root);

  // Reject absolute paths outside workspace
  if (workspaceRoot && !isInside(workspaceRoot, absolute)) {
    throw new Error(`Path scope ${trimmed} resolves outside workspace (${workspaceRoot})`);
  }

  return {
    kind: "path",
    root: absolute,
    recursive: isRecursive,
  };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel);
}

/** Get a display-friendly scope string. */
/**` : scope.root;
}

/** Get a display-friendly scope string. */
export function formatScope(scope: PathScope): string {
  return scope.recursive ? `${scope.root}/**` : scope.root;
}
```

- [ ] **Step 3: Add ownership event types to src/events/types.ts**

Find the event type constants section and add:
```typescript
export const OWNERSHIP_EVENT_TYPES = {
  ACQUIRED: "ownership.acquired",
  RELEASED: "ownership.released",
  RENEWED: "ownership.renewed",
  EXPIRED: "ownership.expired",
  CONFLICT: "ownership.conflict",
  REVOKED: "ownership.revoked",
  DENIED: "ownership.denied",
} as const;
```

- [ ] **Step 4: Write path-scope tests**

Create `tests/ownership/path-scope.test.ts`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pathScopesOverlap, scopeContains, pathInScope, normalizePathScope } from "../../src/ownership/path-scope.js";

describe("pathScopesOverlap (symmetric)", () => {
  const src = { kind: "path" as const, root: "/proj/src", recursive: true };
  const srcRuntime = { kind: "path" as const, root: "/proj/src/runtime", recursive: true };
  const srcExact = { kind: "path" as const, root: "/proj/src/runtime/executor.ts", recursive: false };
  const tests = { kind: "path" as const, root: "/proj/tests", recursive: true };

  it("identical scopes overlap", () => {
    assert.ok(pathScopesOverlap(src, src));
  });

  it("recursive parent and child overlap (both directions)", () => {
    assert.ok(pathScopesOverlap(src, srcRuntime));
    assert.ok(pathScopesOverlap(srcRuntime, src)); // symmetric
  });

  it("recursive scope and exact file overlap", () => {
    assert.ok(pathScopesOverlap(src, srcExact));
    assert.ok(pathScopesOverlap(srcExact, src)); // symmetric
  });

  it("disjoint scopes do not overlap", () => {
    assert.equal(pathScopesOverlap(src, tests), false);
  });

  it("both recursive with shared prefix overlap", () => {
    const a = { kind: "path" as const, root: "/proj/src", recursive: true };
    const b = { kind: "path" as const, root: "/proj/src/runtime", recursive: true };
    assert.ok(pathScopesOverlap(a, b));
    assert.ok(pathScopesOverlap(b, a));
  });

  it("sibling directories under recursive root overlap", () => {
    const root = { kind: "path" as const, root: "/proj/src", recursive: true };
    const a = { kind: "path" as const, root: "/proj/src/runtime", recursive: true };
    const b = { kind: "path" as const, root: "/proj/src/policy", recursive: true };
    assert.ok(pathScopesOverlap(root, a));
    assert.ok(pathScopesOverlap(root, b));
    // siblings neither contains the other
    assert.equal(pathScopesOverlap(a, b), false);
  });
});

describe("scopeContains (directional) and pathInScope", () => {
  const recursive = { kind: "path" as const, root: "/proj/src", recursive: true };
  const exact = { kind: "path" as const, root: "/proj/src/executor.ts", recursive: false };
  const nonRec = { kind: "path" as const, root: "/proj/src/foo", recursive: false };

  it("recursive scope contains descendant", () => {
    assert.ok(scopeContains(recursive, "/proj/src/runtime/executor.ts"));
  });

  it("recursive scope contains direct child", () => {
    assert.ok(scopeContains(recursive, "/proj/src/main.ts"));
  });

  it("recursive scope does not contain outside path", () => {
    assert.equal(scopeContains(recursive, "/proj/tests/main.test.ts"), false);
  });

  it("exact file scope matches that file", () => {
    assert.ok(scopeContains(exact, "/proj/src/executor.ts"));
  });

  it("exact file scope does not match sibling", () => {
    assert.equal(scopeContains(exact, "/proj/src/other.ts"), false);
  });

  it("non-recursive scope does not contain child", () => {
    assert.equal(scopeContains(nonRec, "/proj/src/foo/bar"), false);
  });

  it("pathInScope is an alias", () => {
    assert.equal(pathInScope(recursive, "/proj/src/main.ts"), scopeContains(recursive, "/proj/src/main.ts"));
  });
});

describe("normalizePathScope", () => {
  it("handles ** glob as recursive", () => {
    const s = normalizePathScope("src/runtime/**", "/proj");
    assert.equal(s.root, "/proj/src/runtime");
    assert.equal(s.recursive, true);
  });

  it("handles plain directory as non-recursive", () => {
    const s = normalizePathScope("src/runtime", "/proj");
    assert.equal(s.root, "/proj/src/runtime");
    assert.equal(s.recursive, false);
  });

  it("handles trailing slash as recursive", () => {
    const s = normalizePathScope("src/runtime/", "/proj");
    assert.equal(s.root, "/proj/src/runtime");
    assert.equal(s.recursive, true);
  });

  it("handles exact file path", () => {
    const s = normalizePathScope("src/runtime/executor.ts", "/proj");
    assert.equal(s.root, "/proj/src/runtime/executor.ts");
    assert.equal(s.recursive, false);
  });

  it("rejects .. path segment", () => {
    assert.throws(() => normalizePathScope("../etc/passwd", "/proj"));
  });

  it("allows .. as part of a filename (foo..bar)", () => {
    const s = normalizePathScope("src/foo..bar.ts", "/proj");
    assert.equal(s.root, "/proj/src/foo..bar.ts");
  });

  it("rejects outside workspace", () => {
    assert.throws(() => normalizePathScope("/tmp/foo", "/proj", "/proj"));
  });

  it("rejects unsupported wildcard **/*.ts", () => {
    assert.throws(() => normalizePathScope("src/**/*.ts", "/proj"));
  });

  it("rejects leading **", () => {
    assert.throws(() => normalizePathScope("**/executor.ts", "/proj"));
  });
});
```

- [ ] **Step 5: Compile check**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/ownership/ownership-types.ts src/ownership/path-scope.ts src/events/types.ts tests/ownership/path-scope.test.ts
git commit -m "feat(ownership): add ownership types, deterministic path scopes, and event constants"
```

---

### Task 2: Lock File

**Files:**
- Create: `src/ownership/ownership-lock.ts`

- [ ] **Step 1: Create ownership-lock.ts**

```typescript
/**
 * ownership-lock.ts — File-based lock for OwnershipRegistry atomicity.
 *
 * Prevents concurrent agents from reading stale state and writing conflicting
 * leases. Uses a lock file with stale-lock recovery and short timeout.
 *
 * Long-term: ownership moves into the daemon process as the sole writer.
 */

import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;   // max wait for lock
export const STALE_LOCK_THRESHOLD_MS = 30_000;  // break lock if older than this

export class OwnershipLock {
  private lockPath: string;
  private held = false;

  constructor(cwd: string) {
    this.lockPath = join(cwd, ".alix", "ownership", "ownership.lock");
  }

  /**
   * Acquire the lock. Blocks (polls) up to timeoutMs. Returns true if
   * acquired, false if timed out.
   */
  async acquire(timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    const pid = process.pid.toString();

    while (Date.now() < deadline) {
      if (!existsSync(this.lockPath)) {
        // Lock file doesn't exist — try to create it
        try {
          writeFileSync(this.lockPath, pid, { flag: "wx" });
          this.held = true;
          return true;
        } catch {
          // Race: another process created it between our check and write
          // Fall through to check stale lock
        }
      }

      // Check for stale lock
      if (existsSync(this.lockPath)) {
        const content = readLockContent(this.lockPath);
        if (content !== null) {
          const age = Date.now() - content.timestamp;
          if (age > STALE_LOCK_THRESHOLD_MS) {
            // Stale lock — break it
            try {
              unlinkSync(this.lockPath);
              // Don't log here — ownership lock is low-level; caller handles
            } catch {
              // Another process broke it first
            }
            continue; // retry
          }
        }
      }

      // Wait before retry
      await sleep(100);
    }

    return false; // timeout
  }

  /**
   * Release the lock. Best-effort — process exit also releases via
   * uncaughtException handler.
   */
  release(): void {
    if (!this.held) return;
    try {
      unlinkSync(this.lockPath);
    } catch {
      // Already removed or permission error — ignore
    }
    this.held = false;
  }

  get isHeld(): boolean {
    return this.held;
  }
}

type LockContent = { pid: number; timestamp: number };

function readLockContent(path: string): LockContent | null {
  try {
    const raw = require("node:fs").readFileSync(path, "utf-8").trim();
    const parts = raw.split(":");
    const pid = parseInt(parts[0], 10);
    const timestamp = parts[1] ? parseInt(parts[1], 10) : Date.now();
    return { pid, timestamp };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
```

Wait — the project requires ESM. The lock file should use `import` not `require` in `readLockContent`. Let me fix:

- [ ] **Step 1: Create ownership-lock.ts (corrected for ESM)**

```typescript
/**
 * ownership-lock.ts — File-based lock for OwnershipRegistry atomicity.
 *
 * Prevents concurrent agents from reading stale state and writing conflicting
 * leases. Uses a lock file with stale-lock recovery and short timeout.
 *
 * Long-term: ownership moves into the daemon process as the sole writer.
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

export const DEFAULT_LOCK_TIMEOUT_MS = 5_000;     // max wait for lock (CLI UX)
export const STALE_LOCK_EMERGENCY_CEILING_MS = 120_000; // break if older than this

type LockMetadata = {
  token: string;
  pid: number;
  timestamp: number;
  hostname: string;
};

export class OwnershipLock {
  private lockPath: string;
  private held = false;
  private myToken: string = "";

  constructor(cwd: string) {
    this.lockPath = join(cwd, ".alix", "ownership", "ownership.lock");
  }

  /**
   * Acquire the lock. Blocks (polls) up to timeoutMs.
   * Stale if owning PID is dead OR age > emergency ceiling.
   */
  async acquire(timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS): Promise<boolean> {
    // Ensure directory exists
    mkdirSync(dirname(this.lockPath), { recursive: true });

    const token = randomUUID();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (!existsSync(this.lockPath)) {
        try {
          writeFileSync(this.lockPath, this.serialize(token), { flag: "wx" });
          this.held = true;
          this.myToken = token;
          return true;
        } catch {
          // Race lost
        }
      }

      if (existsSync(this.lockPath)) {
        const meta = this.readMetadata();
        if (meta && this.isStale(meta)) {
          try { unlinkSync(this.lockPath); } catch { /* raced */ }
          continue;
        }
      }

      await this.sleep(200);
    }
    return false;
  }

  /**
   * Release the lock only if OUR token still owns it.
   * Prevents deleting a lock reclaimed by another process.
   */
  release(): void {
    if (!this.held) return;
    try {
      const meta = this.readMetadata();
      if (meta && meta.token === this.myToken) {
        unlinkSync(this.lockPath);
      }
      // If token mismatches, another process reclaimed it — don't touch
    } catch {
      // Already removed
    }
    this.held = false;
    this.myToken = "";
  }

  get isHeld(): boolean {
    return this.held;
  }

  private serialize(token: string): string {
    return `${token}:${process.pid}:${Date.now()}:${hostname()}`;
  }

  private readMetadata(): LockMetadata | null {
    try {
      const raw = readFileSync(this.lockPath, "utf-8").trim();
      const parts = raw.split(":");
      if (parts.length < 4) return null;
      return {
        token: parts[0],
        pid: parseInt(parts[1], 10),
        timestamp: parseInt(parts[2], 10),
        hostname: parts.slice(3).join(":") || "",
      };
    } catch {
      return null;
    }
  }

  private isStale(meta: LockMetadata): boolean {
    // Validate fields before using them
    if (!Number.isFinite(meta.pid) || !Number.isFinite(meta.timestamp)) return true;

    const age = Date.now() - meta.timestamp;

    // Cross-host: if hostname differs, rely on emergency ceiling only
    if (meta.hostname && meta.hostname !== hostname()) {
      return age > STALE_LOCK_EMERGENCY_CEILING_MS;
    }

    if (age > STALE_LOCK_EMERGENCY_CEILING_MS) return true;
    return !this.isPidAlive(meta.pid);
  }

  private isPidAlive(pid: number): boolean {
    try {
      if (existsSync(`/proc/${pid}`)) return true;
      return process.kill(pid, 0);
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }
}
```

- [ ] **Step 2: Build check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/ownership/ownership-lock.ts
git commit -m "feat(ownership): add file lock with stale recovery for OwnershipRegistry atomicity"
```

---

### Task 3: Lock-Protected OwnershipRegistry

**Files:**
- Create: `src/ownership/ownership-registry.ts`
- Create: `tests/ownership/ownership-registry.test.ts`

- [ ] **Step 1: Create ownership-registry.ts**

```typescript
/**
 * ownership-registry.ts — Lock-protected lease-based ownership registry.
 *
 * All public mutation methods acquire the lock internally.
 * Private unlocked helpers (acquireUnlocked, releaseUnlocked, etc.)
 * require the caller to hold the lock (called from withLock).
 *
 * Transaction order:
 *   1. Acquire file lock
 *   2. Reload store from disk (inside lock)
 *   3. Expire stale active leases
 *   4. Detect conflicts / mutate records
 *   5. Atomic save (write tmp + rename) — only if anything changed
 *   6. Release lock
 *   7. Emit lifecycle events (after release — event failure never undoes a lease)
 *
 * Terminal records are preserved — prune() only removes records
 * older than the retention window. Each terminal transition has a
 * distinct timestamp: expiredAt / releasedAt / revokedAt.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  OwnershipRecord, OwnershipScope, OwnershipMode,
  OwnershipStore, AcquireResult, OwnershipEventSink,
} from "./ownership-types.js";
import { modesConflict } from "./ownership-types.js";
import { pathScopesOverlap, scopeContains, normalizePathScope, formatScope } from "./path-scope.js";
import { OwnershipLock } from "./ownership-lock.js";

const STORE_VERSION = 1;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min
const HISTORY_RETENTION_DAYS = 30;

export type OwnershipRegistryOptions = {
  eventSink?: OwnershipEventSink;
  sessionId?: string;
};

export type MutationAuthorization = {
  allowed: boolean;
  reason?: string;
};

export type AcquireRequest = {
  agentId: string;
  scope: OwnershipScope;
  mode: OwnershipMode;
  taskId?: string;
  sessionId?: string;
  ttlMs?: number;
  reason?: string;
};

export type MutationTarget = {
  path: string;
  origin: string;
  confident: boolean;
};

export class OwnershipRegistry {
  private records: OwnershipRecord[] = [];
  private storagePath: string;
  private cwd: string;
  private lock: OwnershipLock;
  private eventSink?: OwnershipEventSink;
  private sessionId?: string;
  private revision = 0;
  private changed = false;
  private pendingEvents: Array<{ event: string; data: Record<string, unknown> }> = [];

  constructor(cwd: string, opts?: OwnershipRegistryOptions) {
    this.cwd = cwd;
    this.storagePath = join(cwd, ".alix", "ownership", "ownership.json");
    this.lock = new OwnershipLock(cwd);
    this.eventSink = opts?.eventSink;
    this.sessionId = opts?.sessionId;
  }

  get currentRevision(): number {
    return this.revision;
  }

  // ═══ Internal load/save (only inside withLock) ═══════════════════

  private reloadFromDisk(): void {
    try {
      const raw = readFileSync(this.storagePath, "utf-8");
      const store = JSON.parse(raw) as OwnershipStore;
      this.records = (store.records ?? []).map(r => ({
        ...r,
        status: (r.status === "active" && this.isExpired(r)) ? ("expired" as const) : r.status,
      }));
      this.revision = store.revision ?? 0;
    } catch {
      this.records = [];
      this.revision = 0;
    }
  }

  private applyExpiration(): void {
    const now = new Date().toISOString();
    for (const r of this.records) {
      if (r.status === "active" && this.isExpired(r)) {
        r.status = "expired";
        r.expiredAt = now;
        this.changed = true;
        this.queueEvent("ownership.expired", { recordId: r.id, agentId: r.agentId });
      }
    }
  }

  private persistIfChanged(): void {
    if (!this.changed) return;
    this.revision++;
    const store: OwnershipStore = { version: STORE_VERSION, revision: this.revision, records: this.records };
    mkdirSync(dirname(this.storagePath), { recursive: true });
    const tmp = this.storagePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(store, null, 2), "utf-8");
    renameSync(tmp, this.storagePath);
  }

  /**
   * Execute fn inside lock. On failure: clear pending events, reload,
   * rethrow. Events emitted after lock release.
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const acquired = await this.lock.acquire();
    if (!acquired) {
      await this.emitEvents([{ event: "ownership.lock_failed", data: { reason: "timeout" } }]);
      return null;
    }
    let events: Array<{ event: string; data: Record<string, unknown> }> = [];
    try {
      this.reloadFromDisk();
      this.applyExpiration();
      this.changed = false;
      const result = await fn();
      this.persistIfChanged();
      events = this.takePendingEvents();
      return result;
    } catch (err) {
      this.pendingEvents = [];
      this.reloadFromDisk();
      throw err;
    } finally {
      this.lock.release();
      await this.emitEvents(events);
    }
  }

  private takePendingEvents(): Array<{ event: string; data: Record<string, unknown> }> {
    const batch = this.pendingEvents;
    this.pendingEvents = [];
    return batch;
  }

  private async emitEvents(
    batch: Array<{ event: string; data: Record<string, unknown> }>,
  ): Promise<void> {
    for (const { event, data } of batch) {
      await this.emitEvent(event, data);
    }
  }

  private markChanged(): void { this.changed = true; }

  // ─── Query (refreshes from disk; no mutation lock) ─────────────

  /** Reload state from disk. For read operations that need fresh data. */
  async refresh(): Promise<void> {
    const acquired = await this.lock.acquire(2000);
    if (!acquired) return;
    try {
      this.reloadFromDisk();
      this.applyExpiration();
    } finally {
      this.lock.release();
    }
  }

  list(): OwnershipRecord[] { return [...this.records]; }

  get(id: string): OwnershipRecord | undefined { return this.records.find(r => r.id === id); }

  /** Fresh query — reloads latest snapshot from disk. */
  async listActive(): Promise<OwnershipRecord[]> {
    await this.refresh();
    return this.records.filter(r => r.status === "active" && !this.isExpired(r));
  }

  /** Fresh query — reloads latest snapshot from disk. */
  async listHistory(): Promise<OwnershipRecord[]> {
    await this.refresh();
    return this.records.filter(r => r.status !== "active" || this.isExpired(r));
  }

  /** Fresh query — returns records matching the pattern. */
  async findConflictsByPattern(pattern: string): Promise<OwnershipRecord[]> {
    await this.refresh();
    const scope = normalizePathScope(pattern, this.cwd);
    return this.records.filter(r =>
      r.status === "active" && !this.isExpired(r) &&
      r.scope.kind === "path" && pathScopesOverlap(r.scope, scope)
    );
  }

  listActive(): OwnershipRecord[] {
    return this.records.filter(r => r.status === "active" && !this.isExpired(r));
  }

  listHistory(): OwnershipRecord[] {
    return this.records.filter(r => r.status !== "active" || this.isExpired(r));
  }

  // ═══ Public API (each internally acquires/releases lock) ═══════

  async acquire(req: AcquireRequest): Promise<AcquireResult> {
    return (await this.withLock(async () => this.acquireUnlocked(req)))
      ?? { acquired: false, conflict: { reason: "Lock timeout", conflictingRecords: [] } };
  }

  async acquireMany(reqs: AcquireRequest[]): Promise<AcquireResult[]> {
    return (await this.withLock(async () => {
      // Check against existing persisted records
      for (const r of reqs) {
        const c = this.findConflicts(r.agentId, r.scope, r.mode);
        if (!c.allowed) return reqs.map(() =>
          ({ acquired: false, conflict: { reason: `Batch conflict: ${c.reason}`, conflictingRecords: c.conflictingRecords } }));
      }
      // Check intra-batch conflicts (same batch, different agents, overlapping scopes)
      for (let i = 0; i < reqs.length; i++) {
        for (let j = i + 1; j < reqs.length; j++) {
          if (reqs[i].agentId !== reqs[j].agentId &&
              this.scopesOverlap(reqs[i].scope, reqs[j].scope) &&
              modesConflict(reqs[i].mode, reqs[j].mode)) {
            return reqs.map(() =>
              ({ acquired: false, conflict: { reason: "Intra-batch conflict", conflictingRecords: [] } }));
          }
        }
      }
      return reqs.map(r => this.acquireUnlocked(r));
    })) ?? reqs.map(() => ({ acquired: false, conflict: { reason: "Lock timeout", conflictingRecords: [] } }));
  }

  async release(id: string): Promise<boolean> {
    return (await this.withLock(async () => this.releaseUnlocked(id))) ?? false;
  }

  async renew(id: string, ttlMs?: number): Promise<boolean> {
    return (await this.withLock(async () => this.renewUnlocked(id, ttlMs))) ?? false;
  }

  async revoke(id: string): Promise<boolean> {
    return (await this.withLock(async () => this.revokeUnlocked(id))) ?? false;
  }

  async prune(opts?: { olderThanDays?: number }): Promise<number> {
    return (await this.withLock(async () => this.pruneUnlocked(opts))) ?? 0;
  }

  /**
   * Authorize a mutation: under lock, reload state, check conflicts,
   * verify or acquire coverage. Single API for OwnershipGate.
   */
  async authorizeMutation(opts: {
    agentId: string;
    targets: MutationTarget[];
    autoAcquire: boolean;
  }): Promise<MutationAuthorization> {
    return (await this.withLock(async () => this.authorizeMutationUnlocked(opts)))
      ?? { allowed: false, reason: "Lock timeout" };
  }

  /** Check whether agent has active exclusive-write coverage for a path. */
  hasCoverageForPath(agentId: string, targetPath: string): boolean {
    return this.listActive().some(r =>
      r.agentId === agentId &&
      r.mode === "exclusive-write" &&
      r.scope.kind === "path" &&
      scopeContains(r.scope, targetPath)
    );
  }

  // ═══ Private unlocked helpers (caller must hold lock) ═══════════

  private acquireUnlocked(req: AcquireRequest): AcquireResult {
    const conflict = this.findConflicts(req.agentId, req.scope, req.mode);
    if (!conflict.allowed) {
      this.queueEvent("ownership.denied", { agentId: req.agentId, scope: req.scope, mode: req.mode, reason: conflict.reason });
      this.queueEvent("ownership.conflict", { agentId: req.agentId, conflicting: conflict.conflictingRecords });
      return { acquired: false, conflict };
    }

    const existing = this.findOwnExact(req.agentId, req.scope, req.mode);
    if (existing) {
      existing.acquiredAt = new Date().toISOString();
      existing.expiresAt = new Date(Date.now() + (req.ttlMs ?? DEFAULT_TTL_MS)).toISOString();
      this.markChanged();
      this.queueEvent("ownership.renewed", { recordId: existing.id, agentId: req.agentId, scope: req.scope, mode: req.mode });
      return { acquired: true, record: existing };
    }

    const now = new Date().toISOString();
    const ttl = req.ttlMs ?? DEFAULT_TTL_MS;
    const record: OwnershipRecord = {
      id: `own_${randomUUID().slice(0, 8)}`,
      agentId: req.agentId,
      taskId: req.taskId,
      sessionId: req.sessionId ?? this.sessionId,
      scope: req.scope,
      mode: req.mode,
      status: "active",
      acquiredAt: now,
      expiresAt: new Date(Date.now() + ttl).toISOString(),
      reason: req.reason,
    };
    this.records.push(record);
    this.markChanged();
    this.queueEvent("ownership.acquired", { recordId: record.id, agentId: req.agentId, scope: req.scope, mode: req.mode, ttl });
    return { acquired: true, record };
  }

  private releaseUnlocked(id: string): boolean {
    const record = this.records.find(r => r.id === id && r.status === "active");
    if (!record) return false;
    record.status = "released";
    record.releasedAt = new Date().toISOString();
    this.markChanged();
    this.queueEvent("ownership.released", { recordId: id, agentId: record.agentId });
    return true;
  }

  private renewUnlocked(id: string, ttlMs?: number): boolean {
    const record = this.records.find(r => r.id === id && r.status === "active" && !this.isExpired(r));
    if (!record) return false;
    record.expiresAt = new Date(Date.now() + (ttlMs ?? DEFAULT_TTL_MS)).toISOString();
    this.markChanged();
    this.queueEvent("ownership.renewed", { recordId: id, agentId: record.agentId });
    return true;
  }

  private revokeUnlocked(id: string): boolean {
    const record = this.records.find(r => r.id === id && r.status === "active");
    if (!record) return false;
    record.status = "revoked";
    record.revokedAt = new Date().toISOString();
    this.markChanged();
    this.queueEvent("ownership.revoked", { recordId: id, agentId: record.agentId });
    return true;
  }

  private pruneUnlocked(opts?: { olderThanDays?: number }): number {
    const cutoff = Date.now() - ((opts?.olderThanDays ?? HISTORY_RETENTION_DAYS) * 24 * 60 * 60 * 1000);
    const before = this.records.length;
    this.records = this.records.filter(r => {
      if (r.status === "active" && !this.isExpired(r)) return true;
      const t = r.expiredAt ?? r.revokedAt ?? r.releasedAt ?? r.expiresAt;
      return new Date(t).getTime() >= cutoff;
    });
    const removed = before - this.records.length;
    if (removed > 0) this.markChanged();
    return removed;
  }

  private authorizeMutationUnlocked(opts: {
    agentId: string;
    targets: MutationTarget[];
    autoAcquire: boolean;
  }): MutationAuthorization {
    const { agentId, targets, autoAcquire } = opts;

    // Phase 1: Check all targets for conflicts
    for (const t of targets) {
      const c = this.findConflictsForPath(agentId, t.path, "exclusive-write");
      if (c) return { allowed: false, reason: `Ownership conflict on ${t.path}: ${c.reason}` };
    }

    // Phase 2: Coverage
    if (!autoAcquire) {
      const uncovered = targets.filter(t => !this.hasCoverageForPath(agentId, t.path));
      if (uncovered.length > 0) {
        return {
          allowed: false,
          reason: `Explicit lease required for: ${uncovered.map(t => t.path).join(", ")}. ` +
            "Run 'alix ownership acquire' first.",
        };
      }
    } else {
      // Auto-acquire mode: every target must be confident
      const unconfident = targets.filter(t => !t.confident);
      if (unconfident.length > 0) {
        return { allowed: false, reason: `Unconfident targets cannot be auto-acquired: ${unconfident.map(t => t.path).join(", ")}` };
      }
      for (const t of targets) {
        if (!this.hasCoverageForPath(agentId, t.path)) {
          this.acquireUnlocked({
            agentId,
            scope: { kind: "path", root: t.path, recursive: false },
            mode: "exclusive-write",
            reason: "auto-acquired by gate",
            ttlMs: 5 * 60 * 1000,
          });
        }
      }
    }
    return { allowed: true };
  }

  // ─── Conflict detection ────────────────────────────────────────────

  private findConflicts(
    agentId: string, scope: OwnershipScope, requestedMode: OwnershipMode,
  ): { allowed: boolean; reason: string; conflictingRecords: OwnershipRecord[] } {
    const conflicting: OwnershipRecord[] = [];
    for (const r of this.listActive()) {
      if (r.agentId === agentId) continue;
      if (!this.scopesOverlap(r.scope, scope)) continue;
      if (modesConflict(r.mode, requestedMode)) conflicting.push(r);
    }
    if (conflicting.length > 0) {
      return {
        allowed: false,
        reason: `Conflicts: ${conflicting.map(c => `${c.agentId} (${c.mode} on ${formatScope(c.scope)})`).join(", ")}`,
        conflictingRecords: conflicting,
      };
    }
    return { allowed: true, reason: "No conflicts", conflictingRecords: [] };
  }

  private findConflictsForPath(
    agentId: string, targetPath: string, requestedMode: OwnershipMode,
  ): AcquireResult["conflict"] {
    const conflicting: OwnershipRecord[] = [];
    for (const r of this.listActive()) {
      if (r.agentId === agentId) continue;
      if (r.scope.kind !== "path") continue;
      if (!scopeContains(r.scope, targetPath)) continue;
      if (modesConflict(r.mode, requestedMode)) conflicting.push(r);
    }
    if (conflicting.length > 0) {
      return { reason: `Conflicts: ${conflicting.map(c => `${c.agentId} (${c.mode})`).join(", ")}`, conflictingRecords: conflicting };
    }
    return undefined;
  }

  findConflictsByPattern(pattern: string): OwnershipRecord[] {
    const scope = normalizePathScope(pattern, this.cwd);
    return this.listActive().filter(r =>
      r.scope.kind === "path" && pathScopesOverlap(r.scope, scope)
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private isExpired(r: OwnershipRecord): boolean {
    return r.status === "active" && Date.now() > new Date(r.expiresAt).getTime();
  }

  private scopesEqual(a: OwnershipScope, b: OwnershipScope): boolean {
    return a.kind === b.kind && a.root === b.root && (a as any).recursive === (b as any).recursive;
  }

  private scopesOverlap(a: OwnershipScope, b: OwnershipScope): boolean {
    if (a.kind !== "path" || b.kind !== "path") return false;
    return pathScopesOverlap(a, b);
  }

  private findOwnExact(agentId: string, scope: OwnershipScope, mode: OwnershipMode): OwnershipRecord | undefined {
    return this.listActive().find(r =>
      r.agentId === agentId && this.scopesEqual(r.scope, scope) && r.mode === mode
    );
  }

  // ─── Events (emitted after lock release) ───────────────────────

  private queueEvent(event: string, data: Record<string, unknown>): void {
    this.pendingEvents.push({ event, data });
  }



  private async emitEvent(event: string, data: Record<string, unknown>): Promise<void> {
    if (!this.eventSink) return;
    try {
      await this.eventSink.emit(event, {
        ...data,
        revision: this.revision,
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
      });
    } catch (error) {
      console.error("Ownership event emission failed:", event, error);
    }
  }
}
```

- [ ] **Step 2: Write the test file**

Create `tests/ownership/ownership-registry.test.ts`:
```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EventEmitter } from "node:events";

describe("OwnershipRegistry", () => {
  let dir: string;
  let reg: any;
  let events: string[];

  async function createRegistry() {
    const { OwnershipRegistry } = await import("../../src/ownership/ownership-registry.js");
    const emitter = { emit: async (event: string, data: any) => { events.push(event); } };
    reg = new OwnershipRegistry(dir, { eventSink: emitter, sessionId: "test-session" });
    await reg.refresh();
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "own-test-"));
    mkdirSync(join(dir, ".alix", "ownership"), { recursive: true });
    events = [];
    await createRegistry();
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("acquire creates a new record", () => {
    const result = await reg.acquire({agentId: "agent-1", scope:, { kind: "path", root: join(dir, "src/runtime"), recursive: true }, "exclusive-write");
    assert.equal(result.acquired, true);
    assert.ok(result.record!.id);
    assert.equal(result.record!.agentId, "agent-1");
    assert.equal(result.record!.status, "active");
  });

  it("acquire with same scope+mode returns existing (renew)", () => {
    const scope = { kind: "path" as const, root: join(dir, "src/runtime"), recursive: true };
    const r1 = await reg.acquire({ agentId: "agent-1", scope:, scope,  mode: "exclusive-write" });
    const r2 = await reg.acquire({ agentId: "agent-1", scope:, scope,  mode: "exclusive-write" });
    assert.equal(r1.record!.id, r2.record!.id);
  });

  it("conflicting acquisition is rejected", () => {
    const scope = { kind: "path" as const, root: join(dir, "src"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope:, scope,  mode: "exclusive-write" });
    const result = await reg.acquire({ agentId: "agent-2", scope:, scope,  mode: "exclusive-write" });
    assert.equal(result.acquired, false);
    assert.ok(result.conflict);
    assert.ok(result.conflict.reason.includes("agent-1"));
  });

  it("shared-read does not conflict with exclusive-write", () => {
    const scope = { kind: "path" as const, root: join(dir, "src"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope:, scope,  mode: "exclusive-write" });
    const result = await reg.acquire({ agentId: "agent-2", scope:, scope,  mode: "shared-read" });
    assert.equal(result.acquired, true); // matrix: exclusive-write → shared-read = ALLOW
  });

  it("exclusive-write conflicts with existing shared-read", () => {
    const scope = { kind: "path" as const, root: join(dir, "src"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope:, scope,  mode: "shared-read" });
    const result = await reg.acquire({ agentId: "agent-2", scope:, scope,  mode: "exclusive-write" });
    assert.equal(result.acquired, false); // matrix: shared-read → exclusive-write = DENY
  });

  it("review-only never conflicts", () => {
    const scope = { kind: "path" as const, root: join(dir, "src"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope:, scope,  mode: "exclusive-write" });
    const result = await reg.acquire({ agentId: "agent-2", scope:, scope,  mode: "review-only" });
    assert.equal(result.acquired, true); // matrix: exclusive-write → review-only = ALLOW
  });

  it("same agent re-access is allowed", () => {
    const scope = { kind: "path" as const, root: join(dir, "src/runtime"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope:, scope,  mode: "exclusive-write" });
    const result = await reg.acquire({agentId: "agent-1", scope:, { kind: "path", root: join(dir, "src"), recursive: true }, "exclusive-write");
    assert.equal(result.acquired, true);
  });

  it("release marks as released", () => {
    const result = await reg.acquire({agentId: "agent-1", scope:, { kind: "path", root: join(dir, "src"), recursive: true }, "exclusive-write");
    assert.ok(await reg.release(result.record!.id));
    assert.equal(reg.get(result.record!.id)?.status, "released");
  });

  it("release unknown id returns false", () => {
    assert.equal(await reg.release("nonexistent"), false);
  });

  it("terminal records are preserved in history", () => {
    const r = await reg.acquire({agentId: "agent-1", scope:, { kind: "path", root: join(dir, "x"), recursive: true }, "exclusive-write");
    await reg.release(r.record!.id);
    assert.equal(reg.listHistory().length, 1);
    assert.equal(reg.listActive().length, 0);
  });

  it("save and reload persists records", async () => {
    const r = await reg.acquire({agentId: "agent-1", scope:, { kind: "path", root: join(dir, "src"), recursive: true }, "exclusive-write", { reason: "test persistence" });
    // Public API persists automatically
    // Re-create and refresh to verify persistence
    await createRegistry(); // creates new instance, loads from file
    assert.equal(reg.list().length, 1);
    assert.equal(reg.list()[0].reason, "test persistence");
  });

  it("renew extends TTL", () => {
    const r = await reg.acquire({agentId: "agent-1", scope:, { kind: "path", root: join(dir, "src"), recursive: true }, "exclusive-write", { ttlMs: 60000 });
    const originalExpiry = r.record!.expiresAt;
    await reg.renew(r.record!.id, 3600000);
    assert.ok(new Date(r.record!.expiresAt).getTime() > new Date(originalExpiry).getTime());
  });

  it("events are emitted on acquire", () => {
    await reg.acquire({agentId: "agent-1", scope:, { kind: "path", root: join(dir, "src"), recursive: true }, "exclusive-write");
    assert.ok(events.includes("ownership.acquired"));
  });

  it("events are emitted on denied", () => {
    await reg.acquire({agentId: "agent-1", scope:, { kind: "path", root: join(dir, "src"), recursive: true }, "exclusive-write");
    await reg.acquire({ agentId: "agent-2", scope: { kind: "path", root: join(dir, "src"), recursive: true }, mode: "exclusive-write" });
    assert.ok(events.includes("ownership.denied"));
  });

  it("prune removes only old terminal records", () => {
    const r1 = await reg.acquire({agentId: "agent-1", scope:, { kind: "path", root: join(dir, "x"), recursive: true }, "exclusive-write");
    const r2 = await reg.acquire({agentId: "agent-2", scope:, { kind: "path", root: join(dir, "y"), recursive: true }, "exclusive-write");
    await reg.release(r1.record!.id);
    // Manually age the released record
    const released = reg.get(r1.record!.id);
    if (released && released.releasedAt) {
      released.releasedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    }
    const count = reg.prune({ olderThanDays: 30 });
    assert.equal(count, 1); // only the old released record
    assert.equal(reg.list().length, 1); // active record remains
    assert.equal(reg.list()[0].id, r2.record!.id);
  });
});
```

- [ ] **Step 3: Build and test**

```bash
npm run build && node --test dist/tests/ownership/ownership-registry.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/ownership/ownership-registry.ts tests/ownership/ownership-registry.test.ts
git commit -m "feat(ownership): add lock-protected OwnershipRegistry with conflict-enforcing acquire and event emission"
```

---

### Task 4: MutationTarget Extractor

**Files:**
- Create: `src/ownership/mutation-targets.ts`
- Create: `tests/ownership/mutation-targets.test.ts`

- [ ] **Step 1: Create mutation-targets.ts**

```typescript
/**
 * mutation-targets.ts — Extract file system mutation targets from tool args.
 *
 * Central extractor that handles all tool argument shapes:
 * - Single path: file.create, file.delete, file.read (write tools)
 * - Source + dest: file.rename, file.copy
 * - Patch: patch.apply (extract from headers or explicit target)
 * - Shell: analyze command for file paths (uses existing shell analysis)
 * - Multiple paths: batch operations
 *
 * All paths are resolved and normalized through WorkspacePathResolver.
 */

import type { WorkspacePathResolver, ResolvedPath } from "../runtime/workspace-path.js";

// Shell commands known to be read-only (no file mutation)
const READ_ONLY_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd",
  "git", "npm", "npx", "node", "tsc", "yarn",
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
 * Returns empty array if no file paths are found (read-only tool, no file args, etc.)
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
        if (resolved.insideWorkspace && !resolved.sensitive) {
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
      if (!sResolved.insideWorkspace || sResolved.sensitive || sResolved.protected ||
          !dResolved.insideWorkspace || dResolved.sensitive || dResolved.protected) {
        return { classification: "unknown-write", targets: [] };
      }
      targets.push({ path: sResolved.absolute, origin: "source", confident: true });
      targets.push({ path: dResolved.absolute, origin: "destination", confident: true });
      return { classification: "known-write", targets };
    }

    case "patch.apply": {
      // Real patch tool args: root, format, patchText
      // For M0.75: parse patch headers from patchText to extract target files
      const patchText = asString(args.patchText);
      const root = asString(args.root);
      if (patchText && root) {
        // Extract file paths from unified diff headers (--- a/... +++ b/...)
        const headerPaths = extractPatchPaths(patchText, resolver, root);
        targets.push(...headerPaths);
        // Also include root as a coverage anchor
        const rResolved = resolver.check(root);
        if (rResolved.insideWorkspace) {
          targets.push({ path: rResolved.absolute, origin: "glob", confident: false });
        }
      }
      if (targets.length === 0) return { classification: "unknown-write", targets: [] };
      return { classification: "known-write", targets };
    }

    case "shell.run": {
      // Use existing shell command analysis to distinguish read-only
      // from mutating commands. The ShellWhitelist and capability inference
      // already classify commands; inject a ShellCommandClassifier.
      const command = asString(args.command);
      if (!command) return { classification: "unknown-write", targets: [] };

      // Known read-only commands -> no-write
      if (READ_ONLY_COMMANDS.has(command.trim().split(/\s+/)[0] ?? "")) {
        return { classification: "no-write", targets: [] };
      }

      // For M0.75: unknown shell commands are unknown-write.
      // Future: integrate full shell command path extraction.
      return { classification: "unknown-write", targets: [] };
    }

    default: {
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

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/** Extract file paths from unified diff patch headers. */
function extractPatchPaths(
  patchText: string,
  resolver: WorkspacePathResolver,
  root: string,
): MutationTarget[] {
  const targets: MutationTarget[] = [];
  // Match unified diff headers: --- a/path  and  +++ b/path
  const headerRe = /^[+-]{3}\s+(?:[ab]/)?(.+)$/gm;
  const seen = new Set<string>();
  let match;
  while ((match = headerRe.exec(patchText)) !== null) {
    const rawPath = match[1].trim();
    if (!rawPath || seen.has(rawPath)) continue;
    seen.add(rawPath);
    // Resolve relative to the patch root
    const resolved = resolver.resolve(rawPath);
    if (resolved.insideWorkspace) {
      targets.push({ path: resolved.absolute, origin: "header", confident: true });
    }
  }
  return targets;
}
```

- [ ] **Step 2: Write tests**

Create `tests/ownership/mutation-targets.test.ts`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("extractMutationTargets", () => {
  let resolver: any;

  before(async () => {
    const mod = await import("../../src/runtime/workspace-path.js");
    resolver = new mod.WorkspacePathResolver("/workspace", []);
  });

  it("extracts single path from file.create", async () => {
    const { extractMutationTargets } = await import("../../src/ownership/mutation-targets.js");
    const result = extractMutationTargets("file.create", { path: "src/main.ts" }, resolver);
    assert.equal(result.classification, "known-write");
    assert.equal(result.targets.length, 1);
    assert.equal(result.targets[0].path, "/workspace/src/main.ts");
    assert.equal(result.targets[0].origin, "single");
    assert.equal(result.targets[0].confident, true);
  });

  it("extracts source and destination from file.rename", async () => {
    const { extractMutationTargets } = await import("../../src/ownership/mutation-targets.js");
    const result = extractMutationTargets("file.rename", { source: "old.ts", destination: "new.ts" }, resolver);
    assert.equal(result.classification, "known-write");
    assert.equal(result.targets.length, 2);
    assert.equal(result.targets[0].path, "/workspace/old.ts");
    assert.equal(result.targets[1].path, "/workspace/new.ts");
  });

  it("returns unknown-write for unrecognized tool with no path args", async () => {
    const { extractMutationTargets } = await import("../../src/ownership/mutation-targets.js");
    const result = extractMutationTargets("web_search", { query: "hello" }, resolver);
    assert.equal(result.classification, "unknown-write");
    assert.equal(result.targets.length, 0);
  });

  it("returns unknown-write for shell.run", async () => {
    const { extractMutationTargets } = await import("../../src/ownership/mutation-targets.js");
    const result = extractMutationTargets("shell.run", { command: "npm test" }, resolver);
    assert.equal(result.classification, "unknown-write");
    assert.equal(result.targets.length, 0);
  });
});
```

- [ ] **Step 3: Build and test**

```bash
npm run build && node --test dist/tests/ownership/mutation-targets.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/ownership/mutation-targets.ts tests/ownership/mutation-targets.test.ts
git commit -m "feat(ownership): add central mutation target extractor for tool args"
```

---

### Task 5: Agent Identity in ToolCallRequest (Mandatory)

**Files:**
- Modify: `src/tools/types.ts`
- Modify: `src/tools/executor.ts`

- [ ] **Step 1: Add mandatory agentId and sessionId to ToolCallRequest**

In `src/tools/types.ts` (the simple version):

```typescript
export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  agentId: string;     // mandatory — no fallback
  sessionId: string;   // mandatory for internal execution requests
};
```

In `src/tools/executor.ts` (the extended version):

```typescript
export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  agentId: string;     // mandatory
  sessionId: string;   // mandatory
  replayId?: string;
  source?: string;
};
```

At external boundaries, validate and reject absent identity for mutating operations. Read-only calls may use known system identities:

- `"system"` — internal runtime operations
- `"cli-user"` — interactive CLI commands
- `"daemon:<taskId>"` — daemon task executions
- `"agent:<agentId>"` — subagent executions

Key construction sites to update:
- `src/tools/executor.ts` — where ToolCallRequest is created from raw tool calls
- `src/tools/tool-router.ts` — where sub-routers construct requests
- `src/runtime/continuation-manager.ts` — where resume constructs the request

- [ ] **Step 2: Migrate persisted continuations and replay records**

Older persisted `PendingContinuation` records in `.alix/approvals/continuations.json`
do not contain `agentId` or `sessionId`.

Surgical approach (not store-level rejection):

1. In `ContinuationStore.load()`: load all records; mark legacy records with
   `migrationIssue: "missing-agent-identity"` on their `PendingContinuation` type.
   Do NOT reject the entire store.
2. In `ContinuationManager.resumeApproved()`: when the continuation has
   `migrationIssue`, surface a clear error ("This continuation was created
   by an older version and lacks agent identity — cannot resume under ownership
   enforcement") and quarantine that record.
3. Valid continuations with identity remain resumable.
4. Do NOT silently assign `"default-agent"` — that would bypass ownership enforcement.

Similarly, replay records in `.alix/approvals/approvals.json` must be checked
for `agentId` when replaying approved tool calls. Same surgical pattern.
- Any test that constructs ToolCallRequest

- [ ] **Step 2: Update continuation-manager to pass agentId through**

In `src/runtime/continuation-manager.ts`, when re-executing a continued tool call, ensure the stored `toolCall.agentId` is passed through to `executeTool()`.

- [ ] **Step 3: Build check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/tools/types.ts src/tools/executor.ts src/runtime/continuation-manager.ts
git commit -m "feat(runtime): propagate agentId and sessionId through ToolCallRequest"
```

---

### Task 6: OwnershipGate Integration

**Files:**
- Create: `src/ownership/ownership-gate.ts`
- Modify: `src/tools/executor.ts`
- Create: `tests/ownership/ownership-gate.test.ts`

- [ ] **Step 1: Create ownership-gate.ts**

```typescript
/**
 * ownership-gate.ts — Ownership enforcement for tool execution.
 *
 * Sits AFTER PolicyGate, before workspace/path validation and execution.
 * For mutates=true tools, checks whether the requesting agent has an
 * active ownership lease covering ALL target paths.
 *
 * Execution order:
 *   argument repair
 *   → request logging
 *   → PolicyGate (skip on continuation-resume)
 *   → OwnershipGate (ALWAYS)
 *   → workspace/path validation
 *   → tool execution
 *
 * Continuation resumes bypass only the repeated policy decision —
 * they MUST still pass ownership checks (the leasing agent may have
 * changed since the continuation was created).
 */

import type { OwnershipRegistry, MutationTarget } from "../ownership/ownership-registry.js";
import type { WorkspacePathResolver } from "../runtime/workspace-path.js";
import type { ToolResult } from "../tools/types.js";
import { extractMutationTargets } from "./mutation-targets.js";

export type OwnershipGateConfig = {
  registry: OwnershipRegistry;
  resolver: WorkspacePathResolver;
  /**
   * When true, automatically acquires a lease for each confident
   * mutation target as the tool runs.
   * Single-agent default: true. Parallel-agent: false.
   */
  autoAcquire?: boolean;
};

/**
 * Check ownership for a tool call.
 *
 * Delegates all authorization to registry.authorizeMutation(),
 * which operates under the ownership lock to reload state,
 * check conflicts, and verify/acquire coverage atomically.
 *
 * Fail-closed: unknown-write classification (e.g. shell.run) is denied.
 */
export async function checkOwnershipGate(
  config: OwnershipGateConfig,
  agentId: string,
  toolName: string,
  args: Record<string, unknown>,
  mutates: boolean,
): Promise<ToolResult | null> {
  // Non-mutating tools pass without ownership check
  if (!mutates) return null;

  // Extract mutation targets with classification
  const extraction = extractMutationTargets(toolName, args, config.resolver);

  // Fail-closed: unknown-write (shell, patch without target, etc.)
  if (extraction.classification === "unknown-write") {
    return {
      kind: "error",
      message: `Cannot determine mutation targets for ${toolName} — ownership check failed closed. ` +
        `Acquire an explicit lease covering the expected paths and retry.`,
      retryable: false,
    };
  }

  // Delegate to registry which acquires lock, reloads, checks, and persists
  const decision = await config.registry.authorizeMutation({
    agentId,
    targets: extraction.targets,
    autoAcquire: config.autoAcquire !== false,
  });

  if (!decision.allowed) {
    return {
      kind: "error",
      message: `Ownership check failed: ${decision.reason}`,
      retryable: false,
    };
  }

  return null; // pass
}
```

- [ ] **Step 2: Integrate into ToolExecutor.execute()**

In `src/tools/executor.ts`:

1. Add `OwnershipRegistry` as an optional constructor parameter:

```typescript
constructor(
  private readonly config: ToolExecutorConfig,
  private readonly log: EventLog,
  private readonly root: string,
  private readonly mcpManager?: McpManager,
  private readonly editFormatPolicy?: EditFormatPolicy,
  private readonly extraHandlers?: Record<string, ToolHandler>,
  private readonly checkpointManager?: CheckpointManager,
  private readonly approvalStore?: ApprovalStore,
  private readonly workspacePathResolver?: WorkspacePathResolver,
  private readonly ownershipRegistry?: OwnershipRegistry,  // ← NEW
) {
```

2. Replace the current continuation-resume early return (lines 150-156) with the correct ordering:

```typescript
// — Restructured execution order —
//
// 1. Tool repair                         (runs before everything)
// 2. PolicyGate                          (skip on continuation-resume)
// 3. OwnershipGate                       (ALWAYS runs)
// 4. Workspace/path validation           (ALWAYS runs)
// 5. Tool execution

// [Existing tool repair code stays]
// [Existing request logging stays]

// 2. Policy gate (skipped for continuation-resume)
if (request.source !== "continuation-resume") {
  const { PolicyGate } = await import("../policy/policy-gate.js");
  // ... existing policy evaluation ...
}

// 3. Ownership gate — ALWAYS, even for continuation-resume
//    (the leasing agent may have changed since the continuation was created)
if (this.ownershipRegistry && this.workspacePathResolver) {
  const ownershipBlocked = await this.checkToolOwnership(name, args, request.agentId);
  if (ownershipBlocked) {
    await this.logEvent(TOOL_EVENT_TYPES.FAILED, { ... });
    return ownershipBlocked;
  }
}

// 4. Execute
let result = await this.router.execute(request);
```

The detailed integration point (replacing lines 150-156 of current executor.ts):

```typescript
// Ownership gate — ALWAYS runs, even for continuation-resume.
// Ownership may have changed since the continuation was created.
if (this.ownershipRegistry && this.workspacePathResolver) {
  const { checkOwnershipGate } = await import("../ownership/ownership-gate.js");
  const capability = this.buildDefaultToolIndex?.().get(name);
  const mutates = capability?.mutates ?? false;

  const ownershipBlocked = await checkOwnershipGate(
    {
      registry: this.ownershipRegistry,
      resolver: this.workspacePathResolver,
      autoAcquire: true,  // single-agent default
    },
    request.agentId,  // mandatory — no fallback
    name,
    args,
    mutates,
  );
  if (ownershipBlocked) {
    await this.logEvent(TOOL_EVENT_TYPES.FAILED, {
      toolCallId, toolName: name, error: ownershipBlocked.message, durationMs: 0,
    });
    return ownershipBlocked;
  }
}
```

- [ ] **Step 3: Write gate tests**

Create `tests/ownership/ownership-gate.test.ts`:
```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("OwnershipGate", () => {
  let dir: string;
  let reg: any;
  let resolver: any;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "own-gate-"));
    mkdirSync(join(dir, ".alix", "ownership"), { recursive: true });

    const { OwnershipRegistry } = await import("../../src/ownership/ownership-registry.js");
    reg = new OwnershipRegistry(dir);
    await reg.refresh();

    const { WorkspacePathResolver } = await import("../../src/runtime/workspace-path.js");
    resolver = new WorkspacePathResolver(dir, []);
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("non-mutating tool passes without check", async () => {
    const { checkOwnershipGate } = await import("../../src/ownership/ownership-gate.js");
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "web_search", { query: "hello" }, false,  // mutates=false
    );
    assert.equal(result, null);
  });

  it("mutating tool on unowned path passes", async () => {
    const { checkOwnershipGate } = await import("../../src/ownership/ownership-gate.js");
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "new-file.ts" }, true,
    );
    assert.equal(result, null);
  });

  it("mutating tool on other agent's owned path is blocked", async () => {
    await reg.acquire({ agentId: "agent-2", scope: { kind: "path", root: join(dir, "src"), recursive: true }, mode: "exclusive-write" });

    const { checkOwnershipGate } = await import("../../src/ownership/ownership-gate.js");
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "src/main.ts" }, true,
    );

    assert.notEqual(result, null);
    assert.equal(result!.kind, "error");
    assert.ok(result!.message.includes("Ownership conflict"));
  });

  it("mutating tool on same agent's owned path passes", async () => {
    await reg.acquire({ agentId: "agent-1", scope: { kind: "path", root: join(dir, "src"), recursive: true }, mode: "exclusive-write" });

    const { checkOwnershipGate } = await import("../../src/ownership/ownership-gate.js");
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "src/main.ts" }, true,
    );

    assert.equal(result, null);
  });

  it("auto-acquires lease for confident mutation target", async () => {
    const { checkOwnershipGate } = await import("../../src/ownership/ownership-gate.js");
    await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "new-file.ts" }, true,
    );

    const leases = reg.listActive();
    assert.equal(leases.length, 1);
    assert.equal(leases[0].agentId, "agent-1");
    assert.equal(leases[0].mode, "exclusive-write");
  });

  it("auto-acquired lease is persisted through save", async () => {
    const { checkOwnershipGate } = await import("../../src/ownership/ownership-gate.js");
    await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "new-file.ts" }, true,
    );

    // Save and reload
    await reg.save();
    const { OwnershipRegistry } = await import("../../src/ownership/ownership-registry.js");
    const reg2 = new OwnershipRegistry(dir);
    await reg2.load();

    const leases = reg2.listActive();
    assert.equal(leases.length, 1);
    assert.equal(leases[0].agentId, "agent-1");
  });

  // ─── Fail-closed and multi-target tests ───────────────────────

  it("mutating tool with no extractable targets fails closed", async () => {
    const { checkOwnershipGate } = await import("../../src/ownership/ownership-gate.js");
    // shell.run with no command → extractMutationTargets returns empty
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "shell.run", {}, true,
    );
    assert.notEqual(result, null);
    assert.equal(result!.kind, "error");
    assert.ok(result!.message.includes("Cannot determine mutation targets"));
  });

  it("multi-target write fails if any target is blocked", async () => {
    await reg.acquire({ agentId: "agent-2", scope: { kind: "path", root: join(dir, "src"), recursive: true }, mode: "exclusive-write" });

    const { checkOwnershipGate } = await import("../../src/ownership/ownership-gate.js");
    // file.rename with source in unowned dir and dest in owned dir
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.rename", {
        source: "safe/new-file.ts",
        destination: "src/main.ts",
      }, true,
    );
    assert.notEqual(result, null);
    assert.equal(result!.kind, "error");
    assert.ok(result!.message.includes("Ownership conflict"));
  });

  it("multi-target write passes if all targets are unowned", async () => {
    const { checkOwnershipGate } = await import("../../src/ownership/ownership-gate.js");
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.rename", {
        source: "safe/new-file.ts",
        destination: "safe/renamed.ts",
      }, true,
    );
    assert.equal(result, null);
  });

  it("continuation-resume path still checks ownership", async () => {
    // Simulate: agent-2 owns src/, agent-1 tries write via continuation-resume
    await reg.acquire({ agentId: "agent-2", scope: { kind: "path", root: join(dir, "src"), recursive: true }, mode: "exclusive-write" });

    const { checkOwnershipGate } = await import("../../src/ownership/ownership-gate.js");
    const result = await checkOwnershipGate(
      { registry: reg, resolver },
      "agent-1", "file.create", { path: "src/main.ts" }, true,
    );

    // Should still be blocked — ownership check runs regardless of source
    assert.notEqual(result, null);
    assert.equal(result!.kind, "error");
  });
});
```

- [ ] **Step 3: Build and test**

```bash
npm run build && node --test dist/tests/ownership/ownership-gate.test.js
```

- [ ] **Step 4: Commit**

```bash
git add src/ownership/ownership-gate.ts src/tools/executor.ts tests/ownership/ownership-gate.test.ts
git commit -m "feat(ownership): add OwnershipGate with continuation-aware execution order"
```

---

### Task 7: CLI Commands

**Files:**
- Create: `src/cli/commands/ownership.ts`
- Modify: `src/cli.ts`
- Create: `tests/cli/ownership.test.ts`

- [ ] **Step 1: Create src/cli/commands/ownership.ts**

```typescript
/**
 * ownership.ts — CLI commands for lease-based ownership management.
 *
 * Usage: alix ownership <list|show|history|acquire|release|renew|conflicts|prune>
 */

import { OwnershipRegistry } from "../../ownership/ownership-registry.js";
import { normalizePathScope, formatScope } from "../../ownership/path-scope.js";

export function createOwnershipRegistry(cwd: string): OwnershipRegistry {
  return new OwnershipRegistry(cwd);
}

export async function handleOwnershipCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub) {
    console.error("Usage: alix ownership <list|show|history|acquire|release|renew|conflicts|prune>");
    process.exit(1);
  }

  const cwd = process.cwd();
  const reg = createOwnershipRegistry(cwd);
  // Public async API handles all locking internally

  switch (sub) {
    case "list": {
      const records = await reg.listActive();
      if (records.length === 0) { console.log("No active ownership records."); return; }
      console.log("STATUS  AGENT".padEnd(32) + "MODE".padEnd(20) + "SCOPE".padEnd(50) + "TTL");
      for (const r of records) {
        const scope = formatScope(r.scope);
        const ttl = new Date(r.expiresAt).getTime() - Date.now();
        const ttlStr = ttl > 0 ? `${Math.round(ttl / 60000)}m` : "expired";
        console.log(`ACTIVE  ${r.agentId.padEnd(22)} ${r.mode.padEnd(18)} ${scope.padEnd(48)} ${ttlStr}`);
      }
      break;
    }

    case "history": {
      const records = await reg.listHistory();
      if (records.length === 0) { console.log("No history records."); return; }
      for (const r of records) {
        const scope = formatScope(r.scope);
        console.log(`${r.status.padEnd(10)} ${r.agentId.padEnd(22)} ${r.mode.padEnd(18)} ${scope}`);
      }
      break;
    }

    case "show": {
      const id = args[1];
      if (!id) { console.error("Usage: alix ownership show <id>"); process.exit(1); }
      const r = reg.get(id);
      if (!r) { console.error(`Record not found: ${id}`); process.exit(1); }
      console.log(JSON.stringify(r, null, 2));
      break;
    }

    case "acquire": {
      const agentIdx = args.indexOf("--agent");
      const pathIdx = args.indexOf("--path");
      const modeIdx = args.indexOf("--mode");
      const agentId = agentIdx >= 0 ? args[agentIdx + 1] : "cli-user";
      const pattern = pathIdx >= 0 ? args[pathIdx + 1] : undefined;
      const modeRaw = modeIdx >= 0 ? args[modeIdx + 1] : "exclusive-write";
      // Validate mode
      if (!["exclusive-write", "shared-read", "review-only"].includes(modeRaw)) {
        console.error("Invalid mode. Allowed: exclusive-write, shared-read, review-only");
        process.exit(1);
      }
      const mode = modeRaw as "exclusive-write" | "shared-read" | "review-only";
      if (!pattern) {
        console.error("Usage: alix ownership acquire --agent <id> --path <scope> --mode <mode>");
        process.exit(1);
      }
      const scope = normalizePathScope(pattern, cwd);
      const result = await reg.acquire({
        agentId,
        scope,
        mode,
        reason: "cli-acquire",
      });
      if (!result.acquired) {
        console.error(`Conflict: ${result.conflict?.reason ?? "lock timeout"}`);
        process.exit(1);
      }
      console.log(`Acquired: ${result.record!.id} (${mode}) on ${formatScope(scope)}`);
      break;
    }

    case "release": {
      const id = args[1];
      if (!id) { console.error("Usage: alix ownership release <id>"); process.exit(1); }
      const released = await await reg.release(id);
      if (released) { console.log(`Released: ${id}`); }
      else { console.error(`Failed to release: ${id}`); process.exit(1); }
      break;
    }

    case "renew": {
      const id = args[1];
      const ttlIdx = args.indexOf("--ttl");
      const ttlMs = ttlIdx >= 0 ? parseTTL(args[ttlIdx + 1]) : undefined;
      if (!id) { console.error("Usage: alix ownership renew <id> [--ttl 30m]"); process.exit(1); }
      const renewed = await reg.renew(id, ttlMs);
      if (renewed) { console.log(`Renewed: ${id}`); }
      else { console.error(`Failed to renew: ${id}`); process.exit(1); }
      break;
    }

    case "conflicts": {
      const pathIdx = args.indexOf("--path");
      const pattern = pathIdx >= 0 ? args[pathIdx + 1] : undefined;
      if (!pattern) { console.error("Usage: alix ownership conflicts --path <pattern>"); process.exit(1); }
      const conflicts = await reg.findConflictsByPattern(pattern);
      if (conflicts.length === 0) { console.log("No conflicts found."); return; }
      console.log(`Conflicts for ${pattern}:`);
      for (const c of conflicts) {
        console.log(`  ${c.agentId} ${c.mode} — ${formatScope(c.scope)}`);
      }
      break;
    }

    case "prune": {
      const count = await reg.prune();
      console.log(`Pruned ${count} expired records.`);
      break;
    }

    default:
      console.error("Unknown ownership subcommand: " + sub);
      console.error("Usage: alix ownership <list|show|history|acquire|release|renew|conflicts|prune>");
      process.exit(1);
  }
}

function parseTTL(s: string): number {
  const m = s.match(/^(\d+)([smh])$/);
  if (!m) {
    console.error("Invalid TTL format. Use e.g. 30m, 2h, 300s");
    process.exit(1);
  }
  const n = parseInt(m[1], 10);
  if (n <= 0) {
    console.error("TTL must be positive");
    process.exit(1);
  }
  if (m[2] === "s") return n * 1000;
  if (m[2] === "m") return n * 60 * 1000;
  return n * 3600 * 1000; // h
}
```

- [ ] **Step 2: Add dispatch in src/cli.ts**

Find the CLI dispatch chain and add:

```typescript
if (command === "ownership") {
  const { handleOwnershipCommand } = await import("./cli/commands/ownership.js");
  await handleOwnershipCommand(args);
}
```

Add help text (find the help section in cli.ts and add):

```
  alix ownership list            Show active ownership records
  alix ownership history         Show terminal (released/expired/revoked) records
  alix ownership show <id>       Show record details
  alix ownership acquire --agent <id> --path <scope> --mode <mode>  Acquire ownership lease
  alix ownership release <id>    Release an ownership lease
  alix ownership renew <id>      Renew an ownership lease
  alix ownership conflicts --path <pattern>  Show conflicts for a pattern
  alix ownership prune           Remove expired records older than 30 days
```

- [ ] **Step 3: Write CLI tests**

Create `tests/cli/ownership.test.ts`:
```typescript
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { join } from "node:path";

const CLI_PATH = join(process.cwd(), "dist", "src", "cli.js");
const CLI = `node ${CLI_PATH}`;

describe("alix ownership CLI", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "own-cli-"));
    mkdirSync(join(dir, ".alix", "ownership"), { recursive: true });
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("list shows 'No active ownership records' when empty", () => {
    const out = execSync(`${CLI} ownership list`, { cwd: dir, encoding: "utf-8" });
    assert.ok(out.includes("No active ownership records"));
  });

  it("acquire creates a record", () => {
    const out = execSync(
      `${CLI} ownership acquire --agent test-bot --path "src/**" --mode exclusive-write`,
      { cwd: dir, encoding: "utf-8" },
    );
    assert.ok(out.includes("Acquired:"));
    assert.ok(out.includes("exclusive-write"));
  });

  it("acquired record appears in list", () => {
    execSync(`${CLI} ownership acquire --agent test-bot --path "src/**" --mode exclusive-write`, { cwd: dir });
    const out = execSync(`${CLI} ownership list`, { cwd: dir, encoding: "utf-8" });
    assert.ok(out.includes("test-bot"));
    assert.ok(out.includes("exclusive-write"));
  });

  it("history shows released records", () => {
    const acquire = execSync(`${CLI} ownership acquire --agent test-bot --path "x/**" --mode exclusive-write`, { cwd: dir, encoding: "utf-8" });
    const id = acquire.match(/own_[a-z0-9]+/)?.[0];
    assert.ok(id);
    execSync(`${CLI} ownership release ${id}`, { cwd: dir });
    const out = execSync(`${CLI} ownership history`, { cwd: dir, encoding: "utf-8" });
    assert.ok(out.includes("released"));
  });
});
```

- [ ] **Step 4: Build and smoke test**

```bash
npm run build && node dist/src/cli.js ownership list
```

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/ownership.ts src/cli.ts tests/cli/ownership.test.ts
git commit -m "feat(cli): add alix ownership commands with withLock atomicity"
```

---

### Task 8: Visibility in RuntimeIndex and Inspector

**Files:**
- Modify: `src/runtime/runtime-index.ts`
- Modify: `src/server/server.ts`

- [ ] **Step 1: Add to RuntimeIndex SESSION_EVENT_ALLOWLIST**

Find `SESSION_EVENT_ALLOWLIST` in `src/runtime/runtime-index.ts` and add:

```typescript
"ownership.acquired",
"ownership.released",
"ownership.renewed",
"ownership.expired",
"ownership.conflict",
"ownership.revoked",
"ownership.denied",
```

- [ ] **Step 2: Add to Inspector VISIBLE_EVENTS**

Find `VISIBLE_EVENTS` in `src/server/server.ts` and add:

```typescript
"ownership.acquired",
"ownership.released",
"ownership.renewed",
"ownership.expired",
"ownership.conflict",
"ownership.revoked",
"ownership.denied",
```

- [ ] **Step 3: Commit**

```bash
git add src/runtime/runtime-index.ts src/server/server.ts
git commit -m "feat(ownership): add ownership events to RuntimeIndex allowlist and Inspector SSE"
```

---

### Task 9: Concurrency and Integration Verification

**Files:**
- Modify: `tests/ownership/ownership-registry.test.ts` (add tests)
- Modify: `tests/ownership/ownership-gate.test.ts` (add tests)

- [ ] **Step 1: Add concurrency tests to ownership-registry.test.ts**

Add to the existing `describe("OwnershipRegistry", ...)`:

```typescript
// ─── Concurrency and expiration tests ─────────────────────────

it("expired lease changes active → expired and preserves record", () => {
  // Create an already-expired lease
  await reg.acquire({agentId: "agent-1", scope:, { kind: "path", root: join(dir, "tmp"), recursive: true },
    "exclusive-write", { ttlMs: -1 });
  // Expire it
  // Create lease then wait for expiration or use short TTL
  // Expiration applied automatically on next withLock()
  assert.equal(r?.status, "expired");
  assert.ok(reg.list().length >= 1); // still in records
});

it("expired lease stops blocking", () => {
  const scope = { kind: "path" as const, root: join(dir, "x"), recursive: true };
  await reg.acquire({ agentId: "agent-1", scope, mode: "exclusive-write", ttlMs: -1 });
  // Force-expire
  // Create lease then wait for expiration or use short TTL
  // Expiration applied automatically on next withLock()

  // Now agent-2 should be able to acquire
  const result = await reg.acquire({ agentId: "agent-2", scope:, scope,  mode: "exclusive-write" });
  assert.equal(result.acquired, true);
});

it("lock prevents double-acquisition of same scope", async () => {
  // Use two separate registry instances to simulate concurrent processes
  const { OwnershipRegistry: OR } = await import("../../src/ownership/ownership-registry.js");

  const regA = new OR(dir);
  const regB = new OR(dir);

  const [resultA, resultB] = await Promise.all([
    regA.acquire({ agentId: "agent-1", scope: { kind: "path", root: join(dir, "conflict"), recursive: true }, mode: "exclusive-write" }),
    regB.acquire({ agentId: "agent-2", scope: { kind: "path", root: join(dir, "conflict"), recursive: true }, mode: "exclusive-write" }),
  ]);

  // Exactly one should succeed
  const successes = [resultA.acquired, resultB.acquired].filter(Boolean).length;
  assert.equal(successes, 1);
});

it("two child processes cannot both acquire overlapping scope", { timeout: 30000 }, async () => {
  // Stronger concurrency test: spawn two child processes
  const { execSync } = await import("node:child_process");
  const pidA = require("node:child_process").spawn("node", ["dist/src/cli.js", "ownership", "acquire", "--agent", "proc-a", "--path", "src/**", "--mode", "exclusive-write"], { cwd: dir });
  const pidB = require("node:child_process").spawn("node", ["dist/src/cli.js", "ownership", "acquire", "--agent", "proc-b", "--path", "src/**", "--mode", "exclusive-write"], { cwd: dir });

  const [codeA, codeB] = await Promise.all([
    new Promise(r => pidA.on("exit", r)),
    new Promise(r => pidB.on("exit", r)),
  ]);

  // Exactly one should succeed (exit 0), one should fail (exit 1)
  const exits = [codeA, codeB];
  assert.equal(exits.filter(c => c === 0).length, 1);
  assert.equal(exits.filter(c => c !== 0).length, 1);
});

it("revision increments on every mutation", async () => {
  const revBefore = reg.currentRevision;
  await reg.acquire({ agentId: "agent-1", scope: { kind: "path", root: join(dir, "rev-test"), recursive: true }, mode: "exclusive-write" });
  assert.ok(reg.currentRevision > revBefore);
});

it("event emission follows successful persistence", async () => {
  // Events are queued during mutation and flushed after persistence + lock release
  const emitted: string[] = [];
  const { OwnershipRegistry } = await import("../../src/ownership/ownership-registry.js");
  const eventReg = new OwnershipRegistry(dir, {
    eventSink: { emit: async (event: string) => { emitted.push(event); } },
  });
  await eventReg.acquire({ agentId: "agent-1", scope: { kind: "path", root: join(dir, "e"), recursive: true }, mode: "exclusive-write" });
  assert.ok(emitted.includes("ownership.acquired"));
});
```

- [ ] **Step 2: Add integration tests to ownership-gate.test.ts**

- [ ] **Step 3: Run all tests and commit**

```bash
npm run build && node --test dist/tests/ownership/*.test.js "dist/tests/cli/ownership.test.js"
```

```bash
git add tests/ownership/ tests/cli/ownership.test.ts
git commit -m "test(ownership): add concurrency, expiration, and integration verification tests"
```

---

## Summary of Final Changes (Rounds 2-3)

| # | Issue | Resolution |
|---|-------|-----------|
| 1 | `pathScopesOverlap` must be symmetric | Split into symmetric `pathScopesOverlap()` and directional `scopeContains()`; tests verify both directions |
| 2 | `pathInScope` not implemented | Added as alias for `scopeContains` |
| 3 | `normalizePathScope` prefix collision | Uses `isInside()` via `relative()` instead of `startsWith()` |
| 4 | Accepts unsupported wildcards | Rejects `**/*.ts`, `**/...`, only accepts `path`, `path/`, `path/**` |
| 5 | Lock uses `require("os")` in ESM | Fixed to `import { hostname } from "node:os"` |
| 6 | Lock dir may not exist | `mkdirSync(dirname(lockPath), { recursive: true })` before polling |
| 7 | Release deletes another process's lock | Unique UUID token stored; `release()` verifies token match before unlinking |
| 8 | Public API exposed unlocked helpers | All mutations internal; public `acquire()`, `release()`, etc. acquire lock automatically |
| 9 | Events emitted before lock release | Events queued, lock released in `finally`, then `drainEvents()` runs |
| 10 | Event sink synchronous | Changed to `Promise<void>`; failures caught and logged, never undo persistence |
| 11 | Revision increments on no-op | `changed` flag; `persistIfChanged()` skips if nothing mutated |
| 12 | Failed callback leaks events | Catch block clears `pendingEvents` and reloads clean state |
| 13 | `expiredAt` missing | Added to `OwnershipRecord`; set during `applyExpiration()` |
| 14 | `resolver.resolve().absolute` wrong API | Uses `resolver.check(rawPath)` returning structured `ResolvedPath` |
| 15 | Shell handling fails open | `shell.run` returns `classification: "unknown-write"` with empty targets; gate denies |
| 16 | Patch doesn't inspect headers | No explicit target → `unknown-write` (future: parse `patchText`) |
| 17 | Auto-acquisition not atomic | `authorizeMutation()` runs inside a single `withLock()` transaction |
| 18 | `autoAcquire: false` doesn't enforce | Checks `hasCoverageForPath()` for every target; rejects uncovered writes |
| 19 | Gate uses stale in-memory data | `authorizeMutation()` reloads from disk under lock before checking |
| 20 | Concurrency test is sequential | Two-registry `Promise.all` test + two-child-process test |
| 21 | Blast radius of mandatory identity | Explicit migration: reject legacy continuations with clear error; no silent default-agent |
| 22 | `ToolCapability.mutates` speculative | Inject `ToolCapabilityIndex` in constructor; document existing API