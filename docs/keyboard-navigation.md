# Keyboard Navigation Controls for Workbench Input

This document describes the keyboard shortcuts handled by the **Workbench** input system (located in `src/interfaces/tui/workbench/input/`).

## Overview
The core routing logic lives in `src/interfaces/tui/workbench/input/input-router.ts`. It maps a raw key string and the current UI context to a **WorkbenchInputIntent** that drives UI actions.

## Key Bindings
| Key | Context Conditions | Action (Intent) | Description |
|-----|-------------------|----------------|-------------|
| `Ctrl+a` | – | `drawer.toggle` (drawer: `agents`) | Opens or closes the **Agents** drawer. |
| `Ctrl+t` | – | `drawer.toggle` (drawer: `tasks`) | Opens or closes the **Tasks** drawer. |
| `Ctrl+r` | – | `drawer.toggle` (drawer: `artifacts`) | Opens or closes the **Artifacts** drawer. |
| `Escape` | `overlayOpen` true | `overlay.close` | Closes any open overlay. |
| `Escape` | `focus` = `drawer` & `drawer` ≠ `closed` | `drawer.close` | Closes the drawer panel. |
| `Escape` | `turnActive` true (no overlay) | `turn.cancel` | Cancels the current turn. |
| `ArrowUp` / `k` | `focus` = `drawer` & drawer open | `drawer.move` (direction: -1) | Move selection up in the drawer list. |
| `ArrowDown` / `j` | `focus` = `drawer` & drawer open | `drawer.move` (direction: 1) | Move selection down in the drawer list. |
| `[` | `focus` = `drawer` & drawer open | `run.move` (direction: -1) | Navigate to the previous run entry. |
| `]` | `focus` = `drawer` & drawer open | `run.move` (direction: 1) | Navigate to the next run entry. |
| `Enter` (in **Agents** drawer) | `drawer` = `agents` | `agentRoster.toggle` | Toggle the selected agent roster entry. |
| `Shift+Enter` | – | `composer.insert` (text: `\n`) | Insert a newline in the composer without submitting. |
| `Backspace` | – | `composer.backspace` | Delete the character before the cursor. |
| `Delete` | – | `composer.delete` | Delete the character after the cursor. |
| `ArrowLeft` | – | `composer.move` (direction: `left`) | Move cursor left in the composer. |
| `ArrowRight` | – | `composer.move` (direction: `right`) | Move cursor right in the composer. |
| `Home` | – | `composer.move` (direction: `start`) | Jump to the start of the composer line. |
| `End` | – | `composer.move` (direction: `end`) | Jump to the end of the composer line. |
| `Ctrl+o` | – | `transcript.toggle` | Toggle the transcript view mode. |
| `Shift+Tab` | – | `permission.cycle` | Cycle through permission prompts. |
| `Enter` | `slashActive` true | `slash.submit` | Submit a slash command (e.g., `/help`). |
| `Enter` | Composer text non‑empty & `turnActive` false | `turn.submit` | Submit the current turn. |
| `Enter` | Composer text non‑empty & `turnActive` true | `turn.queue` | Queue the turn for later execution. |
| Printable characters (e.g., letters, numbers, symbols) | – | `composer.insert` (text: key) | Insert the typed character into the composer. |
| `a` / `d` | `approvalPending` true | `approval.resolve` (`approved`/`denied`) | Resolve a pending approval. |
| Any other key | – | `unhandled` | No action is taken. |

## Context Flags
- **approvalPending** – An approval request is awaiting a decision.
- **overlayOpen** – An overlay (help, diff, review, etc.) is currently displayed.
- **focus** – Which UI component currently has keyboard focus (`composer`, `transcript`, `drawer`, `modal`).
- **drawer** – Which drawer is open (`closed`, `agents`, `tasks`, `artifacts`).
- **turnActive** – Whether a turn (assistant response) is in progress.
- **slashActive** – Whether the composer is currently processing a slash command.
- **composerText** – Current text content of the composer.

These flags are part of `WorkbenchInputContext` (see `input-router.ts`). The routing function evaluates them in order to decide which intent to emit.

---
*Generated from the routing logic in `src/interfaces/tui/workbench/input/input-router.ts` and command parsing in `src/interfaces/tui/workbench/input/builtin-command.ts`.*