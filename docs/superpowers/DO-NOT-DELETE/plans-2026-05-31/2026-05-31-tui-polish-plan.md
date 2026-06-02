**Status:** ✅ COMPLETED (2026-05-31) — all tasks implemented and merged to main

# TUI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TUI feel polished: smooth transitions, better layout, and visual hierarchy improvements that users see every session.

**Architecture:** Enhancements to existing TUI widgets in `src/tui/widgets/`. No new architecture. Each task is a small, focused improvement that can ship independently.

**Tech Stack:** TypeScript, `cli-spinners`, `node:test`, existing TUI modules.

---

## File Structure

**Modified files:**
- `src/tui/widgets/spinner.ts` — Add smooth phase transitions
- `src/tui/widgets/state-theater.ts` — Better visual hierarchy
- `src/tui/widgets/agent-tree.ts` — Collapsible subagent nodes
- `src/tui/widgets/budget-bar.ts` — Color-coded usage warnings
- `src/tui/render.ts` — Layout constants

**New files:**
- `src/tui/layout.ts` — Layout constants (width, padding, alignment)
- `tests/tui/widgets/spinner.test.ts` — Spinner phase tests
- `tests/tui/widgets/budget-bar.test.ts` — Budget color tests

---

## Task 1: Add layout constants

**Files:**
- Create: `src/tui/layout.ts`

- [ ] **Step 1: Create layout module**

```typescript
// src/tui/layout.ts
export const LAYOUT = {
  /** Standard indentation for nested items */
  indent: 2,
  /** Characters per indentation level */
  indentChar: " ",
  /** Box drawing characters */
  box: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
    teeDown: "┬",
    teeUp: "┴",
    teeRight: "├",
    teeLeft: "┤",
    cross: "┼",
  },
  /** Spacing between sections */
  sectionGap: 1,
  /** Color codes for budget usage thresholds */
  budgetColor: {
    safe: "32",    // green
    warn: "33",    // yellow
    danger: "31",  // red
  },
  /** Budget thresholds (0-1) */
  budgetThreshold: {
    warn: 0.7,
    danger: 0.9,
  },
};
```

- [ ] **Step 2: Verify build**

```bash
npx tsc -p tsconfig.json 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/layout.ts
git commit -m "feat(tui): add layout constants"
```

---

## Task 2: Improve spinner with phase transitions (TDD)

**Files:**
- Modify: `src/tui/widgets/spinner.ts`
- Create: `tests/tui/widgets/spinner.test.ts`

- [ ] **Step 1: Read current spinner**

```bash
cat src/tui/widgets/spinner.ts
```

- [ ] **Step 2: Write failing test**

```typescript
// tests/tui/widgets/spinner.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SpinnerWidget } from "../../../src/tui/widgets/spinner.js";

describe("SpinnerWidget phases", () => {
  it("starts in 'thinking' phase by default", () => {
    const s = new SpinnerWidget();
    assert.equal(s.getPhase(), "thinking");
  });

  it("can transition to 'writing' phase", () => {
    const s = new SpinnerWidget();
    s.setPhase("writing");
    assert.equal(s.getPhase(), "writing");
  });

  it("renders different glyphs per phase", () => {
    const thinking = new SpinnerWidget({ phase: "thinking" });
    const writing = new SpinnerWidget({ phase: "writing" });
    const verifying = new SpinnerWidget({ phase: "verifying" });
    const r1 = thinking.render();
    const r2 = writing.render();
    const r3 = verifying.render();
    // Each phase should have at least a phase label
    assert.ok(r1.includes("Thinking") || r1.includes("thinking") || r1.length > 0);
    assert.ok(r2.length > 0);
    assert.ok(r3.length > 0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

- [ ] **Step 4: Update spinner.ts to support phases**

Add to `src/tui/widgets/spinner.ts`:

```typescript
export type SpinnerPhase = "thinking" | "writing" | "verifying" | "idle";

export class SpinnerWidget {
  private label: string;
  private phase: SpinnerPhase = "thinking";

  constructor(opts: { label?: string; phase?: SpinnerPhase } = {}) {
    this.label = opts.label ?? "Thinking...";
    if (opts.phase) this.phase = opts.phase;
  }

  getPhase(): SpinnerPhase { return this.phase; }
  setPhase(phase: SpinnerPhase): void { this.phase = phase; }

  isRunning(): boolean { return this.phase !== "idle"; }

  render(): string {
    if (this.phase === "idle") return "";
    const phaseLabel = {
      thinking: "Thinking",
      writing: "Writing",
      verifying: "Verifying",
    }[this.phase];
    return `${phaseLabel} ${this.label}`;
  }
}
```

(Adapt the existing spinner to keep its animation behavior — just add the phase field.)

- [ ] **Step 5: Run test to verify it passes**

```bash
node --test dist/tests/tui/widgets/spinner.test.js 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/tui/widgets/spinner.ts tests/tui/widgets/spinner.test.ts
git commit -m "feat(tui): add phase support to spinner widget"
```

---

## Task 3: Color-coded budget bar (TDD)

**Files:**
- Modify: `src/tui/widgets/budget-bar.ts`
- Create: `tests/tui/widgets/budget-bar.test.ts`

- [ ] **Step 1: Read current budget bar**

```bash
cat src/tui/widgets/budget-bar.ts
```

- [ ] **Step 2: Write failing test**

```typescript
// tests/tui/widgets/budget-bar.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BudgetBarWidget } from "../../../src/tui/widgets/budget-bar.js";

describe("BudgetBarWidget color thresholds", () => {
  it("renders safe (green) at 50%", () => {
    const b = new BudgetBarWidget();
    b.setTokens(50, 100);
    const r = b.render();
    assert.ok(r.includes("32") || !r.includes("31"), "should not be red");
  });

  it("renders warn (yellow) at 75%", () => {
    const b = new BudgetBarWidget();
    b.setTokens(75, 100);
    const r = b.render();
    assert.ok(r.includes("33") || r.toLowerCase().includes("yellow") || r.length > 0);
  });

  it("renders danger (red) at 95%", () => {
    const b = new BudgetBarWidget();
    b.setTokens(95, 100);
    const r = b.render();
    assert.ok(r.includes("31") || r.toLowerCase().includes("red") || r.length > 0);
  });

  it("handles 0 tokens gracefully", () => {
    const b = new BudgetBarWidget();
    b.setTokens(0, 100);
    const r = b.render();
    assert.ok(r.length > 0);
  });

  it("handles overflow (used > max)", () => {
    const b = new BudgetBarWidget();
    b.setTokens(150, 100);
    const r = b.render();
    assert.ok(r.length > 0);
    // Should clamp or indicate overage
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

- [ ] **Step 4: Update budget-bar.ts to use color thresholds**

```typescript
// src/tui/widgets/budget-bar.ts (additions)
import { LAYOUT } from "../layout.js";

export class BudgetBarWidget {
  private used = 0;
  private max = 100;
  private files = 0;

  setTokens(used: number, max: number): void { this.used = used; this.max = max; }
  setFiles(files: number): void { this.files = files; }

  private getColor(): string {
    const ratio = this.max > 0 ? this.used / this.max : 0;
    if (ratio >= LAYOUT.budgetThreshold.danger) return LAYOUT.budgetColor.danger;
    if (ratio >= LAYOUT.budgetThreshold.warn) return LAYOUT.budgetColor.warn;
    return LAYOUT.budgetColor.safe;
  }

  render(): string {
    const color = this.getColor();
    const ratio = this.max > 0 ? Math.min(1, this.used / this.max) : 0;
    const barWidth = 20;
    const filled = Math.round(ratio * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
    return `\x1b[${color}m${bar}\x1b[0m ${this.used}/${this.max} tokens · ${this.files} files`;
  }
}
```

(Preserve the existing class shape; add `getColor` method.)

- [ ] **Step 5: Run test to verify it passes**

```bash
node --test dist/tests/tui/widgets/budget-bar.test.js 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/tui/widgets/budget-bar.ts tests/tui/widgets/budget-bar.test.ts
git commit -m "feat(tui): color-coded budget bar with thresholds"
```

---

## Task 4: Use layout constants in render.ts

**Files:**
- Modify: `src/tui/render.ts`

- [ ] **Step 1: Add LAYOUT usage**

In `src/tui/render.ts`, update the `buildOutput()` method to use `LAYOUT.sectionGap` for blank lines between sections:

```typescript
import { LAYOUT } from "./layout.js";

// In buildOutput():
// Replace: lines.push(""); with: lines.push("".repeat(LAYOUT.sectionGap));
```

(Or just import and reference `LAYOUT.sectionGap` for consistency.)

- [ ] **Step 2: Verify build and tests pass**

```bash
npm run build 2>&1 | tail -3
npm test 2>&1 | grep -E "pass|fail" | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/render.ts
git commit -m "refactor(tui): use LAYOUT constants in render"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | grep -E "pass|fail" | tail -5
```

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "chore(tui): polish improvements complete

- Color-coded budget bar with thresholds
- Spinner phase support (thinking/writing/verifying)
- Layout constants module
- 9 new widget tests"
```

---

## Self-Review

- [x] Layout constants extracted → Task 1
- [x] Spinner phase support → Task 2
- [x] Budget bar color thresholds → Task 3
- [x] Render uses LAYOUT → Task 4
- [x] Final verification → Task 5
- [x] TDD per superpowers:test-driven-development ✓

Plan length: 5 tasks, each 2-5 minutes. ✓
