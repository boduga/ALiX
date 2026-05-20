# Docs Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update ADR/backlog/docs to reflect what is actually implemented vs planned.

**Architecture:** Review all docs and sync with current implementation.

**Tech Stack:** Markdown editing.

---

### Task 1: Review ADR-0002 (Runtime Builder)

**Files:**
- Read: `docs/adr/ADR-0002-runtime-builder.md`

- [ ] **Step 1: Compare ADR with implementation**

Check what ADR says vs what RuntimeBuilder actually does:
- Is RuntimeBuilder actually used by run.ts?
- What's the intended use case?
- Are there TODOs that should be removed?

- [ ] **Step 2: Update ADR**

If ADR is outdated, update it to reflect reality:
- If RuntimeBuilder is NOT used by run.ts: document it as "for alternate entrypoints"
- If there are TODOs now done: remove them
- If implementation diverges: document the actual behavior

- [ ] **Step 3: Commit**

```bash
git add docs/adr/ADR-0002-runtime-builder.md
git commit -m "docs: update ADR-0002 to reflect actual RuntimeBuilder usage

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
"
```

---

### Task 2: Review Post-MVP Backlog

**Files:**
- Read: `docs/post-mvp-backlog.md`

- [ ] **Step 1: Check all items**

For each item in the backlog:
- Is it marked complete but actually incomplete?
- Is it marked pending but actually done?
- Are there future upgrades documented that are now done?

- [ ] **Step 2: Update status**

Update the backlog to reflect accurate status:
- Mark any items as complete that are done
- Note any future upgrades that were implemented

Example updates:
```
Future upgrades (implemented):
- Semantic search (completed in P0.1)
- Tree-sitter parser (not started - move to backlog)
```

- [ ] **Step 3: Commit**

```bash
git add docs/post-mvp-backlog.md
git commit -m "docs: update post-mvp-backlog status

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
"
```

---

### Task 3: Review ContextCompiler Docs

**Files:**
- Read: `docs/post-mvp-backlog.md` (P0.1 section)
- Read: `src/repomap/context-compiler.ts` (header comments)

- [ ] **Step 1: Compare P0.1 description with implementation**

Check what P0.1 says about ContextCompiler features vs what's actually implemented:
- IntentClassifier ✅
- SymbolExtractor ✅
- DependencyGraph ✅
- GitActivityReader ✅
- ContextRanker ✅
- ContextBudgeter ✅
- Semantic search (future?)
- Tree-sitter parser (future?)

- [ ] **Step 2: Update docs**

Ensure future upgrades section is accurate.

- [ ] **Step 3: Commit**

```bash
git add docs/post-mvp-backlog.md
git commit -m "docs: clarify ContextCompiler future upgrades

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
"
```

---

### Task 4: Verify ToolRouter ADR

**Files:**
- Read: `docs/adr/` (check for ToolRouter ADR)
- Read: `src/tools/tool-router.ts`

- [ ] **Step 1: Check if ToolRouter has ADR**

If there's a ToolRouter ADR, verify it's accurate.
If not, consider creating one.

- [ ] **Step 2: Document if needed**

If no ADR exists and ToolRouter is significant, consider documenting the pattern.

---

### Task 5: Update Superpowers Plans Index

**Files:**
- Read: `docs/superpowers/plans/` (list all plans)
- Modify: `docs/superpowers/README.md` (if exists)

- [ ] **Step 1: List all plans**

Create or update a README listing all plans and their status:
- Completed plans
- In-progress plans
- Pending plans

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/
git commit -m "docs: update plans index to reflect completed work

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
"
```

---

### Task 6: Final Verification

**Files:**
- Read: `CONTEXT.md`
- Read: `CLAUDE.md`

- [ ] **Step 1: Check CLAUDE.md**

Verify CLAUDE.md mentions:
- ToolRouter pattern (if significant)
- RuntimeBuilder (if used)
- ContextPipeline stages (if relevant)

- [ ] **Step 2: Update if needed**

Update CLAUDE.md to reflect current architecture.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md CONTEXT.md
git commit -m "docs: update CLAUDE.md to reflect current architecture

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
"
```