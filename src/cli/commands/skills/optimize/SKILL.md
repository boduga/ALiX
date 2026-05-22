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

## The 80/20 Rule

80% of time is spent in 20% of code. Optimize the hot path, not the cold path.

## Red Flags

- **Premature optimization** — Don't optimize without profiling
- **Guessing** — Always measure before and after