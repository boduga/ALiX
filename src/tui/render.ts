import { TuiStore } from "./store.js";

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
const MAX_LINES = 1000;

export class TuiRenderer {
  private store: TuiStore;
  private running = false;
  private enteredAlt = false;
  private output: string[] = [];
  /** Accumulates streaming chunks. Flushed to output when stream ends. */
  private streamBuf = "";

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

  /** Add a line or streaming chunk to the output buffer. */
  appendOutput(text: string, streaming = false): void {
    if (streaming) {
      // Streaming chunks accumulate on the current line
      this.streamBuf += text;
      this.redraw();
    } else {
      // Non-streaming: flush any accumulated stream, then add new line
      this.flushStream();
      this.output.push(text);
      if (this.output.length > MAX_LINES) {
        this.output.splice(0, this.output.length - MAX_LINES);
      }
      this.redraw();
    }
  }

  /** Push the accumulated streaming buffer as one complete line. */
  private flushStream(): void {
    if (this.streamBuf.length > 0) {
      this.output.push(this.streamBuf);
      if (this.output.length > MAX_LINES) {
        this.output.splice(0, this.output.length - MAX_LINES);
      }
      this.streamBuf = "";
    }
  }

  /** Called when store state changes — just redraw. */
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

    const h = (process.stdout.rows || 24) - 4;

    // Build visible lines: accumulated output + streaming buffer
    const allLines = [...this.output];
    if (this.streamBuf.length > 0) {
      allLines.push(this.streamBuf);
    }

    const visible = allLines.length > h
      ? allLines.slice(allLines.length - h)
      : allLines;

    const footer = `${DIVIDER}\n${bullet} ${label}  │  Tokens: ${pct}%${msg ? `  │  ${msg}` : ""}\n`;
    const frame = HOME + ERASE_DOWN + visible.join("\n") + "\n" + footer;

    process.stdout.write(frame);
  }
}
