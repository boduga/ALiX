// src/tui/render.ts — Bottom-pinned status bar with append-only output.
//
// Key design decisions:
// 1. NO timer-based re-render — only redraw status when store state changes
//    (via subscribe callback). This eliminates the cursor save/restore race
//    between the timer and sequential appendOutput writes.
// 2. Maximum output lines capped at statusTop - 1 to prevent cursor from
//    ever entering the status area.
// 3. Divider is a fixed 40 chars (not terminal-width) to prevent line wrapping.

import { TuiStore } from "./store.js";
import { StateTheaterWidget } from "./widgets/state-theater.js";
import { BudgetBarWidget } from "./widgets/budget-bar.js";
import { SpinnerWidget } from "./widgets/spinner.js";
import { getTerminalHeight } from "./ansi.js";

const STATUS_LINES = 4;
const MAX_OUTPUT = 1000;
const DIVIDER = "─".repeat(40);

export class TuiRenderer {
  private store: TuiStore;
  private stateTheater: StateTheaterWidget;
  private budgetBar: BudgetBarWidget;
  private spinner: SpinnerWidget;
  private running = false;
  private lines: string[] = [];
  private statusTop = 0;
  private started = false;
  private outputLineCount = 0;  // tracks cursor position line

  constructor(store: TuiStore) {
    this.store = store;
    this.stateTheater = new StateTheaterWidget();
    this.budgetBar = new BudgetBarWidget();
    this.spinner = new SpinnerWidget({ label: "Thinking..." });
    // Event-driven: only re-render on actual state changes
    this.store.subscribe(() => this.onStateChange());
  }

  start(): void { this.running = true; }
  stop(): void { this.running = false; }

  /** Draw the full layout once. */
  drawLayout(): void {
    if (this.started) return;
    this.started = true;
    const h = getTerminalHeight();
    this.statusTop = h - STATUS_LINES;
    // Fill screen, draw status at bottom, leave cursor at line 1
    for (let i = 0; i < h - 1; i++) process.stdout.write("\n");
    this.writeStatus();
    process.stdout.write(`\x1b[1;1H`);
  }

  /** Add a line of output. Cap at (statusTop - 1) lines. */
  appendOutput(text: string): void {
    this.lines.push(text);
    if (this.lines.length > MAX_OUTPUT) {
      this.lines.splice(0, this.lines.length - MAX_OUTPUT);
    }
    if (!this.started) return;

    // Cap output lines to stay above the status bar
    if (this.outputLineCount >= this.statusTop - 1) return;

    process.stdout.write(text + "\n");
    this.outputLineCount += text.split("\n").length;
  }

  /** Re-draw the 4 status lines in place (event-driven, no timer). */
  private onStateChange(): void {
    if (!this.running || !this.started) return;
    // Jump to status area, overwrite, return cursor to where it was
    process.stdout.write("\x1b[s");
    this.writeStatus();
    process.stdout.write("\x1b[u");
  }

  private writeStatus(): void {
    const state = this.store.getState();
    this.stateTheater.setState(state.agentState);
    if (state.agentReasoning) this.stateTheater.setReasoning(state.agentReasoning);
    this.budgetBar.setTokens(state.tokenBudget.used, state.tokenBudget.max);
    this.budgetBar.setFiles(state.tokenBudget.files);

    const s = DIVIDER + "\n" +
      this.stateTheater.render() + "\n" +
      this.budgetBar.render() + "\n" +
      (this.spinner.isRunning() ? this.spinner.render() : "");

    process.stdout.write(`\x1b[${this.statusTop + 1};1H`);
    process.stdout.write(s);
    process.stdout.write("\x1b[J");
  }
}
