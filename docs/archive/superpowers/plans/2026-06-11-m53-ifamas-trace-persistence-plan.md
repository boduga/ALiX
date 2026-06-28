# M0.53 Trace Event Persistence

**Status:** ✅ Completed (M0.53) — IFÁ-MAS Diagnostic Artifacts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record IFÁ-MAS diagnostic artifacts into the event log as structured trace events so they persist beyond the live TUI session and appear in the trace timeline.

**Architecture:** Add `"ifamas"` to `TraceSourceType`. Handle `"ifamas.diagnostic"` in `toTraceEvent()`. Have `runIfamasDiagnostic()` optionally accept an `EventLog` reference and emit the diagnostic as a trace event. Update the TUI `/ifamas` command to wire the EventLog so the event lands in the trace timeline and the session file.

**Tech Stack:** TypeScript, existing TraceEvent/EventLog patterns, `node:test`.

---

## File Structure

### Modify
- `src/runtime/trace-events.ts` — add `"ifamas"` to `TraceSourceType`, handle `"ifamas.diagnostic"` in `toTraceEvent()`
- `src/runtime/ifamas-pipeline.ts` — add optional `eventLog` param to `runIfamasDiagnostic()`
- `src/cli/commands/tui.ts` — wire EventLog into the `/ifamas` command

### Create
- `tests/runtime/ifamas-pipeline.test.ts` — new test for event emission (or add to existing)
- `tests/runtime/trace-events-ifamas.test.ts` — test IFÁ-MAS trace event normalization

---

### Task 1: Add `"ifamas"` source type to trace-events.ts

**Files:**
- Modify: `src/runtime/trace-events.ts`

- [ ] **Step 1: Add `"ifamas"` to `TraceSourceType`**

At line 19, after `| "rollback"`, add:
```
  | "ifamas";
```
So the union becomes:
```typescript
export type TraceSourceType =
  | "policy"
  | "approval"
  | "continuation"
  | "tool"
  | "task"
  | "session"
  | "daemon"
  | "runtime"
  | "replay"
  | "rollback"
  | "ifamas";
```

- [ ] **Step 2: Add `"ifamas-detail"` to `TraceDetailMode`**

At line 24, add `| "ifamas-detail"` to the `TraceDetailMode` union.

- [ ] **Step 3: Add `ifamasPayload` to `TraceEvent`**

After `replayId?: string;` at line 50, add:
```typescript
  ifamasPayload?: {
    signalCode: string;
    polarity: string;
    offeringAction: string;
    routeTarget?: string;
    gatewayValid: boolean;
    guildCandidateCount: number;
    chronicleRefCount: number;
  };
```

- [ ] **Step 4: Add `"ifamas.diagnostic"` handler to `toTraceEvent()`**

Before the `return null` at the end of `toTraceEvent()` (line 205), add:
```typescript
  // IFÁ-MAS diagnostic
  if (type === "ifamas.diagnostic") {
    const p = payload as any;
    return {
      id, timestamp: ts, rawEvent,
      sourceType: "ifamas",
      eventType: type,
      label: `ifamas: ${p.polarity || "?"} ${p.signalCode || "?"}`,
      status: "completed" as const,
      detail: `offering: ${p.offeringAction || "?"}`,
      ifamasPayload: {
        signalCode: p.signalCode || "",
        polarity: p.polarity || "",
        offeringAction: p.offeringAction || "",
        routeTarget: p.routeTarget,
        gatewayValid: p.gatewayValid !== false,
        guildCandidateCount: typeof p.guildCandidateCount === "number" ? p.guildCandidateCount : 0,
        chronicleRefCount: typeof p.chronicleRefCount === "number" ? p.chronicleRefCount : 0,
      },
    };
  }
```

- [ ] **Step 5: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 2: Wire event emission in ifamas-pipeline.ts

**Files:**
- Modify: `src/runtime/ifamas-pipeline.ts`

- [ ] **Step 1: Add optional `eventLog` parameter**

The `runIfamasDiagnostic` function signature adds an optional `eventLog` parameter. Add after the existing imports:
```typescript
import type { EventLog } from "../events/event-log.js";
```

- [ ] **Step 2: Add `eventLog?: EventLog` to the input type**

After `chronicleStore?: ChronicleStore;`, add:
```typescript
  eventLog?: EventLog;
```

- [ ] **Step 3: After building the full diagnostic (before return), emit an event**

After the guild selection block and before the return statement, add:
```typescript
  // Emit trace event if eventLog is available
  if (input.eventLog) {
    try {
      await input.eventLog.append?.({
        type: "ifamas.diagnostic",
        actor: "system",
        payload: {
          signalCode: signal.code,
          polarity: signal.polarity,
          offeringAction: offering.action,
          routeTarget: routeDecision.routeHint.targetRole,
          gatewayValid: gatewayValidation.valid,
          guildCandidateCount: guildCandidates.length,
          chronicleRefCount: routeDecision.chronicleEntries.length,
        },
      });
    } catch {
      // Non-fatal — diagnostic still returns successfully
    }
  }
```

**Important:** Use optional chaining `?.` on `append` since the EventLog interface may vary. If the type is strict, wrap in a try/catch (already shown).

- [ ] **Step 4: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 3: Wire EventLog into TUI `/ifamas` command

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Pass the TUI's EventLog to `runIfamasDiagnostic`**

In the `/ifamas` handler (added in M0.52), find the call to `runIfamasDiagnostic({ signal })` and change it to:
```typescript
          const diagnostic = await runIfamasDiagnostic({
            signal,
            eventLog: tuiLog,
          });
```

Also update the `tui.appendOutput` call to include a note about the trace event:
```typescript
          const panelLines = formatIfamasPanel(panelData);
          tui.appendOutput(panelLines.join("\n") + "\n", false);
          tui.appendOutput("Diagnostic recorded as trace event.\n", false);
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 4: Write tests for trace event persistence

**Files:**
- Create: `tests/runtime/trace-events-ifamas.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toTraceEvent } from "../../src/runtime/trace-events.js";

describe("IFÁ-MAS trace event normalization", () => {
  it("converts ifamas.diagnostic event to TraceEvent with sourceType 'ifamas'", () => {
    const event = toTraceEvent({
      type: "ifamas.diagnostic",
      payload: {
        signalCode: "00000000",
        polarity: "neutral",
        offeringAction: "proceed",
        routeTarget: "guild",
        gatewayValid: true,
        guildCandidateCount: 2,
        chronicleRefCount: 0,
      },
    });
    assert.ok(event);
    assert.equal(event!.sourceType, "ifamas");
    assert.equal(event!.eventType, "ifamas.diagnostic");
  });

  it("includes ifamasPayload with all fields", () => {
    const event = toTraceEvent({
      type: "ifamas.diagnostic",
      payload: {
        signalCode: "11111111",
        polarity: "ibi",
        offeringAction: "ask_approval",
        routeTarget: "caller",
        gatewayValid: false,
        guildCandidateCount: 1,
        chronicleRefCount: 3,
      },
    });
    assert.ok(event);
    assert.ok(event!.ifamasPayload);
    assert.equal(event!.ifamasPayload!.signalCode, "11111111");
    assert.equal(event!.ifamasPayload!.polarity, "ibi");
    assert.equal(event!.ifamasPayload!.offeringAction, "ask_approval");
    assert.equal(event!.ifamasPayload!.routeTarget, "caller");
    assert.equal(event!.ifamasPayload!.gatewayValid, false);
    assert.equal(event!.ifamasPayload!.guildCandidateCount, 1);
    assert.equal(event!.ifamasPayload!.chronicleRefCount, 3);
  });

  it("handles missing optional fields gracefully", () => {
    const event = toTraceEvent({
      type: "ifamas.diagnostic",
      payload: {
        signalCode: "10101010",
        polarity: "mixed",
        // routeTarget intentionally missing
        offeringAction: "pause",
        gatewayValid: true,
        // guildCandidateCount intentionally missing
        // chronicleRefCount intentionally missing
      },
    });
    assert.ok(event);
    assert.ok(event!.ifamasPayload);
    assert.equal(event!.ifamasPayload!.routeTarget, undefined);
    assert.equal(event!.ifamasPayload!.guildCandidateCount, 0);
    assert.equal(event!.ifamasPayload!.chronicleRefCount, 0);
  });

  it("sets label and detail from payload", () => {
    const event = toTraceEvent({
      type: "ifamas.diagnostic",
      payload: {
        signalCode: "01010101",
        polarity: "ire",
        offeringAction: "proceed",
        gatewayValid: true,
        guildCandidateCount: 0,
        chronicleRefCount: 0,
      },
    });
    assert.ok(event);
    assert.ok(event!.label.startsWith("ifamas:"));
    assert.ok(event!.detail.includes("proceed"));
    assert.equal(event!.status, "completed");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run build && node --test dist/tests/runtime/trace-events-ifamas.test.js`
Expected: 4/4 tests pass

---

### Task 5: Write/update tests for event emission in ifamas-pipeline.ts

**Files:**
- Modify: `tests/runtime/ifamas-pipeline.test.ts` (add a test for event emission)

- [ ] **Step 1: Add an event emission test**

Add to the existing `describe("runIfamasDiagnostic")` block:

```typescript
  it("emits trace event when eventLog is provided", async () => {
    const signal = makeSafeSignal();
    const emitted: any[] = [];
    const fakeEventLog = {
      append: async (event: any) => { emitted.push(event); },
    };

    const result = await runIfamasDiagnostic({
      signal,
      eventLog: fakeEventLog as any,
    });

    // Should have emitted one event
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, "ifamas.diagnostic");
    assert.equal(emitted[0].payload.signalCode, signal.code);
    assert.equal(emitted[0].actor, "system");
  });

  it("does not throw when eventLog.append fails", async () => {
    const signal = makeSafeSignal();
    const brokenEventLog = {
      append: async () => { throw new Error("storage error"); },
    };

    // Should not throw — event emission is non-fatal
    const result = await runIfamasDiagnostic({
      signal,
      eventLog: brokenEventLog as any,
    });

    assert.ok(result);
    assert.equal(result.signal.signalId, signal.signalId);
  });
```

- [ ] **Step 2: Run the tests**

Run: `npm run build && node --test dist/tests/runtime/ifamas-pipeline.test.js dist/tests/runtime/trace-events-ifamas.test.js`
Expected: All tests pass (existing: 10, ifamas trace: 4, ifamas pipeline emission: 2 = 16 total)

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/runtime/ifamas-pipeline.test.js` — 12/12 pass
3. `node --test dist/tests/runtime/trace-events-ifamas.test.js` — 4/4 pass
4. `node --test dist/tests/runtime/*.test.js` — no regressions (check total count)
5. `grep -rn 'ToolExecutor\|PolicyGate\|ApprovalStore' src/runtime/ifamas-pipeline.ts src/runtime/trace-events.ts` — should not appear in ifamas-pipeline, only trace-events if referenced
6. Git diff shows only the expected files
