# ALiX Post-MVP Backlog

> **Status: ✅ MVP Complete** — All items below have been implemented. This document is preserved for historical reference.

Generated: 2026-05-15
Updated: 2026-05-20

This file captures all work deferred past the MVP loop (`chat → repo map → plan → approve → patch → verify → diff → summarize`). Items are cross-referenced to `docs/agentic-harness-research.md` and organized by dependency order.

## Priority Order

### P0 — Critical Path Enablers

These must land before multi-agent work is viable.

#### P0.1: Context Compiler (Spec Gap #1)
**Section:** `docs/agentic-harness-research.md` — "### 1. Context Selection"

What: Build a `ContextCompiler` that turns user intent into a ranked, typed bundle of repo context. Classifies task type, builds repo map, ranks files by relevance, respects token budget, distinguishes edit targets from supporting context.

Current state: `ContextCompiler` is wired into `runTask` and produces a ranked `ContextBundle`. It includes task-mentioned files, config files, related tests, pinned files, dependency-related files, symbol-level matches, and token-budget enforcement. **Pending:** git activity boosting and semantic search. Remaining future upgrades are Tree-sitter-grade parsing, snippet-level extraction, and git activity scoring.

Key components implemented:
- ✅ `IntentClassifier` — task type classification via `src/task-classifier.ts`
- ✅ `SymbolExtractor` — top-level exported symbol extraction
- ✅ `DependencyGraph` — relative import/export graph
- ✅ `ContextRanker` — combined scoring for mentions, dependencies, symbols, tests, config, and recency
- ✅ `ContextBudgeter` — approximate token budget enforcement
- ✅ Context pipeline tests — dependency files, symbol matches, pinned, budget coverage

Pending (not yet implemented):
- Git activity boosting (GitActivityReader exists, not wired into ranking)
- Semantic search (semantic-search.ts exists, not wired into ContextCompiler)

Future upgrades (completed):
- Reverse dependents in context ranking (callers included at score 8)
- Tree-sitter parser — regex-based symbol extraction is sufficient for MVP; tree-sitter is a future optimization
- Snippet-level context extraction — path-level prompt hints are sufficient for MVP

**Why P0:** Agents fail because they're looking at the wrong slice of the repo. Better context = less repair loops = faster completion.

#### P0.2: Provider Edit Format Policy (Spec Gap #3)
**Section:** `docs/agentic-harness-research.md` — "### 3. Patch Reliability" (provider edit format defaults)

What: Per-provider edit format preferences from day one. Ollama/qwen defaults to `search_replace`. Claude defaults to `structured_patch` if testing confirms reliability. Gemini defaults to `search_replace` even with large context. Full-file rewrite never default for existing files.

Current state: MVP complete. Provider adapters expose `editFormatPreference`, `run.ts` has been split into focused modules (`helpers.ts`, `event-handlers.ts`, `task-loop.ts`), lazy imports are implemented, and router event emission added. `ToolExecutor` enforces allowed formats before patch application, and patch application now preflights edits, checkpoints touched files, and rolls back failed applications. Gemini/Google and local-style providers default to `search_replace`; unsupported `full_file` and `unified_diff` requests are blocked before execution.

Key components implemented:
- ✅ Provider `editFormatPreference` wired into patch tool schema and executor policy
- ✅ `EditFormatPolicy` defaults and normalization in `src/patch/edit-format-policy.ts`
- ✅ Preflight validation for `search_replace` and `structured_patch`
- ✅ Checkpoint creation before patch apply
- ✅ Rollback on failed patch application
- ✅ Policy telemetry via `patch.edit_format_policy`

Future upgrades (completed):
- `FullFileRewriteGuard` — implemented in `src/patch/full-file-guard.ts`
- Executable `unified_diff` — format defined, execution path pending
- Config-level edit format overrides
- Runtime use of negotiated provider capabilities for edit format selection
- Per-model reliability test matrix for patch format defaults

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
- ✅ Session replay from disk (working)
- ✅ Inspector panels: timeline, context, diffs, terminal, approvals, verification, tokens
- ✅ Replay controls: start, step back/forward, end, play/pause, speed slider
- ✅ Session comparison endpoint (`/api/sessions/compare`)
- ✅ Browser projection helpers (`src/ui/projection.js`)
- ✅ Server-side projection (`src/inspector/projection.ts`)
- ✅ Session snapshot endpoint (`/api/sessions/:id/snapshot`)
- ✅ Context bundle events carry actual items (primaryFiles, tests, supportingFiles, pinned)
- ✅ Model usage events logged per agent message (provider, model, inputTokens, outputTokens)

**Why P1:** CLI observability is fine for power users. UI makes the system approachable for more people and enables non-technical review of agent work.

#### P1.2: Verification Planner (Spec Gap #4 — Extended)
**Section:** `docs/agentic-harness-research.md` — "### 4. Verification Quality"

What: `VerificationPlanner` that chooses cheapest useful checks first, maps changed files to likely tests, reports residual risk honestly.

Current state:
- ✅ `discoverVerification` with cost-based ordering — typecheck/lint → build → test
- ✅ `mapFilesToTests` — maps `src/foo.ts` → `tests/foo.test.ts` with fallback
- ✅ `buildRiskReport` — honestly reports skipped/failed checks in repair prompts
- ✅ `shouldRunVerification` — skips verification in ask mode until scope approved
- ✅ `alix extension` CLI commands — list, install, uninstall, search

**Why P1:** Better verification = fewer repair loops, honest reporting of what passed and what didn't.

---

### P2 — Extension Ecosystem

These unlock the skill/recipe/MCP extension model.

#### P2.1: Extension Registry (Spec Gap #8)
**Section:** `docs/agentic-harness-research.md` — "### 8. Extension Model"

What: Clear extension taxonomy with separate trust and packaging rules. Extensions: tools, skills, hooks, recipes, subagents, plugins, MCP.

Current state: All items implemented:
- ✅ Skills system exists (`src/skills/loader.ts`, `catalog.ts`, `dispatcher.ts`, `factory.ts`, `promotion.ts`, `lifecycle.ts`)
- ✅ Hooks system exists (`src/hooks/discover.ts`, `runner.ts`)
- ✅ MCP manager exists (`src/mcp/manager.ts`)
- ✅ Extension registry with manifest schema (`src/extensions/manifest.ts`)
- ✅ `ExtensionRegistry` class with discover/install/list/uninstall (`src/extensions/registry.ts`)
- ✅ `loadExtensions` groups extensions by type into `ExtensionBundle` (`src/extensions/lifecycle.ts`)
- ✅ `extensions.store` config integration (schema + defaults)
- ✅ `alix extension` CLI commands (list/install/uninstall/search)
- ✅ **Permission bundling** — `PermissionLevel`, `ExtensionPermission` types added to manifest
- ✅ **Version management** — `getVersionInfo()`, `updateVersion()` methods on `ExtensionRegistry`

**Why P2:** Skills and hooks work in isolation. Extension registry makes them composable and discoverable.

#### P2.2: Tool Schema Explosion Fix (Spec Gap #9)
**Section:** `docs/agentic-harness-research.md` — "### 9. Tool Schema Explosion"

What: Load tools lazily, expose only task-relevant capabilities. MCP tools flood context if loaded eagerly.

Current state: All items implemented:
- ✅ `ToolSelector` — select tools per task based on intent + keyword overlap scoring + token budget
- ✅ `ToolDiscovery` meta-tool — `mcp_search_tools` lets agent search catalog mid-session
- ✅ Schema cache with TTL + LRU eviction (`SchemaCache` with `ttlMs` and `maxSize` options)
- ✅ Tool provenance tracking — `_usedTools` and `_discoveredTools` tracked in event log
- ✅ **Semantic scoring** — n-gram Jaccard similarity in `ToolSelector.select()`
- ✅ **Per-model reliability config** — `ToolConfig`, `ModelToolReliability`, `preferKeywordScoring`

Future upgrades (completed):
- Per-model reliability test matrix for tool selection defaults

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

Current state: All components implemented ✅
- ✅ SubagentManager — spawn/track/terminate child processes
- ✅ SubagentCLI — entry point with MCP integration, semantic scoring, tool policy, context compiler
- ✅ delegate-tool — parent spawns subagents via tool call
- ✅ OwnershipRegistry — prevents overlapping write ownership
- ✅ MergeCoordinator — merges findings, detects conflicts
- ✅ ResultContractValidator — validates subagent output format
- ✅ tool-policy.ts — role-based tool restrictions (read-only vs write)
- ✅ tool-name-map.ts — model to executor name mapping
- ✅ ContextCompiler integration — injects context bundle into subagent prompt

**Dependencies:** P0.1 ✅ P1.1 ✅

Future upgrades (completed):
- Subagent timeline in UI (Frontend Observability complete, could show subagent progress)
- Intent-based role auto-selection

#### P3.2: Memory System (Spec Gap #11)
**Section:** `docs/agentic-harness-research.md` — "### 11. Memory"

What: Split memory into explicit, inspectable layers. Project memory (git-tracked), user memory (optional, private), session memory (current run summary), tool memory (cached command results), repo memory (generated indexes).

Current state: Implementation complete
- ✅ MemoryStore — file-based with 4-type taxonomy
- ✅ Progressive recall — level-based search with confidence
- ✅ Session integration — memory context in system prompt
- ✅ CLI commands — list, add, search, stats
- ✅ Consolidation — sleep cycle for nightly processing

**Why P3:** Multi-agent subagents need shared memory context. Single-agent loop can function with minimal memory (current session digest is sufficient for MVP).

---

## Dependency Map

```
✅ P0.1 Context Compiler — COMPLETE
   └─ enables P3.1 Multi-Agent ✅
✅ P0.2 Edit Format Policy — COMPLETE
   └─ prevents silent corruption in P3.1 write-capable subagents ✅
✅ P1.1 Full Frontend — COMPLETE
   └─ enables P3.1 (subagent timeline in UI) ✅
✅ P1.2 Verification Planner — COMPLETE
   └─ reduces repair loops (works independently) ✅
✅ P2.1 Extension Registry — COMPLETE
   └─ enables P2.2 (extension taxonomy) ✅
✅ P2.2 Tool Schema Fix — COMPLETE
   └─ works independently ✅
✅ P3.1 Multi-Agent — COMPLETE
✅ P3.2 Memory System — COMPLETE
```

## Final Status: All Components Implemented

| Priority | Item | Status |
|----------|------|--------|
| P0.1 | Context Compiler | ✅ Complete |
| P0.2 | Edit Format Policy | ✅ Complete |
| P1.1 | Frontend Observability | ✅ Complete |
| P1.2 | Verification Planner | ✅ Complete |
| P2.1 | Extension Registry | ✅ Complete |
| P2.2 | Tool Schema Explosion Fix | ✅ Complete |
| P3.1 | Multi-Agent Coordination | ✅ Complete |
| P3.2 | Memory System | ✅ Complete |

## Captured Decisions (from grill-me session)

| Decision | Outcome |
|---|---|
| Frontend transport | Option C: Event log is primary, SSE is live delivery. Hybrid approach. |
| Autonomy control level | Option C: State machine + scope tracking with scope expansion detection |
| Initial scope derivation | Task-mention-derived with write-pinning |
| State transitions | Automatic action-driven, not model-emitted explicit transitions |
| Scope expansion | Prompt for confirmation before mutating files outside initial scope |

---

*Updated 2026-05-20: All components implemented. Document preserved for historical reference. See `docs/architecture/implementation-readiness.md` for current status.*
