**Status:** ✅ COMPLETED (2026-05-31) — all tasks implemented and merged to main

# Performance Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce ALiX's startup latency and per-request overhead. Two specific bottlenecks: lazy-loading heavy modules, and caching the context bundle.

**Architecture:** Targeted optimizations with benchmarks to measure before/after. No major refactors.

**Tech Stack:** TypeScript, `node:test`, `console.time` for quick benchmarks.

---

## File Structure

**New files:**
- `src/utils/lazy-import.ts` — Lazy module loader utility (~30 lines)
- `tests/utils/lazy-import.test.ts` — Tests
- `bench/context-bundle.ts` — Benchmark script
- `bench/startup.ts` — Startup benchmark

**Modified files:**
- `src/run.ts` (or `src/agent/agent.ts`) — Use lazy imports for heavy modules
- `src/repomap/context-pipeline.ts` — Cache results

---

## Task 1: Create lazy-import helper (TDD)

**Files:**
- Create: `tests/utils/lazy-import.test.ts`
- Create: `src/utils/lazy-import.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/utils/lazy-import.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lazy } from "../../src/utils/lazy-import.js";

describe("lazy", () => {
  it("does not call loader until accessed", () => {
    let called = 0;
    const m = lazy(() => { called++; return { x: 1 }; });
    assert.equal(called, 0);
    assert.equal(m().x, 1);
    assert.equal(called, 1);
  });

  it("caches result after first load", () => {
    let called = 0;
    const m = lazy(() => { called++; return { x: 1 }; });
    m();
    m();
    m();
    assert.equal(called, 1);
  });

  it("supports async loaders", async () => {
    const m = lazy(async () => ({ x: 42 }));
    const result = await m();
    assert.equal(result.x, 42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `src/utils/lazy-import.ts`**

```typescript
// src/utils/lazy-import.ts

export type Loader<T> = () => T | Promise<T>;
export type Lazy<T> = Loader<T> & { isLoaded: () => boolean };

export function lazy<T>(loader: Loader<T>): Lazy<T> {
  let cache: T | undefined;
  let loaded = false;
  let pending: Promise<T> | undefined;

  const fn = ((..._args: any[]): any => {
    if (loaded) return cache;
    const result = loader();
    if (result instanceof Promise) {
      if (!pending) {
        pending = result.then((r) => {
          cache = r;
          loaded = true;
          return r;
        });
      }
      return pending;
    } else {
      cache = result;
      loaded = true;
      return result;
    }
  }) as Lazy<T>;

  fn.isLoaded = () => loaded;
  return fn;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test dist/tests/utils/lazy-import.test.js 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/lazy-import.ts tests/utils/lazy-import.test.ts
git commit -m "perf(utils): add lazy import helper (TDD)"
```

---

## Task 2: Apply lazy imports to heavy modules

**Files:**
- Modify: `src/agent/agent.ts` (or `src/run.ts`)

- [ ] **Step 1: Find heavy imports**

```bash
grep -E "^import.*from.*(sqlite|transformers|embedding|tree-sitter)" src/ -r | head -10
```

- [ ] **Step 2: Wrap heavy imports in `lazy()`**

For example, in `agent.ts`:

```typescript
import { lazy } from "../utils/lazy-import.js";

// Before: import { something } from "heavy-module.js"
// After:
const _heavyModule = lazy(() => import("heavy-module.js"));

// At use site:
// Before: something.doThing()
// After: const m = await _heavyModule(); m.doThing();
```

Apply to 1-2 heavy modules (e.g., `better-sqlite3`, `@xenova/transformers`).

- [ ] **Step 3: Verify build and tests pass**

```bash
npm run build 2>&1 | tail -3
npm test 2>&1 | grep -E "pass|fail" | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/agent.ts
git commit -m "perf(agent): lazy-load heavy modules on first use"
```

---

## Task 3: Add context-bundle caching

**Files:**
- Modify: `src/repomap/context-compiler.ts` (or related)

- [ ] **Step 1: Find where the context bundle is built**

```bash
grep -rn "compileContext\|context-bundle" src/repomap/ | head -10
```

- [ ] **Step 2: Add an in-memory cache**

Add a simple cache keyed by task signature (task + recent files changed):

```typescript
// At top of context-compiler.ts
const cache = new Map<string, { result: ContextBundle; timestamp: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

export async function compileContext(task: string, taskType: string, ...): Promise<ContextBundle> {
  const key = `${taskType}::${task}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }
  const result = await compileFresh(...);
  cache.set(key, { result, timestamp: Date.now() });
  return result;
}
```

- [ ] **Step 3: Add a test for the cache**

```typescript
// In tests/repomap/context-compiler.test.ts (or new file)
// Test that two identical compileContext calls return the same instance
// and the second is faster (or just verify cache hit)
```

- [ ] **Step 4: Verify tests pass**

- [ ] **Step 5: Commit**

```bash
git add src/repomap/context-compiler.ts
git commit -m "perf(repomap): cache context bundle results (60s TTL)"
```

---

## Task 4: Add startup benchmark

**Files:**
- Create: `bench/startup.ts`

- [ ] **Step 1: Create the benchmark**

```typescript
// bench/startup.ts
import { performance } from "node:perf_hooks";

async function main() {
  const start = performance.now();
  await import("../dist/cli.js");
  const end = performance.now();
  console.log(`CLI load time: ${(end - start).toFixed(0)}ms`);
}

main();
```

- [ ] **Step 2: Run the benchmark**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
node bench/startup.ts
```

- [ ] **Step 3: Commit**

```bash
git add bench/startup.ts
git commit -m "perf: add startup benchmark"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | grep -E "pass|fail" | tail -3
```

- [ ] **Step 2: Run startup benchmark to measure improvement**

```bash
node bench/startup.ts
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore(perf): performance improvements complete

- Lazy import helper
- Lazy load heavy modules
- Context bundle cache (60s TTL)
- Startup benchmark"
```

---

## Self-Review

- [x] Lazy import helper → Task 1
- [x] Apply lazy imports → Task 2
- [x] Context bundle cache → Task 3
- [x] Startup benchmark → Task 4
- [x] Final verification → Task 5
- [x] TDD per superpowers:test-driven-development ✓

Plan length: 5 tasks. Each focused. ✓
