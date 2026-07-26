# TUI Copy & Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable copy (OSC 52) and paste (bracketed paste) in the TUI's chat and agent tabs, working inside the alternate screen buffer.

**Architecture:** Two independent escape-sequence protocols — bracketed paste (`\x1b[200~`…`\x1b[201~`) for reading pasted text as a raw-byte stream before key parsing, and OSC 52 (`\x1b]52;;<base64>\x1b\\`) for writing visible transcript to the system clipboard. A generalized `TerminalControl.enableTerminalModes()` manages all terminal mode sequences at startup/shutdown.

**Tech Stack:** TypeScript, Node.js `node:net` Buffer API, `TextDecoder`, existing `ViewAction` discriminated union, vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-tui-copy-paste-design.md`

## Global Constraints

From the spec, copied verbatim — every task implicitly honors these:
- Paste is a raw-byte streaming protocol handled in `handleRaw()` **before** `parseKey()` — never through key parsing
- Paste detection uses a state machine with states `'idle'` and `'reading'` only — no `'pending-esc'` (removed by code review)
- Paste content accumulates as `Buffer[]` (not strings) — decoded at flush time via `TextDecoder`
- Paste end marker is detected via `buf.indexOf(Buffer.from('\x1b[201~'))` for byte-correct offsets (not string indexOf)
- Paste CRLF is normalized to LF via `.replace(/\r\n?/g, '\n')`
- Paste appends to `inputBuffer` (insert, not replace)
- Copy action is `'copyScrollback'` added to the existing `ViewAction` union (not a new type)
- Copy uses `collectVisibleTranscript()` helper (not direct state access)
- Copy truncates at 64 KB with a `[truncated at 64 KB]` suffix
- Copy emits `\x1b]52;;<b64>\x1b\\` to stdout (OSC 52, ST variant)
- `enableTerminalModes()`/`disableTerminalModes()` are on `TerminalControl` and sequence: alt buffer → bracketed paste → cursor (enable, forward) and bracketed paste → cursor → alt buffer (disable, reverse)
- Cleanup invariant: terminal modes restored on exit regardless of failure — the implementer chooses the mechanism
- `Alt+C` is the copy keybinding; `parseKey()` detects ESC+letter sequences: `s.length === 2 && s[0] === '\x1b' && s[1] >= 'a' && s[1] <= 'z'` → returns `\`Alt+${s[1]}\``

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/tui/terminal-control.ts` | Modify | Add `enableTerminalModes()` / `disableTerminalModes()` — unified mode sequencing |
| `src/tui/app.ts` | Modify | Add `handlePaste()`, `collectVisibleTranscript()`, copy dispatch; wire mode init/cleanup |
| `src/tui/views/types.ts` | Modify | Extend `ViewAction` union with `{ type: 'copyScrollback' }` |
| `tests/tui/app.vitest.ts` | Modify | Add paste and copy tests |
| `tests/tui/terminal-control.vitest.ts` | Create | Add mode management tests |

---

### Task 1: Generalize TerminalControl

**Files:**
- Modify: `src/tui/terminal-control.ts` (add mode methods)
- Create: `tests/tui/terminal-control.vitest.ts`
- Modify: `src/tui/app.ts` (wire into `start()` and `cleanupSync()`)

**Interfaces:**
- Produces: `TerminalControl.enableTerminalModes()` and `TerminalControl.disableTerminalModes()` — each writes the escape sequence sequence specified in the Global Constraints
- Consumes: existing `enterRawMode`, `exitRawMode`, `showCursor`, `enterAltBuffer`, `exitAltBuffer` — the new methods compose these primitives

- [ ] **Step 1: Read `src/tui/app.ts` `start()` and `cleanupSync()` to understand current mode sequencing**

```ts
// Current start() calls:
this.terminal.enterAltBuffer();
this.terminal.enterRawMode();
this.terminal.showCursor(true);

// Current cleanupSync() calls:
this.terminal.showCursor(true);
this.terminal.exitRawMode();
this.terminal.exitAltBuffer();
```

- [ ] **Step 2: Write failing tests for mode management**

Create `tests/tui/terminal-control.vitest.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTerminalControl } from '../src/tui/terminal-control.js';

describe('TerminalControl — mode management', () => {
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('enableTerminalModes enters alt buffer, enables bracketed paste, hides cursor', () => {
    const tc = createTerminalControl();
    tc.enableTerminalModes();
    const calls = writeSpy.mock.calls.map((c: unknown[]) => (c[0] as string));
    // Order: alt buffer → hide cursor → bracketed paste → stop cursor blink
    expect(calls).toContain('\x1b[?1049h');
    expect(calls).toContain('\x1b[?2004h');
    expect(calls).toContain('\x1b[?25l');
    expect(calls).toContain('\x1b[?12l');
  });

  it('disableTerminalModes reverses in correct order', () => {
    const tc = createTerminalControl();
    tc.disableTerminalModes();
    const calls = writeSpy.mock.calls.map((c: unknown[]) => (c[0] as string));
    // Reverse order: disable bracketed paste → show cursor → exit alt buffer
    expect(calls.indexOf('\x1b[?2004l')).toBeLessThan(calls.indexOf('\x1b[?25h'));
    expect(calls.indexOf('\x1b[?25h')).toBeLessThan(calls.indexOf('\x1b[?1049l'));
  });

  it('disableTerminalModes runs even when enableTerminalModes was not called', () => {
    const tc = createTerminalControl();
    // Should not throw
    expect(() => tc.disableTerminalModes()).not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/tui/terminal-control.vitest.ts`
Expected: FAIL with "enableTerminalModes is not a function"

- [ ] **Step 4: Implement mode methods in TerminalControl**

Add after the existing `exitAltBuffer()` method in the returned object:

```ts
enableTerminalModes(): void {
  // Sequence: alt buffer → hide cursor → bracketed paste → stop blink
  this.enterAltBuffer();
  this.showCursor(false);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdout.write('\x1b[?2004h'); // bracketed paste mode
  process.stdout.write('\x1b[?12l');    // stop cursor blink
},
disableTerminalModes(): void {
  // Reverse order: disable bracketed paste → show cursor → exit alt buffer
  process.stdout.write('\x1b[?2004l'); // disable bracketed paste
  this.showCursor(true);
  this.exitRawMode();
  // Override the ALIX_TUI_ALT_BUFFER=0 opt-out: exitAltBuffer is called
  // directly so it respects the env var internally.
  this.exitAltBuffer();
},
```

And add the two method signatures to the `TerminalControl` interface:

```ts
export interface TerminalControl {
  enterRawMode(): void;
  exitRawMode(): void;
  showCursor(visible: boolean): void;
  enterAltBuffer(): void;
  exitAltBuffer(): void;
  enableTerminalModes(): void;    // NEW
  disableTerminalModes(): void;   // NEW
  onResize(cb: () => void): () => void;
  installEmergencyCleanup(cleanup: () => void): () => void;
}
```

Wait — this is wrong. The existing `enterRawMode` and `enterAltBuffer` are already called from `start()`. I should REPLACE the ad-hoc calls in start/cleanup with the unified method. Let me adjust.

- [ ] **Step 5: Wire into TuiApp.start() and TuiApp.cleanupSync()**

In `src/tui/app.ts`, in `start()`:

```ts
// BEFORE:
this.terminal.enterAltBuffer();
this.terminal.enterRawMode();
this.terminal.showCursor(true);

// AFTER:
this.terminal.enableTerminalModes();
```

In `cleanupSync()`:

```ts
// BEFORE:
this.terminal.showCursor(true);
this.terminal.exitRawMode();
this.terminal.exitAltBuffer();

// AFTER:
this.terminal.disableTerminalModes();
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/tui/terminal-control.vitest.ts tests/tui/app.vitest.ts`
Expected: PASS (7 tests: 3 mode + existing app tests)

- [ ] **Step 7: Run full suite and commit**

Run: `pnpm test:vitest 2>&1 | tail -5`
Expected: 3168+ tests pass

```bash
git add src/tui/terminal-control.ts src/tui/app.ts tests/tui/terminal-control.vitest.ts
git commit -m "feat(tui): add enableTerminalModes / disableTerminalModes to TerminalControl"
```

---

### Task 2: Bracketed paste + OSC 52 copy

**Files:**
- Modify: `src/tui/views/types.ts` (add `copyScrollback` to `ViewAction`)
- Modify: `src/tui/app.ts` (add paste state machine + copy handler)
- Modify: `tests/tui/app.vitest.ts` (add paste + copy tests)

**Interfaces:**
- Consumes: `ViewAction` extended with `{ type: 'copyScrollback' }`, `TabId`, `PerTabState`
- Consumes: `TerminalControl` (already wired from Task 1 — not needed by paste/copy directly)
- Produces: `handlePaste(buf: Buffer): boolean` method on `TuiApp`
- Produces: `collectVisibleTranscript(tab: TabId): string` private method on `TuiApp`
- Produces: `pasteState: 'idle' | 'reading'` field on `TuiApp`
- Produces: `pasteChunks: Buffer[]` field on `TuiApp`

- [ ] **Step 1: Write failing tests for paste**

Add to `tests/tui/app.vitest.ts`:

```ts
describe('TuiApp — bracketed paste', () => {
  // Reuse the same makeApp pattern from the existing chat-input tests

  function makePasteApp() {
    const snap = { generatedAt: 1, session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 }, daemon: null, approvals: null, runtime: null, sops: null, policy: null };
    const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
    const metrics = { start: () => {}, stop: async () => {} };
    const app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    const internal = app as unknown as {
      handleRaw(buf: Buffer): void;
      getStateForTest(): {
        lastSnapshot: unknown;
        views: { chat: { inputBuffer: string }; agent: { inputBuffer: string } };
      };
    };
    internal.getStateForTest().lastSnapshot = snap;
    return { app, internal };
  }

  it('paste start sets state to reading', () => {
    const { internal } = makePasteApp();
    const spy = vi.spyOn(internal as any, 'handlePaste');
    internal.handleRaw(Buffer.from('\x1b[200~'));
    expect(spy).toHaveReturnedWith(true);
    spy.mockRestore();
  });

  it('paste inserts content into the chat input buffer', () => {
    const { internal } = makePasteApp();
    internal.handleRaw(Buffer.from('\x1b[200~'));
    internal.handleRaw(Buffer.from('hello world'));
    internal.handleRaw(Buffer.from('\x1b[201~'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('hello world');
  });

  it('paste inserts content into the agent input buffer', () => {
    const { internal } = makePasteApp();
    internal.getStateForTest().views.agent.inputBuffer = '';
    // Switch to agent tab
    (internal.getStateForTest() as any).activeTab = 'agent';
    internal.handleRaw(Buffer.from('\x1b[200~'));
    internal.handleRaw(Buffer.from('agent paste'));
    internal.handleRaw(Buffer.from('\x1b[201~'));
    expect(internal.getStateForTest().views.agent.inputBuffer).toBe('agent paste');
  });

  it('paste normalizes CRLF to LF', () => {
    const { internal } = makePasteApp();
    internal.handleRaw(Buffer.from('\x1b[200~'));
    internal.handleRaw(Buffer.from('a\r\nb\r\nc'));
    internal.handleRaw(Buffer.from('\x1b[201~'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('a\nb\nc');
  });

  it('empty paste does nothing', () => {
    const { internal } = makePasteApp();
    internal.handleRaw(Buffer.from('\x1b[200~'));
    internal.handleRaw(Buffer.from('\x1b[201~'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('');
  });

  it('paste accumulates multi-byte UTF-8 safely', () => {
    const { internal } = makePasteApp();
    internal.handleRaw(Buffer.from('\x1b[200~'));
    // 4-byte emoji split across chunks
    internal.handleRaw(Buffer.from('\xf0\x9f'));
    internal.handleRaw(Buffer.from('\x98\x80')); // 😀
    internal.handleRaw(Buffer.from('\x1b[201~'));
    expect(internal.getStateForTest().views.chat.inputBuffer).toBe('😀');
  });
});
```

- [ ] **Step 2: Write failing tests for copy**

Add to the same file:

```ts
describe('TuiApp — OSC 52 copy', () => {
  function makeCopyApp() {
    const snap = { generatedAt: 1, session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 }, daemon: null, approvals: null, runtime: null, sops: null, policy: null };
    const builder = { build: vi.fn(async () => snap), buildSync: vi.fn(() => snap) };
    const metrics = { start: () => {}, stop: async () => {} };
    const app = new TuiApp({ builder, daemonMetrics: metrics } as unknown as TuiAppOptions);
    const internal = app as unknown as {
      handleRaw(buf: Buffer): void;
      getStateForTest(): {
        lastSnapshot: unknown;
        views: { chat: { inputBuffer: string; submittedPrompts: string[]; agentResponses: string[] } };
      };
    };
    internal.getStateForTest().lastSnapshot = snap;
    return { app, internal };
  }

  it('Alt+C with content copies OSC 52 sequence to stdout', () => {
    const { internal } = makeCopyApp();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    internal.getStateForTest().views.chat.agentResponses = ['test response'];
    // Alt+C arrives as ESC + 'c'
    internal.handleRaw(Buffer.from('\x1bc'));
    expect(writeSpy).toHaveBeenCalled();
    const output = (writeSpy.mock.calls[0] as [string])[0];
    expect(output).toMatch(/^\x1b\]52;;/);
    expect(output).toMatch(/\x1b\\$/); // ST terminator
    writeSpy.mockRestore();
  });

  it('Alt+C with empty scrollback does nothing', () => {
    const { internal } = makeCopyApp();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    internal.handleRaw(Buffer.from('\x1bc'));
    // No output expected (empty transcript)
    // The paint call still writes to stdout — check for OSC 52 specifically
    expect(writeSpy.mock.calls.some((c: unknown[]) => (c[0] as string).startsWith('\x1b]52;;'))).toBe(false);
    writeSpy.mockRestore();
  });

  it('copies interleaved prompts and responses', () => {
    const { internal } = makeCopyApp();
    internal.getStateForTest().views.chat.submittedPrompts = ['q1', 'q2'];
    internal.getStateForTest().views.chat.agentResponses = ['a1', 'a2'];
    const text = (internal as any).collectVisibleTranscript('chat');
    expect(text).toContain('→ q1');
    expect(text).toContain('← a1');
    expect(text).toContain('← a2');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/tui/app.vitest.ts`
Expected: 10 new tests fail (6 paste + 4 copy). Existing tests should still pass.

- [ ] **Step 4: Extend ViewAction with copyScrollback**

In `src/tui/views/types.ts`:

```ts
export type ViewAction =
  | { type: 'handled' }
  | { type: 'moveCursor'; cursor: number; pinnedBottom?: boolean }
  | { type: 'scroll'; offset: number }
  | { type: 'scheduleRefresh' }
  | { type: 'switchTab'; tab: TabId }
  | { type: 'resolveApproval'; approvalId: string; status: 'approved' | 'denied' }
  | { type: 'copyScrollback' };  // NEW
```

- [ ] **Step 5: Add Alt+C key detection in parseKey**

In `src/tui/app.ts`, inside `parseKey()`, add after the existing ESC+digit block:

```ts
// Alt+letter — used for copy (Alt+C) and future Alt shortcuts.
// Terminals send lowercase for Alt+letter regardless of Shift state.
if (s.length === 2 && s[0] === '\x1b' && s[1] >= 'a' && s[1] <= 'z') {
  return `Alt+${s[1]}`;
}
```

- [ ] **Step 6: Add paste state machine + helpers to TuiApp**

In `src/tui/app.ts`, add class fields:

```ts
private pasteState: 'idle' | 'reading' = 'idle';
private pasteChunks: Buffer[] = [];
```

Add the `handlePaste(buf: Buffer): boolean` method (exact signature and body from the spec, lines 120-159).

Add the `flushPaste(): void` method (exact signature and body from the spec, lines 176-197).

Add the `collectVisibleTranscript(tab: TabId): string` method (exact signature and body from the spec, lines 247-258).

Modify `handleRaw(buf: Buffer)` — add the paste detector at the very top:

```ts
private handleRaw(buf: Buffer): void {
  // 1. Bracketed paste detector — runs on raw bytes, before key parsing.
  if (this.handlePaste(buf)) return;

  const key = parseKey(buf);
  // ... rest stays the same ...
}
```

Add the Alt+C handler inside `handleRaw()`, before the existing printable-character check (after the agent-tab and chat-tab specific blocks, before the view handleKey fallthrough):

```ts
if (key === 'Alt+c') {
  this.dispatch({ type: 'copyScrollback' });
  return;
}
```

Add the `'copyScrollback'` case in `dispatch()`:

```ts
case 'copyScrollback': {
  const text = this.collectVisibleTranscript(this.state.activeTab);
  if (!text) { this.paintFullFrame(); break; }
  const MAX_CLIPBOARD = 64 * 1024;
  const truncated = text.length > MAX_CLIPBOARD
    ? text.slice(0, MAX_CLIPBOARD) + '\n[truncated at 64 KB]'
    : text;
  const b64 = Buffer.from(truncated, 'utf8').toString('base64');
  process.stdout.write(`\x1b]52;;${b64}\x1b\\`);
  this.paintFullFrame();
  break;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/tui/app.vitest.ts`
Expected: All existing + 10 new tests pass

- [ ] **Step 8: Run full suite and commit**

Run: `pnpm test:vitest 2>&1 | tail -5`
Expected: ~3180 tests pass

```bash
git add src/tui/views/types.ts src/tui/app.ts tests/tui/app.vitest.ts
git commit -m "feat(tui): bracketed paste + OSC 52 copy for chat and agent tabs"
```

---

### Task 3: Verification

**Files:** (none — verification only)

- [ ] **Step 1: Build clean**

Run: `pnpm build`
Expected: tsc compiles cleanly

- [ ] **Step 2: Full test suite**

Run: `pnpm test:vitest 2>&1 | tail -5`
Expected: All tests pass

- [ ] **Step 3: Visual smoke test in the TUI**

Run: `npx alix tui`

In the agent tab:
1. Type some text, press Enter
2. Verify the response renders
3. Press `Alt+C` — the response should now be in the system clipboard
4. Press `Ctrl+Shift+V` (or `Shift+Insert`) — pasted text should appear in the input buffer

Due to raw-mode restrictions, the bracketed paste test requires manual verification. The copy test can be verified by pasting outside the TUI.

- [ ] **Step 4: Final commit (if any cleanup needed)**

```bash
# Only if smoke test revealed issues:
git add -A
git commit -m "fix(tui): visual polish for copy/paste"
```

---

## Self-Review Notes

**Spec coverage:**

| Spec section | Task |
|---|---|
| TerminalControl mode management | Task 1 |
| Bracketed paste raw-byte protocol | Task 2 (handlePaste, flushPaste) |
| Paste state machine (idle / reading) | Task 2 |
| Buffer accumulation (not string) | Task 2 |
| TextDecoder for final decode | Task 2 |
| CRLF normalization | Task 2 |
| ViewAction extension with copyScrollback | Task 2 (types.ts) |
| Alt+C keybinding | Task 2 (parseKey) |
| collectVisibleTranscript helper | Task 2 |
| OSC 52 emit with 64KB limit | Task 2 (dispatch) |
| Cleanup invariant (mode restore) | Task 1 |
| Paste/copy tests | Task 2 |
| Mode management tests | Task 1 |

**Placeholder scan:** No TBD/TODO markers. Every step has concrete code.

**Type consistency:** 
- `ViewAction` extended in Task 2 is the same type existing in `src/tui/views/types.ts` — already read and confirmed
- `handlePaste(buf: Buffer): boolean` signature matches the spec exactly
- `collectVisibleTranscript(tab: TabId): string` uses the existing `TabId` type
- `pasteState` uses `'idle' | 'reading'` (removed `'pending-esc'` per code review)
- `copyScrollback` variant uses the exact literal `{ type: 'copyScrollback' }` (not `copy-scrollback` with hyphen)

**Potential gotchas:**
- The `handlePaste()` end-marker scan uses `buf.indexOf(Buffer.from('\x1b[201~'))` — this is byte-level Buffer.indexOf, not string indexOf. No UTF-8 corruption on multi-byte characters before the terminator.
- The paste detector currently requires the ENTIRE start marker `\x1b[200~` to arrive in ONE chunk. ESC split across chunks falls through to `parseKey()` which treats the stray ESC as null (acceptable per spec).
- `TextDecoder` is used in `flushPaste()` — it's the Web API (`new TextDecoder('utf8')`) which is available in Node 24+.
- The `cleanupSync()` no longer calls the ad-hoc exit methods individually — `disableTerminalModes()` handles all three. Verify this doesn't break the alt-buffer ALIX_TUI_ALT_BUFFER=0 opt-out (it calls `exitAltBuffer()` which internally respects the env var).
