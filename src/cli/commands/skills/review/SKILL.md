---
name: review
description: Code review with checklist covering security, performance, error handling, test coverage, and code quality. Use when user asks for review or wants to improve code quality.
trigger: /review
pattern: "review|check.*code|look.*over|assess|evaluate|audit|quality"
version: "1.0.0"
is_core: true
tags: [quality, review, security, performance]
---

# Code Review

## Core Principle

Reviews should improve code, not just check it. Find actionable improvements, not nitpicks.

## Review Checklist

### Security
- [ ] No hardcoded secrets, credentials, or API keys
- [ ] Input validation on all public interfaces
- [ ] Proper error handling (no stack traces to users)
- [ ] SQL injection, XSS, CSRF prevention
- [ ] File path traversal prevention
- [ ] Rate limiting on public endpoints

### Performance
- [ ] No N+1 queries
- [ ] Appropriate indexing for database queries
- [ ] Lazy loading where appropriate
- [ ] No blocking operations in hot paths
- [ ] Appropriate caching strategies
- [ ] No memory leaks (unbounded data structures, event listeners)

### Error Handling
- [ ] All async operations have error handling
- [ ] Errors are logged with context
- [ ] Fallback values are sensible
- [ ] No silently swallowed errors
- [ ] Timeouts on external calls

### Test Coverage
- [ ] New code has tests
- [ ] Tests cover happy path and error cases
- [ ] Tests are not overly mocked (testing behavior, not implementation)
- [ ] Edge cases are covered

### Code Quality
- [ ] No code duplication (DRY)
- [ ] Clear naming (intent is obvious)
- [ ] Appropriate abstraction level
- [ ] No commented-out dead code
- [ ] Consistent style
- [ ] Appropriate comments (WHY, not WHAT)

### API Design (if applicable)
- [ ] RESTful conventions followed
- [ ] Proper HTTP status codes
- [ ] Consistent response format
- [ ] Versioning strategy defined

## Review Workflow

1. **Understand the context** — What problem does this solve?
2. **Check the happy path** — Does it work for normal cases?
3. **Check error paths** — What happens on failures?
4. **Apply checklist** — Go through security, performance, etc.
5. **Provide actionable feedback** — Suggest HOW to fix, not just WHAT is wrong
6. **Approve or request changes** — Be clear about the gate

## Feedback Guidelines

- Be specific: "Line 42: X should handle empty array" not "X is wrong"
- Be kind: Critique code, not people
- Be helpful: Offer suggestions, not just criticism
- Be practical: Focus on real issues, not style preferences
- Be balanced: Acknowledge good work, not just problems

## When to Request Changes

Request changes for:
- Security vulnerabilities
- Breaking bugs
- Missing tests
- Performance regressions
- Violations of domain patterns

Approve with comments for:
- Style preferences
- Personal taste differences
- "I would have done it differently" without clear improvement

## Priority

1. **Blocking** — Must fix before merge (security, correctness)
2. **Important** — Should fix, but merge ok with comments (performance, coverage)
3. **Nice to have** — Consider fixing (style, readability)
4. **Nit** — Optional, don't block on (formatting, naming)