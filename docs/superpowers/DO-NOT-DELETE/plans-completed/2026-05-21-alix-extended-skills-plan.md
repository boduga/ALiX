# ALiX Extended Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7 more starter skills for ALiX users.

**Architecture:** Skills follow Hermes format (YAML front matter + markdown body). Each skill lives in `src/cli/commands/skills/<name>/SKILL.md`. Install command already exists.

**Tech Stack:** Node.js, TypeScript, Hermes-format skills

---

### Task 1: Add Refactor Skill

**Files:**
- Create: `src/cli/commands/skills/refactor/SKILL.md`
- Test: `tests/cli/commands/skills/refactor.test.ts`

```markdown
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
```

---

### Task 2: Add Architect Skill

**Files:**
- Create: `src/cli/commands/skills/architect/SKILL.md`
- Test: `tests/cli/commands/skills/architect.test.ts`

```markdown
---
name: architect
description: Architecture reviews. Find shallow modules, propose deepening opportunities, write ADRs for significant decisions.
trigger: /architect
pattern: "architecture|design|module|interface|deepen|adr"
version: "1.0.0"
is_core: true
tags: [architecture, design, quality]
---

# Architecture Improvement

## Core Principle

Find **deepening opportunities** — refactors that turn shallow modules into deep ones with high leverage and good locality.

## Glossary

- **Module** — Anything with an interface and implementation
- **Interface** — Everything a caller must know to use the module
- **Depth** — Leverage at the interface: much behavior behind a small interface
- **Seam** — Where an interface lives; a place behavior can be altered
- **Adapter** — A concrete thing satisfying an interface at a seam

## Key Principles

### Deletion Test
Imagine deleting the module:
- If complexity vanishes → it was a pass-through (shallow)
- If complexity reappears across N callers → it was earning its keep (deep)

### The Interface Is the Test Surface
Test the module through its interface, not its internals.

### One Adapter = Hypothetical Seam, Two = Real Seam
Multiple adapters confirm the abstraction is useful.

## The Process

1. **Explore** — Read CONTEXT.md, explore codebase with GitNexus
2. **Find candidates** — Look for shallow modules, tight coupling
3. **Apply deletion test** — Would deleting this concentrate or scatter complexity?
4. **Propose deepening** — How could this module earn its keep?
5. **Write ADR** — Document significant architectural decisions

## When to Write ADRs

Write an ADR when a decision:
- Affects multiple modules or teams
- Could be revisited later
- Has non-obvious tradeoffs
- Sets a precedent

## ADR Format

```markdown
# ADR-XXX: Title

## Status
Proposed | Accepted | Deprecated

## Context
What is the issue we're addressing?

## Decision
What is the decision?

## Consequences
What becomes easier? What becomes harder?
```
```

---

### Task 3: Add Simplify Skill

**Files:**
- Create: `src/cli/commands/skills/simplify/SKILL.md`
- Test: `tests/cli/commands/skills/simplify.test.ts`

```markdown
---
name: simplify
description: Code cleanup and quality improvement. Removes dead code, deduplicates, fixes hacky patterns, improves efficiency.
trigger: /simplify
pattern: "simplify|cleanup|clean.*up|refine|remove.*dead"
version: "1.0.0"
is_core: true
tags: [quality, cleanup, maintainability]
---

# Code Simplification

## Core Principle

**Remove complexity that doesn't earn its keep.** Every line of code is a liability.

## What to Remove

### Dead Code
- Commented-out code
- Unused functions
- Unreachable paths
- Old workarounds
- Debug code left in

### Duplication
- Copy-paste with variation
- Repeated logic patterns
- Magic numbers (extract to constants)
- String constants (extract to named constants)

### Hacky Patterns
- Deep nesting
- Flag parameters
- Complex conditionals (extract to well-named functions)
- Premature optimization

## What NOT to Remove

- Code that looks simple but is actually correct
- Comments explaining WHY (not WHAT)
- Valid abstractions (even if they seem like duplication)
- Code you're not sure about (ask first)

## The Process

1. **Scan** — Find dead code, duplication, hacky patterns
2. **Prioritize** — Focus on high-impact changes
3. **Remove incrementally** — One change at a time
4. **Verify tests pass** — After each change
5. **Commit frequently** — Small commits with clear messages

## Quality Checklist

### Redundant State
- [ ] State that duplicates existing state
- [ ] Cached values that could be derived
- [ ] Observers/effects that could be direct calls

### Parameter Sprawl
- [ ] Adding parameters instead of generalizing
- [ ] Functions doing too much

### Stringly-Typed Code
- [ ] Raw strings where constants exist
- [ ] Magic numbers not extracted

### Unnecessary Complexity
- [ ] Wrapper elements with no value
- [ ] Comments explaining obvious code
```

---

### Task 4: Add Document Skill

**Files:**
- Create: `src/cli/commands/skills/document/SKILL.md`
- Test: `tests/cli/commands/skills/document.test.ts`

```markdown
---
name: document
description: Auto-generates documentation. Creates docstrings, README updates, API docs from source code.
trigger: /document
pattern: "document|docstring|docs|readme|api.*docs|comment"
version: "1.0.0"
is_core: true
tags: [documentation, quality]
---

# Documentation Generation

## Core Principle

**Good documentation explains WHY, not WHAT.** Code should be self-documenting for the what.

## What to Document

### Functions/APIs
- What does it do?
- What are the inputs/outputs?
- What can go wrong?
- What are the preconditions?

### Complex Logic
- Why is this approach taken?
- What edge cases are handled?
- What are the assumptions?

### Public Interfaces
- How should this be used?
- What are the invariants?
- When should this be called?

### Architecture Decisions
- Why is the system structured this way?
- What are the key abstractions?
- How do components interact?

## What NOT to Document

- Obvious code (don't document what the code says)
- Trivial getters/setters
- Implementation details (private methods)
- Comments that repeat the code

## Documentation Types

### Inline Comments
```typescript
// Use exponential backoff because the upstream service
// returns 429 under load, and simple retry floods it.
```

### Docstrings
```typescript
/**
 * Fetches a user by ID.
 * @param id - The user ID (UUID format)
 * @returns The user or null if not found
 * @throws {DatabaseError} If connection fails
 */
```

### README Sections
- Overview
- Installation
- Usage examples
- Configuration options
- Troubleshooting

## The Process

1. **Read code** — Understand what it does
2. **Identify gaps** — What's missing documentation?
3. **Add inline comments** — For complex logic
4. **Generate docs** — README, API docs
5. **Verify accuracy** — Docs match code
```

---

### Task 5: Add Migrate Skill

**Files:**
- Create: `src/cli/commands/skills/migrate/SKILL.md`
- Test: `tests/cli/commands/skills/migrate.test.ts`

```markdown
---
name: migrate
description: Safe migrations for schema changes, dependency upgrades, and config migrations using dual-write pattern.
trigger: /migrate
pattern: "migrate|migration|upgrade|schema|transition|dual.?write"
version: "1.0.0"
is_core: true
tags: [migrations, safety, reliability]
---

# Safe Migrations

## Core Principle

**Always maintain backward compatibility.** Old code must work during and after migration.

## Migration Patterns

### 1. Expand-Contract (Blue-Green)
1. **Expand** — Add new schema/behavior alongside old
2. **Migrate data** — Convert data to new format
3. **Contract** — Remove old schema/behavior

### 2. Dual-Write Pattern
Write to both old and new simultaneously:
- New data goes to new format
- Old code reads from old format
- Migration tool syncs existing data
- Old code eventually updated to read from new

### 3. Feature Flag
Use flags to gradually enable new behavior:
```typescript
const result = flag.enabled('new-feature')
  ? newImplementation(input)
  : oldImplementation(input);
```

## When to Use Each

| Pattern | Use When |
|---------|----------|
| Expand-Contract | Schema changes, API versioning |
| Dual-Write | Data migration with live users |
| Feature Flag | Behavioral changes, A/B testing |

## The Process

1. **Assess scope** — What needs to change?
2. **Plan migration path** — Which pattern fits?
3. **Implement expansion** — Add new alongside old
4. **Migrate data** — Convert existing data
5. **Contract** — Remove old after verification
6. **Monitor** — Watch for regressions

## Safety Checklist

- [ ] Migration is reversible
- [ ] Old behavior still works during migration
- [ ] Data integrity maintained
- [ ] Tests cover both old and new paths
- [ ] Rollback plan documented
- [ ] Monitoring in place for regressions
```

---

### Task 6: Add Test-Suite Skill

**Files:**
- Create: `src/cli/commands/skills/test-suite/SKILL.md`
- Test: `tests/cli/commands/skills/test-suite.test.ts`

```markdown
---
name: test-suite
description: Test suite auditing. Identifies untested paths, generates missing tests, improves coverage without over-testing.
trigger: /test-suite
pattern: "test.*coverage|untested|coverage|audit.*tests|missing.*test"
version: "1.0.0"
is_core: true
tags: [testing, quality, coverage]
---

# Test Suite Improvement

## Core Principle

**Test behavior, not implementation.** Good tests verify what the system does, not how it does it.

## Coverage Analysis

### What to Measure
- Line coverage (are all lines executed?)
- Branch coverage (are all branches tested?)
- Path coverage (are all paths exercised?)

### What NOT to Measure
- Coverage for coverage's sake
- Testing getters/setters
- Testing trivial code

## Finding Untested Paths

1. **Run coverage report** — See which lines are untested
2. **Identify critical paths** — Auth, payments, data mutations
3. **Find edge cases** — Empty, null, error states
4. **Trace execution** — Use GitNexus to find all flows

## Coverage Levels

| Level | Target | What |
|-------|--------|------|
| Critical paths | 100% | Auth, payments, data |
| Business logic | 80% | Core features |
| Edge cases | 60% | Error handling |
| Utility code | 40% | Helpers, utilities |

## Anti-Patterns

### Over-Mocked Tests
```typescript
// BAD: Tests implementation, not behavior
const result = service.calculate(mockData);
expect(mockRepo.save).toHaveBeenCalled();
```

### Implementation Tests
```typescript
// BAD: Tests internals that could change
expect(component.state.isLoading).toBe(true);
```

## The Process

1. **Run coverage** — `npm test -- --coverage`
2. **Identify gaps** — Focus on critical paths first
3. **Generate tests** — Write behavior tests
4. **Verify** — Run coverage again
5. **Iterate** — Add tests for missing paths
```

---

### Task 7: Add Optimize Skill

**Files:**
- Create: `src/cli/commands/skills/optimize/SKILL.md`
- Test: `tests/cli/commands/skills/optimize.test.ts`

```markdown
---
name: optimize
description: Performance profiling and optimization. Identifies hot paths, suggests caching strategies, optimizes database queries.
trigger: /optimize
pattern: "optimize|performance|slow|bottleneck|fast|cache|speed"
version: "1.0.0"
is_core: true
tags: [performance, optimization, speed]
---

# Performance Optimization

## Core Principle

**Don't optimize without measuring.** Profile first, then optimize the real bottlenecks.

## The Process

1. **Profile** — Identify where time is spent
2. **Analyze** — Find the actual bottlenecks
3. **Optimize** — Address root cause, not symptoms
4. **Verify** — Measure improvement
5. **Monitor** — Watch for regressions

## Profiling Techniques

### CPU Profiling
- Find functions that consume most CPU
- Look for algorithmic inefficiencies (O(n²) → O(n))
- Identify repeated computations

### Memory Profiling
- Find memory leaks
- Identify large allocations
- Look for unbounded data structures

### I/O Profiling
- Database query efficiency
- Network call batching
- Caching opportunities

## Common Bottlenecks

### Database
- N+1 queries (use JOIN or batch)
- Missing indexes
- Large result sets (paginate)
- Unnecessary queries

### Memory
- Unbounded arrays
- Memory leaks (event listeners, closures)
- Large object copies

### CPU
- O(n²) algorithms
- Repeated expensive computations
- Synchronous blocking

## Caching Strategies

| Strategy | Use When | Example |
|----------|----------|---------|
| Memoization | Pure functions, repeated calls | `cache(fn)()` |
| TTL cache | Data with expiration | `Cache-Control: max-age=3600` |
| Invalidation | Data that changes | `on mutation: clear cache` |
| Lazy loading | Large data | Pagination |

## The 80/20 Rule

80% of time is spent in 20% of code. Optimize the hot path, not the cold path.

## Red Flags

- **Premature optimization** — Don't optimize without profiling
- **Micro-optimizations** — Focus on algorithmic improvements
- **Guessing** — Always measure before and after
```