# M0.9 Audit: Execution Order and Governance

**Status:** ✅ Completed (M0.18) — Plan implemented and committed to main.

**Goal:** Fix 6 correctness issues found in the M0.9 implementation before adding more features.

---

### Issue 1: Repair modifies args after argument hash (P0)

**Location:** `src/tools/executor.ts:110,165-172`

The `argumentHash` is computed at line 110 with the original args, but the tool repair layer at line 170 can modify args via `result.args`. The `assertPolicyArgumentsMatch` at line 183 uses the ORIGINAL hash against the MODIFIED args, causing a hash mismatch.

**Fix:** Recompute `argumentHash` after repair modifies args.

```typescript
// === TOOL REPAIR LAYER ===
let repairHint: string | undefined;
if (this.repair && name !== "done" && !name.startsWith("mcp.")) {
  const result = this.repair.process(name, args);
  if (result.repaired) {
    repairHint = result.hint;
    (request as Record<string, unknown>).args = result.args;
    // Recompute hash with repaired args
    args = result.args;
    argumentHash = hashArgs(args);
  }
}
```

### Issue 2: Missing terminal events on early returns (P0)

**Location:** `src/agent/agent-loop.ts`

`runTaskLoop()` returns via multiple paths (max_iterations, max_repairs, scope_rejected, etc.) that don't emit `task.done`/`task.failed`, `graph.completed`/`graph.failed`, `workflow.completed`/`workflow.failed`.

**Fix:** Wrap `runTaskLoop()` return in a helper that always emits terminal events.

```typescript
function emitTerminalEvents(
  session: { sessionId: string; actor: "system" },
  log: EventLog,
  wfRun: WorkflowRun,
  taskGraph: TaskGraph,
  taskNode: TaskNode,
  wfMeta: { workflowId: string },
  graphMeta: { workflowId: string; graphId: string; nodeId: string },
  result: RunResult,
): Promise<void>
```

### Issue 3: DB migration has two sources (P1)

**Location:** `src/db/manager.ts:40-131`, `src/db/migrations/0001_m09_kernel.sql`

`migrateKernel()` duplicates the SQL inline. The SQL file is the single source of truth.

**Fix:** Make `migrateKernel()` read from the SQL file.

```typescript
migrateKernel(): void {
  const sqlPath = join(__dirname, "migrations", "0001_m09_kernel.sql");
  this.migrate(sqlPath);
}
```

### Issue 4: Demo doesn't verify no mutations (P1)

**Location:** `src/cli/commands/demo.ts`

The demo prints "Demo complete. No files were modified." but doesn't actually check.

**Fix:** Read events and assert no `file.*` or `patch.*` events exist.

```typescript
const mutationEvents = events.filter(e => e.type.startsWith("file.") || e.type.startsWith("patch."));
if (mutationEvents.length > 0) {
  console.log(`⚠️  WARNING: ${mutationEvents.length} mutation events detected in read-only demo!`);
} else {
  console.log("No files were modified (verified).");
}
```

### Issue 5: TUI bypass not visible anywhere (P2)

The TUI uses `sessionMode: "bypass"` which means policy decisions are never surfaced. This isn't visible to the user.

**Fix:** Print a notice at TUI startup or add it to the demo output.

### Issue 6: Verify minimal metric coverage (P2)

Check that all M0.9 metric names from `MinimalMetrics` are emitted somewhere.

**Verification:**
- `workflow_runs_total` → agent-loop.ts ✓
- `workflow_duration_ms` → agent-loop.ts ✓
- `tool_calls_total` → executor.ts ✓
- `tool_failures_total` → executor.ts ✓
- `model_calls_total` → NOT emitted anywhere
- `policy_decisions_total` → NOT emitted (policy events exist but no metric counter)
- `policy_denials_total` → NOT emitted

**Fix:** Add `model_calls_total` and `policy_decisions_total` counters.

---

## Implementation

### Task 1: Fix repair → hash ordering

**Files:** `src/tools/executor.ts`

- [ ] Add `args = result.args; argumentHash = hashArgs(args);` after repair modifies args

### Task 2: Add terminal event helper and wire into all paths

**Files:** `src/agent/agent-loop.ts`

- [ ] Create `emitTerminalEvents()` function before `runTaskLoop` call
- [ ] Call it on ALL return paths from `runTaskLoop`

### Task 3: Make DB migration single-source

**Files:** `src/db/manager.ts`, `src/db/migrations/0001_m09_kernel.sql`

- [ ] Change `migrateKernel()` to read from the SQL file
- [ ] Remove duplicate inline SQL

### Task 4: Add mutation verification to demo

**Files:** `src/cli/commands/demo.ts`

- [ ] Filter events for `file.*` / `patch.*` types and print warning if found

### Task 5: Add missing metric counters

**Files:** `src/agent/agent-loop.ts`, `src/tools/executor.ts`

- [ ] Add `model_calls_total` metric where model calls happen
- [ ] Add `policy_decisions_total` metric in executor
