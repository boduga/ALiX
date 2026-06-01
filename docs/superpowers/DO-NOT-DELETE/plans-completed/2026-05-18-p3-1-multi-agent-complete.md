# P3.1 Multi-Agent Coordination — Complete

> **For agentic workers:** Use subagent-driven-development or inline execution below.

**Goal:** Complete P3.1 by adding ContextCompiler integration to subagent, then update plan doc to match actual implementation.

**Architecture:** Inject ContextCompiler into SubagentCLI to provide context bundle in subagent system prompt. Update plan doc to accurately reflect what's implemented vs what was added.

---

## Task 1: Add ContextCompiler to SubagentCLI

**Files:**
- Modify: `src/agents/subagent-cli.ts`
- Modify: `src/repomap/context-compiler.ts` (export needed types)

- [ ] **Step 1: Add ContextCompiler import and warmup**

Add to imports in `subagent-cli.ts`:
```typescript
import { ContextCompiler } from "../repomap/context-compiler.js";
import type { ContextBundle } from "../repomap/context-compiler.js";
```

Add after config loading (around line 100):
```typescript
// Warm up context compiler
const contextCompiler = new ContextCompiler();
await contextCompiler.warm(projectRoot);
```

- [ ] **Step 2: Compile context bundle and inject into system prompt**

After the system prompt construction (around line 208), add context injection:

```typescript
// Compile context for this task
const contextBundle = await contextCompiler.compile(
  prompt,
  "explore", // default task type for subagents
  4000,      // max tokens for context
  []         // no pinned paths for subagents
);

const contextSection = contextBundle.primaryFiles.length > 0
  ? `\n## Relevant Files\n${contextBundle.primaryFiles.map(f => `- ${f.path}`).join("\n")}`
  : "";

const systemPrompt = `${roleInstructions}
Task: ${prompt}${contextSection}

## Critical Rules
...
```

- [ ] **Step 3: Run build to verify**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Test subagent with context**

Run: `alix agent explorer "list files in src/agents/"` and verify it receives context

- [ ] **Step 5: Commit**

```bash
git add src/agents/subagent-cli.ts
git commit -m "feat(subagent): inject context bundle into subagent system prompt"
```

---

## Task 2: Update Plan Document to Match Implementation

**Files:**
- Create: `docs/superpowers/plans/2026-05-18-p3-1-multi-agent-complete.md`

- [ ] **Step 1: Write updated plan documenting actual implementation**

```markdown
# P3.1 Multi-Agent Coordination — Implementation Plan (Updated)

## What Was Built

### Core Components (src/agents/)

| Component | File | Description |
|-----------|------|-------------|
| SubagentManager | `subagent-manager.ts` | Spawn/track/terminate child processes, ownership tracking |
| SubagentCLI | `subagent-cli.ts` | Entry point, model calls, tool execution, findings |
| delegate-tool | `delegate-tool.ts` | Parent spawns subagents via tool call |
| OwnershipRegistry | `ownership-registry.ts` | Prevents overlapping write ownership |
| MergeCoordinator | `merge-coordinator.ts` | Merges findings, detects conflicts |
| ResultContractValidator | `result-contract-validator.ts` | Validates subagent output format |
| tool-policy.ts | `tool-policy.ts` | Role-based tool restrictions (read-only vs write) |
| tool-name-map.ts | `tool-name-map.ts` | Maps model tool names to executor names |

### Key Implementation Details

**SubagentCLI features:**
- MCP tool integration with ToolSelector (per-task selection based on intent)
- Semantic scoring via n-gram Jaccard similarity
- Per-model reliability config (preferKeywordScoring)
- Role-based tool filtering via tool-policy.ts
- Hallucination filtering via isToolCallText() detection
- Findings built from tool outputs, not model text

**SubagentManager features:**
- Process spawning with ownership registry
- Concurrent subagent tracking
- Callback on completion
- Mode-based tool restriction (read_only vs write)

**delegate-tool features:**
- buildTask callback for task construction
- onResult callback for result handling
- Worker role requires ownedPaths

### Config Integration

Subagent config in schema.ts:
- `SubagentRole` type: "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker"
- `SubagentStyle`: "thinking" | "coding" | "fast"
- `ModelTierConfig`: provider + model per style
- ToolConfig: maxTools, tokenBudget, reliabilityDefaults

### What Was Added (vs Original Plan)

Original plan had 7 tasks. Actual implementation:

| Original Task | Status | Notes |
|---------------|--------|-------|
| Task 1: Types and Config | ✅ | Extended with ModelTierConfig, ToolConfig |
| Task 2: SubagentManager | ✅ | Same implementation |
| Task 3: SubagentCLI | ✅ | Extended with MCP, semantic scoring, tool policy |
| Task 4: delegate tool | ✅ | Same implementation |
| Task 5: TaskDelegator, OwnershipRegistry, ResultContractValidator | ✅ | OwnershipRegistry separate from TaskDelegator |
| Task 6: MergeCoordinator + EventBridge | ✅ | EventBridge implicit in event logging |
| Task 7: CLI + failure handling | ✅ | CLI command plus tool-policy-based restrictions |

### Remaining Items (Future)

1. **ContextCompiler injection** — Add context bundle to subagent prompt (Task 1 above)
2. **Intent-based role selection** — TaskDelegator could auto-pick role from task type
3. **Subagent timeline in UI** — Frontend observability for subagent progress
4. **Parent approval for worker writes** — Worker subagent writes need confirmation step
```

- [ ] **Step 2: Commit plan**

```bash
git add docs/superpowers/plans/2026-05-18-p3-1-multi-agent-complete.md
git commit -m "docs: add P3.1 complete implementation plan"
```

---

## Task 3: Update post-mvp-backlog.md

- [ ] **Step 1: Update P3.1 section**

```markdown
#### P3.1: Multi-Agent Coordination (Spec Gap #10)

Current state: All components implemented
- ✅ SubagentManager — spawn/track/terminate child processes
- ✅ SubagentCLI — entry point with MCP integration, semantic scoring, tool policy
- ✅ delegate-tool — parent spawns subagents
- ✅ OwnershipRegistry — prevents overlapping write ownership
- ✅ MergeCoordinator — merges findings, detects conflicts
- ✅ ResultContractValidator — validates subagent output
- ✅ tool-policy.ts — role-based tool restrictions
- ✅ tool-name-map.ts — model to executor name mapping
- ✅ ContextCompiler integration — pending (in progress)

Dependencies met: P0.1 ✅ P1.1 ✅
```