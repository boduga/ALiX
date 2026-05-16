# ALiX Post-MVP Backlog

Generated: 2026-05-15
Status: tracking

This file captures all work deferred past the MVP loop (`chat → repo map → plan → approve → patch → verify → diff → summarize`). Items are cross-referenced to `docs/agentic-harness-research.md` and organized by dependency order.

## Priority Order

### P0 — Critical Path Enablers

These must land before multi-agent work is viable.

#### P0.1: Context Compiler (Spec Gap #1)
**Section:** `docs/agentic-harness-research.md` — "### 1. Context Selection"

What: Build a `ContextCompiler` that turns user intent into a ranked, typed bundle of repo context. Classifies task type, builds repo map, ranks files by relevance, respects token budget, distinguishes edit targets from supporting context.

Current state: `ContextCompiler` is wired into `runTask` and produces a ranked `ContextBundle`. It includes task-mentioned files, config files, related tests, pinned files, dependency-related files, symbol-level matches, git activity scoring, and token-budget enforcement. Remaining future upgrades are semantic search, Tree-sitter-grade parsing, and richer snippet extraction.

Key components implemented:
- ✅ `IntentClassifier` — task type classification via `src/task-classifier.ts`
- ✅ `SymbolExtractor` — top-level exported symbol extraction
- ✅ `DependencyGraph` — relative import/export graph
- ✅ `GitActivityReader` — recent git activity scoring
- ✅ `ContextRanker` — combined scoring for mentions, dependencies, symbols, tests, config, and recency
- ✅ `ContextBudgeter` — approximate token budget enforcement

Future upgrades:
- Tree-sitter parser for more precise symbols and references
- Semantic search over repo content
- Snippet-level context extraction instead of path-level prompt hints

**Why P0:** Agents fail because they're looking at the wrong slice of the repo. Better context = less repair loops = faster completion.

#### P0.2: Provider Edit Format Policy (Spec Gap #3)
**Section:** `docs/agentic-harness-research.md` — "### 3. Patch Reliability" (provider edit format defaults)

What: Per-provider edit format preferences from day one. Ollama/qwen defaults to `search_replace`. Claude defaults to `structured_patch` if testing confirms reliability. Gemini defaults to `search_replace` even with large context. Full-file rewrite never default for existing files.

Current state: `src/patch/edit-format-policy.ts` exists but not wired into run.ts. Provider adapters have `editFormatPreference` but it's not used at patch selection time.

Key work:
- Wire `provider.editFormatPreference` into `PatchEngine` format selection
- Add per-model reliability testing to determine which formats work
- Implement `PreimageValidator` before patch apply
- Implement `CheckpointManager` (create checkpoint before edits)
- Implement `RollbackManager` (restore checkpoint on failed patch)

**Why P0:** Providers vary in patch reliability. Without format policy, weaker local models produce silent corruption.

---

### P1 — Quality Multipliers

These make the single-agent loop significantly better without multi-agent complexity.

#### P1.1: Frontend Observability — Full Feature Set (Spec Gap #5)
**Section:** `docs/agentic-harness-research.md` — "### 5. Frontend Observability"

What: Full vanilla JS inspector UI with all views. SSE server exists (`src/server/server.ts`) and basic UI skeleton exists (`src/ui/`). Missing:

Current state:
- ✅ Event log → JSONL (working)
- ✅ SSE server for live streaming (working)
- ✅ Basic UI timeline (working)
- ✅ Session replay from disk (working)

Missing:
- ❌ Diff viewer (show file changes after patch)
- ❌ Terminal output stream (show shell command results)
- ❌ Approval panel (show pending approvals with approve/deny buttons)
- ❌ Context view (show what files/symbols were included in context)
- ❌ Verification view (show verification results per check)
- ❌ Token usage display
- ❌ Replay controls (pause, step, speed)
- ❌ Session comparison (diff two sessions)

**Why P1:** CLI observability is fine for power users. UI makes the system approachable for more people and enables non-technical review of agent work.

#### P1.2: Verification Planner (Spec Gap #4 — Extended)
**Section:** `docs/agentic-harness-research.md` — "### 4. Verification Quality"

What: `VerificationPlanner` that chooses cheapest useful checks first, maps changed files to likely tests, reports residual risk honestly.

Current state: `src/verifier/verifier.ts` discovers commands from `package.json`. `runWithIsolation` wired in for git stash/restore. Missing:

- ❌ Test mapper — map changed files to related tests (e.g. changing `src/auth.ts` → run `tests/auth.test.ts`)
- ❌ Cost-based ordering — run cheap checks (typecheck, lint) before expensive checks (full test suite)
- ❌ Residual risk reporting — summarize what was NOT verified in final report
- ❌ Policy integration — skip verification when policy says "ask" mode requires approval

**Why P1:** Better verification = fewer repair loops, honest reporting of what passed and what didn't.

---

### P2 — Extension Ecosystem

These unlock the skill/recipe/MCP extension model.

#### P2.1: Extension Registry (Spec Gap #8)
**Section:** `docs/agentic-harness-research.md` — "### 8. Extension Model"

What: Clear extension taxonomy with separate trust and packaging rules. Extensions: tools, skills, hooks, recipes, subagents, plugins, MCP.

Current state:
- ✅ Skills system exists (`src/skills/loader.ts`, `catalog.ts`, `dispatcher.ts`, `factory.ts`, `promotion.ts`, `lifecycle.ts`)
- ✅ Hooks system exists (`src/hooks/discover.ts`, `runner.ts`)
- ✅ MCP manager exists (`src/mcp/manager.ts`)
- ❌ Extension registry with manifest schema
- ❌ Permission bundling per extension
- ❌ Installation/uninstallation workflow
- ❌ Extension version management

**Why P2:** Skills and hooks work in isolation. Extension registry makes them composable and discoverable.

#### P2.2: Tool Schema Explosion Fix (Spec Gap #9)
**Section:** `docs/agentic-harness-research.md` — "### 9. Tool Schema Explosion"

What: Load tools lazily, expose only task-relevant capabilities. MCP tools flood context if loaded eagerly.

Current state: `src/mcp/tool-deferral.ts` has fuzzy search and caching. MCP manager discovers all tools on startup. Missing:

- ❌ `ToolSelector` — select tools per task based on intent
- ❌ `ToolDiscovery` meta-tool — let agent search catalog for additional tools during run
- ❌ Schema cache with TTL
- ❌ Tool provenance tracking in event log

**Why P2:** Prevents token waste and model confusion when many MCP tools are available.

#### P2.3: LSP Diagnostics (For Consideration)
**Section:** `docs/agentic-harness-research.md` — OpenCode borrowing

What: Real-time type errors, symbol navigation (go-to-definition, find-references), and hover info surfaced as agent tools via an MCP adapter for LSP servers.

Current state: None.

**Alternative (preferred):** Run typecheckers in the background via the verifier loop (P1.2). Same diagnostics UX without per-language server management. If the MCP ecosystem produces a good LSP bridge server, revisit this.

**Why listed for consideration:** Useful for IDE-like UX, but high complexity cost (per-language LSP servers, stateful lifecycle management, protocol complexity). Prioritize verifier-based diagnostics first.

---

### P3 — Multi-Agent

These require P0 and P1 to be stable first. A shaky single-agent loop does not become stronger by adding more agents.

**Rule from spec:** "Subagents should stay out of the first milestone. A shaky single-agent loop does not become stronger by adding more agents."

#### P3.1: Multi-Agent Coordination (Spec Gap #10)
**Section:** `docs/agentic-harness-research.md` — "### 10. Multi-Agent Coordination"

What: Read-only subagents first (explorer, reviewer, test investigator, docs researcher). Controlled write-capable workers with explicit ownership. Parent owns final decisions.

Key components:
- `SubagentManager` — spawn and manage subagent processes
- `TaskDelegator` — assign tasks to subagents with clear contracts
- `OwnershipRegistry` — track which subagent owns which file paths
- `SubagentEventBridge` — bridge subagent events into parent event log
- `ResultContractValidator` — validate subagent output against expected format
- `MergeCoordinator` — handle conflicting edits from multiple subagents

MVP behavior: Support read-only subagents only. No subagent writes files in first implementation.

**Dependencies:** Requires Context Compiler (P0.1) for subagent prompt construction. Requires Frontend Observability (P1.1) for subagent timeline in UI.

#### P3.2: Memory System (Spec Gap #11)
**Section:** `docs/agentic-harness-research.md` — "### 11. Memory"

What: Split memory into explicit, inspectable layers. Project memory (git-tracked), user memory (optional, private), session memory (current run summary), tool memory (cached command results), repo memory (generated indexes).

Current state: `src/utils/session-digest.ts` generates rolling summaries. `src/repomap/repomap-lite.ts` generates file indexes. Missing:

- ❌ `ProjectMemoryStore` — read/write project memory file
- ❌ `UserPreferenceStore` — optional private user memory
- ❌ `ToolCache` — cache command results and indexes
- ❌ `MemoryInspector` — CLI command to inspect all memory layers
- ❌ Memory expiry/eviction policy

**Why P3:** Multi-agent subagents need shared memory context. Single-agent loop can function with minimal memory (current session digest is sufficient for MVP).

---

## Dependency Map

```
P0.1 Context Compiler
  └─ enables P3.1 Multi-Agent (subagent prompts)
P0.2 Edit Format Policy
  └─ prevents silent corruption in P3.1 write-capable subagents
P1.1 Full Frontend
  └─ enables P3.1 (subagent timeline in UI)
P1.2 Verification Planner
  └─ reduces repair loops (works independently)
P2.1 Extension Registry
  └─ enables P2.2 (extension taxonomy)
P2.2 Tool Schema Fix
  └─ works independently
P3.1 Multi-Agent
  └─ requires P0.1, P0.2, P1.1
P3.2 Memory System
  └─ works independently, enables P3.1
```

## Captured Decisions (from grill-me session)

| Decision | Outcome |
|---|---|
| Frontend transport | Option C: Event log is primary, SSE is live delivery. Hybrid approach. |
| Autonomy control level | Option C: State machine + scope tracking with scope expansion detection |
| Initial scope derivation | Task-mention-derived with write-pinning |
| State transitions | Automatic action-driven, not model-emitted explicit transitions |
| Scope expansion | Prompt for confirmation before mutating files outside initial scope |

---

*Regenerate this file after major implementation milestones. Cross-check against `docs/agentic-harness-research.md` gaps #1-12.*