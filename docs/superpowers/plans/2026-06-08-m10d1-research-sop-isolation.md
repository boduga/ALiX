# M0.10-D.1: Research SOP Execution Isolation

**Status:** ✅ Completed (M0.26) — Plan implemented and committed to main.

**Goal:** Make `research.deep_report` nodes execute in a web-first, repo-isolated mode — no local file reads, only `web_search`/`web_fetch`/`done`.

---

### Issue 1: CLI flag parsing

The `alix sop run` handler passes `--topic` value to `sop.buildGraph()`, but `--plan-only` is NOT parsed — it leaks into topic via `args.slice(topicIdx + 1).join(" ")`.

**Fix:** Parse flags before constructing topic.

```typescript
const topicIdx = args.indexOf("--topic");
const planOnly = args.includes("--plan-only");
const topic = topicIdx >= 0
  ? args.slice(topicIdx + 1).filter(a => !a.startsWith("--")).join(" ")
  : "";
```

Also reject bracket literals:
```typescript
if (topic.includes("[") || topic.includes("]")) {
  console.error("Unexpected bracket syntax. Did you mean --plan-only instead of [--plan-only]?");
  process.exit(1);
}
```

### Issue 2: Research nodes need constrained tools

The root cause: `GraphExecutor.execute()` calls `runTask()` which gives each node the full coding-agent toolset (file.read, shell.run, etc.). Research nodes should only have web tools.

**Fix:** Add an `executionProfile` field to `TaskNode`:

```typescript
export type ExecutionProfile = "default" | "research";
```

Research profile means:
- `skipContext: true` (no repo context compilation)
- Tool filtering: only `web_search`, `web_fetch`, `done` allowed
- `planMode: false`
- `sessionMode: "bypass"`

**In `GraphExecutor.execute()`**, check `node.executionProfile`:

```typescript
const opts: RunOpts = {
  planMode: false,
  sessionMode: node.riskLevel === "high" || node.riskLevel === "critical" ? "ask" : "bypass",
  skipContext: node.executionProfile === "research",
};
```

But `RunOpts` doesn't have a tool filter. For M0.10-D.1, the simplest fix: prepend a system instruction to the node goal that restricts tool use.

**Better fix:** Use a `systemPrompt` override in the node's goal:

```
Goal for research node:
  "Search the web for sources about 'topic'. Use ONLY web_search. Do NOT read local files."
```

This instructs the model without needing new infrastructure.

### Issue 3: Artifact path guard

`write_artifacts` node should only write under `.alix/reports/<reportId>/`.

**Fix:** The `writeReportArtifacts()` function already writes to `.alix/reports/<reportId>/`. Add a safety check in the SOP runner that verifies the path before execution.

---

## Implementation

### Task 1: Fix CLI flag parsing

**Files:** `src/cli.ts`

- [ ] Fix `--plan-only` flag parsing and `--topic` value extraction
- [ ] Reject bracket literals in topic
- [ ] Print "Plan-only mode. Not executing." when --plan-only is set
- [ ] Test: `alix sop run research.deep_report --topic "vector databases" --plan-only` shows plan-only message
- [ ] Test: `alix sop run research.deep_report --topic "vector databases" [--plan-only]` shows bracket error

### Task 2: Add research profile to graph builder

**Files:** `src/sop/research-deep-report.ts`

- [ ] Add `executionProfile: "research"` to all 6 nodes (or at least the search/claims nodes)
- [ ] Enhanced node goals that explicitly restrict tools:
  - scope_topic: "Define research scope. Do NOT read local files."
  - search_sources: "Search the web ONLY. Use web_search. Do NOT read local files."
  - extract_claims: "Read the sources found. Do NOT read local project files."
  - synthesize: "Write report using extracted data."
  - critic_review: "Review the report."
  - write_artifacts: "Write files to .alix/reports/<reportId>/ only."

### Task 3: Wire research profile in GraphExecutor

**Files:** `src/kernel/graph-executor.ts`, `src/kernel/task-graph.ts`

- [ ] Add `ExecutionProfile` type to `task-graph.ts`
- [ ] Add `executionProfile?: ExecutionProfile` to `TaskNode`
- [ ] In `GraphExecutor.execute()`, when `executionProfile === "research"`, set `skipContext: true`
- [ ] Add a system prompt override to the runTask call for research nodes: `"You are a research agent. Use ONLY web_search and web_fetch. Do NOT read or write local project files."`

### Task 4: Artifact path guard

**Files:** `src/sop/artifact-writer.ts`

- [ ] Verify `writeReportArtifacts()` already restricts to `.alix/reports/` (it does)
- [ ] Write a note in the SOP runner about the artifact path restriction

### Task 5: Tests

**Files:** `tests/sop/research-deep-report.test.ts`

- [ ] Add test: research nodes have executionProfile: "research"
- [ ] Add test: artifact path starts with .alix/reports/
- [ ] Add test: node goals contain web-only instructions
