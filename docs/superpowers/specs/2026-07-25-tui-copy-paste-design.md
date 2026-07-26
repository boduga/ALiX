# TUI Copy & Paste — Design Spec

**Date:** 2026-07-25
**Status:** Draft
**Author:** Claude (with boduga review)

## Problem

The TUI's chat and agent tabs run in raw mode with an alternate screen buffer. The user cannot:
- **Paste** text into the input buffer — raw mode reads each character as a keypress, so pasted text burst-feeds chars
- **Copy** text from the scrollback — the alt buffer prevents native terminal selection

## Existing workaround

`ALIX_TUI_ALT_BUFFER=0` runs the TUI outside the alt buffer, enabling native selection. But this loses the clean alt-buffer experience (no scrollback contamination, no display artifacts from reflow).

## Goals

1. **Paste** into the chat/agent input buffer via bracketed paste mode
2. **Copy** scrollback content to the system clipboard via OSC 52
3. Both work inside the alt buffer
4. Minimal changes to the existing input pipeline

## Non-Goals

- Mouse-based selection (works by default in the alt buffer on most terminals)
- Visual copy indicator (could be added in a follow-up)
- Copy partial selection (copies the full visible scrollback)
- Paste auto-submit (pasted text lands in the input buffer; Enter to submit)
- Copy from non-input tabs (only active chat/agent tab)

## Architecture

Two independent escape-sequence protocols, one per direction:

```
Paste (bracketed paste)
    terminal → \x1b[200~ <text> \x1b[201~ → TUI input parser → inputBuffer

Copy (OSC 52)
    TUI → \x1b]52;;<base64>\x1b\\ → terminal → system clipboard
```

## Component 1: Bracketed Paste

### What it is

A terminal protocol that wraps pasted text in distinguished escape sequences so applications can tell the difference between typed input and pasted text. The terminal sends:

- Paste start: `\x1b[200~`
- Content: raw bytes (including newlines, tabs, non-ASCII)
- Paste end: `\x1b[201~`

### Changes

**`src/tui/terminal-control.ts`** — add two methods:

```ts
enableBracketedPaste(): void   // writes \x1b[?2004h
disableBracketedPaste(): void  // writes \x1b[?2004l
```

Called from `TuiApp.start()` and `TuiApp.cleanupSync()` respectively, alongside the existing alt-buffer enter/exit.

**`src/tui/app.ts` — `parseKey()`** — add detection:

```ts
// Bracketed paste start
if (s === '\x1b[200~') return 'paste.start';
// Bracketed paste end  
if (s === '\x1b[201~') return 'paste.end';
```

**`src/tui/app.ts` — `handleRaw()`** — add a paste state machine:

```ts
// In the TuiApp class:
private pasteBuffer = '';
private inPaste = false;

// Inside handleRaw, before other key handling:
if (key === 'paste.start') {
  this.inPaste = true;
  this.pasteBuffer = '';
  this.paintFullFrame();
  return;
}
if (this.inPaste) {
  // Accumulate all bytes until paste.end is received.
  // Raw bytes may include newlines, tabs, multi-byte UTF-8.
  this.pasteBuffer += buf.toString('utf8');
  return;
}
```

When paste.end arrives, insert `this.pasteBuffer` into the active tab's input buffer and repaint.

## Component 2: OSC 52 Copy

### What it is

The Operating System Command (OSC) 52 escape sequence tells the terminal emulator to write `base64` data to the system clipboard.

```
\x1b]52;;<base64-encoded-text>\x07      (BEL-terminated variant)
\x1b]52;;<base64-encoded-text>\x1b\\    (ST-terminated variant)
```

The ST variant (`\x1b\\`) is more widely supported. We use it.

### Keybinding

`Alt+C` for copy, because:
- `Ctrl+Shift+C` is intercepted by most terminals for their own copy operation
- `Alt+C` is distinguishable in raw mode (terminal sends `\x1b` then `c`)
- It's mnemonic: **C** = Copy

### Changes

**In `parseKey()`:** Alt+letter sequences arrive as `ESC + letter`. Currently ESC+digit is handled for tab navigation; extend to also handle ESC+letter for copy.

```ts
// Alt+letter — used for copy (Alt+C) and future Alt shortcuts
if (s.length === 2 && s[0] === '\x1b' && s[1] >= 'a' && s[1] <= 'z') {
  return `Alt+${s[1]}`;
}
```

**In `handleRaw()`:** When the global handler sees `Alt+C`:
1. Get the active tab's state
2. Join `submittedPrompts[]` and `agentResponses[]` into one string
3. Base64-encode it
4. Write `\x1b]52;;<base64>\x1b\\` to stdout
5. Set a flag to show a brief visual indicator (phase 1: not implemented)

```ts
if (key === 'Alt+c') {
  const perTab = this.state.views[this.state.activeTab];
  const text = [...perTab.submittedPrompts, ...perTab.agentResponses].join('\n');
  if (!text) return;
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  process.stdout.write(`\x1b]52;;${b64}\x1b\\`);
  return;
}
```

## Data Flow

### Paste

```
User pastes (Ctrl+Shift+V or Shift+Insert)
    ↓
Terminal wraps in \x1b[200~ ... \x1b[201~
    ↓
TUI handleRaw receives \x1b[200~ → sets inPaste flag
    ↓
TUI handleRaw receives raw bytes → appends to pasteBuffer
    ↓
TUI handleRaw receives \x1b[201~ → clears inPaste flag
    ↓
appends pasteBuffer to active tab's inputBuffer
    ↓
repaintFullFrame
```

### Copy

```
User presses Alt+C
    ↓
parseKey returns 'Alt+c'
    ↓
handleRaw dispatches to copy handler
    ↓
collects scrollback text from active tab state
    ↓
base64-encodes, writes OSC 52 sequence to stdout
    ↓
Terminal copies to system clipboard
```

## Key Changes

| File | Change |
|------|--------|
| `src/tui/terminal-control.ts` | Add `enableBracketedPaste()` / `disableBracketedPaste()` |
| `src/tui/app.ts` — `start()` | Call `enableBracketedPaste()` |
| `src/tui/app.ts` — `cleanupSync()` | Call `disableBracketedPaste()` |
| `src/tui/app.ts` — `parseKey()` | Handle `\x1b[200~` / `\x1b[201~` paste brackets, `Alt+C` for copy |
| `src/tui/app.ts` — `handleRaw()` | Add paste state machine, add copy handler |

## Testing

### Paste tests (`tests/tui/app.vitest.ts`)

| Test | Input | Expected |
|------|-------|----------|
| Paste start sets flag | `\x1b[200~` | `inPaste = true` |
| Raw bytes during paste accumulate | `"hello"` | `pasteBuffer = "hello"` |
| Paste end inserts into inputBuffer | `\x1b[201~` | `inputBuffer = "hello"` |
| Paste with newlines preserved | `\x1b[200~line1\nline2\x1b[201~` | `inputBuffer = "line1\nline2"` |
| Non-paste bytes ignored during paste | (any non-bracket byte) | appended to pasteBuffer |
| Paste on chat tab vs agent tab | (same behavior) | both tabs work |

### Copy tests

| Test | Input | Expected |
|------|-------|----------|
| Copy from active tab | `Alt+C` | OSC 52 sequence written to stdout |
| Copy from empty scrollback | `Alt+C` | No output (no-op) |
| Copy from tab with content | `Alt+C` after response | Base64-encoded text in sequence |

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

Both protocols are POSIX-standard escape sequences supported by virtually all modern terminal emulators.
