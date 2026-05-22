---
name: refactor
description: Safe refactoring. Analyze impact before touching code, rename safely, identify affected files. Works with ALiX's native tools.
trigger: /refactor
pattern: "refactor|rename|extract|split|restructure|improve.*code"
version: "1.0.0"
is_core: true
tags: [refactoring, quality, architecture]
---

# Safe Refactoring

## Core Principle

**Always analyze impact before touching code.** Understand blast radius before making changes.

## The Process

1. **Analyze impact** — Find all callers, understand dependencies
2. **Plan changes** — Identify all files that need updates
3. **Make changes incrementally** — Small, testable steps
4. **Verify** — Run tests after each change
5. **Commit frequently** — Small commits with clear messages

## Impact Analysis

Before refactoring a function or module:

```bash
# Find all callers (grep for usage patterns)
grep -rn "functionName\|methodName" src/

# Find files that import the module
grep -rn "import.*from.*moduleName" src/

# Check for tests
grep -rn "describe\|it\|test" tests/ | grep -i "moduleName"
```

## Blast Radius Levels

| Level | Meaning | Action |
|-------|---------|--------|
| Many callers | WILL BREAK | Update all callers first |
| Few callers | Update carefully | Verify tests pass |
| No callers | Safe to change | May be dead code |

## Safe Refactoring Patterns

### Rename Function
1. Search for all usages
2. Replace in all locations
3. Run tests
4. If tests pass, commit

### Extract Function
1. Identify the logic to extract
2. Create new function with clear name
3. Replace old logic with call to new function
4. Test that behavior unchanged

### Split Large Function
1. Identify logical sections
2. Extract each section to helper function
3. Compose helpers in original function
4. Test that behavior unchanged

### Rename Module/Class
1. Find all imports
2. Update import paths
3. Update all usages
4. Test that behavior unchanged

## Anti-Patterns

- Refactoring without tests
- Large refactors that aren't commit-friendly
- "While I'm here" improvements (scope creep)
- Changing working code just to look cleaner

## Red Flags

STOP if:
- No test coverage for code being refactored
- Changes would break many callers
- Architecture needs redesign (not just refactor)
- You're not sure about dependencies