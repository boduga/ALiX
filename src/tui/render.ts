// src/tui/render.ts -- Split-screen TUI renderer with bottom-pinned status bar.
//
// Layout:
//   Lines 0 to (terminalHeight - 5):  Append-only output buffer
//   Line (terminalHeight - 5):        Divider (─)
//   Line (terminalHeight - 4):        State theater (currently active state)
//   Line (terminalHeight - 3):        Budget bar (tokens used / max)
//   Line (terminalHeight - 2):        Spinner / status message
//   Last line:                        Reserved (terminal edge)

import { TuiStore } from "./store.js";
import { StateTheaterWidget } from "./widgets/state-theater.js";
import { BudgetBarWidget } from "./widgets/budget-bar.js";
import { SpinnerWidget } from "./widgets/spinner.js";
import { moveToLine, clearToEndOfLine, getTerminalHeight } from "./ansi.js";
import { LAYOUT } from "./layout.js";

const STATUS_LINES = 5;  // divider + state + budget + spinner + gap
const MAX_OUTPUT_LINES = 1000;

export class TuiRenderer {
  private store: TuiStore;
  private stateTheater: StateTheaterWidget;
  private budgetBar: BudgetBarWidget;
  private spinner: SpinnerWidget;
  private running = false;
  private timerId?: NodeJS.Timeout;
  private lastRenderTime = 0;
  private initialPrinted = false;
  private outputBuffer: string[] = [];
  private statusLineStart = 0;  // computed on first render
  private outputCursor = 0;

  constructor(store: TuiStore) {
    this.store = store;
    this.stateTheater = new StateTheaterWidget();
    this.budgetBar = new BudgetBarWidget();
    this.spinner = new SpinnerWidget({ label: "Thinking..." });
    this.store.subscribe(() => this.scheduleRender());
  }

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    if (this.timerId) clearTimeout(this.timerId);
  }

  /** Append a line to the output buffer and write it above the status bar. */
  appendOutput(text: string): void {
    this.outputBuffer.push(text);
    if (this.outputBuffer.length > MAX_OUTPUT_LINES) {
      this.outputBuffer.splice(0, this.outputBuffer.length - MAX_OUTPUT_LINES);
    }
    if (!this.initialPrinted) return;

    // Write the line at the current output cursor position, then advance
    const line = this.outputCursor;
    this.outputCursor = Math.min(this.outputCursor + 1, this.statusLineStart - 1);

    process.stdout.write(moveToLine(line));
    process.stdout.write(clearToEndOfLine());
    process.stdout.write(text);
    this.renderStatus();
  }

  /** Render the initial layout: empty output area + status block pinned to bottom. */
  renderInitial(): string {
    if (this.initialPrinted) return "";
    this.initialPrinted = true;

    const h = getTerminalHeight();
    this.statusLineStart = h - STATUS_LINES;  // 0-indexed

    // Fill screen, write status at bottom, then place cursor above it
    this.lastRenderTime = performance.now();
    const result = "\n".repeat(h) + moveToLine(this.statusLineStart) + this.buildStatusBlock() + moveToLine(this.statusLineStart - 1);
    return result;
  }

  private scheduleRender(): void {
    if (!this.running) return;
    const now = performance.now();
    if (now - this.lastRenderTime >= 100) {
      this.doRender();
      this.lastRenderTime = now;
    }
    this.timerId = setTimeout(() => this.scheduleRender(), 100);
  }

  private doRender(): void {
    if (!this.initialPrinted) return;
    // Only re-render the status block (bottom STATUS_LINES lines)
    this.renderStatus();
  }

  private renderStatus(): void {
    const block = this.buildStatusBlock();
    const h = this.statusLineStart;
    // Write status block starting at statusLineStart
    process.stdout.write(moveToLine(h));
    process.stdout.write(block);
  }

  private buildStatusBlock(): string {
    const state = this.store.getState();
    this.stateTheater.setState(state.agentState);
    if (state.agentReasoning) this.stateTheater.setReasoning(state.agentReasoning);
    this.budgetBar.setTokens(state.tokenBudget.used, state.tokenBudget.max);
    this.budgetBar.setFiles(state.tokenBudget.files);

    const lines: string[] = [];

    // Divider
    const termWidth = process.stdout.columns || 80;
    lines.push("─".repeat(termWidth));

    // State theater line
    lines.push(this.stateTheater.render());

    // Budget bar line
    lines.push(this.budgetBar.render());

    // Spinner / status line
    if (this.spinner.isRunning()) {
      lines.push(this.spinner.render());
    } else {
      lines.push("");
    }

    return lines.join("\n") + "\n";
  }
}
