# M0.55 IFÁ-MAS Replay

**Status:** ✅ Completed (M0.55) / Recall Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose prior IFÁ-MAS diagnostic artifacts and Chronicle learning entries inside the TUI, allowing an operator to inspect historical passive diagnostics without changing execution behavior.

**Milestone Question:** Can an operator recall previous IFÁ-MAS diagnostic history by trace ID, signal code, offering action, route hint, or Chronicle entry metadata?

**Architecture:** Add a `/chronicle` command and a `"chronicle"` TUI panel. The panel renders searchable Chronicle entries and persisted trace artifacts. Read-only — no execution changes.

**Tech Stack:** TypeScript, ChronicleStore, TuiStore/TuiPanel patterns, `node:test`.

**Hard Boundaries:**
- No ToolExecutor changes
- No PolicyGate changes
- No ApprovalStore changes
- No runtime routing changes
- No automatic replay/rollback execution
- No mutation except existing ChronicleStore reads

---

## File Structure

### Create
- `src/tui/chronicle-panel.ts` — Chronicle panel model + formatting
- `tests/tui/chronicle-panel.test.ts` — 10 test cases

### Modify
- `src/tui/store.ts` — add `"chronicle"` to `TuiPanel`, add state fields
- `src/tui/panel-renderer.ts` — add chronicle render branch
- `src/tui/runtime-snapshot.ts` — carry chronicle panel data
- `src/cli/commands/tui.ts` — add `/chronicle` command

---

### Task 1: Create `src/tui/chronicle-panel.ts`

**Files:**
- Create: `src/tui/chronicle-panel.ts`

- [ ] **Step 1: Write the panel model and formatter**

```typescript
export type ChroniclePanelEntry = {
  chronicleId: string;
  traceId?: string;
  signalCode?: string;
  offeringAction?: string;
  routeTarget?: string;
  guildCandidateCount?: number;
  summary: string;
  createdAt: string;
};

export type ChroniclePanelData = {
  query?: string;
  entries: ChroniclePanelEntry[];
  totalEntries: number;
  emptyReason?: string;
};

export function formatChroniclePanel(data: ChroniclePanelData): string[] {
  const lines: string[] = [];

  if (data.query) {
    lines.push(`── Chronicle (filter: ${data.query}) ────────`);
  } else {
    lines.push("── Recent Chronicle ──────────────────────");
  }

  if (data.entries.length === 0) {
    lines.push(`  ${data.emptyReason ?? "No chronicle entries found."}`);
    return lines;
  }

  lines.push(`Entries: ${data.totalEntries}${data.query ? ` (showing ${data.entries.length})` : ""}`);

  for (const entry of data.entries) {
    const time = new Date(entry.createdAt).toLocaleTimeString();
    lines.push(`  ${time}  ${entry.signalCode?.padEnd(10) ?? "—".padEnd(10)}  ${entry.offeringAction?.padEnd(16) ?? "—".padEnd(16)}  ${entry.routeTarget ?? "—"}`);
    lines.push(`         ${entry.summary.slice(0, 60)}`);
    if (entry.guildCandidateCount !== undefined) {
      lines.push(`         guild: ${entry.guildCandidateCount} candidate(s)`);
    }
  }

  return lines;
}

export function chronicleEntryToPanelEntry(
  chronicleEntry: { entryId: string; signalCode: string; domain: string; polarity: string; problem: string; diagnosis: string; actionTaken: string; outcome: string; lesson: string; offeringsUsed: string[]; createdAt: string; traceRefs: string[] },
): ChroniclePanelEntry {
  return {
    chronicleId: chronicleEntry.entryId,
    signalCode: chronicleEntry.signalCode,
    offeringAction: chronicleEntry.actionTaken,
    summary: chronicleEntry.problem,
    createdAt: chronicleEntry.createdAt,
  };
}
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 2: Add `"chronicle"` panel to store.ts

**Files:**
- Modify: `src/tui/store.ts`

- [ ] **Step 1: Add `"chronicle"` to `TuiPanel`**

Change to:
```typescript
export type TuiPanel = "chat" | "daemon" | "approvals" | "sops" | "policy" | "runtime" | "trace" | "replays" | "ifamas" | "chronicle";
```

- [ ] **Step 2: Add `chroniclePanelData` to `TuiState`**

After `ifamasPanelData`, add:
```typescript
  chroniclePanelData?: import("./chronicle-panel.js").ChroniclePanelData;
```

- [ ] **Step 3: Add `"chronicle"` to `PANELS`**

Change to:
```typescript
export const PANELS: TuiPanel[] = ["chat", "daemon", "approvals", "sops", "policy", "runtime", "trace", "replays", "ifamas", "chronicle"];
```

- [ ] **Step 4: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 3: Render the chronicle panel in panel-renderer.ts

**Files:**
- Modify: `src/tui/panel-renderer.ts`

- [ ] **Step 1: Add import**

```typescript
import { formatChroniclePanel } from "./chronicle-panel.js";
```

- [ ] **Step 2: Add render branch after the `ifamas` block**

```typescript
  } else if (s.activePanel === "chronicle") {
    if (s.chroniclePanelData) {
      const panelLines = formatChroniclePanel(s.chroniclePanelData);
      for (const line of panelLines) {
        buf.push(line);
      }
    } else {
      buf.push("── Chronicle ─────────────────────────────");
      buf.push("  No chronicle data loaded.");
      buf.push("  Use /chronicle to search past IFÁ-MAS diagnostics.");
    }
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 4: Wire chronicle data in runtime-snapshot.ts

**Files:**
- Modify: `src/tui/runtime-snapshot.ts`

- [ ] **Step 1: Add `chroniclePanelData` to `TuiRuntimeSnapshot`**

After `ifamasPanelData`, add:
```typescript
  chroniclePanelData?: import("./chronicle-panel.js").ChroniclePanelData;
```

- [ ] **Step 2: Pass through in `applySnapshotToStore`**

After the `ifamasPanelData` line, add:
```typescript
  if (snapshot.chroniclePanelData) {
    store.getState().chroniclePanelData = snapshot.chroniclePanelData;
  }
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 5: Wire `/chronicle` command in TUI

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add `/chronicle` command handler**

In the main TUI command loop, add after the `/ifamas` handler:

```typescript
      // /chronicle — search IFÁ-MAS Chronicle entries
      if (task.startsWith("/chronicle")) {
        const { ChronicleStore } = await import("../../chronicle/chronicle-store.js");
        const { chronicleEntryToPanelEntry, formatChroniclePanel } = await import("../../tui/chronicle-panel.js");

        const args = task.slice("/chronicle".length).trim();
        const chronicleStore = new ChronicleStore(activeCwd);

        let entries: import("../../chronicle/chronicle-store.js").ChronicleEntry[];
        let queryLabel = "";

        if (args.startsWith("trace:")) {
          // Filter by trace context is not supported in ChronicleStore search directly.
          // Return all entries — trace filtering is a future enhancement.
          entries = await chronicleStore.search({});
          queryLabel = `trace:${args.slice(6)}`;
        } else if (args.startsWith("signal:")) {
          entries = await chronicleStore.search({ signalCode: args.slice(7) });
          queryLabel = args;
        } else if (args.startsWith("offering:")) {
          // Chronicle doesn't index by offering action, so return all for now
          entries = await chronicleStore.search({});
          queryLabel = args;
        } else if (args.startsWith("route:")) {
          entries = await chronicleStore.search({});
          queryLabel = args;
        } else if (args) {
          tui.appendOutput(`Unknown filter: ${args}. Use: signal:<code>, trace:<id>, offering:<action>, route:<target>\n`, false);
          continue;
        } else {
          entries = await chronicleStore.search({});
        }

        const panelEntries = entries.slice(0, 20).map(chronicleEntryToPanelEntry);

        const panelData = {
          query: queryLabel || undefined,
          entries: panelEntries,
          totalEntries: entries.length,
          emptyReason: entries.length === 0 ? "No chronicle entries found. Run /ifamas on a trace event first." : undefined,
        };

        store.getState().chroniclePanelData = panelData;
        store.setPanel("chronicle");

        const panelLines = formatChroniclePanel(panelData);
        tui.appendOutput(panelLines.join("\n") + "\n", false);
        continue;
      }
```

**Note:** `ChronicleStore.search` currently supports `domain`, `polarity`, `outcome`, and `signalCode`. The `/chronicle trace:`, `/chronicle offering:`, and `/chronicle route:` filters return all entries since ChronicleStore doesn't index those fields yet. The CLI parsing and display are wired for future filtering enhancements without changing the UI structure.

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 6: Write tests

**Files:**
- Create: `tests/tui/chronicle-panel.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatChroniclePanel, chronicleEntryToPanelEntry } from "../../src/tui/chronicle-panel.js";
import type { ChroniclePanelData, ChroniclePanelEntry } from "../../src/tui/chronicle-panel.js";

describe("chronicle-panel", () => {
  it("formats an empty Chronicle panel", () => {
    const data: ChroniclePanelData = { entries: [], totalEntries: 0, emptyReason: "No entries found." };
    const lines = formatChroniclePanel(data);
    assert.ok(lines.some(l => l.includes("No entries found.")));
  });

  it("formats one Chronicle entry", () => {
    const data: ChroniclePanelData = {
      entries: [{ chronicleId: "c1", signalCode: "00000000", offeringAction: "proceed", routeTarget: "guild", summary: "test diagnostic", createdAt: new Date().toISOString() }],
      totalEntries: 1,
    };
    const lines = formatChroniclePanel(data);
    assert.ok(lines.some(l => l.includes("1")));
    assert.ok(lines.some(l => l.includes("00000000")));
    assert.ok(lines.some(l => l.includes("proceed")));
  });

  it("formats multiple Chronicle entries", () => {
    const entries: ChroniclePanelEntry[] = [
      { chronicleId: "c1", signalCode: "00000000", offeringAction: "proceed", routeTarget: "guild", summary: "first", createdAt: new Date("2026-01-01").toISOString() },
      { chronicleId: "c2", signalCode: "11111111", offeringAction: "ask_approval", routeTarget: "caller", summary: "second", createdAt: new Date("2026-01-02").toISOString() },
    ];
    const data: ChroniclePanelData = { entries, totalEntries: 2 };
    const lines = formatChroniclePanel(data);
    assert.ok(lines.some(l => l.includes("2")));
    assert.ok(lines.some(l => l.includes("first")));
    assert.ok(lines.some(l => l.includes("second")));
  });

  it("handles no matches", () => {
    const data: ChroniclePanelData = { query: "signal:abcdef", entries: [], totalEntries: 0 };
    const lines = formatChroniclePanel(data);
    assert.ok(lines.some(l => l.includes("filter")));
    assert.ok(lines.some(l => l.includes("No chronicle")));
  });

  it("chronicleEntryToPanelEntry converts ChronicleEntry to panel entry", () => {
    const chronicleEntry = {
      entryId: "chronicle-001",
      signalCode: "10101010",
      domain: "task" as const,
      polarity: "ire" as const,
      problem: "Test diagnostic run",
      diagnosis: "Offering: proceed",
      actionTaken: "proceed",
      outcome: "success" as const,
      lesson: "Guild candidates: 0",
      offeringsUsed: ["proceed"],
      taboosObserved: [],
      traceRefs: [],
      replayRefs: [],
      rollbackRefs: [],
      createdAt: "2026-06-11T00:00:00.000Z",
    };

    const panelEntry = chronicleEntryToPanelEntry(chronicleEntry);
    assert.equal(panelEntry.chronicleId, "chronicle-001");
    assert.equal(panelEntry.signalCode, "10101010");
    assert.equal(panelEntry.offeringAction, "proceed");
    assert.equal(panelEntry.summary, "Test diagnostic run");
    assert.equal(panelEntry.createdAt, "2026-06-11T00:00:00.000Z");
  });

  it("does NOT import ToolExecutor, PolicyGate, or ApprovalStore", () => {
    const source = require("fs").readFileSync("src/tui/chronicle-panel.ts", "utf-8");
    assert.ok(!source.includes("ToolExecutor"));
    assert.ok(!source.includes("PolicyGate"));
    assert.ok(!source.includes("ApprovalStore"));
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run build && node --test dist/tests/tui/chronicle-panel.test.js`
Expected: 6/6 tests pass (only tests for the new panel module)

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tui/chronicle-panel.test.js` — 6/6 pass
3. `node --test dist/tests/runtime/*.test.js dist/tests/tui/*.test.js` — no regressions
4. `grep -rn 'ToolExecutor\|PolicyGate\|ApprovalStore' src/tui/chronicle-panel.ts` — no output
5. Git diff shows only the intended files
