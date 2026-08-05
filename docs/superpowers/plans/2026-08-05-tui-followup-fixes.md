# TUI Follow-Up Fixes (Layout Helper + app.ts Split + Slice-Lock Test) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three follow-ups from the TUI bottom-anchored-panel work: centralize duplicated layout geometry, split the `TuiApp` god-class into cohesive modules, and add an end-to-end test proving the unpinned scrollback slice doesn't move when new content arrives.

**Architecture:** Three independent, sequential changes on one feature branch, each with its own commit and green test run: (1) a pure `computeViewport(dims, kind)` helper + constants in `scroll-math.ts` that replaces the duplicated `panelRow`/`scrollbackTop`/`scrollbackRows`/`textWidth` math; (2) a measured decomposition of `TuiApp` that extracts five cohesive units (`timeline-emitter`, `slash-controller`, `palette-controller`, `frame-painter`, `approval-resolver`) behind narrow context objects while `TuiApp` keeps input routing + dispatch + tab switching; (3) an app-level test that wires the real EventLog → RuntimeCollector → TuiApp chain and asserts slice identity across a repaint.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), node:test/vitest, EventLog (JSONL), RuntimeCollector projections, GitNexus MCP for impact gates.

## Global Constraints

- **GitNexus impact gate (project CLAUDE.md):** BEFORE editing any symbol in `src/tui/`, run `mcp__gitnexus__impact({ target: "<symbol>", direction: "upstream" })` and report blast radius. Warn on HIGH/CRITICAL before proceeding. BEFORE every commit, run `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })` and confirm only expected symbols/flows affected.
- **Preserve behavior exactly.** The test suites `tests/tui/*.vitest.ts` and `tests/tui/views/*.vitest.ts` must pass unchanged after Tasks 1–2. Task 3 only adds a new test.
- **`.js` import suffixes** on all relative imports (ESM).
- **Pre-existing CI failures (NOT regressions):** `pnpm test:node` currently fails on `AgentView slash strip` → `renders ranked candidates with the selected marker` — verified pre-existing at `a425cd05` (main). Task 1 touches `agent-view.ts`; after each commit, diff the node-tests failure count against main. If the count changes, you introduced a regression.
- **Run `graphify update .`** after implementation (project CLAUDE.md).
- **Branch policy:** single feature branch `tui/followup-fixes` off `main`; no other branches in flight.
- **Commit message trailer:** end each commit with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## File Structure (locked in before tasks)

- `src/tui/views/scroll-math.ts` — **Modify.** Add layout constants + `Viewport` interface + `computeViewport()`; refactor `computeBottomAnchor()` to use it.
- `src/tui/views/agent-view.ts` — **Modify.** Replace inline geometry with `computeViewport(ctx.dimensions, 'agent')`.
- `src/tui/views/chat-view.ts` — **Modify.** Replace inline geometry with `computeViewport(ctx.dimensions, 'chat')`.
- `src/tui/views/dashboard-view.ts` — **Modify.** Import `HEADER_H`/`FOOTER_H` constants instead of redefining.
- `src/tui/timeline-emitter.ts` — **Create.** EventLog emit methods.
- `src/tui/slash-controller.ts` — **Create.** Slash-completion state + logic.
- `src/tui/palette-controller.ts` — **Create.** Command-palette modal key handling + paint.
- `src/tui/frame-painter.ts` — **Create.** Full-frame painting + plan-approval card + cursor placement.
- `src/tui/approval-resolver.ts` — **Create.** Approval resolution from the view.
- `src/tui/app.ts` — **Modify.** Remove extracted methods; keep orchestration.
- `tests/tui/app-pinned-bottom.vitest.ts` — **Modify (Task 3).** Add slice-lock test + runtime-collector wiring.

---

## Task 1: `computeViewport` layout helper

**Files:**
- Modify: `src/tui/views/scroll-math.ts`
- Modify: `src/tui/views/agent-view.ts:34-88`
- Modify: `src/tui/views/chat-view.ts:25-65`
- Modify: `src/tui/views/dashboard-view.ts:42-43`
- Modify: `src/tui/app.ts:1071-1078, 1090-1128, 1589-1609` (use the helper; do NOT extract anything else yet)
- Modify: `tests/tui/views/scroll-math.vitest.ts:73,78` — `computeBottomAnchor(ctx, kind)` now takes 2 args (drop `76, 26`)
- Modify: `tests/tui/app-pinned-bottom.vitest.ts:110-115, 205-210` — drop the `textWidth` + `panelRow` args
- Test: `tests/tui/views/chat-view-bottom-anchored.vitest.ts` (existing — must stay green)

> **All `computeBottomAnchor` callers use the new 2-arg signature in the same commit.** `tsconfig.json` includes `tests/**/*.ts`, so the two test files above compile under `pnpm typecheck`/`pnpm build` — leaving them on the old 4-arg signature breaks Steps 6-9. The dropped args equal exactly what `computeViewport` derives (both test ctxs hardcode 80x30, so `76`/`26` → `textWidth=76`, `panelRow=26`), so assertions are unchanged, only arity.

**Interfaces:**
- Produces (consumed by Tasks 1–3):
  - `export const HEADER_H: 3`, `export const FOOTER_H: 3`, `export const PANEL_H: 0`, `export const SCROLLBACK_TOP_AGENT: 6`, `export const SCROLLBACK_TOP_CHAT: 5`
  - `export interface Viewport { headerRows: number; footerRows: number; panelRows: number; panelRow: number; scrollbackTop: number; scrollbackBottom: number; scrollbackRows: number; textWidth: number; promptCol: number; }`
  - `export function computeViewport(dims: { columns: number; rows: number }, kind: 'agent' | 'chat'): Viewport`
  - `export function computeBottomAnchor(ctx: ViewRenderContext, kind: 'agent' | 'chat'): number` (signature change — drops `textWidth` and `panelRow` params; computes internally)

- [ ] **Step 1: Refresh the GitNexus index, then run the impact gate for the symbols you'll edit**

The index was stale at plan time (`FTS indexes missing`, `computeBottomAnchor` not found). Per project CLAUDE.md, refresh first:
Run: `npx gitnexus analyze`

Then run: `mcp__gitnexus__impact({ target: "computeBottomAnchor", direction: "upstream" })`, then same for `computeScrollbackRows`, `AgentView`, `ChatView`, `TuiApp.paintFullFrame`, `TuiApp.resetScrollOffsetToBottom`, `TuiApp.dispatch`. (At plan time `TuiApp` upstream = MEDIUM, 11 impacted, 1 process `runTui`, module `Tui` — the contained blast radius is the basis for proceeding. Re-confirm after the index refresh.)
Expected: blast radius = the views + app.ts. Note the risk level. If HIGH/CRITICAL, STOP and warn the user.

- [ ] **Step 2: Add the constants + `Viewport` + `computeViewport` to `scroll-math.ts`**

At the top of `src/tui/views/scroll-math.ts` (after the imports, before `buildAgentScrollbackLines`), add:

```ts
/** Shared TUI layout geometry. Single source of truth — the views, app.ts,
 *  and scroll-math all compute panelRow/scrollbackTop/textWidth from these.
 *  FOOTER_H = 3 (tabs row + status row + padding). PANEL_H is the future
 *  multi-line input-panel knob (0 today — single-line prompt). */
export const HEADER_H = 3;
export const FOOTER_H = 3;
export const PANEL_H = 0;
/** Scrollback starts below the agent tab's status row (agent=6: header rows
 *  0-2, blank 3, status 4, blank 5). Chat has no status row, so 5. */
export const SCROLLBACK_TOP_AGENT = 6;
export const SCROLLBACK_TOP_CHAT = 5;

export interface Viewport {
  headerRows: number;
  footerRows: number;
  panelRows: number;
  panelRow: number;
  scrollbackTop: number;
  scrollbackBottom: number;
  scrollbackRows: number;
  textWidth: number;
  promptCol: number;
}

/** Compute all bottom-anchored layout geometry for a tab. Pure over dims. */
export function computeViewport(
  dims: { columns: number; rows: number },
  kind: 'agent' | 'chat',
): Viewport {
  const footerRows = FOOTER_H;
  const panelRow = Math.max(0, dims.rows - FOOTER_H - PANEL_H - 1);
  const scrollbackTop = kind === 'agent' ? SCROLLBACK_TOP_AGENT : SCROLLBACK_TOP_CHAT;
  const scrollbackBottom = panelRow - 1;
  return {
    headerRows: HEADER_H,
    footerRows,
    panelRows: PANEL_H,
    panelRow,
    scrollbackTop,
    scrollbackBottom,
    scrollbackRows: Math.max(0, scrollbackBottom - scrollbackTop + 1),
    textWidth: Math.max(0, dims.columns - 4),
    promptCol: kind === 'agent' ? 13 : 7,
  };
}
```

- [ ] **Step 3: Refactor `computeBottomAnchor` to use `computeViewport`**

Replace the existing `computeBottomAnchor` (currently `src/tui/views/scroll-math.ts:133-138`) with:

```ts
/** Compute the bottom-anchor offset: the index into the scrollback line array
 *  at which the visible window starts when `pinnedBottom === true`.
 *  Convenience wrapper used by the views' render branch and by app.ts on
 *  End/clear/tab-switch. */
export function computeBottomAnchor(ctx: ViewRenderContext, kind: 'agent' | 'chat'): number {
  const vp = computeViewport(ctx.dimensions, kind);
  const allLines = kind === 'agent' ? buildAgentScrollbackLines(ctx, vp.textWidth) : buildChatScrollbackLines(ctx, vp.textWidth);
  return Math.max(0, allLines.length - vp.scrollbackRows);
}
```

Note the signature change: it no longer takes `textWidth` or `panelRow` (both computed internally). **All callers must be updated in the same commit** — see Step 5.

- [ ] **Step 4: Update the views to use `computeViewport`**

In `src/tui/views/agent-view.ts`, replace the local constants + inline math (lines 36-45):

```ts
    const vp = computeViewport(ctx.dimensions, 'agent');
```

Then update the body:
- `textWidth` → `vp.textWidth`
- `panelRow` → `vp.panelRow` (wherever referenced)
- `scrollbackBottom` → `vp.scrollbackBottom`
- `scrollbackRows` → `vp.scrollbackRows`
- `renderBottomAnchoredSlice({ ... top: SCROLLBACK_TOP ... })` → `top: vp.scrollbackTop`
- `STATUS_ROW` (currently `4`) is used for the status-row writes at lines 52, 58 — it's a layout constant but NOT part of `computeViewport`'s contract. Keep a local `const STATUS_ROW = 4;` in `agent-view.ts` (or derive `SCROLLBACK_TOP_AGENT - 2`). Simplest: keep `const STATUS_ROW = 4;`.
- The prompt write uses `PROMPT_COL` (currently `13`) → `vp.promptCol`.
- Update the import: `import { buildAgentScrollbackLines, computeViewport } from './scroll-math.js';`

In `src/tui/views/chat-view.ts`, replace lines 27-35 with `const vp = computeViewport(ctx.dimensions, 'chat');` and update the same symbols (`panelRow`, `scrollbackBottom`, `scrollbackRows`, `textWidth`, `SCROLLBACK_TOP`, `PROMPT_COL` → their `vp.*` equivalents). Update the import to include `computeViewport`.

- [ ] **Step 5: Update `app.ts` callers of `computeBottomAnchor` + inline geometry**

In `src/tui/app.ts`:

(a) `resetScrollOffsetToBottom` (lines 1071-1078) — replace the body with:

```ts
  private resetScrollOffsetToBottom(tab: 'agent' | 'chat'): void {
    const ctx = this.buildViewRenderContext(tab);
    this.state.views[tab].scrollOffset = computeBottomAnchor(ctx, tab);
  }
```

(b) `dispatch`'s `case 'scroll':` (lines 1090-1128) — replace:

```ts
          const ctx = this.buildViewRenderContext(tab);
          const FOOTER_H = 3;
          const panelRow = Math.max(0, ctx.dimensions.rows - FOOTER_H - 1);
          const bottomAnchor = computeBottomAnchor(ctx, tab, Math.max(0, ctx.dimensions.columns - 4), panelRow);
```

with:

```ts
          const ctx = this.buildViewRenderContext(tab);
          const bottomAnchor = computeBottomAnchor(ctx, tab);
```

(the `step` logic and the rest of the case body stays unchanged).

(c) Cursor placement (lines 1589-1609) — replace the inline `panelRow = Math.max(0, dims.rows - 3 - 1)` (two occurrences) with `computeViewport(dims, 'chat').panelRow` / `computeViewport(dims, 'agent').panelRow`. Add `computeViewport` to the existing `import { computeBottomAnchor } from './views/scroll-math.js';` line.

(d) `dashboard-view.ts` (lines 42-43) — replace the local `const HEADER_H = 3; const FOOTER_H = 3;` with imports from `./scroll-math.js`:

```ts
import { HEADER_H, FOOTER_H } from './scroll-math.js';
```

(delete the local `const HEADER_H = 3; const FOOTER_H = 3;` definitions).

- [ ] **Step 6: Update the two test call sites to the 2-arg signature**

In `tests/tui/views/scroll-math.vitest.ts` lines 73, 78:
```ts
    expect(computeBottomAnchor(ctx30, 'agent', 76, 26)).toBe(179);
    // →
    expect(computeBottomAnchor(ctx30, 'agent')).toBe(179);
    expect(computeBottomAnchor(ctx3, 'agent', 76, 26)).toBe(0);
    // →
    expect(computeBottomAnchor(ctx3, 'agent')).toBe(0);
```

In `tests/tui/app-pinned-bottom.vitest.ts` lines 110-115 and 205-210: drop the `textWidth` and `panelRow` args, leaving `computeBottomAnchor(buildViewRenderContext('agent'), 'agent')` (2 args). The context helper in that file builds `dimensions` from `process.stdout`, which matches what `computeViewport` derives, so the expected value is unchanged.

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no `computeBottomAnchor` callers left on the old signature).

- [ ] **Step 8: Run the TUI view + app tests**

Run: `pnpm test:vitest -- tests/tui/views tests/tui/app-pinned-bottom.vitest.ts`
Expected: PASS. In particular `chat-view-bottom-anchored.vitest.ts` (the `panelRow(height)` helper and the slice-identity assertions) and `scroll-math.vitest.ts` (the `computeBottomAnchor` assertions) must be green — the math is unchanged, only centralized.

- [ ] **Step 9: Run the full TUI vitest suite**

Run: `pnpm test:vitest -- tests/tui`
Expected: PASS.

- [ ] **Step 10: Run the node-tests lane and diff the failure count**

Run: `pnpm build && pnpm test:node`
Expected: only the pre-existing `AgentView slash strip` / `renders ranked candidates with the selected marker` failure. Count failures before and after your change — must be identical (1).

- [ ] **Step 11: Run `detect_changes` and commit**

Run: `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })`
Expected: only `computeBottomAnchor`, `computeScrollbackRows` (if still referenced), `AgentView`, `ChatView`, `TuiApp` methods touched.

```bash
git add src/tui/views/scroll-math.ts src/tui/views/agent-view.ts src/tui/views/chat-view.ts src/tui/views/dashboard-view.ts src/tui/app.ts tests/tui/views/scroll-math.vitest.ts tests/tui/app-pinned-bottom.vitest.ts
git commit -m "refactor(tui): centralize layout geometry in computeViewport helper

Single source of truth for panelRow/scrollbackTop/scrollbackRows/textWidth.
computeBottomAnchor no longer takes textWidth/panelRow — computed internally.
No behavior change; existing TUI tests pass unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 7: Run the TUI view + app tests**

Run: `pnpm test:vitest -- tests/tui/views tests/tui/app-pinned-bottom.vitest.ts`
Expected: PASS. In particular `chat-view-bottom-anchored.vitest.ts` (the `panelRow(height)` helper and the slice-identity assertions) must be green — the math is unchanged, only centralized.

- [ ] **Step 8: Run the full TUI vitest suite**

Run: `pnpm test:vitest -- tests/tui`
Expected: PASS.

- [ ] **Step 9: Run the node-tests lane and diff the failure count**

Run: `pnpm build && pnpm test:node`
Expected: only the pre-existing `AgentView slash strip` / `renders ranked candidates with the selected marker` failure. Count failures before and after your change — must be identical (1).

- [ ] **Step 10: Run `detect_changes` and commit**

Run: `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })`
Expected: only `computeBottomAnchor`, `computeScrollbackRows` (if still referenced), `AgentView`, `ChatView`, `TuiApp` methods touched.

```bash
git add src/tui/views/scroll-math.ts src/tui/views/agent-view.ts src/tui/views/chat-view.ts src/tui/views/dashboard-view.ts src/tui/app.ts
git commit -m "refactor(tui): centralize layout geometry in computeViewport helper

Single source of truth for panelRow/scrollbackTop/scrollbackRows/textWidth.
computeBottomAnchor no longer takes textWidth/panelRow — computed internally.
No behavior change; existing TUI tests pass unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Split `TuiApp` into cohesive modules

**Files:**
- Create: `src/tui/timeline-emitter.ts`
- Create: `src/tui/slash-controller.ts`
- Create: `src/tui/palette-controller.ts`
- Create: `src/tui/frame-painter.ts`
- Create: `src/tui/approval-resolver.ts`
- Modify: `src/tui/app.ts` (remove extracted methods; keep orchestration)
- Test: `tests/tui/app-pinned-bottom.vitest.ts`, `tests/tui/views/*` (existing — must stay green)

**Interfaces:**

- `TimelineEmitter` (Task 2a):
  - Consumes: `TuiAppOptions`-shaped `{ eventLog?: EventLog; chatSessionId?: string; agentSessionId?: string }`, `appendLogEntry`
  - Produces:
    - `class TimelineEmitter { constructor(private readonly opts: { eventLog?: EventLog; chatSessionId?: string; agentSessionId?: string }) {}`
    - `emitCtx(sessionId?: string): CapabilityEmitContext | undefined`
    - `emitTimelineLog(kind: 'user' | 'agent', text: string, sessionId?: string): void`
    - `sessionIdForTab(tab: TabId): string | undefined`
    - `appendAgentMessage(tab: TabId, text: string): void`

- `SlashController` (Task 2b):
  - Consumes: `{ activeTab(): TabId, getAgentBuffer(): string, setAgentBuffer(s: string): void }`, `slashManifests` array
  - Produces:
    - `class SlashController { constructor(private readonly tabs: { activeTab(): TabId; getAgentBuffer(): string; setAgentBuffer(s: string): void }) {}`
    - `manifests: any[]`
    - `selection: number`
    - `hint: string | null`
    - `active(): boolean`
    - `buffer(): string | null`
    - `cycleSelection(delta: number): void`
    - `complete(): boolean`
    - `computeStrip(): SlashStrip | null`
    - `refreshCatalog(): Promise<void>`

- `PaletteController` (Task 2c):
  - Consumes: `{ capabilityService?: CapabilityService }`, `getCapabilityService` accessor
  - Produces:
    - `class PaletteController { constructor(private readonly opts: { capabilityService?: CapabilityService }) {}`
    - `open: boolean`
    - `query: string`
    - `handleKey(key: string): void`
    - `paint(canvas: TerminalCanvas, width: number, height: number, headerH: number, footerH: number): void`
    - `hasCapabilityService(): boolean`

- `FramePainter` (Task 2d):
  - Consumes: `TuiApp` (via a narrow `FramePainterDeps` object — see below), `computeViewport`, `computeSlashStrip`
  - Produces:
    - `class FramePainter { constructor(private readonly deps: FramePainterDeps) {}`
    - `paintFullFrame(): void`
    - `paintPlanApprovalCard(canvas: TerminalCanvas, width: number, height: number, headerH: number, footerH: number): void`
    - `buildViewRenderContext(tab: TabId): ViewRenderContext`

- `ApprovalResolver` (Task 2e):
  - Consumes: `{ views: () => TuiAppState['views'], activeTab: () => TabId, syncTabs: readonly TabId[], approvalManager?: ApprovalManager, emit: (tab: TabId, text: string) => void, refresh: () => Promise<void> }`
  - Produces: `class ApprovalResolver { constructor(private readonly deps: ApprovalResolverDeps) {} ; resolve(approvalId: string, status: 'approved' | 'denied'): Promise<void> }`

- [ ] **Step 1: Impact gate for `TuiApp` + its methods**

Run: `mcp__gitnexus__impact({ target: "TuiApp", direction: "upstream" })` and `mcp__gitnexus__impact({ target: "TuiApp.paintFullFrame", direction: "upstream" })` (or per-method for the ones you extract). Report blast radius; warn on HIGH/CRITICAL.

- [ ] **Step 2a: Extract `TimelineEmitter`**

Create `src/tui/timeline-emitter.ts`:

```ts
import type { TabId } from './state.js';
import type { EventLog } from '../events/event-log.js';
import type { CapabilityEmitContext } from './capabilities/invocation-presenter.js';
import { appendLogEntry } from './log-emit.js';

/** Per-tab session ids + EventLog the TUI was constructed with. */
export interface TimelineEmitterOpts {
  eventLog?: EventLog;
  chatSessionId?: string;
  agentSessionId?: string;
}

/** Single-emit timeline writes into the EventLog (Phase 6 D9).
 *  The EventLog is the single source of truth timeline; the per-tab
 *  in-memory cache was removed. Fire-and-forget appends — a log-write
 *  failure must not fail the input path. */
export class TimelineEmitter {
  constructor(private readonly opts: TimelineEmitterOpts) {}

  emitCtx(sessionId?: string): CapabilityEmitContext | undefined {
    if (!this.opts.eventLog || !sessionId) return undefined;
    return { eventLog: this.opts.eventLog, sessionId };
  }

  emitTimelineLog(kind: 'user' | 'agent', text: string, sessionId?: string): void {
    if (!this.opts.eventLog || !sessionId) return;
    const agentDomain = sessionId === this.opts.agentSessionId;
    const type = agentDomain
      ? (kind === 'user' ? 'agent.message' : 'agent.response')
      : (kind === 'user' ? 'chat.message' : 'chat.response');
    appendLogEntry(this.opts.eventLog, {
      sessionId,
      actor: kind === 'user' ? 'user' : 'agent',
      type,
      payload: { text },
    });
  }

  sessionIdForTab(tab: TabId): string | undefined {
    if (tab === 'chat') return this.opts.chatSessionId;
    if (tab === 'agent') return this.opts.agentSessionId;
    return undefined;
  }

  appendAgentMessage(tab: TabId, text: string): void {
    this.emitTimelineLog('agent', text, this.sessionIdForTab(tab));
  }
}
```

In `app.ts`: delete `emitCtx`, `emitTimelineLog`, `sessionIdForTab`, `appendAgentMessage` (lines 170-211, 1228-1233); add `private readonly timelineEmitter = new TimelineEmitter({ eventLog: this.opts.eventLog, chatSessionId: this.opts.chatSessionId, agentSessionId: this.opts.agentSessionId });` and replace call sites (`this.emitCtx(...)` → `this.timelineEmitter.emitCtx(...)`, `this.emitTimelineLog(...)` → `this.timelineEmitter.emitTimelineLog(...)`, `this.sessionIdForTab(...)` → `this.timelineEmitter.sessionIdForTab(...)`, `this.appendAgentMessage(...)` → `this.timelineEmitter.appendAgentMessage(...)`).

Check: `grep -n "this\.emitCtx\|this\.emitTimelineLog\|this\.sessionIdForTab\|this\.appendAgentMessage" src/tui/app.ts` → only the new field initializer remains.

- [ ] **Step 2b: Extract `SlashController`**

Create `src/tui/slash-controller.ts`:

```ts
import { parseSlashInput, rankSkillMatches, skillSlashNames } from '../skills/slash.js';
import { getSlashCatalog } from '../skills/slash-catalog.js';
import type { SlashStrip, SlashStripEntry } from './views/types.js';
import type { TabId } from './state.js';

/** Narrow accessors into the agent tab's per-tab state — the controller never
 *  sees the full TuiApp. */
export interface SlashTabAccess {
  activeTab(): TabId;
  getAgentBuffer(): string;
  setAgentBuffer(s: string): void;
}

/** Slash-command completion strip state + logic (agent tab only). */
export class SlashController {
  manifests: any[] = [];
  selection = 0;
  hint: string | null = null;

  constructor(private readonly tabs: SlashTabAccess) {}

  active(): boolean {
    if (this.tabs.activeTab() !== 'agent') return false;
    const buf = this.tabs.getAgentBuffer();
    return buf.startsWith('/') && buf.length >= 1;
  }

  buffer(): string | null {
    if (this.tabs.activeTab() !== 'agent') return null;
    const buf = this.tabs.getAgentBuffer();
    return buf.startsWith('/') && buf.length >= 1 ? buf : null;
  }

  cycleSelection(delta: number): void {
    const strip = this.computeStrip();
    if (!strip || strip.entries.length === 0) return;
    const n = strip.entries.length;
    this.selection = (this.selection + delta + n) % n;
  }

  complete(): boolean {
    const buf = this.buffer();
    if (!buf) return false;
    const parsed = parseSlashInput(buf);
    if (!parsed) return false;
    const matches = rankSkillMatches(this.manifests, parsed.command);
    if (matches.length === 0) return false;
    const idx = Math.min(this.selection, matches.length - 1);
    const selected = matches[idx]!;
    const primary = skillSlashNames(selected)[0] ?? `/${selected.name}`;
    const rest = parsed.rest ? ` ${parsed.rest}` : ' ';
    this.tabs.setAgentBuffer(`${primary}${rest}`);
    this.selection = 0;
    return true;
  }

  computeStrip(): SlashStrip | null {
    const buf = this.buffer();
    if (!buf) { this.selection = 0; this.hint = null; return null; }
    const parsed = parseSlashInput(buf);
    if (!parsed) { this.hint = null; return null; }
    const matches = rankSkillMatches(this.manifests, parsed.command);
    this.selection = Math.min(this.selection, Math.max(0, matches.length - 1));
    if (matches.length > 0) {
      if (parsed.command !== '/') this.hint = null;
    } else if (this.manifests.length === 0) {
      this.hint = 'no skills installed';
    } else {
      this.hint = `no skill matches ${parsed.command}`;
    }
    return {
      entries: matches.slice(0, 8).map((m): SlashStripEntry => ({
        name: m.name,
        label: skillSlashNames(m)[0] ?? `/${m.name}`,
        description: m.description,
      })),
      selected: this.selection,
      hint: this.hint,
    };
  }

  async refreshCatalog(): Promise<void> {
    this.manifests = await getSlashCatalog();
  }
}
```

In `app.ts`: delete `slashActive`, `slashBuffer`, `cycleSlashSelection`, `completeSlash`, `computeSlashStrip`, `refreshSlashCatalog` (lines 312-321, 417-504) and the fields `slashManifests`, `slashSelection`, `slashHint` (lines 127-132). Add:

```ts
  private readonly slash = new SlashController({
    activeTab: () => this.state.activeTab,
    getAgentBuffer: () => this.state.views.agent.inputBuffer,
    setAgentBuffer: (s: string) => { this.state.views.agent.inputBuffer = s; },
  });
```

Replace call sites:
- `this.slashManifests` → `this.slash.manifests`
- `this.slashSelection` → `this.slash.selection`
- `this.slashHint` → `this.slash.hint`
- `this.slashActive()` → `this.slash.active()`
- `this.slashBuffer()` → `this.slash.buffer()`
- `this.cycleSlashSelection(d)` → `this.slash.cycleSelection(d)`
- `this.completeSlash()` → `this.slash.complete()`
- `this.computeSlashStrip()` → `this.slash.computeStrip()`
- `this.refreshSlashCatalog()` → `this.slash.refreshCatalog()`

Keep the test seams (`slashManifestsForTest`, `slashHintForTest`, `slashSelectionForTest` at lines 283-287) working by delegating to `this.slash`:
```ts
  get slashManifestsForTest(): any[] { return this.slash.manifests; }
  set slashManifestsForTest(v: any[]) { this.slash.manifests = v; }
  get slashHintForTest(): string | null { return this.slash.hint; }
  get slashSelectionForTest(): number { return this.slash.selection; }
```

- [ ] **Step 2c: Extract `PaletteController`**

Create `src/tui/palette-controller.ts`:

```ts
import { PaletteModal } from './capabilities/palette.js';
import { getCapabilityService } from './capabilities/capability-service.js';
import type { CapabilityService } from './capabilities/capability-service.js';
import type { TerminalCanvas } from './canvas.js';

export interface PaletteControllerOpts {
  capabilityService?: CapabilityService;
}

/** Command-palette modal — key routing while open + overlay paint. */
export class PaletteController {
  readonly modal = new PaletteModal();
  open = false;
  query = '';

  constructor(private readonly opts: PaletteControllerOpts) {}

  hasCapabilityService(): boolean {
    try { getCapabilityService(); return true; } catch { return false; }
  }

  /** Route a key while the palette is open. */
  handleKey(key: string): void {
    if (key === 'Escape') { this.open = false; return; }
    if (key === 'Ctrl+p') { this.open = false; return; }
    if (key === '\x03') { process.exit(0); return; }
    if (key === 'Enter') {
      if (!this.modal.empty) {
        const entry = this.modal.selected();
        this.open = false;
        entry.invoke();
      }
      return;
    }
    if (key === 'ArrowUp') { this.modal.move(-1); return; }
    if (key === 'ArrowDown') { this.modal.move(1); return; }
    if (key === 'Backspace') { this.query = this.query.slice(0, -1); }
    else if (key && key.length === 1) { this.query += key; }
    this.modal.refresh(this.query);
  }

  /** Render the palette as an overlay in the active view's canvas. No-op when closed. */
  paint(canvas: TerminalCanvas, width: number, height: number, headerH: number, footerH: number): void {
    if (!this.open) return;
    const PALETTE_H = 12;
    const y = Math.max(headerH + 1, Math.floor(height / 2) - Math.floor(PALETTE_H / 2));
    const innerW = Math.max(0, width - 4);
    canvas.drawBox(1, y, innerW, PALETTE_H, ' Command Palette (Ctrl+P) ', '\x1b[90m');
    canvas.write(3, y + 1, `\x1b[7m ${this.query} \x1b[0m`);
    const list = this.modal.list;
    const rows = Math.max(0, PALETTE_H - 3);
    const start = Math.max(0, Math.min(this.modal.selectedIndex(), list.length - rows));
    for (let i = 0; i < Math.min(list.length, rows); i++) {
      const entry = list[start + i]!;
      const sel = start + i === this.modal.selectedIndex();
      const line = `${sel ? '› ' : '  '}${entry.title}${entry.subtitle ? `  \x1b[90m${entry.subtitle}\x1b[0m` : ''}`;
      canvas.write(3, y + 2 + i, (sel ? '\x1b[36m' : '') + line.slice(0, innerW - 4) + (sel ? '\x1b[0m' : ''));
    }
    if (list.length === 0) canvas.write(3, y + 2, '\x1b[90mNo capabilities found\x1b[0m');
  }
}
```

In `app.ts`: delete `hasCapabilityService`, `handlePaletteKey`, `paintPalette` (lines 1393-1452) and the fields `palette`, `paletteOpen`, `paletteQuery` (lines 124-126). Add `private readonly paletteController = new PaletteController({ capabilityService: this.opts.capabilityService });`. Replace call sites: `this.paletteOpen` → `this.paletteController.open`, `this.paletteQuery` → `this.paletteController.query`, `this.palette.` → `this.paletteController.modal.`, `this.handlePaletteKey(k)` → `this.paletteController.handleKey(k)`, `this.paintPalette(...)` → `this.paletteController.paint(...)`, `this.hasCapabilityService()` → `this.paletteController.hasCapabilityService()`.

Note: line 906 (`this.paletteQuery = '';` inside the Ctrl+P open trigger) becomes `this.paletteController.query = '';` and `this.paletteOpen = true` → `this.paletteController.open = true`.

- [ ] **Step 2d: Extract `FramePainter`**

This is the largest extract. Create `src/tui/frame-painter.ts`. `TAB_ORDER`, `SessionPhase`, and `TuiPlanApprovalGate` are module-level in `app.ts` — copy `TAB_ORDER` and import `SessionPhase`/`TuiPlanApprovalGate` locally in `frame-painter.ts` so it never imports from `app.ts`. Define the deps interface in `frame-painter.ts`:

```ts
import { TerminalCanvas } from './canvas.js';
import { computeViewport } from './views/scroll-math.js';
import type { TabId, TuiAppState } from './state.js';
import type { ViewRenderContext, SlashStrip } from './views/types.js';
import type { RuntimeSnapshot } from './snapshot.js';
import type { IOutput } from './io.js';
import type { AgentSession } from '../agent/session.js';
import type { DashboardSnapshot } from './snapshot.js';
import type { TerminalDimensions } from './views/types.js';
import { SessionPhase } from './state.js';
import { TuiPlanApprovalGate } from './plan-approval-gate.js';

/** Everything FramePainter reads from TuiApp — a narrow seam so it never
 *  reaches into the god class. */
export interface FramePainterDeps {
  state: () => TuiAppState;
  views: () => Record<TabId, import('./views/types.js').TuiView>;
  opts: {
    themeName?: string;
    agentSession?: AgentSession;
  };
  chatRuntime: () => RuntimeSnapshot | null;
  agentRuntime: () => RuntimeSnapshot | null;
  computeSlashStrip: () => SlashStrip | null;
  planApprovalGate: TuiPlanApprovalGate;
  output: IOutput;
  palette: import('./palette-controller.js').PaletteController;
}
```

**Extraction mechanics for `paintFullFrame`:** it calls `this.paintPlanApprovalCard`, `this.paintPalette`, and `this.computeSlashStrip()`, and does the tab-row/status-row writes using `TAB_ORDER` + `SessionPhase` + `snap.daemon`. So the whole `paintFullFrame` body (app.ts lines 1454-1610) moves VERBATIM into `FramePainter.paintFullFrame()`, rewritten only to read through the deps. Cursor placement (lines 1589-1609) stays INSIDE `paintFullFrame` verbatim — it reads `s.views.chat.inputBuffer` and `deps.output`, both available. Concretely:

```ts
export class FramePainter {
  constructor(private readonly deps: FramePainterDeps) {}

  buildViewRenderContext(tab: TabId): ViewRenderContext { /* verbatim app.ts 1052-1060, via deps */ }

  paintPlanApprovalCard(canvas: TerminalCanvas, width: number, height: number, headerH: number, footerH: number): void { /* verbatim app.ts 1348-1390, via deps.planApprovalGate */ }

  paintFullFrame(): void {
    const s = this.deps.state();
    if (!s.lastSnapshot) return;
    const dims: TerminalDimensions = { columns: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 };
    const HEADER_H_ = 3, FOOTER_H_ = 3;
    // ... VERBATIM body of app.ts paintFullFrame (1454-1610) with ONLY these substitutions:
    //   this.state.lastSnapshot        -> s.lastSnapshot
    //   this.state.activeTab           -> s.activeTab
    //   this.state.views[...]          -> s.views[...]
    //   this.views[tab].render(...)    -> this.deps.views()[tab].render(...)
    //   this.chatRuntime               -> this.deps.chatRuntime()
    //   this.agentRuntime              -> this.deps.agentRuntime()
    //   this.computeSlashStrip()       -> this.deps.computeSlashStrip()
    //   this.planApprovalGate          -> this.deps.planApprovalGate
    //   this.paintPlanApprovalCard(..) -> this.paintPlanApprovalCard(..)   (same class method)
    //   this.paintPalette(...)         -> this.deps.palette.paint(...)
    //   this.output.write(...)         -> this.deps.output.write(...)
    //   TAB_ORDER                      -> module-level const copied into frame-painter.ts
    //   SessionPhase                   -> import { SessionPhase } from './state.js'  (frame-painter.ts)
    //   this.opts.themeName            -> this.deps.opts.themeName
    //   this.opts.agentSession         -> this.deps.opts.agentSession
    //   FOOTER_H / HEADER_H            -> keep local const 3 (or import from scroll-math.js)
    // cursor placement (1589-1609)     -> stays verbatim inside this method (reads s.views.* + this.deps.output)
  }
}
```

`TAB_ORDER` is module-level in app.ts — copy it into frame-painter.ts (frame-painter must NOT import from app.ts). `SessionPhase` is imported from `./state.js` in app.ts already — import it the same way in frame-painter.ts. No `onRepaintCursor` callback is needed; cursor placement is not split out.

After extraction, `app.ts`:
- deletes `paintFullFrame`, `paintPlanApprovalCard`, `buildViewRenderContext` (lines 1052-1060, 1348-1390, 1454-1610)
- keeps `this.buildViewRenderContext(tab)` callers (`resetScrollOffsetToBottom`, `dispatch`) delegating to `this.framePainter.buildViewRenderContext(tab)`:
  ```ts
  private buildViewRenderContext(tab: TabId): ViewRenderContext {
    return this.framePainter.buildViewRenderContext(tab);
  }
  ```
- `paintFullFrame()` (called ~15× across app.ts) becomes a thin delegate:
  ```ts
  private paintFullFrame(): void {
    this.framePainter.paintFullFrame();
  }
  ```
  OR replace all `this.paintFullFrame()` call sites with `this.framePainter.paintFullFrame()`. Prefer the thin delegate to keep the diff small — the private method stays, delegating to the painter.

- [ ] **Step 2e: Extract `ApprovalResolver`**

Create `src/tui/approval-resolver.ts`:

```ts
import type { TabId, TuiAppState } from './state.js';
import type { ApprovalManager } from './approval-manager.js';

export interface ApprovalResolverDeps {
  views: () => TuiAppState['views'];
  activeTab: () => TabId;
  syncTabs: readonly TabId[];
  approvalManager?: ApprovalManager;
  emit: (tab: TabId, text: string) => void;
  refresh: () => Promise<void>;
}

/** Resolve an approval (approve/deny) by delegating to the wired
 *  ApprovalManager — routes through the ApprovalStore + EventLog. */
export class ApprovalResolver {
  constructor(private readonly deps: ApprovalResolverDeps) {}

  async resolve(approvalId: string, status: 'approved' | 'denied'): Promise<void> {
    if (!approvalId) return;
    let originalTool = 'unknown';
    let originalTarget = '';
    let requestedAt = Date.now();
    for (const t of this.deps.syncTabs) {
      const found = this.deps.views()[t]?.pendingApprovals?.find((a) => a.id === approvalId);
      if (found) {
        originalTool = found.toolName;
        originalTarget = found.target;
        requestedAt = found.requestedAt;
        break;
      }
    }
    const mgr = this.deps.approvalManager;
    if (!mgr) {
      this.deps.emit(this.deps.activeTab(), `[approval] no ApprovalManager wired for ${status} ${approvalId}`);
      await this.deps.refresh();
      return;
    }
    try {
      const result = await mgr.tryHandleCommand(status === 'approved' ? `/approve ${approvalId}` : `/deny ${approvalId}`);
      const summary = result.handled ? result.message : `${status} ${approvalId} (no handler)`;
      this.deps.emit(this.deps.activeTab(), `[approval:${status}] ${summary}`);
      for (const t of this.deps.syncTabs) {
        const tab = this.deps.views()[t];
        if (!tab) continue;
        tab.resolvedApprovals.unshift({ id: approvalId, toolName: originalTool, target: originalTarget, status, requestedAt, resolvedAt: Date.now() });
        if (tab.resolvedApprovals.length > 200) tab.resolvedApprovals.length = 200;
      }
    } catch (err) {
      this.deps.emit(this.deps.activeTab(), `[approval:${status}] error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await this.deps.refresh();
    }
  }
}
```

In `app.ts`: delete `resolveApprovalFromView` (lines 1160-1222); add `private readonly approvalResolver = new ApprovalResolver({ views: () => this.state.views, activeTab: () => this.state.activeTab, syncTabs: this.SYNC_TABS, approvalManager: this.opts.approvalManager, emit: (tab, text) => this.timelineEmitter.appendAgentMessage(tab, text), refresh: () => this.refresh() });` and replace the call site (`this.resolveApprovalFromView(id, status)` → `void this.approvalResolver.resolve(id, status)`).

- [ ] **Step 3: Typecheck after each sub-extract**

Run: `pnpm typecheck`
Expected: PASS after each of 2a-2e (run it between extracts so a failure pinpoints the broken extract).

- [ ] **Step 4: Run TUI vitest after each sub-extract**

Run: `pnpm test:vitest -- tests/tui`
Expected: PASS after each extract. If a test fails, the extract broke behavior — fix before moving on.

- [ ] **Step 5: Full vitest + node-tests**

Run: `pnpm test:vitest` (full) and `pnpm build && pnpm test:node`
Expected: full vitest PASS; node-tests still exactly 1 pre-existing failure (AgentView slash strip).

- [ ] **Step 6: `detect_changes` + commit**

Run: `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })`
Expected: only the new module symbols + the app.ts removals; no `handleRaw`/paste/routing behavior change.

```bash
git add src/tui/timeline-emitter.ts src/tui/slash-controller.ts src/tui/palette-controller.ts src/tui/frame-painter.ts src/tui/approval-resolver.ts src/tui/app.ts
git commit -m "refactor(tui): split app.ts god-class into cohesive modules

Extract TimelineEmitter, SlashController, PaletteController, FramePainter,
and ApprovalResolver behind narrow context objects. TuiApp keeps input
routing, dispatch, tab switching, submit paths, snapshot sync, lifecycle.
Behavior-preserving — existing TUI tests pass unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: End-to-end slice-lock test (new content while unpinned)

**Files:**
- Modify: `tests/tui/app-pinned-bottom.vitest.ts` (add `makeApp` runtime-collector wiring + new test)
- Test: `tests/tui/app-pinned-bottom.vitest.ts` (the new test itself)

**Interfaces:**
- Consumes: `RuntimeCollectorImpl`, `EventLog`, `FileProjectionCheckpointStore`, `TimelineBuilder`, `createProjectionRuntime`, `IncrementalExecutionTraceBuilder` (all already used by `tests/tui/runtime/projection-state-restart.vitest.ts`); `vi.spyOn(viewportModule, 'renderBottomAnchoredSlice')` pattern from `tests/tui/views/chat-view-bottom-anchored.vitest.ts:149-199`.
- Produces: a new `it(...)` block and an extended `makeApp` returning `{ app, internal, log, agentCollector, chatCollector }`.

**Why this is the "end-to-end" version the handoff asked for:** the existing no-drift test (`app-pinned-bottom.vitest.ts:128-164`) mutates `internal.agentRuntime` directly and asserts only `scrollOffset` unchanged, with no re-render. This test wires the real EventLog → `RuntimeCollectorImpl` → `TuiAppOptions.runtimeCollectors` → `paintFullFrame` chain, appends to the log, forces the collector's private `sample()`, triggers a refresh+paint, and asserts the rendered slice is identical.

- [ ] **Step 1: Impact gate (test-only change — still run per project rule)**

Run: `mcp__gitnexus__impact({ target: "TuiApp.paintFullFrame", direction: "upstream" })` (the test drives it). Expected: no HIGH/CRITICAL.

- [ ] **Step 2: Add a `makeAppWithCollectors` helper (leave `makeApp` untouched)**

Modify `tests/tui/app-pinned-bottom.vitest.ts`. Add imports:

```ts
import { RuntimeCollectorImpl } from '../../src/tui/runtime-collector.js';
import { FileProjectionCheckpointStore } from '../../src/tui/runtime/projection-checkpoint-store.js';
import { TimelineBuilder } from '../../src/tui/runtime/timeline-builder.js';
import { IncrementalExecutionTraceBuilder } from '../../src/tui/runtime/execution-trace-builder.js';
import { createProjectionRuntime } from '../../src/tui/runtime/projection-runtime.js';
import * as viewportModule from '../../src/tui/views/bottom-anchored-viewport.js';
```

Do NOT modify the existing `makeApp` (lines 10-30) — the existing tests don't need collectors, and adding them there would leak the collectors' `setInterval` pollers (`app.stop()` doesn't stop `runtimeCollectors`). Add a separate helper after `makeApp`:

```ts
/** Wire real EventLog -> RuntimeCollector per sub-session, so `internal.refresh()`
 *  samples real projected timelines (the end-to-end path the slice-lock test needs).
 *  Callers MUST stop the collectors (their start() sets up a setInterval poller). */
async function makeAppWithCollectors() {
  const dir = mkdtempSync(join(tmpdir(), 'alix-slice-'));
  const log = new EventLog(join(dir, 'events'));
  await log.init();
  const mkCollector = (sessionId: string) => new RuntimeCollectorImpl({
    eventLog: log,
    checkpointStore: new FileProjectionCheckpointStore(join(dir, 'projections', sessionId)),
    sessionId,
    projectionRuntime: createProjectionRuntime([
      ['timeline', new TimelineBuilder(sessionId)],
      ['trace', new IncrementalExecutionTraceBuilder()],
    ]),
  });
  const agentCollector = mkCollector('sess-agent');
  const chatCollector = mkCollector('sess-chat');
  await agentCollector.start();
  await chatCollector.start();

  const snap = {
    generatedAt: 1,
    session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 },
    daemon: null, approvals: null, runtime: null, sops: null, policy: null,
  };
  const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
  const metrics = { start: () => {}, stop: async () => {} };
  const app = new TuiApp({
    builder, daemonMetrics: metrics,
    eventLog: log, chatSessionId: 'sess-chat', agentSessionId: 'sess-agent',
    runtimeCollectors: { chat: chatCollector, agent: agentCollector },
  } as unknown as TuiAppOptions);
  const internal = app as unknown as {
    handleRaw(buf: Buffer): void;
    getStateForTest(): { lastSnapshot: any; activeTab?: string; views: { [k: string]: any } };
    refresh(): Promise<void>;
    setActiveTabForTest(tab: string): void;
  };
  internal.getStateForTest().lastSnapshot = snap;
  return { app, internal, log, agentCollector, chatCollector };
}
```

`internal.refresh()` is private on `TuiApp` — accessible here via the cast (same pattern as the existing `handleRaw` cast). `sample()` is private on `RuntimeCollectorImpl` — forced via cast in the test body (pattern from `tests/tui/runtime/projection-state-restart.vitest.ts:28-29`).

- [ ] **Step 3: Write the failing slice-lock test**

Add this test inside the `describe` block (after the existing no-drift test at line 164):

```ts
  it('new content while unpinned keeps the rendered slice identical (end-to-end slice lock)', async () => {
    const { app, internal, log, agentCollector, chatCollector } = await makeAppWithCollectors();
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      // Seed the agent sub-session log with enough lines that bottomAnchor > 0.
      for (let i = 0; i < 60; i++) {
        await log.append({ sessionId: 'sess-agent', actor: 'user', type: 'agent.message', payload: { text: `seeded ${i}` } });
      }
      // Force the collector's private sample() to pick up the appended events.
      const sample = (agentCollector as unknown as { sample(): Promise<void> }).sample;
      await sample.call(agentCollector);
      await internal.refresh();

      internal.setActiveTabForTest('agent');
      internal.handleRaw(ARROW_UP); // unpin
      const per = internal.getStateForTest().views.agent;
      expect(per.pinnedBottom).toBe(false);
      const offsetBefore = per.scrollOffset;

      // Capture the slice passed to renderBottomAnchoredSlice during the paint.
      spy = vi.spyOn(viewportModule, 'renderBottomAnchoredSlice');
      await internal.refresh(); // repaint now
      const optsBefore = spy.mock.calls.at(-1)?.[0]!;
      const allLinesBefore = optsBefore.allLines as readonly unknown[];
      const offsetArgBefore = optsBefore.offset as number;
      spy.mockClear();

      // Append new content via the log, force sample + refresh (repaint).
      for (let i = 60; i < 65; i++) {
        await log.append({ sessionId: 'sess-agent', actor: 'agent', type: 'agent.response', payload: { text: `new ${i}` } });
      }
      await sample.call(agentCollector);
      await internal.refresh();
      const optsAfter = spy.mock.calls.at(-1)?.[0]!;
      const allLinesAfter = optsAfter.allLines as readonly unknown[];
      const offsetArgAfter = optsAfter.offset as number;

      // The parked window must not move: same offset, and the rendered slice
      // is identical for the shared index range.
      expect(per.scrollOffset).toBe(offsetBefore);
      expect(per.pinnedBottom).toBe(false);
      expect(offsetArgAfter).toBe(offsetArgBefore);
      expect(allLinesAfter.length).toBeGreaterThan(allLinesBefore.length);
      for (let i = 0; i < Math.min(allLinesBefore.length - offsetArgBefore, 30); i++) {
        expect(allLinesAfter[offsetArgAfter + i]).toEqual(allLinesBefore[offsetArgBefore + i]);
      }
    } finally {
      spy?.mockRestore();
      await agentCollector.stop();
      await chatCollector.stop();
      await app.stop().catch(() => {});
    }
  });
```

Note: this test asserts slice identity through the real EventLog→collector→paint path — strictly stronger than the existing `scrollOffset`-only no-drift test. It coexists with (does not replace) the existing test.

- [ ] **Step 4: Run the test — expect it to PASS**

Run: `pnpm test:vitest -- tests/tui/app-pinned-bottom.vitest.ts`
Expected: PASS (all tests in the file, including the new one).

> If the new test fails, that's a REAL bug: the pinnedBottom=false slice IS drifting on new content. Investigate `dispatch`'s scroll case + `resetScrollOffsetToBottom` before "fixing" the test.

- [ ] **Step 5: Full vitest + node-tests**

Run: `pnpm test:vitest` and `pnpm build && pnpm test:node`
Expected: full vitest PASS; node-tests still 1 pre-existing failure.

- [ ] **Step 6: `detect_changes` + commit**

Run: `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })`
Expected: only the test file changed.

```bash
git add tests/tui/app-pinned-bottom.vitest.ts
git commit -m "test(tui): end-to-end slice-lock when new content arrives unpinned

Wires real EventLog -> RuntimeCollector -> TuiApp and asserts the rendered
scrollback slice is identical after new log entries arrive while the view
is unpinned — stronger than the existing scrollOffset-only no-drift test.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Verification (full pass before opening the PR)

Run in order:
1. `pnpm typecheck` — clean.
2. `pnpm test:vitest` — full suite green.
3. `pnpm build && pnpm test:node` — confirm exactly **1** pre-existing failure (`AgentView slash strip`), no new failures.
4. `mcp__gitnexus__detect_changes({ scope: "compare", base_ref: "main" })` — only the expected symbols/flows.
5. `graphify update .`
6. `gh pr create` against `main` per `finishing-a-development-branch` (Option: push + PR), then request a two-axis code review (Standards + Spec) as done for prior PRs.

## Rollback

The three commits are independent and individually revertable:
- `git revert <commit1>` restores the inline geometry.
- `git revert <commit2>` restores the god-class methods.
- `git revert <commit3>` removes the added test.
No shared state between tasks; reverting any one is safe.
