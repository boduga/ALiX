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

export class TuiRenderer {
  private store: TuiStore;
  private running = false;

  constructor(store: TuiStore) {
    this.store = store;
    this.store.subscribe(() => this.onStoreChange());
  }

  start(): void { this.running = true; }
  stop(): void { this.running = false; }

  /** Nothing to draw at startup — output + status appear as the agent runs. */
  drawLayout(): void {}

  /** Write a line of output. */
  appendOutput(text: string): void {
    process.stdout.write(text + "\n");
  }

  /** On every store change, write a status line. */
  private onStoreChange(): void {
    if (!this.running) return;
    const s = this.store.getState();
    const bullet = STATE_BULLET[s.agentState] ?? "○";
    const label = STATE_LABEL[s.agentState] ?? s.agentState.toUpperCase();
    const pct = s.tokenBudget.max > 0
      ? Math.round((s.tokenBudget.used / s.tokenBudget.max) * 100)
      : 0;
    const msg = s.agentReasoning ? s.agentReasoning.slice(0, 50) : "";
    const line = `${bullet} ${label}  │  Tokens: ${pct}%${msg ? `  │  ${msg}` : ""}`;
    process.stdout.write(line + "\n");
  }
}
