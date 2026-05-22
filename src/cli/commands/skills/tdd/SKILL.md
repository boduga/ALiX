---
name: tdd
description: Test-driven development with red-green-refactor loop. Use when user wants to build features or fix bugs using TDD, mentions "red-green-refactor", wants test-first development.
trigger: /tdd
pattern: "test.?first|tdd|red.?green|test.?driven"
version: "1.0.0"
is_core: true
tags: [testing, quality, development]
---

# Test-Driven Development

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means.

## The Red-Green-Refactor Loop

1. **RED** — Write a failing test that describes the desired behavior
2. **GREEN** — Write minimal code to make the test pass
3. **REFACTOR** — Clean up code while keeping tests passing

## Key Rules

- **Vertical slices, not horizontal.** One test → one implementation → repeat. Don't write all tests first, then all code.
- **Test public interfaces.** If you rename an internal function and tests break, those tests were testing implementation.
- **One assertion focus.** Each test should verify one behavior. Multiple assertions are fine if they describe one capability.
- **Meaningful names.** Test names should read like specifications: `user can checkout with valid cart` not `testCheckout`.

## When to Use

Use `/tdd` when:
- Building a new feature
- Fixing a bug (write test first to reproduce)
- Adding to an untested module
- Refactoring existing code

## Anti-Pattern: Horizontal Slices

DO NOT write all tests first, then all implementation. This produces tests that:
- Test imagined behavior, not actual behavior
- Are insensitive to real changes
- Pass when behavior breaks, fail when behavior is fine

## Workflow

1. Identify the smallest piece of behavior to add
2. Write a failing test for that behavior
3. Write minimal code to pass the test
4. Verify test passes
5. Refactor for clarity
6. Repeat