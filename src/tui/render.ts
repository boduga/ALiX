// src/tui/render.ts — Full-screen TUI using the alternate screen buffer.
//
// On start: enters alternate screen (\x1b[?1049h), maintains a buffer
// of output lines, and redraws everything on every state change:
//   Output area  — all accumulated lines, top to bottom
//   Divider      ────
//   State line   ● EXECUTING
//   Budget line  Tokens: 23%
//
// On stop: exits alternate screen (\x1b[?1049l), restoring the user's
// terminal to its state before the TUI started.

import { TuiStore, type AgentState } from "./store.js";

const STATE_BULLET: Record<string, string> = {
  idle: "○", understanding: "●", planning: "●",
  executing: "●", verifying: "●", repairing: "●",
  summarizing: "●", done: "✓", error: "✗",
};
const STATE_LABEL: Record<string, string> = {
  idle: "IDLE", understanding: "UNDERSTANDING", planning: "PLANNING",
  executing: "EXECUTING", verifying: "VERIFYING", repairing: "REPAIRING",
  summarizing: "SUMMARIZING", done: "DONE", error: "ERROR",
};

const ALT_SCREEN = "\x1b[?1049h";
const MAIN_SCREEN = "\x1b[?1049l";
const HOME = "\x1b[H";
const ERASE_DOWN = "\x1b[J";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const DIVIDER = "────────────────────────────────────────";

export class TuiRenderer {
  private store: TuiStore;
  private running = false;
  private enteredAlt = false;
  /** Accumulated output lines */
  private output: string[] = [];

  constructor(store: TuiStore) {
    this.store = store;
    this.store.subscribe(() => this.onStoreChange());
  }

  start(): void { this.running = true; }
  stop(): void {
    this.running = false;
    if (this.enteredAlt) {
      process.stdout.write(SHOW_CURSOR + MAIN_SCREEN);
      this.enteredAlt = false;
    }
  }

  drawLayout(): void {
    if (this.enteredAlt) return;
    this.enteredAlt = true;
    process.stdout.write(HIDE_CURSOR + ALT_SCREEN);
  }

  appendOutput(text: string): void {
    this.output.push(text);
    this.redraw();
  }

  private onStoreChange(): void {
    if (!this.running) return;
    this.redraw();
  }

  private redraw(): void {
    if (!this.enteredAlt) return;
    const state = this.store.getState();
    const bullet = STATE_BULLET[state.agentState] ?? "○";
    const label = STATE_LABEL[state.agentState] ?? state.agentState.toUpperCase();
    const pct = state.tokenBudget.max > 0
      ? Math.round((state.tokenBudget.used / state.tokenBudget.max) * 100)
      : 0;
    const msg = state.agentReasoning ? state.agentReasoning.slice(0, 50) : "";

    // Determine available screen height
    const h = (process.stdout.rows || 24) - 4;  // leave 4 lines for footer

    // Take the last h lines of output
    const visible = this.output.length > h
      ? this.output.slice(this.output.length - h)
      : this.output;

    // Build full frame
    const footer = `${DIVIDER}\n${bullet} ${label}  │  Tokens: ${pct}%${msg ? `  │  ${msg}` : ""}\n`;

    // Write it all at once from home position
    const frame = HOME + ERASE_DOWN + visible.join("\n") + "\n" + footer;

    process.stdout.write(frame);

    // Position cursor right above the divider
    const cursorLine = visible.length + 1;
    process.stdout.write(`\x1b[${cursorLine};1H`);
  }
}
