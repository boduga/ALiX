// src/tui/render.ts — Bottom-pinned status bar with append-only output.
//
// Status block (4 lines) is drawn at the bottom of the terminal.
// Output writes from line 1 downward. Cursor advances with output.
// On re-render (10fps), only the status block updates in place.
// The cursor is always left at the last output line + 1, so
// readline prompts and other sequential writes appear in order.

import { TuiStore } from "./store.js";
import { StateTheaterWidget } from "./widgets/state-theater.js";
import { BudgetBarWidget } from "./widgets/budget-bar.js";
import { SpinnerWidget } from "./widgets/spinner.js";
import { getTerminalHeight } from "./ansi.js";

const STATUS_LINES = 4;
const MAX_OUTPUT = 1000;

export class TuiRenderer {
  private store: TuiStore;
  private stateTheater: StateTheaterWidget;
  private budgetBar: BudgetBarWidget;
  private spinner: SpinnerWidget;
  private running = false;
  private timerId?: NodeJS.Timeout;
  private lastRender = 0;
  private lines: string[] = [];
  private statusTop = 0;
  private started = false;

  constructor(store: TuiStore) {
    this.store = store;
    this.stateTheater = new StateTheaterWidget();
    this.budgetBar = new BudgetBarWidget();
    this.spinner = new SpinnerWidget({ label: "Thinking..." });
    this.store.subscribe(() => this.schedule());
  }

  start(): void { this.running = true; }
  stop(): void { this.running = false; if (this.timerId) clearTimeout(this.timerId); }

  /** Draw the full layout once. */
  drawLayout(): void {
    if (this.started) return;
    this.started = true;
    const h = getTerminalHeight();
    this.statusTop = h - STATUS_LINES;
    for (let i = 0; i < h - 1; i++) process.stdout.write("\n");
    this.renderStatus();
    // Cursor is now at line h (bottom). Move it to line 1.
    process.stdout.write(`\x1b[1;1H`);
    this.lastRender = performance.now();
  }

  /** Add a line of output. Writes at cursor position then advances. */
  appendOutput(text: string): void {
    this.lines.push(text);
    if (this.lines.length > MAX_OUTPUT) this.lines.splice(0, this.lines.length - MAX_OUTPUT);
    if (!this.started) return;

    process.stdout.write(text + "\n");
    // If we just wrote past the status area, jump back up
    // The cursor is now on the next line after text.
    // We don't need to move it — it's already in the right place.
  }

  /** Re-draw the 4 status lines in place. */
  private renderStatus(): void {
    const state = this.store.getState();
    this.stateTheater.setState(state.agentState);
    if (state.agentReasoning) this.stateTheater.setReasoning(state.agentReasoning);
    this.budgetBar.setTokens(state.tokenBudget.used, state.tokenBudget.max);
    this.budgetBar.setFiles(state.tokenBudget.files);

    // Build status block
    const w = (process.stdout.columns || 80);
    const s = "─".repeat(w) + "\n" +
      this.stateTheater.render() + "\n" +
      this.budgetBar.render() + "\n" +
      (this.spinner.isRunning() ? this.spinner.render() : "");

    // Save cursor, write status, restore cursor
    process.stdout.write("\x1b[s");                                    // save
    process.stdout.write(`\x1b[${this.statusTop + 1};1H`);              // move to status start
    process.stdout.write(s);
    process.stdout.write("\x1b[J");                                    // clear below
    process.stdout.write("\x1b[u");                                    // restore
  }

  private schedule(): void {
    if (!this.running) return;
    const now = performance.now();
    if (now - this.lastRender >= 100) {
      // Save cursor, re-draw status, restore
      process.stdout.write("\x1b[s");
      this.renderStatus();
      process.stdout.write("\x1b[u");
      this.lastRender = now;
    }
    this.timerId = setTimeout(() => this.schedule(), 100);
  }
}
