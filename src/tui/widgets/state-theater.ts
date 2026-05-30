import { cyan, green, red, yellow, dim } from "../ansi.js";
import type { AgentState } from "../store.js";

const STATE_ORDER: AgentState[] = ["understanding", "planning", "executing", "verifying", "summarizing"];

const STATE_ICONS = {
  idle: "○",
  understanding: "○",
  planning: "○",
  executing: "○",
  verifying: "○",
  repairing: "○",
  summarizing: "○",
  done: "✓",
  error: "✗",
};

const STATE_COLORS = {
  idle: dim,
  understanding: cyan,
  planning: cyan,
  executing: yellow,
  verifying: cyan,
  repairing: red,
  summarizing: green,
  done: green,
  error: red,
};

export class StateTheaterWidget {
  private state: AgentState;
  private reasoning: string = "";
  private showReasoning = false;

  constructor(initialState: AgentState = "idle") {
    this.state = initialState;
  }

  setState(state: AgentState): void {
    this.state = state;
  }

  setReasoning(reasoning: string): void {
    this.reasoning = reasoning;
    this.showReasoning = true;
  }

  clearReasoning(): void {
    this.reasoning = "";
    this.showReasoning = false;
  }

  render(): string {
    const parts = STATE_ORDER.map((s, idx) => {
      const isActive = s === this.state;
      const isPast = STATE_ORDER.indexOf(this.state) > idx;

      let icon = STATE_ICONS[s];
      if (isActive) icon = "●";
      else if (isPast) icon = "✓";

      const colorFn = isActive
        ? STATE_COLORS[this.state]
        : isPast
          ? green
          : dim;

      const label = s.toUpperCase();
      return colorFn(`${icon} ${label}`);
    });

    // Add special states
    if (this.state === "done" || this.state === "error") {
      const colorFn = STATE_COLORS[this.state];
      parts.push(colorFn(`${STATE_ICONS[this.state]} ${this.state.toUpperCase()}`));
    }

    const bar = parts.join("   ");

    if (this.showReasoning && this.reasoning) {
      return `${bar}\n  ${dim("Reasoning:")} ${cyan(this.reasoning)}`;
    }

    return bar;
  }
}