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