# Workbench Smoke-Test Checklist

A short manual checklist for verifying the core Workbench controls in the TUI.
Run through it after any change to `src/interfaces/tui/workbench/`. Source of truth for key
routing: `src/interfaces/tui/workbench/input/input-router.ts` (see `docs/keyboard-navigation.md`).

## Prerequisites

- [ ] ALiX built (`pnpm build`)
- [ ] Terminal is at least 120 columns × 30 rows
- [ ] TUI launched (`alix tui`)

## Composer controls

- [ ] Typing printable characters inserts text at the cursor
- [ ] `Shift+Enter` inserts a newline without submitting
- [ ] `Backspace` / `Delete` delete before / after the cursor
- [ ] `ArrowLeft` / `ArrowRight` / `Home` / `End` move the cursor
- [ ] `Enter` with text (no active turn) submits the turn
- [ ] `Enter` with an active turn queues the next turn instead of submitting
- [ ] `Enter` on a slash command (e.g. `/help`) executes it

## Drawers and overlays

- [ ] `Ctrl+a` toggles the Agents drawer; `Enter` toggles the selected roster entry
- [ ] `Ctrl+t` toggles the Tasks drawer
- [ ] `Ctrl+r` toggles the Artifacts drawer
- [ ] `ArrowUp`/`k` and `ArrowDown`/`j` move drawer selection
- [ ] `[` / `]` navigate previous / next run entries
- [ ] `Escape` closes the open overlay, then the drawer, then cancels an active turn

## Approvals and turn state

- [ ] `Shift+Tab` cycles permission modes
- [ ] With an approval pending, `a` approves and `d` denies
- [ ] `Escape` during an active turn cancels it

## Misc

- [ ] `Ctrl+o` toggles the transcript view mode
- [ ] Unknown keys produce no action (no stray input in the composer)
