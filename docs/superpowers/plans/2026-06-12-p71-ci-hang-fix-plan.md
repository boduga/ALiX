# P0.71 — CI Test Suite Hang Fix

**Goal:** Identify and fix the test hang that prevents `npm run test:node` from completing cleanly in CI.

---

### Task 1: Identify the hanging test

Run with verbose output to find which test hangs:

```bash
node --test --test-timeout=30000 dist/tests/*.test.js dist/tests/**/*.test.js 2>&1
```

Look for tests that take >10s or never complete. Common causes:
- Tests that create HTTP servers without closing them
- Tests that leave open file handles
- Tests that use infinite loops or unresolved promises
- Tests that spawn subprocesses without cleanup

### Task 2: Fix identified issues

Based on findings, the fix could be:
- Add proper `after()` cleanup hooks
- Set test timeouts
- Close open resources in `finally` blocks
- Skip environment-dependent tests in CI

### Task 3: Exclude if unfixable

If a test is inherently non-isolated (e.g. requires a daemon), exclude it:

```bash
"test:node:ci": "find dist/tests -name '*.test.js' ! -path 'dist/tests/manual/*' ! -path 'dist/tests/pty/*' -print0 | xargs -0 node --test",
```

### Verification

```bash
npm run test:node
# Expected: completes within 120s with 0 failures
```
