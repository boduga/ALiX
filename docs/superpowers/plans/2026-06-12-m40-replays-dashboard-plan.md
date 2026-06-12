# M0.40 — Replays Dashboard Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated TUI panel that lists all replay and rollback operations with their status, provides per-item drilldown into diffs and approval state, and surfaces reliability warnings.

**Architecture:** A new `ReplaysPanel` component in `src/tui/` reads from `ReplayStatusIndex` and the existing replay/rollback stores on disk. It shows a scrollable list of replays (most recent first), each with status icon/color. Selecting one shows a detail view (diff set, approval status, step results). The panel is registered in `PanelRenderer` and navigable via `replays` panel name.

**Tech Stack:** TypeScript, existing TUI panel system (`panel-renderer.ts`, `store.ts`), existing runtime stores (`ReplayStatusIndex`, `ReplayDiffStore`, `RollbackProgressStore`), `node:test`.

---

## File Structure

### Create
- `src/tui/replays-panel.ts` — ReplaysPanel component (~350 lines)
- `tests/tui/replays-panel.test.ts` — (~150 lines)

### Modify
- `src/tui/panel-renderer.ts` — register `"replays"` panel in defaultPanels
- `src/cli/commands/tui.ts` — add `replays` to tab nav (optional, not critical)

---

### Task 1: Implement ReplaysPanel component

**Files:**
- Create: `src/tui/replays-panel.ts`

- [ ] **Step 1: Create the ReplaysPanel file**

```typescript
/**
 * replays-panel.ts — TUI panel for browsing replay and rollback history.
 *
 * Reads status from ReplayStatusIndex, loads rollback progress, and
 * renders a scrollable list. Selection opens a detail view with
 * diffs, approval state, and step results.
 */

import type { ReplayStatusIndex } from "../runtime/replay-status-index.js";
import type { RollbackProgressStore } from "../runtime/rollback-progress.js";
import type { ReplayDiffStore } from "../runtime/replay-diff-store.js";
import type { ReplayLock } from "../runtime/replay-lock.js";
import { STATUS_ICONS, type TuiPanel } from "./panel-renderer.js";
import type { TuiStore } from "./store.js";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

// ─── Types ─────────────────────────────────────────────────────────────

export type ReplaySummary = {
  replayId: string;
  mode: "dry-run" | "sandbox" | "approved-live";
  status: "pending" | "running" | "completed" | "failed" | "locked" | "rollback-completed" | "rollback-partial";
  stepCount: number;
  createdAt: string;
  hasDiffSet: boolean;
  approvalIds: string[];
};

export type ReplaysPanelState = {
  replays: ReplaySummary[];
  selectedIndex: number;
  detailView: boolean;
  loading: boolean;
  error?: string;
};

// ─── Colors (ANSI) ─────────────────────────────────────────────────────

const COLOR_GREEN = "\x1b[32m";
const COLOR_YELLOW = "\x1b[33m";
const COLOR_RED = "\x1b[31m";
const COLOR_CYAN = "\x1b[36m";
const COLOR_DIM = "\x1b[2m";
const COLOR_RESET = "\x1b[0m";
const COLOR_BOLD = "\x1b[1m";

// ─── Status helpers ────────────────────────────────────────────────────

function statusIcon(status: string): string {
  switch (status) {
    case "completed": return `${COLOR_GREEN}✓${COLOR_RESET}`;
    case "running": return `${COLOR_YELLOW}●${COLOR_RESET}`;
    case "pending": return `${COLOR_DIM}○${COLOR_RESET}`;
    case "failed": return `${COLOR_RED}✗${COLOR_RESET}`;
    case "locked": return `${COLOR_YELLOW}🔒${COLOR_RESET}`;
    case "rollback-completed": return `${COLOR_GREEN}↩${COLOR_RESET}`;
    case "rollback-partial": return `${COLOR_YELLOW}↩${COLOR_RESET}`;
    default: return `${COLOR_DIM}?${COLOR_RESET}`;
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

// ─── ReplaysPanel ──────────────────────────────────────────────────────

export class ReplaysPanel implements TuiPanel {
  readonly name = "replays";
  private state: ReplaysPanelState = {
    replays: [],
    selectedIndex: 0,
    detailView: false,
    loading: true,
  };

  constructor(
    private cwd: string,
    private store: TuiStore,
    private statusIndex: ReplayStatusIndex,
    private rollbackProgress?: RollbackProgressStore,
    private diffStore?: ReplayDiffStore,
  ) {}

  async refresh(): Promise<void> {
    this.state.loading = true;
    this.state.detailView = false;
    this.state.selectedIndex = 0;
    try {
      this.state.replays = await this.loadReplays();
      this.state.error = undefined;
    } catch (err: any) {
      this.state.error = err.message;
      this.state.replays = [];
    }
    this.state.loading = false;
  }

  private async loadReplays(): Promise<ReplaySummary[]> {
    const summaries: ReplaySummary[] = [];
    const statuses = await this.statusIndex.getAllStatuses();

    for (const [replayId, status] of Object.entries(statuses)) {
      const diffSet = this.diffStore
        ? await this.diffStore.loadIndex(replayId)
        : undefined;

      const replayDir = join(this.cwd, ".alix", "replays", replayId);
      let createdAt = "";
      try {
        const metaPath = join(replayDir, "meta.json");
        if (existsSync(metaPath)) {
          const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
          createdAt = meta.createdAt || "";
        }
      } catch { /* no meta file */ }

      summaries.push({
        replayId,
        mode: status.mode as any,
        status: status.status as any,
        stepCount: status.stepCount || 0,
        createdAt,
        hasDiffSet: !!diffSet && diffSet.records.length > 0,
        approvalIds: status.approvalIds || [],
      });
    }

    summaries.sort((a, b) => {
      const tA = new Date(a.createdAt || 0).getTime();
      const tB = new Date(b.createdAt || 0).getTime();
      return tB - tA; // most recent first
    });

    return summaries;
  }

  async render(width: number, height: number): Promise<string[]> {
    if (this.state.error) {
      return [`${COLOR_RED}Error loading replays: ${this.state.error}${COLOR_RESET}`];
    }
    if (this.state.loading) {
      return ["Loading replays..."];
    }
    if (this.state.replays.length === 0) {
      return ["No replays found. Run a replay first via /replay."];
    }

    if (this.state.detailView && this.state.replays[this.state.selectedIndex]) {
      return this.renderDetail(width, height);
    }

    return this.renderList(width, height);
  }

  private renderList(width: number, height: number): string[] {
    const lines: string[] = [];
    const header = `${COLOR_BOLD}Replays (${this.state.replays.length})${COLOR_RESET}`;
    lines.push(header);
    lines.push("─".repeat(Math.min(width, 60)));

    const availableLines = height - 3;
    let startIdx = Math.max(0, this.state.selectedIndex - Math.floor(availableLines / 2));
    const visible = this.state.replays.slice(startIdx, startIdx + availableLines);

    for (const replay of visible) {
      const idx = this.state.replays.indexOf(replay);
      const sel = idx === this.state.selectedIndex ? "▸ " : "  ";
      const icon = statusIcon(replay.status);
      const modeTag = replay.mode === "approved-live" ? "live" : replay.mode;
      const diffIcon = replay.hasDiffSet ? " 📄" : "";
      const ts = replay.createdAt ? formatTimestamp(replay.createdAt) : "unknown date";

      lines.push(`${sel}${icon} ${replay.replayId.slice(0, 24)} [${modeTag}]${diffIcon}`);
      lines.push(`   ${COLOR_DIM}${ts} — ${replay.stepCount} steps${COLOR_RESET}`);
    }

    lines.push("");
    lines.push(`${COLOR_DIM}↑↓ navigate · → detail · r refresh · ESC back${COLOR_RESET}`);
    return lines;
  }

  private renderDetail(width: number, height: number): string[] {
    const replay = this.state.replays[this.state.selectedIndex];
    const lines: string[] = [];

    const header = `${COLOR_BOLD}${statusIcon(replay.status)} ${replay.replayId}${COLOR_RESET}`;
    lines.push(header);
    lines.push("─".repeat(Math.min(width, 60)));

    lines.push(`Mode:   ${replay.mode}`);
    lines.push(`Status: ${replay.status}`);
    lines.push(`Steps:  ${replay.stepCount}`);
    if (replay.createdAt) lines.push(`Date:   ${formatTimestamp(replay.createdAt)}`);
    lines.push(`Diffs:  ${replay.hasDiffSet ? `${COLOR_GREEN}available${COLOR_RESET}` : `${COLOR_DIM}none${COLOR_RESET}`}`);
    if (replay.approvalIds.length > 0) {
      lines.push(`Approvals: ${replay.approvalIds.length}`);
    }

    lines.push("");
    lines.push(`${COLOR_DIM}← back to list${COLOR_RESET}`);
    return lines;
  }

  onInput(key: string): boolean {
    if (this.state.replays.length === 0) return false;

    if (this.state.detailView) {
      if (key === "left" || key === "escape") {
        this.state.detailView = false;
        return true;
      }
      return false;
    }

    switch (key) {
      case "down": case "j":
        if (this.state.selectedIndex < this.state.replays.length - 1) {
          this.state.selectedIndex++;
        }
        return true;
      case "up": case "k":
        if (this.state.selectedIndex > 0) {
          this.state.selectedIndex--;
        }
        return true;
      case "right": case "enter":
        this.state.detailView = true;
        return true;
      case "r":
        this.refresh();
        return true;
      default:
        return false;
    }
  }
}
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

- [ ] **Step 3: Commit**

```bash
git add src/tui/replays-panel.ts
git commit -m "feat(tui): add ReplaysPanel component for browsing replay history"
```

---

### Task 2: Register replays panel in PanelRenderer

**Files:**
- Modify: `src/tui/panel-renderer.ts`

- [ ] **Step 1: Import ReplaysPanel**

Add at the top of `src/tui/panel-renderer.ts`:
```typescript
import { ReplaysPanel } from "./replays-panel.js";
```

- [ ] **Step 2: Register in defaultPanels array**

Find the `defaultPanels` array (exported, contains panels like "tasks", "trace", "approvals", "chronicle", "echo"). Add `"replays"`:
```typescript
export const defaultPanels: [string, ...string[]] = [
  "tasks", "trace", "approvals", "chronicle", "echo", "replays",
];
```

- [ ] **Step 3: Wire construction in createPanel function**

Find the `createPanel()` function that maps panel names to instances. Add a case:
```typescript
if (name === "replays") {
  return new ReplaysPanel(cwd, store, statusIndex, rollbackProgress, diffStore);
}
```

Pass the required deps into the function signature or access them from existing parameters.

- [ ] **Step 4: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

- [ ] **Step 5: Commit**

```bash
git add src/tui/panel-renderer.ts
git commit -m "feat(tui): register replays panel in PanelRenderer"
```

---

### Task 3: Write tests for ReplaysPanel

**Files:**
- Create: `tests/tui/replays-panel.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ReplaysPanel } from "../../src/tui/replays-panel.js";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const TEST_DIR = join(process.cwd(), `.test-replays-panel-${Date.now()}`);
const ALIX_DIR = join(TEST_DIR, ".alix", "replays");

function makeReplayDir(replayId: string): string {
  const dir = join(ALIX_DIR, replayId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeStatusIndex() {
  const filePath = join(ALIX_DIR, "..", "status-index.json");
  return { filePath, load: async () => {} };
}

describe("ReplaysPanel", () => {
  let store: any;
  let statusIndex: any;
  let panel: ReplaysPanel;

  beforeEach(() => {
    mkdirSync(ALIX_DIR, { recursive: true });

    statusIndex = {
      getAllStatuses: async () => ({
        "replay_1": { status: "completed", mode: "approved-live", stepCount: 5, approvalIds: ["apr_1"] },
        "replay_2": { status: "failed", mode: "dry-run", stepCount: 3, approvalIds: [] },
        "replay_3": { status: "running", mode: "sandbox", stepCount: 2, approvalIds: [] },
      }),
    };

    store = { getState: () => ({ traceEvents: [] }) };
    panel = new ReplaysPanel(TEST_DIR, store, statusIndex);
  });

  afterEach(() => {
    rmSync(join(TEST_DIR, ".alix"), { recursive: true, force: true });
  });

  it("shows loading state before refresh", async () => {
    // Panel starts as "loading: true" — wait for nothing
    const lines = await panel.render(80, 24);
    // render() doesn't block; loading state shown before refresh
    assert.ok(lines.length > 0);
  });

  it("loads replays and renders list after refresh", async () => {
    await panel.refresh();
    const lines = await panel.render(80, 24);
    assert.ok(lines.some(l => l.includes("replay_1")), "list must contain replay_1");
    assert.ok(lines.some(l => l.includes("replay_2")), "list must contain replay_2");
  });

  it("shows empty state when no replays exist", async () => {
    statusIndex.getAllStatuses = async () => ({});
    panel = new ReplaysPanel(TEST_DIR, store, statusIndex);
    await panel.refresh();
    const lines = await panel.render(80, 24);
    assert.ok(lines.some(l => l.includes("No replays found")), "must show empty state");
  });

  it("shows error state on failure", async () => {
    statusIndex.getAllStatuses = async () => { throw new Error("Store unavailable"); };
    panel = new ReplaysPanel(TEST_DIR, store, statusIndex);
    await panel.refresh();
    const lines = await panel.render(80, 24);
    assert.ok(lines.some(l => l.includes("Error")), "must show error state");
  });

  it("navigates with up/down keys", async () => {
    await panel.refresh();
    assert.equal((panel as any).state.selectedIndex, 0);
    panel.onInput("down");
    assert.equal((panel as any).state.selectedIndex, 1);
    panel.onInput("down");
    assert.equal((panel as any).state.selectedIndex, 2);
    panel.onInput("up");
    assert.equal((panel as any).state.selectedIndex, 1);
  });

  it("opens detail view on right arrow", async () => {
    await panel.refresh();
    assert.equal((panel as any).state.detailView, false);
    panel.onInput("right");
    assert.equal((panel as any).state.detailView, true);
  });

  it("closes detail view on left arrow or escape", async () => {
    await panel.refresh();
    panel.onInput("right");
    assert.equal((panel as any).state.detailView, true);
    panel.onInput("left");
    assert.equal((panel as any).state.detailView, false);
  });

  it("refreshes on r key", async () => {
    await panel.refresh();
    panel.onInput("r");
    // After refresh, loading becomes false and replays are loaded
    assert.equal((panel as any).state.loading, false);
  });

  it("detail view shows replay metadata", async () => {
    await panel.refresh();
    panel.onInput("right");
    const lines = await panel.render(80, 24);
    assert.ok(lines.some(l => l.includes("replay_1")), "detail must show replay ID");
    assert.ok(lines.some(l => l.includes("approved-live")), "detail must show mode");
    assert.ok(lines.some(l => l.includes("completed")), "detail must show status");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run build && node --test dist/tests/tui/replays-panel.test.js
```
Expected: tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/tui/replays-panel.test.ts
git commit -m "test(tui): add ReplaysPanel unit tests"
```

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/tui/replays-panel.test.js` — all tests pass
3. `node --test dist/tests/tui/*.test.js` — no regressions in existing TUI panels
4. `node --test dist/tests/runtime/replay-*.test.js` — no regressions in replay stores
