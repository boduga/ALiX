# Borrow Patterns From Other Harnesses

> **For agentic workers:** This is a RESEARCH and DOCUMENTATION plan. Read each section to understand patterns to implement, then use subagent-driven-development for implementation.

**Goal:** Document patterns to borrow from other agentic harnesses and specify which to implement in ALiX.

**Source Harnesses:** Claude Code, Codex CLI, Gemini CLI, OpenHands, OpenCode, Aider, Goose

---

## Shell Tool Patterns (Priority: HIGH)

### Claude Code Pattern: Persistent Working Directory

**What it does:** Maintains shell state across calls, so `cd` persists.

**How to borrow:**
1. **Quick fix:** Add examples to tool description (`cd && cmd`)
2. **Full implementation:** ShellPool class that maintains bash process

**Current gap:** Each `shell.run` spawns fresh shell, `cd` doesn't persist.

### Codex CLI Pattern: Sandboxed Execution

**What it does:** Isolated command execution with resource limits.

**How to borrow:**
- Already partially implemented via `runWithIsolation` in test-isolation.ts
- Could extend to shell tool

### OpenHands Pattern: Multiple Runtime Modes

**What it does:** Docker, process, and remote sandbox runtimes.

**How to borrow:**
- Add `runtime` config option: `process` (default) | `docker` | `remote`
- Implement DockerSandbox class

---

## Context Selection Patterns (Priority: HIGH)

### Aider Pattern: Tree-sitter Repo Map

**What it does:** Uses Tree-sitter for accurate symbol extraction and code structure understanding.

**How to borrow:**
- Already implemented: `src/repomap/` with Lite approach
- Could enhance with Tree-sitter for better AST parsing

### Aider Pattern: Dynamic Token Budget

**What it does:** Token-budgeted context that dynamically adjusts based on model limits.

**How to borrow:**
- Already implemented: `ContextCompiler` with token limits
- Could enhance with smarter budget allocation

### Aider Pattern: Git-Native Checkpoints

**What it does:** Git stash-based isolation for verification commands.

**How to borrow:**
- Already implemented: `test-isolation.ts` with stash/restore
- Already implemented: `CheckpointManager` for patch rollback

---

## Extension Patterns (Priority: MEDIUM)

### Goose Pattern: MCP-First Extensions

**What it does:** All extensions via MCP protocol.

**How to borrow:**
- Already implemented: MCP Manager with deferral
- Could enhance: Add MCP server discovery and lazy loading

### Goose Pattern: Recipes

**What it does:** Repeatable task recipes as code.

**How to borrow:**
- Already implemented: Skills as markdown workflows
- Could enhance: Add recipe runner with variables

### OpenCode Pattern: LSP Diagnostics

**What it does:** Use LSP language servers as tools for real-time diagnostics.

**How to borrow:**
- New feature: Add LSP diagnostic tool that runs `tsserver` or `clangd`
- Integrate via MCP protocol

---

## Tool Discovery Patterns (Priority: MEDIUM)

### Goose Pattern: Lazy Tool Discovery

**What it does:** Only load tool schemas when needed, not all at once.

**How to borrow:**
- Already implemented: `ToolSelector` with MCP deferral
- Could enhance: Meta-tool for discovering tools by category

### OpenCode Pattern: Built-in Dev Tools

**What it does:** grep, glob, view, write, edit, patch, bash, fetch, diagnostics.

**How to borrow:**
- Already implemented: file tools, dir.search, shell.run
- Could add: `lsp_diagnostics`, `grep`, `glob` as native tools

---

## Verification Patterns (Priority: MEDIUM)

### Codex CLI Pattern: Review/Verifier Agent

**What it does:** Separate agent for reviewing changes and running verification.

**How to borrow:**
- Already implemented: `verifyAndScore()` in EnhancedVerifier
- Could enhance: Add dedicated verifier agent that reviews patches

### Aider Pattern: Graph Ranking

**What it does:** PageRank-style ranking of files by relevance.

**How to borrow:**
- Partially implemented in `ContextCompiler`
- Could enhance with actual graph-based ranking

---

## Shell Security (Based on IndyDevDan)

Based on [IndyDevDan's "Five Levels of Bash Security"](https://www.youtube.com/watch?v=yBcmIoA-vGs) video.

| Level | Description | Status | Plan |
|-------|-------------|--------|------|
| Level 1 | User prompt/skill | ✅ Done | N/A |
| Level 2 | System prompt | ✅ Done | N/A |
| Level 3 | Bash + Blacklist | ✅ Done | `2026-05-24-shell-security-blacklist.md` |
| Level 4 | Bash + Whitelist | 📋 Planned | `2026-05-24-shell-security-whitelist.md` |
| Level 5 | No Bash Tool | 📋 Planned | `2026-05-24-shell-security-no-bash.md` |

---

## Implementation Priority (Future Work)

1. ~~Shell tool description~~ — ✅ Complete
2. **Tree-sitter repo map** — Enhance symbol extraction with AST parsing
3. **Enhanced graph ranking** — PageRank-style file relevance
4. **Skip for now:** Multiple runtime modes (complex, not needed)
5. **Skip for now:** LSP diagnostics (TypeScript already works)

---

## References

- Full research: `docs/agentic-harness-research.md`
- Implementation specs: `docs/architecture/`
- Already implemented: See `docs/superpowers/plans/`