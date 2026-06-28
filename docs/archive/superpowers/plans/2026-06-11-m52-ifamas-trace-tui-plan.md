# M0.52 IFÁ-MAS Trace/TUI Integration Plan

**Status:** ✅ Completed (M0.52)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface IFÁ-MAS diagnostic artifacts (Signal, Offering, Route, Gateway, Guild) in the existing TUI panel system without changing execution behavior.

**Architecture:** A new `"ifamas"` panel type and `IfamasTracePanel` data model. The panel renders a compact summary of the last diagnostic run. State is stored in `TuiState` and populated via `runtime-snapshot.ts`. The panel-renderer gets a new `s.activePanel === "ifamas"` branch. No changes to ToolExecutor, PolicyGate, ApprovalStore, or routing.

**Tech Stack:** TypeScript, existing TuiStore/TuiPanel patterns, `node:test`.

---

## File Structure

### Create
- `src/tui/ifamas-panel.ts` — `IfamasTracePanel` type + rendering helpers
- `tests/tui/ifamas-panel.test.ts` — 8 test cases

### Modify
- `src/tui/store.ts` — add `"ifamas"` to `TuiPanel`, add `ifamasPanelData` to `TuiState`
- `src/tui/panel-renderer.ts` — add `s.activePanel === "ifamas"` render branch
- `src/tui/runtime-snapshot.ts` — accept and carry `IfamasTracePanel` data

---

### Task 1: Create `src/tui/ifamas-panel.ts`

**Files:**
- Create: `src/tui/ifamas-panel.ts`

- [ ] **Step 1: Write the panel model and helpers**

```typescript
/**
 * ifamas-panel.ts — IFÁ-MAS diagnostic panel model for the TUI.
 *
 * Renders a compact summary of the last IFÁ-MAS diagnostic pipeline run.
 * Pure display logic — no execution, no state mutation.
 */

export type IfamasTracePanel = {
  signalCode: string;
  polarity: string;
  offeringAction: string;
  routeTarget?: string;
  gatewayValid: boolean;
  guildCandidateCount: number;
  topGuildCandidate?: string;
  chronicleRefCount: number;
};

/**
 * Format an IfamasTracePanel into display lines for the TUI.
 * Returns an array of strings, one per line.
 */
export function formatIfamasPanel(panel: IfamasTracePanel): string[] {
  const lines: string[] = [];

  lines.push("── IFÁ-MAS Diagnostic ─────────────────");
  lines.push(`Signal:   ${panel.polarity.toUpperCase()}  ${panel.signalCode}`);
  lines.push(`Offering: ${panel.offeringAction}`);
  lines.push(`Route:    ${panel.routeTarget ?? "—"}`);
  lines.push(`Gateway:  ${panel.gatewayValid ? "✓ valid" : "✗ invalid"}`);
  lines.push(`Guild:    ${panel.guildCandidateCount} candidate(s)`);
  if (panel.topGuildCandidate) {
    lines.push(`  Top:    ${panel.topGuildCandidate}`);
  }
  if (panel.chronicleRefCount > 0) {
    lines.push(`Chronicle: ${panel.chronicleRefCount} past case(s) found`);
  }

  return lines;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 2: Add `"ifamas"` panel to store.ts

**Files:**
- Modify: `src/tui/store.ts`

- [ ] **Step 1: Add `"ifamas"` to TuiPanel**

At line 64, change:
```typescript
export type TuiPanel = "chat" | "daemon" | "approvals" | "sops" | "policy" | "runtime" | "trace" | "replays";
```
To:
```typescript
export type TuiPanel = "chat" | "daemon" | "approvals" | "sops" | "policy" | "runtime" | "trace" | "replays" | "ifamas";
```

- [ ] **Step 2: Add `ifamasPanelData` to TuiState**

After `selectedReplayIds: string[];` at line 106, add:
```typescript
  ifamasPanelData?: import("./ifamas-panel.js").IfamasTracePanel;
```

- [ ] **Step 3: Add `"ifamas"` to PANELS**

At line 109, change:
```typescript
export const PANELS: TuiPanel[] = ["chat", "daemon", "approvals", "sops", "policy", "runtime", "trace", "replays"];
```
To:
```typescript
export const PANELS: TuiPanel[] = ["chat", "daemon", "approvals", "sops", "policy", "runtime", "trace", "replays", "ifamas"];
```

- [ ] **Step 4: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 3: Render the IFÁ-MAS panel in panel-renderer.ts

**Files:**
- Modify: `src/tui/panel-renderer.ts`

- [ ] **Step 1: Add the import**

At the top, after the existing `import` lines, add:
```typescript
import { formatIfamasPanel } from "./ifamas-panel.js";
```

- [ ] **Step 2: Add the render branch**

After the `s.activePanel === "replays"` block (just before the final render), add:
```typescript
  } else if (s.activePanel === "ifamas") {
    if (s.ifamasPanelData) {
      const panelLines = formatIfamasPanel(s.ifamasPanelData);
      for (const line of panelLines) {
        buf.push(line);
      }
    } else {
      buf.push("── IFÁ-MAS Diagnostic ─────────────────");
      buf.push("  No diagnostic data loaded.");
      buf.push("  Run a diagnostic or call runIfamasDiagnostic()");
      buf.push("  then set ifamasPanelData via /ifamas command.");
    }
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 4: Wire into runtime-snapshot.ts

**Files:**
- Modify: `src/tui/runtime-snapshot.ts`

- [ ] **Step 1: Add `ifamasPanelData` to TuiRuntimeSnapshot**

At line 38, after `replayLockStates`, add:
```typescript
  ifamasPanelData?: import("./ifamas-panel.js").IfamasTracePanel;
```

- [ ] **Step 2: Pass through in applySnapshotToStore**

Find the `applySnapshotToStore` function and add after the `replayLockStates` line:
```typescript
  if (snapshot.ifamasPanelData) {
    store.getState().ifamasPanelData = snapshot.ifamasPanelData;
  }
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 5: Wire a `/ifamas` TUI command

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add `/ifamas` command handler**

In the main TUI loop, after the `/replay-status` handler (around line 697), add:

```typescript
      // /ifamas — run IFÁ-MAS diagnostic pipeline on selected trace event
      if (task.startsWith("/ifamas")) {
        const selected = store.getSelectedTraceEvent();
        if (!selected) {
          tui.appendOutput("No trace event selected. Navigate to a trace event first.\n", false);
          continue;
        }

        // Build a minimal SignalFrame from the selected event
        const { createSignalFrame } = await import("../../runtime/signal-frame.js");
        const { runIfamasDiagnostic } = await import("../../runtime/ifamas-pipeline.js");

        // Determine bits from event properties
        const bits = {
          intentClear: true,
          policyRisk: false,
          toolRequired: false,
          memoryRequired: false,
          freshnessRequired: false,
          mutationPossible: false,
          approvalRequired: false,
          replayRollbackContext: false,
        };

        const signal = createSignalFrame({ bits, domain: "task", intent: selected.label ?? "trace-event" });

        try {
          const diagnostic = await runIfamasDiagnostic({ signal });
          const { IfamasTracePanel, formatIfamasPanel } = await import("../../tui/ifamas-panel.js");

          const panelData: IfamasTracePanel = {
            signalCode: diagnostic.signal.code,
            polarity: diagnostic.signal.polarity,
            offeringAction: diagnostic.offering.action,
            routeTarget: diagnostic.routeDecision.routeHint.targetRole,
            gatewayValid: diagnostic.gatewayValidation.valid,
            guildCandidateCount: diagnostic.guildCandidates.length,
            topGuildCandidate: diagnostic.guildCandidates[0]?.profile?.agentId,
            chronicleRefCount: diagnostic.routeDecision.chronicleEntries.length,
          };

          store.getState().ifamasPanelData = panelData;
          store.setPanel("ifamas");

          const panelLines = formatIfamasPanel(panelData);
          tui.appendOutput(panelLines.join("\n") + "\n", false);
        } catch (err: any) {
          tui.appendOutput("IFÁ-MAS diagnostic error: " + err.message + "\n", false);
        }
        continue;
      }
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

---

### Task 6: Write tests

**Files:**
- Create: `tests/tui/ifamas-panel.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatIfamasPanel } from "../../src/tui/ifamas-panel.js";
import type { IfamasTracePanel } from "../../src/tui/ifamas-panel.js";

function makePanel(overrides: Partial<IfamasTracePanel> = {}): IfamasTracePanel {
  return {
    signalCode: "00100010",
    polarity: "ire",
    offeringAction: "proceed",
    routeTarget: "guild",
    gatewayValid: true,
    guildCandidateCount: 2,
    topGuildCandidate: "guild-agent-1",
    chronicleRefCount: 0,
    ...overrides,
  };
}

describe("formatIfamasPanel", () => {
  it("renders Signal code and polarity", () => {
    const panel = makePanel({ signalCode: "11111111", polarity: "ibi" });
    const lines = formatIfamasPanel(panel);
    const signalLine = lines.find(l => l.startsWith("Signal:"));
    assert.ok(signalLine);
    assert.ok(signalLine!.includes("11111111"));
    assert.ok(signalLine!.includes("IBI"));
  });

  it("renders Offering action", () => {
    const panel = makePanel({ offeringAction: "ask_approval" });
    const lines = formatIfamasPanel(panel);
    assert.ok(lines.some(l => l.includes("ask_approval")));
  });

  it("renders Nexus route recommendation", () => {
    const panel = makePanel({ routeTarget: "caller" });
    const lines = formatIfamasPanel(panel);
    assert.ok(lines.some(l => l.includes("caller")));
  });

  it("renders gateway validation result", () => {
    const validLines = formatIfamasPanel(makePanel({ gatewayValid: true }));
    assert.ok(validLines.some(l => l.includes("valid")));

    const invalidLines = formatIfamasPanel(makePanel({ gatewayValid: false }));
    assert.ok(invalidLines.some(l => l.includes("invalid")));
  });

  it("renders guild candidate count", () => {
    const lines = formatIfamasPanel(makePanel({ guildCandidateCount: 3 }));
    assert.ok(lines.some(l => l.includes("3")));
  });

  it("handles no candidates", () => {
    const panel = makePanel({ guildCandidateCount: 0, topGuildCandidate: undefined });
    const lines = formatIfamasPanel(panel);
    assert.ok(lines.some(l => l.includes("0")));
    // Should not include "Top:" line
    assert.ok(!lines.some(l => l.startsWith("  Top:")));
  });

  it("handles invalid gateway result", () => {
    const panel = makePanel({ gatewayValid: false });
    const lines = formatIfamasPanel(panel);
    assert.ok(lines.some(l => l.includes("invalid")));
  });

  it("does NOT require ToolExecutor / PolicyGate imports", () => {
    const fs = require("fs");
    const source = fs.readFileSync("src/tui/ifamas-panel.ts", "utf-8");
    assert.ok(!source.includes("ToolExecutor"));
    assert.ok(!source.includes("PolicyGate"));
    assert.ok(!source.includes("ApprovalStore"));
  });
});
```

- [ ] **Step 2: Run the test**

Run: `node --test dist/tests/tui/ifamas-panel.test.js`
Expected: 8/8 tests pass

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tui/ifamas-panel.test.js` — 8/8 pass
3. `node --test dist/tests/runtime/*.test.js dist/tests/tui/*.test.js dist/tests/agents/*.test.js dist/tests/chronicle/*.test.js` — no regressions
4. `grep -rn 'ToolExecutor\|PolicyGate\|ApprovalStore' src/tui/ifamas-panel.ts` — no output
5. Git diff shows only the expected files
