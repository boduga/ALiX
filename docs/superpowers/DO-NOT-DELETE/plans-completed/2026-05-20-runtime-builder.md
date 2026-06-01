# RuntimeBuilder Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract dependency wiring from `run.ts` into a `RuntimeBuilder`. `run.ts` becomes a thin coordinator. Initialization order lives in one place.

**Architecture:** `RuntimeBuilder` owns all module construction. Modules are added via builder methods or constructor. Circular dependencies resolved at the builder level. `Runtime` exposes `run()` and `close()` to `run.ts`.

**Tech Stack:** TypeScript, node:test.

---

### Task 1: Define RuntimeBuilder Interface

**Files:**
- Create: `src/runtime/runtime-builder.ts`
- Create: `src/runtime/runtime.ts`
- Test: `tests/runtime/runtime-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/runtime/runtime-builder.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { RuntimeBuilder } from "../../src/runtime/runtime-builder.js";

describe("RuntimeBuilder", () => {
  it("builds a Runtime", async () => {
    const builder = new RuntimeBuilder({ root: "/tmp" });
    const runtime = await builder.build();
    assert.ok(runtime);
    assert.equal(typeof runtime.close, "function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/runtime/runtime-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/runtime/runtime.ts
export interface Runtime {
  close(): Promise<void>;
}

// src/runtime/runtime-builder.ts
import type { Runtime } from "./runtime.js";

export class RuntimeBuilder {
  constructor(private root: string) {}

  async build(): Promise<Runtime> {
    return { close: async () => {} };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/runtime/runtime-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime/runtime.ts src/runtime/runtime-builder.ts tests/runtime/runtime-builder.test.ts
git commit -m "feat(runtime-builder): define RuntimeBuilder interface"
```

---

### Task 2: Add Module Wiring to RuntimeBuilder

**Files:**
- Modify: `src/runtime/runtime-builder.ts`
- Test: `tests/runtime/runtime-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("RuntimeBuilder wires PolicyEngine", async () => {
  const builder = new RuntimeBuilder({ root: "/tmp" });
  const runtime = await builder.build();
  assert.ok((runtime as any).policyEngine);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/runtime/runtime-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Wire EventLog, PolicyEngine, ToolExecutor**

```typescript
// src/runtime/runtime-builder.ts
export class RuntimeBuilder {
  private _eventLog?: EventLog;
  private _sessionId?: string;
  private _config?: AlixConfig;

  constructor(private root: string) {}

  withConfig(config: AlixConfig): this {
    this._config = config;
    return this;
  }

  withSession(sessionId: string): this {
    this._sessionId = sessionId;
    return this;
  }

  async build(): Promise<Runtime> {
    const config = this._config ?? await loadConfig(this.root);
    const sessionId = this._sessionId ?? randomUUID();

    const eventLog = new EventLog(join(this.root, ".alix", "sessions", sessionId));
    await eventLog.init();

    const policyEngine = new PolicyEngineBuilder(config).withEventLog(eventLog, sessionId).build();

    const toolExecutor = new ToolExecutor(config, eventLog, this.root);

    return {
      close: async () => {
        await eventLog.close();
      },
      // Expose modules for run.ts access
      eventLog,
      policyEngine,
      toolExecutor,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/runtime/runtime-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/runtime/runtime-builder.ts tests/runtime/runtime-builder.test.ts
git commit -m "feat(runtime-builder): wire EventLog, PolicyEngine, ToolExecutor"
```

---

### Task 3: Wire Remaining Modules

**Files:**
- Modify: `src/runtime/runtime-builder.ts`
- Test: `tests/runtime/runtime-builder.test.ts`

- [ ] **Step 1: Wire ContextCompiler, McpManager, ScopeTracker, SubagentManager, CheckpointManager**

Add each module to the builder, following the pattern from Task 2.

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test tests/runtime/runtime-builder.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/runtime/runtime-builder.ts
git commit -m "feat(runtime-builder): wire ContextCompiler, McpManager, ScopeTracker, SubagentManager"
```

---

### Task 4: Refactor run.ts to Use RuntimeBuilder

**Files:**
- Modify: `src/run.ts`
- Test: Integration test (existing session tests)

- [ ] **Step 1: Replace module construction with RuntimeBuilder**

Find all `new Xxx(...)` constructions in `run.ts`. Replace with `runtime.xxx`.

- [ ] **Step 2: Call Runtime.close() on shutdown**

```typescript
// At end of runTask():
await runtime.close();
```

- [ ] **Step 3: Run integration tests**

Run: `npm test 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/run.ts
git commit -m "refactor(run.ts): delegate to RuntimeBuilder"
```

---

### Task 5: Write ADR-0002

**Files:**
- Create: `docs/adr/ADR-0002-runtime-builder.md`

- [ ] **Step 1: Write the ADR**

Document the decision: RuntimeBuilder over alternatives (micro-kernel, DI container). Include Consequences section with positive (single initialization place, swappable modules) and negative (another abstraction layer, builder may become complex).

- [ ] **Step 2: Commit**

```bash
git add docs/adr/ADR-0002-runtime-builder.md
git commit -m "docs: add ADR-0002 RuntimeBuilder decision"
```