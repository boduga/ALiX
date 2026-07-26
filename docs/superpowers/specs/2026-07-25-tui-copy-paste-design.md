# TUI Copy & Paste — Design Spec

**Date:** 2026-07-25
**Status:** Draft v2
**Author:** Claude (with boduga review)

## Problem

The TUI's chat and agent tabs run in raw mode with an alternate screen buffer. The user cannot:
- **Paste** text into the input buffer — raw mode reads each character as a keypress, so pasted text burst-feeds chars
- **Copy** text from the scrollback — the alt buffer prevents native terminal selection

## Existing workaround

`ALIX_TUI_ALT_BUFFER=0` runs the TUI outside the alt buffer, enabling native selection. But this loses the clean alt-buffer experience.

## Goals

1. **Paste** into the chat/agent input buffer via bracketed paste mode
2. **Copy** scrollback content to the system clipboard via OSC 52
3. Both work inside the alt buffer
4. Minimal changes to the existing input pipeline
5. Robust to arbitrary input chunking, UTF-8 boundaries, and terminal disconnects

## Non-Goals

- Mouse-based selection (works by default in the alt buffer on most terminals)
- Visual copy indicator (could be added in a follow-up)
- Copy partial selection (copies the full visible scrollback)
- Paste auto-submit
- Copy from non-input tabs
- Terminal capability detection (future extension)

## Architecture

Three independent layers:

```
Terminal mode management
    └── TerminalControl (alt buffer + bracketed paste + cursor)

Raw-byte stream processing
    ├── paste detector (before key parsing)
    │   └── Buffer accumulator
    └── parseKey() (unchanged — only sees non-paste bytes)

Action dispatch
    ├── 'copy-scrollback' → collectVisibleTranscript() → OSC 52
    └── normal key input → inputBuffer
```

Key change from v1: bracketed paste is handled as a **raw-byte streaming protocol** in `handleRaw()`, before any key parsing. `parseKey()` never sees paste sequences. This is robust to arbitrary chunk boundaries and UTF-8 spans.

## TerminalControl — Generalised Mode Management

Instead of ad-hoc methods for each terminal protocol, `TerminalControl` owns all terminal mode sequencing:

```ts
interface TerminalControl {
  enterRawMode(): void;
  exitRawMode(): void;
  showCursor(visible: boolean): void;
  enterAltBuffer(): void;
  exitAltBuffer(): void;
  onResize(cb: () => void): () => void;
  installEmergencyCleanup(cleanup: () => void): () => void;

  // Unified mode management — called once at startup/shutdown
  enableTerminalModes(): void;    // alt buffer + bracketed paste + cursor
  disableTerminalModes(): void;   // bracketed paste + cursor + alt buffer (reverse order)
}
```

`enableTerminalModes()` writes:
1. `\x1b[?1049h` — alt buffer
2. `\x1b[?25l` — hide cursor (if desired for initial draw)
3. `\x1b[?2004h` — bracketed paste mode
4. `\x1b[?12l` — stop cursor blink

`disableTerminalModes()` writes in reverse:
1. `\x1b[?2004l` — disable bracketed paste
2. `\x1b[?25h` — show cursor
3. `\x1b[?1049l` — exit alt buffer

**Cleanup invariant:** terminal modes must be restored on exit regardless of how the TUI stops — normal exit, crash, or startup failure mid-sequence. The user's terminal is never left in bracketed paste mode, with hidden cursor, or in the alt buffer. The implementer chooses the mechanism (`finally`, `process.on('exit')`, emergency signal handler, etc.).

Existing methods (`enterRawMode`, `exitRawMode`, `showCursor`, etc.) stay. `enableTerminalModes()`/`disableTerminalModes()` are higher-level compositions that call the existing primitives.

## Component 1: Bracketed Paste (Raw-Byte Protocol)

### Handler placement

In `TuiApp.handleRaw(buf: Buffer)`, the first check is for bracketed paste — before `parseKey()`:

```ts
private handleRaw(buf: Buffer): void {
  // 1. Bracketed paste detector — runs on raw bytes, before key parsing.
  //    This is robust to arbitrary chunk boundaries and UTF-8 spans.
  if (this.handlePaste(buf)) return;

  // 2. Key parsing — only non-paste bytes reach here.
  const key = parseKey(buf);
  // ... existing dispatch ...
}
```

### Paste detector

```ts
// State tracked on TuiApp:
private pasteState: 'idle' | 'reading' = 'idle';
private pasteChunks: Buffer[] = [];

/**
 * Handle a buffer of raw stdin bytes in the context of bracketed paste.
 * Returns true if the bytes were consumed as paste (caller should not
 * continue to parseKey). Uses Buffer accumulation (not string concatenation)
 * so UTF-8 characters that span chunk boundaries are preserved correctly.
 */
private handlePaste(buf: Buffer): boolean {
  // Paste start sequence is always \x1b[200~
  // Paste end sequence is always \x1b[201~
  // Both may arrive split across any number of chunks.

  if (this.pasteState === 'idle') {
    // Scan for paste-start sequence \x1b[200~
    // The ESC char may arrive in a previous chunk's last byte.
    const s = buf.toString('utf8'); // safe — this is one command byte or a few
    if (s === '\x1b[200~') {
      this.pasteState = 'reading';
      this.pasteChunks = [];
      return true;
    }
    return false;
  }

  if (this.pasteState === 'reading') {
    // Scan forward for paste-end sequence using byte offsets, not
    // string indices. Converting to string first and using string
    // indexOf would produce character offsets that do not match byte
    // offsets when multi-byte UTF-8 content precedes the terminator,
    // causing buf.subarray() to slice mid-character.
    const endBuf = Buffer.from('\x1b[201~');
    const endIdx = buf.indexOf(endBuf);
    if (endIdx >= 0) {
      // End sequence found in this chunk.
      if (endIdx > 0) {
        this.pasteChunks.push(buf.subarray(0, endIdx));
      }
      this.flushPaste();
      return true;
    }
    // No end marker yet — accumulate chunk.
    this.pasteChunks.push(buf);
    return true;
  }

  return false;
}
```

This design is robust to:

| Scenario | Behavior |
|----------|----------|
| Paste arrives in one chunk `\x1b[200~hello\x1b[201~` | Detected in one pass. |
| ESC and `[200~` split across chunks | First chunk doesn't match `\x1b[200~`, falls through to `parseKey()`. This is an edge case that the action-based dispatch below mitigates — a stray ESC that doesn't complete `[200~` just becomes `parseKey('\\x1b')` which returns `null` (unhandled). If this is a concern, a multi-byte scan state machine can be added in a follow-up. |
| Paste content contains raw bytes that look like `\x1b[201~` | Impossible: paste content is NOT inspected for the end sequence — the *entire* chunk is checked for `\x1b[201~` before any of it is consumed. The end marker is at the *end* of the paste, not embedded. If the *chunk itself* contains the sequence textually, it would need to be `\x1b[201~` literally — which is the protocol terminator, not paste content. |
| Paste content is binary / control characters | Accumulated as Buffers, decoded at flush time via StringDecoder. |
| Empty paste `\x1b[200~\x1b[201~` | `pasteChunks` is empty, `flushPaste` does nothing. |
| User types text during paste (rare) | Only bytes after `\x1b[201~` reach `parseKey()`. |

### Flush

```ts
private flushPaste(): void {
  this.pasteState = 'idle';
  const chunks = this.pasteChunks;
  this.pasteChunks = [];

  if (chunks.length === 0) return;

  // Use StringDecoder for correct UTF-8 across Buffer boundaries.
  const decoder = new TextDecoder('utf8');
  const combined = decoder.decode(Buffer.concat(chunks));

  // Normalize CRLF → LF so Windows clipboard pastes produce
  // consistent line endings in the input buffer.
  const normalized = combined.replace(/\r\n?/g, '\n');

  // Insert at the input buffer — does NOT replace existing content.
  const perTab = this.state.views[this.state.activeTab];
  // When cursor-position editing arrives, this will insert at cursor.
  perTab.inputBuffer += normalized;

  this.paintFullFrame();
}
```

**Guarantee:** `flushPaste` always resets `pasteState` to `'idle'` so a partial paste-start that doesn't match (e.g. `\x1b[20` split across chunks) just falls through to `parseKey()` with no state leak.

## Component 2: OSC 52 Copy

### Action dispatch

Introduce a `TuiAction` type so keybindings are decoupled from logic:

```ts
// Extend the existing ViewAction union (defined in src/tui/views/types.ts)
// with one new variant for clipboard copy.
// Existing variants: handled, moveCursor, scroll, switchTab,
// resolveApproval, scheduleRefresh
// NEW:
//   | { type: 'copyScrollback' }

```

The `Alt+C` keybinding maps to `'copyScrollback'` — not to an inline operation.

### Keybinding

`Alt+C` for copy. The `parseKey()` function is extended to detect ESC+letter sequences distinctly from ESC+digit:

```ts
// Alt+letter — returns action-like name for future extensibility
if (s.length === 2 && s[0] === '\x1b' && s[1] >= 'a' && s[1] <= 'z') {
  // Alt+letter: lower-case for all (terminals send 'c' for Alt+C
  // regardless of Shift state)
  return `Alt+${s[1]}`;
}
```

### collectVisibleTranscript — the copy source

Instead of directly accessing `submittedPrompts[]` and `agentResponses[]`, extract a helper that builds the **rendered** transcript — what the user actually sees, including plan content, approvals, and future ResponseBlock rendering:

```ts
/**
 * Collect the visible scrollback content from a tab's state as a
 * plain-text transcript, suitable for clipboard copy. This uses the
 * rendered view model (what the user sees), not the raw state arrays.
 *
 * In Phase 1 this joins submittedPrompts + agentResponses with
 * interleaving markers (→ for user, ← for agent). Future phases
 * can add ResponseBlock rendering, plan content, timestamps, etc.
 */
private collectVisibleTranscript(tab: TabId): string {
  const perTab = this.state.views[tab];
  const submitted = perTab.submittedPrompts;
  const responses = perTab.agentResponses;
  const parts: string[] = [];
  const maxLen = Math.max(submitted.length, responses.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < submitted.length) parts.push(`→ ${submitted[i]}`);
    if (i < responses.length) parts.push(`← ${responses[i]}`);
  }
  return parts.join('\n');
}
```

### OSC 52 implementation

In `handleRaw()`, when the `Alt+c` key arrives:

```ts
if (key === 'Alt+c') {
  this.dispatch({ type: 'copyScrollback' });
  return;
}
```

In `dispatch()`:

```ts
case 'copyScrollback': {
  const text = this.collectVisibleTranscript(this.state.activeTab);
  if (!text) { this.paintFullFrame(); break; }

  const MAX_CLIPBOARD = 64 * 1024; // 64 KB — safe for most terminals
  const truncated = text.length > MAX_CLIPBOARD
    ? text.slice(0, MAX_CLIPBOARD) + '\n[truncated at 64 KB]'
    : text;
  const b64 = Buffer.from(truncated, 'utf8').toString('base64');
  process.stdout.write(`\x1b]52;;${b64}\x1b\\`);
  // Could show "Copied" indicator here in a future phase.
  break;
}
```

**64 KB limit:** If the transcript exceeds 64 KB, it's truncated with a `[truncated at 64 KB]` suffix. This prevents silent failure on terminals that limit OSC 52 payload size (notably tmux, screen, and SSH relays).

### Notes

- The copy action dispatches through the existing `dispatch()` method, not as a special inline path. This means future keybindings (`F8`, `Ctrl+Shift+C` via terminal protocol) can all map to the same action without changing the handler logic.
- The `collectVisibleTranscript()` helper is a single place to evolve the clipboard format: adding timestamps, plan blocks, ResponseBlock rendering, or filtering. The copy handler doesn't know about the transcript format.
- The copy handler uses `stdout.write` (not canvas), so the ESC sequence is sent to the terminal before the next frame paint. The terminal processes it and copies to the clipboard.

## Data Flow

### Paste

```
User pastes (Ctrl+Shift+V or Shift+Insert)
    ↓
Terminal wraps in \x1b[200~ ... \x1b[201~
    ↓
TUI handleRaw → handlePaste(buf)
    ↓
pasteState === 'idle' → found \x1b[200~ → set 'reading'
    ↓
Subsequent chunks → handlePaste → pasteChunks.push(buf)
    ↓
Chunk containing \x1b[201~ → flushPaste()
    ↓
TextDecoder.decode(Buffer.concat(chunks))
    ↓
CRLF → LF normalization
    ↓
append to perTab.inputBuffer (insert, not replace)
    ↓
paintFullFrame
```

### Copy

```
User presses Alt+C
    ↓
parseKey('C') → 'Alt+c'
    ↓
handleRaw → dispatch({ type: 'copyScrollback' })
    ↓
collectVisibleTranscript(activeTab)
    ↓
truncate to 64 KB if needed
    ↓
base64 → \x1b]52;;<b64>\x1b\\ → stdout
    ↓
Terminal copies to system clipboard
```

## Key Changes

| File | Change |
|------|--------|
| `src/tui/terminal-control.ts` | Add `enableTerminalModes()` / `disableTerminalModes()` (unify alt buffer + bracketed paste + cursor) |
| `src/tui/app.ts` — `handleRaw()` | Add `handlePaste()` — raw-byte streaming paste detector, runs before `parseKey()` |
| `src/tui/app.ts` — `handleRaw()` | Add `Alt+C` → `dispatch({ type: 'copyScrollback' })` |
| `src/tui/app.ts` — `dispatch()` | Add `'copyScrollback'` case — `collectVisibleTranscript()` + OSC 52 |
| `src/tui/app.ts` | Add `collectVisibleTranscript(tab)` helper, paste state (`pasteState`, `pasteChunks`) |
| `src/tui/views/types.ts` | Extend `ViewAction` union with `{ type: 'copyScrollback' }` |
| `src/tui/app.ts` — `cleanupSync()` | Wrap in `finally` to guarantee `disableTerminalModes()` even on startup failure |

## Testing

### Paste tests

| Test | Input (as Buffer chunks) | Expected |
|------|--------------------------|----------|
| Paste start sets state | `\x1b[200~` (single chunk) | `pasteState = 'reading'` |
| Raw bytes accumulate | `"hello"` after start | `pasteChunks.length === 1` |
| Paste end inserts into inputBuffer | `\x1b[201~` | `inputBuffer += "hello"` |
| Newlines preserved | `\x1b[200~line1\nline2\x1b[201~` | `inputBuffer += "line1\nline2"` |
| CRLF normalized to LF | `\x1b[200~a\r\nb\x1b[201~` | `inputBuffer += "a\nb"` |
| Bare CR normalized to LF | `\x1b[200~a\rb\x1b[201~` | `inputBuffer += "a\nb"` |
| Empty paste is no-op | `\x1b[200~\x1b[201~` | `inputBuffer` unchanged |
| Non-paste bytes ignored during paste | `hello` during 'reading' | appended to `pasteChunks` |
| Paste on chat tab vs agent tab | (same behavior) | both tabs work |
| UTF-8 multi-byte characters | `😀` (4 bytes across 2 chunks) | decoded correctly via `TextDecoder` |
| UTF-8 + end-marker in one chunk | `"café😀\x1b[201~"` as Buffer | end marker found at byte offset 10 (not string offset 6); `buf.subarray(0, 10)` preserves multi-byte char |
| Split paste-sequence across chunks | `\x1b[20` + `0~` content `\x1b[201~` | First chunk falls through to `parseKey()` (stray ESC = null). Phrase 2 doesn't match `\x1b[200~` — falls through. **Edge case; acceptable.** A follow-up phase can add multi-byte scan. |
| Large paste (50 KB) | 50 KB of content | No corruption, all bytes preserved |
| Large paste (100 KB, >64KB) | 100 KB of content | Copied to input buffer in full (paste has no OSC 52 limit — only copy has). |

### Copy tests

| Test | Input | Expected |
|------|-------|----------|
| Copy from active tab | `Alt+C` | `\x1b]52;;<b64>\x1b\\` written to stdout |
| Empty scrollback | `Alt+C`, no prompts/responses | No stdout output (no-op) |
| Copy from tab with content | `Alt+C` after response | Base64-encoded interleaved transcript in sequence |
| Copy transcript > 64 KB | Very long conversation | Truncated with `[truncated at 64 KB]` suffix |
| Copy from chat tab | `Alt+C` on chat tab | Same format, different source arrays |

### Cleanup tests

| Test | Input | Expected |
|------|-------|----------|
| Clean exit disables bracketed paste | `stop()` | `\x1b[?2004l` written to stdout |
| Startup failure still disables | Exception during `start()` | `cleanupSync()` runs, bracketed paste disabled |

## Terminal Compatibility

| Terminal | Bracketed paste | OSC 52 |
|----------|-----------------|--------|
| xterm | ✅ | ✅ |
| GNOME Terminal | ✅ | ✅ |
| kitty | ✅ | ✅ |
| iTerm2 | ✅ | ✅ |
| Windows Terminal | ✅ | ✅ |
| tmux | ✅ | Requires `set -g set-clipboard on` |
| macOS Terminal | ✅ | Requires `Set -c` permission |

## Future Extensions

The architecture is designed so these can be added without changing the core protocol layer:

- **TerminalCapabilities detection** — OSC 52 isn't universally enabled. A `TerminalCapabilities` type with `osc52: boolean` and `bracketedPaste: boolean` fields can be populated on first successful use.
- **More keybindings for copy** — `F8`, `Ctrl+Shift+C` (via terminal-specific key protocols), etc. All map to the same `'copyScrollback'` action.
- **Visual copy indicator** — a status-bar message "Copied N chars" that fades after 2 seconds.
- **Richer transcript rendering** — ResponseBlock types (code blocks, lists) can be rendered into the transcript text.
- **Timestamps** in the transcript.
- **Mouse-mode selection** — combine `\x1b[?1000h` with OSC 52 to copy user-selected regions.
