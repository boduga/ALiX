# Code Coverage Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify untested modules, add missing tests to improve coverage.

**Architecture:** Use c8 or Node.js built-in coverage to identify gaps, then add targeted tests.

**Tech Stack:** TypeScript, node:test, c8 for coverage reporting.

---

### Task 1: Generate Coverage Report

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check if coverage tool exists**

Run: `npm test -- --coverage 2>&1 | head -20`
Or: `npx c8 npm test 2>&1 | head -30`

- [ ] **Step 2: If not configured, add coverage to package.json**

```json
{
  "scripts": {
    "test:coverage": "c8 node --test",
    "coverage:report": "c8 report --reporter=text-summary"
  }
}
```

- [ ] **Step 3: Generate report**

Run coverage and identify modules with <50% coverage or no tests.

---

### Task 2: Identify Untested Modules

**Files:**
- Analyze: Coverage report output

- [ ] **Step 1: List modules with no test files**

```bash
# Find source files without corresponding tests
for f in src/**/*.ts; do
  test="${f%.ts}.test.ts"
  if [ ! -f "$test" ]; then
    echo "Missing test: $test"
  fi
done
```

- [ ] **Step 2: Identify modules with low coverage**

From coverage report, list modules with <50% coverage.

- [ ] **Step 3: Prioritize by importance**

1. Critical path modules (tools, executor, policy)
2. Core business logic (context, verification)
3. Utility modules

---

### Task 3: Add Tests for High-Priority Modules

**Files:**
- Create: Tests for untested modules

For each untested module, write a test file following the existing pattern:

```typescript
// tests/<module-path>/<module-name>.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { /* module */ } from "../../src/<module-path>.js";

describe("<ModuleName>", () => {
  it("test case description", () => {
    // Arrange
    // Act
    // Assert
  });
});
```

- [ ] **Step 1: Add tests for critical modules**

Priority order:
1. `src/tools/executor.ts` (if not fully tested)
2. `src/autonomy/scope-tracker.ts`
3. `src/mcp/tool-selector.ts`
4. `src/utils/memory/decision-extractor.ts`

- [ ] **Step 2: Run tests to verify**

Run: `npm test 2>&1 | tail -10`

- [ ] **Step 3: Add tests for medium-priority modules**

Continue with remaining untested modules.

---

### Task 4: Verify Coverage Improvement

**Files:**
- Modify: `package.json` (if adding coverage script)

- [ ] **Step 1: Run coverage report**

Run: `npm run test:coverage 2>&1 | tail -20`

- [ ] **Step 2: Compare before/after**

Record coverage percentage before and after.

- [ ] **Step 3: Commit**

```bash
git add tests/ package.json
git commit -m "test: add coverage and fill test gaps

- Add c8 coverage script to package.json
- Add tests for untested modules
- Coverage: X% → Y%
"
```