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

- [ ] State that duplicates existing state
- [ ] Cached values that could be derived
- [ ] Raw strings where constants exist
- [ ] Magic numbers not extracted