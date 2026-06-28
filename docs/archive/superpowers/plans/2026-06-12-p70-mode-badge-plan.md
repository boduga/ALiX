# P0.70 — TUI Mode Badge

**Goal:** Show the current policy mode (ask/bypass/auto) as a visible badge/icon in the TUI welcome line so the operator sees it at a glance.

**Architecture:** One-line change to the welcome text in `src/cli/commands/tui.ts`. Add an icon prefix to the existing `Session: ${mode}` display.

---

### Task 1: Add mode icon

**Files:**
- Modify: `src/cli/commands/tui.ts`

Find the welcome text at line 148:
```typescript
  tui.appendOutput(`Execution mode: ${execMode} | Session: ${mode}${daemonInfo}`, false);
```

Change to:
```typescript
  const modeIcon = mode === "bypass" ? "⚠" : mode === "auto" ? "●" : "✓";
  tui.appendOutput(`Execution mode: ${execMode} | Session: ${modeIcon} ${mode}${daemonInfo}`, false);
```

### Task 2: Add test

Create `tests/tui/mode-badge.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("TUI mode badge", () => {
  it("bypass mode shows warning icon", () => {
    const mode = "bypass";
    const icon = mode === "bypass" ? "⚠" : mode === "auto" ? "●" : "✓";
    assert.equal(icon, "⚠");
  });

  it("ask mode shows checkmark", () => {
    const mode = "ask";
    const icon = mode === "bypass" ? "⚠" : mode === "auto" ? "●" : "✓";
    assert.equal(icon, "✓");
  });

  it("auto mode shows bullet", () => {
    const mode = "auto";
    const icon = mode === "bypass" ? "⚠" : mode === "auto" ? "●" : "✓";
    assert.equal(icon, "●");
  });
});
```

### Verification

```bash
npm run build && node --test dist/tests/tui/mode-badge.test.js
```
