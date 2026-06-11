# PR 2: Capability Mapping + Argument Hash

**Status:** ✅ Completed (M0.12) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a canonical capability mapping layer alongside the legacy `inferCapability()` names, and emit `argumentHash` on every tool event for audit trail and M0.9 PolicyDecision.

**Architecture:** Two independent additions. (1) A pure mapping function `legacyCapabilityToCanonical()` that translates `file.read` → `filesystem.read`, `shell.run` → `shell.exec`, etc. Both the legacy and canonical names are emitted on tool events. (2) An `argumentHash` (SHA-256 of stable-JSON-serialized args) emitted on `tool.requested`, `tool.started`, `tool.completed`, `tool.failed` events via new payload fields.

**Tech Stack:** TypeScript, node:crypto, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/tools/capability-map.ts` | **Modify** | Add `legacyCapabilityToCanonical()` and `canonicalCapability` field on existing types |
| `src/tools/executor.ts` | **Modify** | Compute and emit `argumentHash` and `canonicalCapability` on tool events |
| `src/events/types.ts` | **Modify** | Add `argumentHash` and `canonicalCapability` to `ToolRequestPayload`, `ToolCompletedPayload`, `ToolFailedPayload` |
| `tests/tools/capability-map.test.ts` | **Create** | Tests for mapping and argument hash |

---

### Task 1: Add canonical capability mapping

**Files:**
- Modify: `src/tools/capability-map.ts`

- [ ] **Step 1: Add the mapping function**

Append to `src/tools/capability-map.ts`:

```typescript
/** Map legacy capability names to canonical PRD capability names. */
const LEGACY_TO_CANONICAL: Record<string, string> = {
  "file.read": "filesystem.read",
  "file.write": "filesystem.write",
  "file.search": "filesystem.search",
  "file.delete": "filesystem.write",
  "shell.run": "shell.exec",
  "shell.readonly": "shell.exec",
  "git.diff": "repo.read",
  "git.commit": "repo.write",
  "git.push": "repo.write",
  "patch.apply": "patch.apply",
  "delegate": "agent.delegate",
  "task.complete": "task.complete",
  "web.search": "web.search",
  "web.fetch": "web.fetch",
  "mcp.invoke": "mcp.invoke",
  "tool.invoke": "tool.invoke",
};

/**
 * Convert a legacy capability name (e.g. "file.write") to its canonical
 * PRD name (e.g. "filesystem.write"). Returns the original name if no
 * mapping exists (forward-compat with future capabilities).
 */
export function legacyCapabilityToCanonical(legacy: string): string {
  return LEGACY_TO_CANONICAL[legacy] ?? legacy;
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit src/tools/capability-map.ts 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/capability-map.ts
git commit -m "feat(tools): add legacyCapabilityToCanonical mapping"
```

---

### Task 2: Add argumentHash to event payload types

**Files:**
- Modify: `src/events/types.ts`

- [ ] **Step 1: Add argumentHash and canonicalCapability to tool payload types**

Update the payload types:

```typescript
export type ToolRequestPayload = {
  toolCallId: string;
  toolName: string;
  capability: string;
  canonicalCapability: string;   // NEW
  argumentHash: string;          // NEW
  argsPreview: Record<string, unknown>;
};

// ToolStartedPayload — add argumentHash
export type ToolStartedPayload = {
  toolCallId: string;
  toolName: string;
  argumentHash: string;          // NEW
};

// ToolCompletedPayload — add argumentHash + canonicalCapability
export type ToolCompletedPayload = {
  toolCallId: string;
  toolName: string;
  capability: string;            // NEW (already used by code)
  canonicalCapability: string;   // NEW
  argumentHash: string;          // NEW
  status: "success" | "cancelled";
  durationMs: number;
};

// ToolFailedPayload — add argumentHash + canonicalCapability
export type ToolFailedPayload = {
  toolCallId: string;
  toolName: string;
  capability: string;            // NEW
  canonicalCapability: string;   // NEW
  argumentHash: string;          // NEW
  error: string;
  durationMs: number;
};
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds. Fix any TS errors in executor.ts if the new required fields aren't provided.

- [ ] **Step 3: Commit**

```bash
git add src/events/types.ts
git commit -m "feat(events): add argumentHash and canonicalCapability to tool event payloads"
```

---

### Task 3: Wire argumentHash and canonicalCapability in ToolExecutor

**Files:**
- Modify: `src/tools/executor.ts`

- [ ] **Step 1: Import hash function and mapping**

```typescript
import { createHash } from "node:crypto";
import { legacyCapabilityToCanonical } from "./capability-map.js";
```

- [ ] **Step 2: Add hash helper**

```typescript
/** Compute a stable SHA-256 hash of JSON-serialized tool arguments. */
export function hashArgs(args: Record<string, unknown>): string {
  // Sort keys for deterministic JSON serialization
  const sorted = Object.keys(args).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = args[k];
    return acc;
  }, {});
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}
```

- [ ] **Step 3: Update tool.requested event emission to include hash + canonical**

In the `execute()` method, after `const capability = inferCapability(name);`, add:

```typescript
const canonicalCapability = legacyCapabilityToCanonical(capability);
const argumentHash = hashArgs(args);
```

Then update the `tool.requested` event emission to include:

```typescript
await this.log.append({
  ...session,
  type: TOOL_EVENT_TYPES.REQUESTED,
  payload: {
    toolCallId,
    toolName: name,
    capability,
    canonicalCapability,
    argumentHash,
    argsPreview: sanitizeArgs(args),
  } as ToolRequestPayload,
});
```

- [ ] **Step 4: Update tool.started event to include argumentHash**

Find where `tool.started` is emitted and add:

```typescript
payload: { toolCallId, toolName: name, argumentHash } satisfies ToolStartedPayload,
```

- [ ] **Step 5: Update tool.completed and tool.failed events**

Find both emissions and add `capability`, `canonicalCapability`, `argumentHash` to their payloads.

The payload values are already computed above (`capability`, `canonicalCapability`, `argumentHash`) — just add them to the object.

- [ ] **Step 6: Build and fix type errors**

```bash
npm run build 2>&1 | tail -15
```

Fix any `Type ... is not assignable` errors by ensuring all new fields are provided in every tool event emission.

- [ ] **Step 7: Commit**

```bash
git add src/tools/executor.ts
git commit -m "feat(tools): emit argumentHash and canonicalCapability on all tool events"
```

---

### Task 4: Write tests

**Files:**
- Create: `tests/tools/capability-map.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { legacyCapabilityToCanonical } from "../../src/tools/capability-map.js";

describe("legacyCapabilityToCanonical", () => {

  it("maps file.read → filesystem.read", () => {
    assert.equal(legacyCapabilityToCanonical("file.read"), "filesystem.read");
  });

  it("maps file.write → filesystem.write", () => {
    assert.equal(legacyCapabilityToCanonical("file.write"), "filesystem.write");
  });

  it("maps shell.run → shell.exec", () => {
    assert.equal(legacyCapabilityToCanonical("shell.run"), "shell.exec");
  });

  it("maps shell.readonly → shell.exec", () => {
    assert.equal(legacyCapabilityToCanonical("shell.readonly"), "shell.exec");
  });

  it("maps delegate → agent.delegate", () => {
    assert.equal(legacyCapabilityToCanonical("delegate"), "agent.delegate");
  });

  it("maps web.search → web.search (already canonical)", () => {
    assert.equal(legacyCapabilityToCanonical("web.search"), "web.search");
  });

  it("returns unknown names unchanged", () => {
    assert.equal(legacyCapabilityToCanonical("some.new.capability"), "some.new.capability");
  });

});

describe("hashArgs", () => {
  // Import from executor.ts — export it first, or inline here
  // If executor.ts is ESM with side effects, test the logic directly
  it("produces a deterministic hash", () => {
    const { createHash } = require("node:crypto");
    const args = { path: "src/test.ts", content: "hello" };
    const sorted = Object.keys(args).sort().reduce((acc, k) => { acc[k] = (args as any)[k]; return acc; }, {} as Record<string, unknown>);
    const hash1 = createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
    const hash2 = createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
    assert.equal(hash1, hash2);
  });

  it("produces different hashes for different args", () => {
    const { createHash } = require("node:crypto");
    const stable = (args: Record<string, unknown>) => createHash("sha256").update(JSON.stringify(Object.keys(args).sort().reduce((acc, k) => { acc[k] = args[k]; return acc; }, {} as Record<string, unknown>))).digest("hex");
    assert.notEqual(stable({ path: "a.ts" }), stable({ path: "b.ts" }));
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test tests/tools/capability-map.test.ts 2>&1
```

Expected: all mapping tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/tools/capability-map.test.ts
git commit -m "test(tools): capability mapping and argument hash tests"
```
