---
name: debug
description: Systematic debugging using reproduce-minimize-hypothesize-instrument-fix-regression loop. Use when user reports a bug, says something is broken, or asks to diagnose an issue.
trigger: /debug
pattern: "debug|diagnose|fix this|broken|not working|error|fail"
version: "1.0.0"
is_core: true
tags: [debugging, troubleshooting, quality]
---

# Systematic Debugging

## Core Principle

**NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.** Symptom fixes waste time and create new bugs.

## The Four Phases

### Phase 1: Root Cause Investigation

1. **Read error messages carefully** — They often contain the exact solution
2. **Reproduce consistently** — Can you trigger it reliably? What are the exact steps?
3. **Check recent changes** — What changed that could cause this?
4. **Gather evidence** — Log data flow, check state at each layer

### Phase 2: Pattern Analysis

1. **Find working examples** — What's similar that works?
2. **Compare against references** — Read the pattern implementation completely
3. **Identify differences** — What's different between working and broken?
4. **Understand dependencies** — What does this need?

### Phase 3: Hypothesis and Testing

1. **Form single hypothesis** — "I think X is the root cause because Y"
2. **Test minimally** — Smallest change to test hypothesis
3. **Verify before continuing** — Worked? Continue. Didn't? New hypothesis.

### Phase 4: Implementation

1. **Create failing test case** — Automated reproduction
2. **Implement single fix** — Address root cause only
3. **Verify fix** — Test passes, no regressions
4. **If fix doesn't work (3+ attempts):** Question the architecture

## Red Flags

Stop and follow process when you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "It's probably X, let me fix that"
- "One more fix attempt" (after 2+ failures)

## When 3+ Fixes Failed

**Pattern indicating architectural problem:**
- Each fix reveals new shared state/coupling/problem in different place
- Fixes require massive refactoring to implement

**Action:** STOP and discuss with human partner. This is a wrong architecture, not a wrong hypothesis.

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|-----------------|
| 1. Root Cause | Read errors, reproduce, check changes | Understand WHAT and WHY |
| 2. Pattern | Find working examples, compare | Identify differences |
| 3. Hypothesis | Form theory, test minimally | Confirmed or new hypothesis |
| 4. Implementation | Create test, fix, verify | Bug resolved, tests pass |