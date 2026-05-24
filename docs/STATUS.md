# ALiX Feature Status & Audit Ledger

> **Last Updated:** 2026-05-23
> **Tracking:** Git log + commits on main branch

---

## Completed

| Feature | Date | Commit | Notes |
|---------|------|--------|-------|
| Multi-embedder verification | 2026-05-23 | `7ac83bc` | Failure DB, scorer, exemplar, task loop integration |
| Historical failure matching | 2026-05-23 | `d8dc335` | Query suggestions on verification failure |
| TaskLoop integration | 2026-05-23 | `3694964` | EnhancedVerifier hook points |
| Resource cleanup | 2026-05-23 | `233598b` | EnhancedVerifier.close() on task end |
| Research task type | 2026-05-22 | `bb81066` | Web search for non-coding prompts |
| Provider consolidation | 2026-05-22 | `f0f5f28` | Shared catalog |

---

## In Progress

*None* - worktree cleared, state clean

---

## Next Up

1. **P0.1 Context Compiler** - Ranked repo context bundle with intent classification
2. **P1.1 Frontend observability** - Diff viewer, approval panel, replay controls

---

## How to Update

When a feature is merged to main:
1. Add row to Completed table with commit hash
2. Update "Last Updated" date
3. Commit: `docs: update STATUS.md`

**Rule:** Plan files stay in `docs/superpowers/plans/` (git-tracked), not worktrees.