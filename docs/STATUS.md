# ALiX Feature Status & Audit Ledger

> **Last Updated:** 2026-05-24
> **Tracking:** Git log + commits on main branch

---

## Completed

| Feature | Date | Commit | Notes |
|---------|------|--------|-------|
| P1.2 Verification planner | 2026-05-24 | `bed09a3` | Cost ordering, dependency graph, smart test selection |
| Shell security Levels 3-4 | 2026-05-24 | `4833a7a` | Blacklist + whitelist, evasion detection |
| Critical-risk patterns | 2026-05-24 | `d8ca04f` | CommandClassifier with inline-exec, pipe-shell, rm-rf |
| Evasion detection | 2026-05-24 | `8aa34c0` | PolicyEngine blocks base64, reverse shells, nohup |
| ShellWhitelist module | 2026-05-24 | `4bb40bd` | Allow-list mode, BLOCKED_COMMANDS |
| Tool lifecycle streaming | 2026-05-23 | `d800f9e` | Tool outputs + lifecycle events to stdout |
| ShellPool persistence | 2026-05-23 | `17ce29e` | Persistent bash process across calls |
| Shell command chaining | 2026-05-23 | `e724303` | Tool description with && examples |
| Skip verification for read-only | 2026-05-23 | `3f1715e` | hasMutations check before verification |
| Multi-embedder verification | 2026-05-23 | `7ac83bc` | Failure DB, scorer, exemplar, task loop integration |
| Historical failure matching | 2026-05-23 | `d8dc335` | Query suggestions on verification failure |
| TaskLoop integration | 2026-05-23 | `3694964` | EnhancedVerifier hook points |
| Resource cleanup | 2026-05-23 | `233598b` | EnhancedVerifier.close() on task end |
| Research task type | 2026-05-22 | `bb81066` | Web search for non-coding prompts |
| Provider consolidation | 2026-05-22 | `f0f5f28` | Shared catalog |
| P0.1 Context Compiler | 2026-05-20 | `b59640e` | Ranked repo context bundle with intent classification |

---

## In Progress

*None*

---

## Next Up

1. **Level 5 Shell Security** - Replace shell.run with explicit tools (NoShellRouter)

---

## Not Started

| Feature | Priority | Notes |
|---------|----------|-------|
| Multi-agent coordination | P3.1 | Read-only subagents, ownership registry |
| Memory system | P3.2 | Project/user/session/tool/repo layers |

---

## How to Update

When a feature is merged to main:
1. Add row to Completed table with commit hash
2. Update "Last Updated" date
3. Commit: `docs: update STATUS.md`

**Rule:** Plan files stay in `docs/superpowers/plans/` (git-tracked), not worktrees.