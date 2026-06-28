# M0.54 Chronicle Learning Loop Implementation Plan

**Status:** ✅ Completed (M0.54)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each IFÁ-MAS diagnostic run, automatically append a Chronicle entry recording what was diagnosed, what offering was prescribed, and what outcome route was recommended — without changing execution.

**Architecture:** Add an optional `chronicleStore` path to `runIfamasDiagnostic()` that, when provided, creates and stores a `ChronicleEntry` summarizing the diagnostic. The entry captures the signal, offering action, route decision, gateway validation, and guild selection count. The TUI `/ifamas` command already passes `chronicleStore` to the pipeline, so no additional wiring is needed there.

**Tech Stack:** TypeScript, existing ChronicleStore, existing runIfamasDiagnostic, `node:test`.

---

## File Structure

### Modify
- `src/runtime/ifamas-pipeline.ts` — add `chronicleStore` writing after successful diagnostic
- `tests/runtime/ifamas-pipeline.test.ts` — add tests for chronicle entry creation

---

### Task 1: Add Chronicle entry creation to ifamas-pipeline.ts

**Files:**
- Modify: `src/runtime/ifamas-pipeline.ts`

- [ ] **Step 1: After the eventLog emission block, add Chronicle entry writing**

After the existing eventLog try/catch block (and before the return statement), add:

```typescript
  // Append Chronicle entry if chronicleStore is available
  if (input.chronicleStore) {
    try {
      await input.chronicleStore.append({
        signalCode: signal.code,
        domain: signal.domain,
        polarity: signal.polarity,
        problem: `IFÁ-MAS diagnostic: ${signal.intent || "unspecified"}`,
        diagnosis: `Offering: ${offering.action}. Route: ${routeDecision.routeHint.targetRole}. Gateway: ${gatewayValidation.valid ? "valid" : "invalid"}.`,
        actionTaken: offering.action,
        outcome: gatewayValidation.valid ? "success" : "failure",
        lesson: `Guild candidates: ${guildCandidates.length}. Chronicle refs: ${routeDecision.chronicleEntries.length}.`,
        taboosObserved: envelope.safety.taboos,
        offeringsUsed: [offering.action],
        traceRefs: [],
        replayRefs: [],
        rollbackRefs: [],
      });
    } catch {
      // Non-fatal — diagnostic still returns successfully
    }
  }
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 2: Add tests for Chronicle entry creation

**Files:**
- Modify: `tests/runtime/ifamas-pipeline.test.ts`

- [ ] **Step 1: Add imports at the top**

Add after the existing imports:
```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChronicleStore } from "../../src/chronicle/chronicle-store.js";
```

- [ ] **Step 2: Add test for chronicle entry creation**

Add to the existing `describe("runIfamasDiagnostic")` block:

```typescript
  it("creates Chronicle entry when chronicleStore is provided", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "chronicle-test-"));
    const chronicleStore = new ChronicleStore(tmpDir);
    const signal = makeSafeSignal();

    const result = await runIfamasDiagnostic({
      signal,
      chronicleStore,
    });

    // Chronicle should have one entry now
    const entries = await chronicleStore.search({ domain: "task" });
    assert.ok(entries.length >= 1);
    assert.equal(entries[0].signalCode, signal.code);
    assert.equal(entries[0].offeringsUsed.length, 1);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not throw when chronicleStore.append fails", async () => {
    const brokenStore = {
      append: async () => { throw new Error("storage error"); },
    } as any;

    const signal = makeSafeSignal();
    const result = await runIfamasDiagnostic({
      signal,
      chronicleStore: brokenStore,
    });

    assert.ok(result);
    assert.equal(result.signal.signalId, signal.signalId);
  });
```

- [ ] **Step 2: Run the tests**

Run: `npm run build && node --test dist/tests/runtime/ifamas-pipeline.test.js`
Expected: 14/14 pass (was 12, now +2)

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/runtime/ifamas-pipeline.test.js` — 14/14 pass
3. `node --test dist/tests/chronicle/*.test.js` — no regressions
4. Full suite — no regressions
5. Git diff shows only the intended files
