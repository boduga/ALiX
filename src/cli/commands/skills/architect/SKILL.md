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