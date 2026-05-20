# Finish run.ts Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete run.ts cleanup - move remaining helpers, remove dead comments, and decide RuntimeBuilder strategy.

**Architecture:**
1. Review remaining inline functions in run.ts that should be moved
2. Remove stale planning comments
3. Decide: should run.ts use RuntimeBuilder, or is ADR-0002 accurate?

**Tech Stack:** TypeScript, node:test.

---

### Task 1: Identify Remaining Helper Exports

**Files:**
- Modify: `src/run.ts`
- Modify: `src/run/helpers.ts` (extend)
- Modify: `src/run/index.ts` (update exports)

- [ ] **Step 1: List remaining inline functions in run.ts**

Read src/run.ts and identify functions that could be moved to helpers.ts:
- Any functions not core to run.ts orchestration
- Functions that are purely utility/helper-like

- [ ] **Step 2: Move remaining helpers to src/run/helpers.ts**

```typescript
// src/run/helpers.ts - add:
export function formatDuration(ms: number): string { /* ... */ }
export function truncateOutput(text: string, maxLen: number): string { /* ... */ }
// etc.
```

- [ ] **Step 3: Update barrel export**

Update src/run/index.ts to export new helpers.

- [ ] **Step 4: Verify build and tests**

Run: `npm run build && npm test 2>&1 | tail -5`

---

### Task 2: Remove Dead Comments

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Identify stale planning comments**

Look for:
- Old "EXTRACTED TO" comments
- TODO comments that are now done
- Comments documenting extraction plan (now implemented)

- [ ] **Step 2: Clean up comments**

Remove or update stale comments. Keep meaningful documentation.

- [ ] **Step 3: Commit**

```bash
git add src/run/
git commit -m "refactor(run): remove dead comments, export remaining helpers

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
"
```

---

### Task 3: RuntimeBuilder Decision

**Files:**
- Modify: `src/run.ts` (if decision is to use builder)
- Modify: `docs/adr/ADR-0002-runtime-builder.md` (update decision)

- [ ] **Step 1: Review current run.ts vs RuntimeBuilder**

Current run.ts creates components inline. RuntimeBuilder is an alternative pattern.

- [ ] **Step 2: Decide approach**

**Option A: Use RuntimeBuilder**
- Replace inline component creation with `RuntimeBuilder`
- Pros: Consistent construction, testable
- Cons: Large change, potential breaking

**Option B: Keep inline (ADR update)**
- Document that RuntimeBuilder is for alternate entrypoints (CLI variants, testing)
- Main run.ts keeps inline construction for simplicity
- Update ADR-0002 to reflect this

- [ ] **Step 3: Implement decision**

If Option A:
```typescript
// In run.ts
const builder = new RuntimeBuilder(config.root);
builder.withConfig(config);
builder.withSession(sessionId);
const runtime = await builder.build();
// Use runtime.policyEngine, runtime.toolExecutor, etc.
```

If Option B:
- Update ADR-0002 to say "builder is for alternate entrypoints for now"

- [ ] **Step 4: Verify build and tests**

Run: `npm run build && npm test 2>&1 | tail -5`

- [ ] **Step 5: Commit**

```bash
git add src/run.ts docs/adr/ADR-0002-runtime-builder.md
git commit -m "docs: update ADR-0002 to reflect RuntimeBuilder is for alternate entrypoints

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
"
```