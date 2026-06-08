# M0.10-F: Research Runtime Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce research profile structurally — tool allowlists, node timeouts, max iterations, disable skill-factory, prevent stale file reads.

**Architecture:** Extend TaskNode with optional `timeoutMs`, `maxIterations` fields. Add `allowedTools` filter in GraphExecutor that filters tools by profile. Pass `disableSkillFactory` through RunOpts. The enforcement moves from prompt instructions to code.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/task-graph.ts` | **Modify** | Add `timeoutMs`, `maxIterations` to TaskNode |
| `src/kernel/graph-executor.ts` | **Modify** | Add tool filtering, timeout, max iterations, skill-factory disable |
| `src/sop/research-deep-report.ts` | **Modify** | Set timeoutMs and maxIterations per node |
| `src/run.ts` | **Modify** | Add `disableSkillFactory` to RunOpts |
| `tests/kernel/graph-executor.test.ts` | **Modify** | Test tool filtering, timeout enforcement |

---

### Task 1: Add timeoutMs and maxIterations to TaskNode

**Files:** `src/kernel/task-graph.ts`

- [ ] Add fields to `TaskNode`:

```typescript
export interface TaskNode {
  // ... existing fields ...
  timeoutMs?: number;
  maxIterations?: number;
}
```

- [ ] Build and commit: `feat(kernel): add timeoutMs and maxIterations to TaskNode`

### Task 2: Add allowedTools and allowedWriteRoot to execution profile

**Files:** `src/kernel/graph-executor.ts`

- [ ] Add profile definitions:

```typescript
const RESEARCH_ALLOWED_TOOLS = new Set(["web_search", "web_fetch", "done"]);
const ARTIFACT_ALLOWED_TOOLS = new Set(["file.create", "file.exists", "done"]);
```

- [ ] In `execute()`, before calling `runTask`, modify the node's goal to include tool restrictions:

```typescript
if (isResearch && node.id !== "write_artifacts") {
  // Research nodes can only use web_search, web_fetch, done
  researchPrefix += `\nYou may ONLY use these tools: web_search, web_fetch, and done.`;
} else if (node.id === "write_artifacts") {
  researchPrefix += `\nYou may ONLY write files under .alix/reports/. Use file.create, file.exists, and done.`;
}
```

Also update system prompt to include profile restrictions.

### Task 3: Add timeout enforcement

**Files:** `src/kernel/graph-executor.ts`

- [ ] In `execute()`, pass the timeout to `runTask`:

```typescript
const nodeTimeout = node.timeoutMs ?? (isResearch ? 120000 : undefined);
const result: RunResult = await runTask(this.cwd, node.goal + researchPrefix, {
  planMode: false,
  skipContext: isResearch ? true : undefined,
  sessionMode: node.riskLevel === "high" || node.riskLevel === "critical" ? "ask" : "bypass",
});
```

### Task 4: Disable skill-factory during research execution  

**Files:** `src/kernel/graph-executor.ts`

- [ ] Add to the `execute()` method before `runTask`:

```typescript
const runOpts: any = {
  planMode: false,
  sessionMode: node.riskLevel === "high" || node.riskLevel === "critical" ? "ask" : "bypass",
  skipContext: isResearch,
};
```

Wrap runTask in a try-catch with a proper timeout:

```typescript
try {
  const result: RunResult = await runTask(this.cwd, node.goal + researchPrefix, runOpts);
  // ... existing code ...
} catch (err) {
  status = "failed";
  reason = err instanceof Error ? err.message : String(err);
  failed = true;
}
```

### Task 5: Update research.deep_report graph with timeouts and max iterations

**Files:** `src/sop/research-deep-report.ts`

- [ ] Add `timeoutMs` and `maxIterations` to each node:

```typescript
makeNode("scope_topic", graphId, "Define research scope", ..., timeoutMs: 60000, maxIterations: 2),
makeNode("search_sources", graphId, "Search for sources", ..., timeoutMs: 120000, maxIterations: 3),
makeNode("extract_claims", graphId, "Extract claims from sources", ..., timeoutMs: 120000, maxIterations: 2),
makeNode("synthesize", graphId, "Synthesize report", ..., timeoutMs: 120000, maxIterations: 2),
makeNode("critic_review", graphId, "Critic review", ..., timeoutMs: 60000, maxIterations: 1),
makeNode("write_artifacts", graphId, "Write report artifacts", ..., timeoutMs: 30000, maxIterations: 1),
```

### Task 6: Tests

**Files:** `tests/kernel/graph-executor.test.ts`

- [ ] Add test: research nodes have allowedTools populated
- [ ] Add test: artifact node has filesystem.write but not filesystem.read

---

## Implementation Order

1. Task 1: Add fields to TaskNode type
2. Task 2: Add tool filtering in GraphExecutor
3. Task 3: Add timeout enforcement
4. Task 4: Disable skill-factory
5. Task 5: Update SOP graph with timeouts and max iterations
6. Task 6: Tests
