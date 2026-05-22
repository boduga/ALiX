---
name: refactor
description: Safe refactoring using GitNexus blast radius analysis. Trace impact before touching code, rename safely, identify affected execution flows.
trigger: /refactor
pattern: "refactor|rename|extract|split|restructure|improve.*code"
version: "1.0.0"
is_core: true
tags: [refactoring, quality, architecture]
---

# Safe Refactoring

## Core Principle

**Always analyze impact before touching code.** Use GitNexus to understand blast radius before making changes.

## The Process

1. **Analyze impact** — Run `gitnexus_impact()` to find direct callers and downstream effects
2. **Trace flows** — Use `gitnexus_query()` to find related execution flows
3. **Plan changes** — Identify all files that need updates
4. **Rename safely** — Use `gitnexus_rename()` instead of find-replace
5. **Verify** — Run tests, check affected flows still work

## GitNexus Commands

- `gitnexus_impact({target: "functionName", direction: "upstream"})` — What calls this?
- `gitnexus_query({query: "concept"})` — Find execution flows
- `gitnexus_rename()` — Safe rename across call graph

## Blast Radius Levels

| Level | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK | Direct callers need updates |
| d=2 | LIKELY AFFECTED | Check integration points |
| d=3 | MAY NEED TESTING | Verify no regressions |

## When to Refactor

- Code is duplicated (DRY violation)
- Function is doing too much (split it)
- Naming is unclear (rename for clarity)
- Coupling is tight (extract interfaces)
- Module is shallow (add depth)

## Anti-Patterns

- Refactoring without tests
- Find-replace renaming (misses callers)
- "While I'm here" improvements
- Changing working code just to look cleaner

## Red Flags

STOP if:
- No test coverage for refactored code
- Changes would break many callers
- Architecture needs redesign (not just refactor)
- You're guessing about dependencies