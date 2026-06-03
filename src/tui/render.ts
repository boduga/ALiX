// src/tui/render.ts — Bottom-pinned status bar with append-only output.
//
// Status block (4 lines) is drawn at the bottom of the terminal.
// Output writes above it, line by line, and never repeats.
// On re-render (10fps), only the status block updates in place.

import { TuiStore } from "./store.js";
import { StateTheaterWidget } from "./widgets/state-theater.js";
import { BudgetBarWidget } from "./widgets/budget-bar.js";
import { SpinnerWidget } from "./widgets/spinner.js";
import { getTerminalHeight } from "./ansi.js";

const STATUS_LINES = 4;
const MAX_OUTPUT_LINES = 1000;

export class TuiRenderer {
  private store: TuiStore;
  private stateTheater: StateTheaterWidget;
  private budgetBar: BudgetBarWidget;
  private spinner: SpinnerWidget;
  private running = false;
  private timerId?: NodeJS.Timeout;
  private lastRenderTime = 0;
  private outputBuffer: string[] = [];
  private statusTop = 0;
  private started = false;

  constructor(store: TuiStore) {
    this.store = store;
    this.stateTheater = new StateTheaterWidget();
    this.budgetBar = new BudgetBarWidget();
    this.spinner = new SpinnerWidget({ label: "Thinking..." });
    this.store.subscribe(() => this.scheduleRender());
  }

  start(): void { this.running = true; }

  stop(): void {
    this.running = false;
    if (this.timerId) clearTimeout(this.timerId);
  }

  /** Draw the full layout directly to stdout. Call once after start(). */
  drawLayout(): void {
    if (this.started) return;
    this.started = true;

    const h = getTerminalHeight();
    this.statusTop = h - STATUS_LINES;

    // Fill screen so scrollback is clear, then draw status at bottom
    for (let i = 0; i < h; i++) process.stdout.write("\n");
    this.writeStatus();
    // Place cursor at the first output line
    process.stdout.write(`\x1b[${1};1H`);
    this.lastRenderTime = performance.now();
  }

  /** Write a line of text into the output area, one line at a time. */
  appendOutput(text: string): void {
    this.outputBuffer.push(text);
    if (this.outputBuffer.length > MAX_OUTPUT_LINES) {
      this.outputBuffer.splice(0, this.outputBuffer.length - MAX_OUTPUT_LINES);
    }
    if (!this.started) return;

    // Jump to the next output line from the top
    const line = Math.min(1 + this.outputBuffer.length, this.statusTop);
    process.stdout.write(`\x1b[${line};1H`);
    process.stdout.write(text);
    process.stdout.write(`\x1b[J`);
    this.writeStatus();
    // Place cursor back in output area
    const maxLine = Math.min(this.statusTop, 1 + this.outputBuffer.length);
    process.stdout.write(`\x1b[${maxLine};1H`);
  }

  /** Overwrite the status block in place. */
  private writeStatus(): void {
    const state = this.store.getState();
    this.stateTheater.setState(state.agentState);
    if (state.agentReasoning) this.stateTheater.setReasoning(state.agentReasoning);
    this.budgetBar.setTokens(state.tokenBudget.used, state.tokenBudget.max);
    this.budgetBar.setFiles(state.tokenBudget.files);

    const w = process.stdout.columns || 80;
    const lines: string[] = [];
    lines.push("─".repeat(w));
    lines.push(this.stateTheater.render());
    lines.push(this.budgetBar.render());
    lines.push(this.spinner.isRunning() ? this.spinner.render() : "");

    const s = lines.join("\n") + "\n";
    process.stdout.write(`\x1b[${this.statusTop + 1};1H`);
    process.stdout.write(s);
  }

  private scheduleRender(): void {
    if (!this.running) return;
    const now = performance.now();
    if (now - this.lastRenderTime >= 100) {
      this.writeStatus();
      // Move cursor back to output area
      process.stdout.write(`\x1b[${1 + this.outputBuffer.length};1H`);
      this.lastRenderTime = now;
    }
    this.timerId = setTimeout(() => this.scheduleRender(), 100);
  }
}
