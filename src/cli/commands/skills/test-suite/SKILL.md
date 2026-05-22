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

1. **Run coverage report** — `npm test -- --coverage`
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
expect(mockRepo.save).toHaveBeenCalled();
```

### Implementation Tests
```typescript
// BAD: Tests internals that could change
expect(component.state.isLoading).toBe(true);
```